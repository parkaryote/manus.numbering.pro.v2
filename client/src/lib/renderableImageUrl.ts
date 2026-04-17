const ABSOLUTE_HTTP_URL = /^https?:\/\//i;
const IMAGE_PROXY_FALLBACK_PARAM = "__raw";
const IMAGE_PROXY_BASE = "/api/image-proxy";

function buildProxyUrl(imageUrl: string): string {
  return `${IMAGE_PROXY_BASE}?url=${encodeURIComponent(imageUrl)}&${IMAGE_PROXY_FALLBACK_PARAM}=1`;
}

export function isRenderableImageAbsoluteUrl(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  const trimmed = imageUrl.trim();
  if (!trimmed) return false;
  return ABSOLUTE_HTTP_URL.test(trimmed);
}

export function getRenderableImageCandidates(imageUrl?: string | null): string[] {
  if (!imageUrl) return [];
  const trimmed = imageUrl.trim();
  if (!trimmed) return [];
  if (!isRenderableImageAbsoluteUrl(trimmed)) return [trimmed];
  if (trimmed.includes(`${IMAGE_PROXY_FALLBACK_PARAM}=1`)) return [trimmed];
  return [trimmed, buildProxyUrl(trimmed)];
}

export function resolveRenderableImageUrl(imageUrl?: string | null): string {
  const candidates = getRenderableImageCandidates(imageUrl);
  return candidates[0] ?? "";
}
