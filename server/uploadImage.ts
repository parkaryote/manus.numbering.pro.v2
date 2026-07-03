import express from "express";
import multer from "multer";
import { storagePut } from "./storage.js";
import { nanoid } from "nanoid";
import { sdk } from "./_core/sdk.js";

const router = express.Router();
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXT_BY_IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function toStableUploadsPath(relKey: string): string {
  const normalized = relKey.replace(/^\/+/, "").replace(/\\/g, "/");
  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/uploads/${encodedPath}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024, // 16MB
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has((file.mimetype ?? "").toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only jpg/png/webp/gif images are allowed"));
    }
  },
});

router.post("/", async (req, res, next) => {
  try {
    await sdk.authenticateRequest(req as any);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const normalizedMime = (req.file.mimetype ?? "").toLowerCase();
    const fileExtension = EXT_BY_IMAGE_MIME[normalizedMime] ?? "jpg";
    const fileKey = `questions/${nanoid()}.${fileExtension}`;

    const { url: remoteUrl } = await storagePut(
      fileKey,
      req.file.buffer,
      normalizedMime
    );

    // Always return an app-internal stable URL so DB records survive
    // storage CDN/domain changes or signed URL policies.
    const stableUrl = toStableUploadsPath(fileKey);
    res.json({ url: stableUrl, key: fileKey, remoteUrl });
  } catch (error) {
    console.error("[Image Upload] Error:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

export default router;
