import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import uploadAudioRouter from "../uploadAudio.js";
import uploadImageRouter from "../uploadImage.js";
import { createContext } from "./context.js";
import { registerOAuthRoutes } from "./oauth.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
