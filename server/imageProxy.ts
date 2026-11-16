import express from "express";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// 내부망/루프백/링크로컬(클라우드 메타데이터 포함) 대역. SSRF 방지용.
const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 3, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:7f00:1) 는 IPv4 규칙으로 검사한다.
    const mapped = address.toLowerCase().match(/^::ffff:(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (isIP(tail) === 4) return blockedAddresses.check(tail, "ipv4");
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const high = parseInt(hex[1], 16);
        const low = parseInt(hex[2], 16);
        const dotted = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
        return blockedAddresses.check(dotted, "ipv4");
      }
      return true;
    }
    return blockedAddresses.check(address, "ipv6");
  }
  return true;
}

export function isBlockedHost(hostname: string): boolean {
  // URL.hostname 은 IPv6 를 [::1] 처럼 대괄호로 감싸서 돌려준다.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host)) return isBlockedAddress(host);
  return false;
}

async function resolvesToBlockedAddress(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isBlockedAddress(host);
  try {
    const records = await lookup(host, { all: true });
    if (records.length === 0) return true;
    return records.some((record) => isBlockedAddress(record.address));
  } catch {
    return true;
  }
}

export function parseTargetUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

class ProxyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// 리다이렉트를 직접 따라가면서 매 홉마다 목적지를 다시 검증한다.
async function fetchImage(initialUrl: URL, signal: AbortSignal): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (await resolvesToBlockedAddress(currentUrl.hostname)) {
      throw new ProxyError(400, "Invalid image url");
    }
    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        // Avoid some providers blocking "empty" UA fetches
        "user-agent": "numbering.pro-image-proxy/1.0",
      },
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    const nextUrl = location ? parseTargetUrl(new URL(location, currentUrl).toString()) : null;
    if (!nextUrl) throw new ProxyError(400, "Invalid image url");
    currentUrl = nextUrl;
  }
  throw new ProxyError(508, "Too many redirects");
}

async function readBodyWithLimit(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new ProxyError(413, "Image too large");
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ProxyError(413, "Image too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

router.get("/", async (req, res) => {
  const targetUrl = parseTargetUrl(req.query.url);
  if (!targetUrl) {
    return res.status(400).json({ error: "Invalid image url" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetchImage(targetUrl, controller.signal);

    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return res.status(upstream.status).json({ error: "Image fetch failed" });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      await upstream.body?.cancel().catch(() => undefined);
      return res.status(415).json({ error: "Unsupported content type" });
    }

    const cacheControl =
      upstream.headers.get("cache-control") ||
      "public, max-age=3600, s-maxage=3600";
    const etag = upstream.headers.get("etag");
    const lastModified = upstream.headers.get("last-modified");
    const body = await readBodyWithLimit(upstream);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    if (etag) res.setHeader("ETag", etag);
    if (lastModified) res.setHeader("Last-Modified", lastModified);
    res.setHeader("Vary", "Accept");
    // 외부 SVG 등을 우리 도메인에서 직접 열어도 스크립트가 실행되지 않게 한다.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return res.status(200).send(body);
  } catch (error) {
    if (error instanceof ProxyError) {
      return res.status(error.status).json({ error: error.message });
    }
    const isAbort = error instanceof Error && error.name === "AbortError";
    if (isAbort) {
      return res.status(504).json({ error: "Image fetch timeout" });
    }
    return res.status(502).json({ error: "Image proxy error" });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
