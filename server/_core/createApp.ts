import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import uploadAudioRouter from "../uploadAudio.js";
import uploadImageRouter from "../uploadImage.js";
import imageProxyRouter from "../imageProxy.js";
import { storageGet } from "../storage.js";
import { createContext } from "./context.js";
import { registerOAuthRoutes } from "./oauth.js";
import { resolveUploadsDir } from "./uploadsDir.js";
import fs from "fs";
import path from "path";

const UPLOAD_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"] as const;
const KNOWN_MISSING_UPLOAD_FALLBACKS: Record<string, string> = {
  "questions/efIYp0Qy4eIhEy8THYf7T.webp": "/demo-assets/tooth-direction.png",
};
const KNOWN_MISSING_UPLOAD_FALLBACKS_BY_BASENAME: Record<string, string> = {
  "efIYp0Qy4eIhEy8THYf7T.webp": "/demo-assets/tooth-direction.png",
};

function resolveHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function resolveRequestOrigin(req: {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}): string {
  const headers = req.headers ?? {};
  const forwardedProto = resolveHeaderValue(headers["x-forwarded-proto"]).split(",")[0]?.trim();
  const forwardedHost = resolveHeaderValue(headers["x-forwarded-host"]).split(",")[0]?.trim();
  const host = forwardedHost || resolveHeaderValue(headers.host).split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  if (!host) return "";
  return `${proto}://${host}`;
}

function normalizeSampleRate(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

type RequestIpLike = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

function getClientIp(req: RequestIpLike): string {
  const forwardedFor = getHeaderValue(req.headers?.["x-forwarded-for"]);
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  return (req.ip || req.socket?.remoteAddress || "").slice(0, 128);
}

function sanitizeUserAgent(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.slice(0, 256);
}

function decodeUploadRelativePathFromUrl(rawUrl: string): string {
  const pathOnly = rawUrl.split("?")[0] || "";
  const withoutPrefix = pathOnly.replace(/^\/uploads\/?/i, "");
  const decoded = withoutPrefix
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
  return decoded.replace(/^\/+/, "");
}

function resolveSafeUploadPath(rootDir: string, relPath: string): string | null {
  const root = path.resolve(rootDir);
  const absolute = path.resolve(root, relPath);
  if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) return null;
  return absolute;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function buildUploadRelativePathVariants(relPath: string): string[] {
  const normalized = relPath.replace(/^\/+/, "");
  if (!normalized) return [];

  const querySplitIndex = normalized.indexOf("?");
  const pathOnly =
    querySplitIndex >= 0 ? normalized.slice(0, querySplitIndex) : normalized;
  const query = querySplitIndex >= 0 ? normalized.slice(querySplitIndex) : "";
  const match = pathOnly.match(/^(.*?)(\.[a-z0-9]+)$/i);
  if (!match) return [normalized];

  const base = match[1] ?? pathOnly;
  const ext = (match[2] ?? "").toLowerCase();
  if (!UPLOAD_IMAGE_EXTENSIONS.includes(ext as (typeof UPLOAD_IMAGE_EXTENSIONS)[number])) {
    return [normalized];
  }

  const variants: string[] = [`${base}${ext}${query}`];
  for (const candidateExt of UPLOAD_IMAGE_EXTENSIONS) {
    if (candidateExt === ext) continue;
    variants.push(`${base}${candidateExt}${query}`);
  }
  return variants;
}

function resolveKnownMissingUploadFallback(relPath: string): string | null {
  const normalized = relPath.replace(/^\/+/, "").trim();
  if (!normalized) return null;
  const directMatch = KNOWN_MISSING_UPLOAD_FALLBACKS[normalized];
  if (directMatch) return directMatch;
  const basename = path.posix.basename(normalized);
  if (!basename) return null;
  return KNOWN_MISSING_UPLOAD_FALLBACKS_BY_BASENAME[basename] ?? null;
}

async function verifyRemoteAssetAvailability(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
    });
    // 일부 스토리지는 HEAD 405/403을 반환하지만 GET은 정상 동작한다.
    if (response.status === 403 || response.status === 405) return true;
    return response.ok;
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();
  const localUploadsDir = resolveUploadsDir();
  if (!fs.existsSync(localUploadsDir)) {
    fs.mkdirSync(localUploadsDir, { recursive: true });
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/uploads", express.static(localUploadsDir));
  app.use("/uploads", async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const relPath = decodeUploadRelativePathFromUrl(req.originalUrl || req.url || "");
    if (!relPath) return next();
    const relPathCandidates = buildUploadRelativePathVariants(relPath);

    // 1) 업로드 디렉터리 확장자 변형 폴백 (.webp -> .png 등)
    for (const candidateRelPath of relPathCandidates) {
      const localCandidate = resolveSafeUploadPath(localUploadsDir, candidateRelPath);
      if (localCandidate && fs.existsSync(localCandidate)) {
        return res.sendFile(localCandidate);
      }
    }

    // 2) 번들된 public 업로드 자산 폴백 (데모/하드코딩 이미지)
    const publicUploadsDir =
      process.env.NODE_ENV === "production"
        ? path.resolve(process.cwd(), "dist", "public", "uploads")
        : path.resolve(process.cwd(), "client", "public", "uploads");
    for (const candidateRelPath of relPathCandidates) {
      const publicCandidate = resolveSafeUploadPath(publicUploadsDir, candidateRelPath);
      if (publicCandidate && fs.existsSync(publicCandidate)) {
        return res.sendFile(publicCandidate);
      }
    }

    const knownFallbackPath = resolveKnownMissingUploadFallback(relPath);
    if (knownFallbackPath) {
      return res.redirect(307, knownFallbackPath);
    }

    // 3) 원격 스토리지 연동 환경일 때는 서명 URL로 폴백
    try {
      let firstRemoteUrl: string | null = null;
      for (const candidateRelPath of relPathCandidates) {
        const remote = await storageGet(candidateRelPath);
        if (!remote?.url || !isAbsoluteHttpUrl(remote.url)) continue;
        if (!firstRemoteUrl) firstRemoteUrl = remote.url;
        const isAvailable = await verifyRemoteAssetAvailability(remote.url);
        if (isAvailable) {
          return res.redirect(307, remote.url);
        }
      }
      if (firstRemoteUrl) {
        return res.redirect(307, firstRemoteUrl);
      }
    } catch (error) {
      console.warn("[uploads] fallback resolve failed:", error);
    }

    return next();
  });

  const trafficLogEnabled = process.env.TRAFFIC_LOG_ENABLED !== "false";
  const trafficLogSampleRate = normalizeSampleRate(process.env.TRAFFIC_LOG_SAMPLE_RATE);
  if (trafficLogEnabled) {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      res.on("finish", () => {
        if (trafficLogSampleRate <= 0) return;
        if (trafficLogSampleRate < 1 && Math.random() > trafficLogSampleRate) return;

        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const rawHost = getHeaderValue(req.headers["x-forwarded-host"]) || getHeaderValue(req.headers.host);
        const rawReferer = getHeaderValue(req.headers.referer);
        const userAgent = sanitizeUserAgent(getHeaderValue(req.headers["user-agent"]));
        const method = req.method.toUpperCase();
        const path = (req.originalUrl || req.url || "/").slice(0, 512);

        const payload = {
          ts: new Date().toISOString(),
          type: "traffic",
          method,
          path,
          status: res.statusCode,
          durationMs: Math.max(0, Math.round(elapsedMs)),
          ip: getClientIp(req),
          host: rawHost.slice(0, 128),
          referer: rawReferer.slice(0, 256),
          userAgent,
        };

        console.log(`[Traffic] ${JSON.stringify(payload)}`);
      });
      next();
    });
  }

  app.use((req, res, next) => {
    const isProd = process.env.NODE_ENV === "production";
    const csp = isProd
      ? [
          "default-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://vercel.live",
          "connect-src 'self' https://www.google-analytics.com https://vitals.vercel-insights.com https://www.googletagmanager.com",
          "frame-src https://accounts.google.com",
          "object-src 'none'",
          "upgrade-insecure-requests",
        ].join("; ")
      : [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss: https: http:",
          "img-src 'self' data: blob: https: http:",
          "connect-src 'self' ws: wss: https: http:",
          "frame-src https://accounts.google.com",
          "object-src 'none'",
        ].join("; ");

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Content-Security-Policy", csp);
    next();
  });

  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

    const originHeader = resolveHeaderValue(req.headers.origin);
    if (!originHeader) return next();

    const requestOrigin = resolveRequestOrigin(req);
    if (!requestOrigin) {
      return res.status(400).json({ error: "Invalid host header" });
    }

    try {
      const origin = new URL(originHeader).origin;
      if (origin !== requestOrigin) {
        return res.status(403).json({ error: "Cross-origin mutation is blocked" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid origin header" });
    }
    return next();
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const forwardedHost = req.headers["x-forwarded-host"];
    const rawHost = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost || req.headers.host || "";
    const host = String(rawHost).split(",")[0]?.trim().toLowerCase().split(":")[0];

    if (host === "www.numbering.pro") {
      const targetUrl = `https://numbering.pro${req.originalUrl || req.url || "/"}`;
      return res.redirect(308, targetUrl);
    }

    return next();
  });

  registerOAuthRoutes(app);

  // Keep /api prefix for existing clients, and also expose stripped paths
  // for serverless catch-all environments that may mount under /api.
  app.use("/api", uploadAudioRouter);
  app.use("/", uploadAudioRouter);

  app.use("/api/upload/image", uploadImageRouter);
  app.use("/upload/image", uploadImageRouter);
  app.use("/api/image-proxy", imageProxyRouter);
  app.use("/image-proxy", imageProxyRouter);

  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
  });
  app.use("/api/trpc", trpcMiddleware);
  app.use("/trpc", trpcMiddleware);

  return app;
}
