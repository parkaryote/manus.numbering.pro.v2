import { Router } from "express";
import multer from "multer";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.post("/upload-audio", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileKey = `audio/${nanoid()}.webm`;
    const result = await storagePut(fileKey, req.file.buffer, "audio/webm");

    res.json({ audioUrl: result.url });
  } catch (error) {
    console.error("Audio upload error:", error);
    res.status(500).json({ error: "Failed to upload audio" });
  }
});

export default router;
