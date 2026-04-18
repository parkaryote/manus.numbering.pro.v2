const ABSOLUTE_HTTP_URL = /^https?:\/\//i;
const IMAGE_PROXY_FALLBACK_PARAM = "__raw";
const IMAGE_PROXY_BASE = "/api/image-proxy";
const ABSOLUTE_PROTOCOL_RELATIVE_URL = /^\/\//;
const DATA_OR_BLOB_URL = /^(data:|blob:)/i;

function buildProxyUrl(imageUrl: string): string {
  return `${IMAGE_PROXY_BASE}?url=${encodeURIComponent(imageUrl)}&${IMAGE_PROXY_FALLBACK_PARAM}=1`;
}

function toAbsoluteProtocolRelativeUrl(raw: string): string {
  const protocol =
    typeof window !== "undefined" && window.location?.protocol
      ? window.location.protocol
      : "https:";
  return `${protocol}${raw}`;
}

function normalizeRelativePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed.replace(/^\.?\/*/, "")}`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function isRenderableImageAbsoluteUrl(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  const trimmed = imageUrl.trim();
  if (!trimmed) return false;
  return ABSOLUTE_HTTP_URL.test(trimmed) || ABSOLUTE_PROTOCOL_RELATIVE_URL.test(trimmed);
}

export function getRenderableImageCandidates(imageUrl?: string | null): string[] {
  if (!imageUrl) return [];
  const trimmed = imageUrl.trim();
  if (!trimmed) return [];
  if (DATA_OR_BLOB_URL.test(trimmed)) return [trimmed];

  const normalizedAbsolute = ABSOLUTE_PROTOCOL_RELATIVE_URL.test(trimmed)
    ? toAbsoluteProtocolRelativeUrl(trimmed)
    : trimmed;

  if (!isRenderableImageAbsoluteUrl(normalizedAbsolute)) {
    return unique([normalizeRelativePath(normalizedAbsolute)]);
  }

  if (normalizedAbsolute.includes(`${IMAGE_PROXY_FALLBACK_PARAM}=1`)) {
    return [normalizedAbsolute];
  }

  const candidates: string[] = [normalizedAbsolute];
  try {
    const parsed = new URL(normalizedAbsolute);
    if (parsed.pathname.startsWith("/uploads/")) {
      // 운영 도메인 변경/저장경로 이전 시에도 동일 경로 우선 재시도
      candidates.push(parsed.pathname);
    }
  } catch {
    // ignore URL parsing failure
  }
  candidates.push(buildProxyUrl(normalizedAbsolute));
  return unique(candidates);
}

export function resolveRenderableImageUrl(imageUrl?: string | null): string {
  const candidates = getRenderableImageCandidates(imageUrl);
  return candidates[0] ?? "";
}
