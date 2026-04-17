const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

export function resolveRenderableImageUrl(imageUrl?: string | null): string {
  if (!imageUrl) return "";
  const trimmed = imageUrl.trim();
  if (!trimmed) return "";
  if (!ABSOLUTE_HTTP_URL.test(trimmed)) {
    return trimmed;
  }
  return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
}
