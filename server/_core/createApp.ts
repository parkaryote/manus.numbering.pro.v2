import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import uploadAudioRouter from "../uploadAudio.js";
import uploadImageRouter from "../uploadImage.js";
import imageProxyRouter from "../imageProxy.js";
import { storageGet } from "../storage.js";
import { createContext } from "./context.js";
import { registerOAuthRoutes } from "./oauth.js";
import fs from "fs";
import path from "path";

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

export function createApp() {
  const app = express();
  const localUploadsDir =
    process.env.LOCAL_UPLOAD_DIR?.trim() ||
    path.resolve(process.cwd(), "var", "uploads");
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

    // 1) 번들된 public 업로드 자산 폴백 (데모/하드코딩 이미지)
    const publicUploadsDir =
      process.env.NODE_ENV === "production"
        ? path.resolve(process.cwd(), "dist", "public", "uploads")
        : path.resolve(process.cwd(), "client", "public", "uploads");
    const publicCandidate = resolveSafeUploadPath(publicUploadsDir, relPath);
    if (publicCandidate && fs.existsSync(publicCandidate)) {
      return res.sendFile(publicCandidate);
    }

    // 2) 원격 스토리지 연동 환경일 때는 서명 URL로 폴백
    try {
      const remote = await storageGet(relPath);
      if (remote?.url && isAbsoluteHttpUrl(remote.url)) {
        return res.redirect(307, remote.url);
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

    const isRailwayHost = host?.endsWith(".up.railway.app");
    const pathWithQuery = req.originalUrl || req.url || "/";
    const pathOnly = String(pathWithQuery).split("?")[0] || "/";
    const isAuthRelatedPath =
      pathOnly === "/login" ||
      pathOnly === "/oauth/callback" ||
      pathOnly === "/api/oauth/callback";
    if (isRailwayHost && isAuthRelatedPath) {
      const targetUrl = `https://numbering.pro${pathWithQuery}`;
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
