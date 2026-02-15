/**
 * Document Upload Router - Server-only module
 * 
 * 이 라우터는 PDF/PPT/이미지 파일 업로드를 처리합니다.
 * OCR 처리는 비동기로 진행되며, Job 기반 API를 제공합니다.
 */

import express from "express";
import multer from "multer";

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
      cb(new Error("Unsupported file type"));
    }
  },
});

// TODO: OCR 라우트 구현
// POST /api/upload/document - 파일 업로드 및 OCR 작업 시작
// GET /api/ocr/jobs/:id - 작업 상태 조회
// GET /api/ocr/jobs/:id/result - 결과 조회

export default router;
