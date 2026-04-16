import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import uploadAudioRouter from "../uploadAudio.js";
import uploadImageRouter from "../uploadImage.js";
import { createContext } from "./context.js";
import { registerOAuthRoutes } from "./oauth.js";

function resolveHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function resolveRequestOrigin(req: express.Request): string {
  const forwardedProto = resolveHeaderValue(req.headers["x-forwarded-proto"]).split(",")[0]?.trim();
  const forwardedHost = resolveHeaderValue(req.headers["x-forwarded-host"]).split(",")[0]?.trim();
  const host = forwardedHost || resolveHeaderValue(req.headers.host).split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  if (!host) return "";
  return `${proto}://${host}`;
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
    if (process.env.NODE_ENV !== "production") return next();
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

  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
  });
  app.use("/api/trpc", trpcMiddleware);
  app.use("/trpc", trpcMiddleware);

  return app;
}
