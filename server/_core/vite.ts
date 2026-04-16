import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

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

function injectOgRuntimeMeta(template: string, req: {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
  originalUrl?: string;
  url?: string;
}, updatedAtISO: string): string {
  const origin = resolveRequestOrigin(req);
  const pathWithQuery = req.originalUrl || req.url || "/";
  const ogUrl = origin ? `${origin}${pathWithQuery}` : "https://numbering.pro/";
  return template
    .replaceAll("__OG_URL__", ogUrl)
    .replaceAll("__OG_UPDATED_AT__", updatedAtISO);
}

export async function setupVite(app: Express, server: Server) {
  const ogUpdatedAtISO = new Date().toISOString();
  const serverOptions = {
    middlewareMode: true,
    hmr: false,
    allowedHosts: true as const,
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/.cache/**",
        "**/.pnpm-store/**",
        "**/tmp/**",
        "**/.output/**",
        "**/.vercel/**",
        "**/.manus-logs/**",
      ],
      usePolling: true,
      interval: 2000,
    },
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      template = injectOgRuntimeMeta(template, req, ogUpdatedAtISO);
      const page = await vite.transformIndexHtml(url, template);
      res
        .status(200)
        .set({
          "Content-Type": "text/html",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        })
        .end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const ogUpdatedAtISO = new Date().toISOString();
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      },
    })
  );

  // fall through to index.html if the file doesn't exist
  app.use("*", async (req, res, next) => {
    try {
      const indexPath = path.resolve(distPath, "index.html");
      const template = await fs.promises.readFile(indexPath, "utf-8");
      const html = injectOgRuntimeMeta(template, req, ogUpdatedAtISO);
      res
        .status(200)
        .set({
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        })
        .end(html);
    } catch (error) {
      next(error);
    }
  });
}
