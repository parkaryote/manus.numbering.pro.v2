/**
 * Document Upload Router
 * 
 * Handles PDF/PPT/image file uploads, runs OCR via Google Cloud Vision API,
 * and returns extracted text for problem registration.
 */

import express from "express";
import multer from "multer";
import { extractTextFromPdf, extractTextFromPpt, extractTextFromImage } from "./ocr";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, PPT, PPTX, JPEG, PNG, WebP, GIF`));
    }
  },
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { mimetype, buffer, originalname } = req.file;
    console.log(`[Document Upload] Processing ${originalname} (${mimetype}, ${buffer.length} bytes)`);

    let result;

    if (mimetype === "application/pdf") {
      result = await extractTextFromPdf(buffer);
    } else if (
      mimetype === "application/vnd.ms-powerpoint" ||
      mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      result = await extractTextFromPpt(buffer, originalname);
    } else if (mimetype.startsWith("image/")) {
      result = await extractTextFromImage(buffer);
    } else {
      return res.status(400).json({ error: `Unsupported file type: ${mimetype}` });
    }

    console.log(`[Document Upload] OCR complete: ${result.totalPages} pages, ${result.rawText.length} chars`);

    res.json({
      success: true,
      filename: originalname,
      totalPages: result.totalPages,
      pages: result.pages,
      rawText: result.rawText,
    });
  } catch (error: any) {
    console.error("[Document Upload] Error:", error);
    
    // Provide user-friendly error messages
    if (error.message?.includes("GOOGLE_APPLICATION_CREDENTIALS") || error.message?.includes("authentication")) {
      return res.status(503).json({ 
        error: "OCR 서비스가 설정되지 않았습니다. 관리자에게 문의하세요." 
      });
    }
    
    res.status(500).json({ 
      error: error.message || "파일 처리 중 오류가 발생했습니다." 
    });
  }
});

export default router;
