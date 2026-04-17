import express from "express";

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "::1") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function parseTargetUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

router.get("/", async (req, res) => {
  const targetUrl = parseTargetUrl(req.query.url);
  if (!targetUrl) {
    return res.status(400).json({ error: "Invalid image url" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Avoid some providers blocking "empty" UA fetches
        "user-agent": "numbering.pro-image-proxy/1.0",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Image fetch failed" });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      return res.status(415).json({ error: "Unsupported content type" });
    }

    const cacheControl =
      upstream.headers.get("cache-control") ||
      "public, max-age=3600, s-maxage=3600";
    const etag = upstream.headers.get("etag");
    const lastModified = upstream.headers.get("last-modified");
    const body = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    if (etag) res.setHeader("ETag", etag);
    if (lastModified) res.setHeader("Last-Modified", lastModified);
    res.setHeader("Vary", "Accept");
    return res.status(200).send(body);
  } catch (error) {
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
