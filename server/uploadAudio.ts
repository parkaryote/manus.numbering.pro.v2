import { Router } from "express";
import multer from "multer";
import { storagePut } from "./storage.js";
import { nanoid } from "nanoid";
import { sdk } from "./_core/sdk.js";

const router = Router();
const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
]);

const EXT_BY_AUDIO_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AUDIO_MIME.has((file.mimetype ?? "").toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only supported audio files are allowed"));
    }
  },
});

router.post("/upload-audio", async (req, res, next) => {
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
    const fileExtension = EXT_BY_AUDIO_MIME[normalizedMime] ?? "webm";
    const fileKey = `audio/${nanoid()}.${fileExtension}`;
    const result = await storagePut(fileKey, req.file.buffer, normalizedMime);

    res.json({ audioUrl: result.url });
  } catch (error) {
    console.error("Audio upload error:", error);
    res.status(500).json({ error: "Failed to upload audio" });
  }
});

export default router;
