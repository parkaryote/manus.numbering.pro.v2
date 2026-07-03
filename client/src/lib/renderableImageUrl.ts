const ABSOLUTE_HTTP_URL = /^https?:\/\//i;
const IMAGE_PROXY_FALLBACK_PARAM = "__raw";
const IMAGE_PROXY_BASE = "/api/image-proxy";
const ABSOLUTE_PROTOCOL_RELATIVE_URL = /^\/\//;
const DATA_OR_BLOB_URL = /^(data:|blob:)/i;
const UPLOAD_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"] as const;

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

function buildUploadPathVariants(pathname: string): string[] {
  const normalizedPath = normalizeRelativePath(pathname);
  if (!normalizedPath.startsWith("/uploads/")) return [normalizedPath];

  const querySplitIndex = normalizedPath.indexOf("?");
  const pathOnly =
    querySplitIndex >= 0 ? normalizedPath.slice(0, querySplitIndex) : normalizedPath;
  const query = querySplitIndex >= 0 ? normalizedPath.slice(querySplitIndex) : "";
  const match = pathOnly.match(/^(.*?)(\.[a-z0-9]+)$/i);
  if (!match) return [normalizedPath];

  const base = match[1] ?? pathOnly;
  const ext = (match[2] ?? "").toLowerCase();
  if (!UPLOAD_IMAGE_EXTENSIONS.includes(ext as (typeof UPLOAD_IMAGE_EXTENSIONS)[number])) {
    return [normalizedPath];
  }

  const variants: string[] = [`${base}${ext}${query}`];
  for (const candidateExt of UPLOAD_IMAGE_EXTENSIONS) {
    if (candidateExt === ext) continue;
    variants.push(`${base}${candidateExt}${query}`);
  }
  return variants;
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

function extractLegacyStorageKeyPath(absoluteUrl: string): string | null {
  try {
    const parsed = new URL(absoluteUrl);
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    if (!segments.length) return null;

    const preferredRoots = ["questions", "audio"];
    for (const root of preferredRoots) {
      const idx = segments.lastIndexOf(root);
      if (idx >= 0 && idx < segments.length - 1) {
        const key = segments.slice(idx).join("/");
        return normalizeRelativePath(`/uploads/${key}`);
      }
    }

    // Secondary heuristic: if the upstream URL already contains '/uploads/...'
    const uploadsIdx = segments.lastIndexOf("uploads");
    if (uploadsIdx >= 0 && uploadsIdx < segments.length - 1) {
      const key = segments.slice(uploadsIdx + 1).join("/");
      return normalizeRelativePath(`/uploads/${key}`);
    }
  } catch {
    // ignore URL parsing failure
  }
  return null;
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
    return unique(buildUploadPathVariants(normalizeRelativePath(normalizedAbsolute)));
  }

  if (normalizedAbsolute.includes(`${IMAGE_PROXY_FALLBACK_PARAM}=1`)) {
    return [normalizedAbsolute];
  }

  const candidates: string[] = [normalizedAbsolute];
  try {
    const parsed = new URL(normalizedAbsolute);
    if (parsed.pathname.startsWith("/uploads/")) {
      // 운영 도메인 변경/저장경로 이전 시에도 동일 경로 우선 재시도
      candidates.push(...buildUploadPathVariants(parsed.pathname));
    }
  } catch {
    // ignore URL parsing failure
  }
  const legacyKeyPath = extractLegacyStorageKeyPath(normalizedAbsolute);
  if (legacyKeyPath) {
    candidates.push(...buildUploadPathVariants(legacyKeyPath));
  }
  candidates.push(buildProxyUrl(normalizedAbsolute));
  return unique(candidates);
}

export function resolveRenderableImageUrl(imageUrl?: string | null): string {
  const candidates = getRenderableImageCandidates(imageUrl);
  return candidates[0] ?? "";
}
