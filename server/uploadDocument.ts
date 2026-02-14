/**
 * Document Upload Router - Job 기반 API
 * 
 * 1. POST /api/upload/document - 파일 업로드 및 OCR 작업 시작
 * 2. GET /api/ocr/jobs/:id - 작업 상태 조회
 * 3. GET /api/ocr/jobs/:id/result - 결과 조회
 */

import express from "express";
import multer from "multer";
import { startOcrJob, getOcrJobStatus, getOcrJobResult } from "./ocr";
import { storagePut } from "./storage";
import { v4 as uuidv4 } from "uuid";

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

/**
 * POST /api/upload/document
 * 파일 업로드 및 OCR 작업 시작
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { mimetype, buffer, originalname } = req.file;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    console.log(`[Document Upload] Processing ${originalname} (${mimetype}, ${buffer.length} bytes) for user ${userId}`);

    // 1. S3에 파일 업로드
    const s3Key = `ocr-uploads/${userId}/${uuidv4()}/${originalname}`;
    const { url: s3Url } = await storagePut(s3Key, buffer, mimetype);

    console.log(`[Document Upload] Uploaded to S3: ${s3Key}`);

    // 2. OCR 작업 시작
    const { jobId, status } = await startOcrJob(userId, s3Key, originalname, mimetype);

    console.log(`[Document Upload] OCR job started: ${jobId}`);

    res.json({
      success: true,
      jobId,
      status,
      filename: originalname,
      s3Url,
    });
  } catch (error: any) {
    console.error("[Document Upload] Error:", error);

    // 사용자 친화적 에러 메시지
    if (error.message?.includes("GOOGLE_APPLICATION_CREDENTIALS") || error.message?.includes("authentication")) {
      return res.status(503).json({
        error: "OCR 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.",
      });
    }

    res.status(500).json({
      error: error.message || "파일 처리 중 오류가 발생했습니다.",
    });
  }
});

export default router;
