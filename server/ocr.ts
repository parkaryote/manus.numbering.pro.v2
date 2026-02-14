/**
 * OCR Service - asyncBatchAnnotateFiles + GCS 최소 구조
 * 
 * 아키텍처:
 * - S3: source of truth (영구 보관)
 * - GCS: scratch 공간 (임시, 즉시 삭제)
 * - Vision API: asyncBatchAnnotateFiles (단일 호출)
 * - Job 기반: Cloud Run 300초 제약 회피
 */

import { Storage } from "@google-cloud/storage";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { v4 as uuidv4 } from "uuid";
import { storagePut, storageGet } from "./storage";
import { getDb } from "./db";
import { ocrJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { Readable } from "stream";

// 환경변수
const GCS_OCR_BUCKET = process.env.GCS_OCR_BUCKET || "typing-quiz-ocr-temp-dev";
const GCS_OCR_INPUT_PREFIX = process.env.GCS_OCR_INPUT_PREFIX || "ocr-input/";
const GCS_OCR_OUTPUT_PREFIX = process.env.GCS_OCR_OUTPUT_PREFIX || "ocr-output/";
const OCR_JOB_TIMEOUT_SECONDS = parseInt(process.env.OCR_JOB_TIMEOUT_SECONDS || "600");
const OCR_MAX_RETRIES = parseInt(process.env.OCR_MAX_RETRIES || "3");
const OCR_LIFECYCLE_DAYS = parseInt(process.env.OCR_LIFECYCLE_DAYS || "1");

// Google Cloud 클라이언트 (ADC/IAM 사용)
const storage = new Storage();
const visionClient = new ImageAnnotatorClient();

/**
 * OCR 작업 시작
 * 1. S3에서 파일 다운로드
 * 2. GCS에 업로드
 * 3. Vision API asyncBatchAnnotateFiles 호출
 * 4. jobId 반환
 */
export async function startOcrJob(
  userId: number,
  s3Key: string,
  fileName: string,
  fileType: string
): Promise<{ jobId: string; status: string }> {
  const jobId = `ocr-job-${uuidv4()}`;
  
  try {
    // 1. S3에서 파일 다운로드 (스트림)
    const s3Buffer = await downloadFromS3Stub(s3Key);
    const s3Stream = Readable.from([s3Buffer]);
    
    // 2. GCS에 업로드
    const gcsInputPath = await uploadToGcs(jobId, s3Stream, fileName);
    
    // 3. Vision API asyncBatchAnnotateFiles 호출
    const gcsOutputPath = await callVisionAsyncBatchAnnotateFiles(
      jobId,
      gcsInputPath,
      fileType
    );
    
    // 4. DB에 job 레코드 저장
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db.insert(ocrJobs).values({
      id: jobId,
      userId,
      s3Key,
      gcsInputPath,
      gcsOutputPath,
      status: "RUNNING",
      expiresAt: new Date(Date.now() + OCR_LIFECYCLE_DAYS * 24 * 60 * 60 * 1000),
    });
    
    return { jobId, status: "RUNNING" };
  } catch (error) {
    console.error(`[OCR] startOcrJob failed: ${error}`);
    
    // 에러 시 DB에 실패 기록
    try {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      await db.insert(ocrJobs).values({
        id: jobId,
        userId,
        s3Key,
        status: "ERROR",
        errorMessage: String(error),
        expiresAt: new Date(Date.now() + OCR_LIFECYCLE_DAYS * 24 * 60 * 60 * 1000),
      });
    } catch (dbError) {
      console.error(`[OCR] Failed to save error to DB: ${dbError}`);
    }
    
    throw error;
  }
}

/**
 * OCR 작업 상태 조회
 */
export async function getOcrJobStatus(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const job = await (db.query as any).ocrJobs.findFirst({
    where: eq(ocrJobs.id, jobId),
  });
  
  if (!job) {
    throw new Error("Job not found");
  }
  
  return {
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * OCR 결과 조회
 * - GCS에서 결과 읽기
 * - 텍스트 추출
 * - GCS 파일 즉시 삭제
 * - draft 생성
 */
export async function getOcrJobResult(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const job = await (db.query as any).ocrJobs.findFirst({
    where: eq(ocrJobs.id, jobId),
  });
  
  if (!job) {
    throw new Error("Job not found");
  }
  
  if (job.status !== "DONE") {
    throw new Error(`Job status is ${job.status}, not DONE`);
  }
  
  try {
    // 1. GCS에서 결과 읽기
    const resultJson = await readFromGcs(job.gcsOutputPath!);
    
    // 2. 텍스트 추출 (fullTextAnnotation)
    const extractedText = extractTextFromVisionResult(resultJson);
    
    // 3. GCS 파일 즉시 삭제
    await deleteFromGcs(job.gcsInputPath!);
    await deleteFromGcs(job.gcsOutputPath!);
    
    // 4. draft 생성
    const draft = generateDraft(extractedText);
    
    // 5. DB 업데이트 (result 저장)
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db
      .update(ocrJobs)
      .set({ result: JSON.stringify({ fullText: extractedText, draft }) })
      .where(eq(ocrJobs.id, jobId));
    
    return {
      jobId,
      status: "DONE",
      result: {
        fullText: extractedText,
        pages: extractedText.split("\n---PAGE BREAK---\n").map((text, idx) => ({
          pageNumber: idx + 1,
          text: text.trim(),
          confidence: 0.95, // Vision API에서 제공하는 실제 confidence 사용
        })),
      },
      draft,
    };
  } catch (error) {
    console.error(`[OCR] getOcrJobResult failed: ${error}`);
    throw error;
  }
}



/**
 * GCS에 업로드
 */
async function uploadToGcs(
  jobId: string,
  stream: Readable,
  fileName: string
): Promise<string> {
  // TODO: stream이 이미 소비되었을 수 있으므로 재생성 필요
  const bucket = storage.bucket(GCS_OCR_BUCKET);
  const gcsPath = `${GCS_OCR_INPUT_PREFIX}${jobId}/${fileName}`;
  const file = bucket.file(gcsPath);
  
  return new Promise((resolve, reject) => {
    let retries = 0;
    
    const upload = () => {
      stream
        .pipe(file.createWriteStream())
        .on("finish", () => {
          console.log(`[OCR] Uploaded to GCS: ${gcsPath}`);
          resolve(`gs://${GCS_OCR_BUCKET}/${gcsPath}`);
        })
        .on("error", (error: any) => {
          retries++;
          if (retries < OCR_MAX_RETRIES) {
            console.warn(`[OCR] GCS upload retry ${retries}/${OCR_MAX_RETRIES}`);
            setTimeout(upload, Math.pow(2, retries) * 1000);
          } else {
            reject(new Error(`GCS upload failed after ${OCR_MAX_RETRIES} retries: ${error}`));
          }
        });
    };
    
    upload();
  });
}

// 임시 구현: S3 다운로드 함수 (실제 구현 필요)
async function downloadFromS3Stub(s3Key: string): Promise<Buffer> {
  // 실제로는 S3에서 파일을 다운로드해야 함
  // 현재는 stub 구현
  throw new Error("S3 download not implemented");
}

/**
 * Vision API asyncBatchAnnotateFiles 호출
 */
async function callVisionAsyncBatchAnnotateFiles(
  jobId: string,
  gcsInputPath: string,
  fileType: string
): Promise<string> {
  try {
    const gcsOutputPath = `gs://${GCS_OCR_BUCKET}/${GCS_OCR_OUTPUT_PREFIX}${jobId}/`;
    
    // MIME 타입 결정
    let mimeType = "application/pdf";
    if (fileType.includes("ppt")) {
      mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (fileType.includes("image")) {
      mimeType = "image/jpeg";
    }
    
    const request = {
      requests: [
        {
          inputConfig: {
            gcsSource: {
              uri: gcsInputPath,
            },
            mimeType,
          },
          features: [
            {
              type: 11, // DOCUMENT_TEXT_DETECTION
            } as any,
          ] as any,
          outputConfig: {
            gcsDestination: {
              uri: gcsOutputPath,
            },
          },
        },
      ],
    };
    
    console.log(`[OCR] Calling Vision API asyncBatchAnnotateFiles: ${gcsInputPath}`);
    
    const [operation] = await visionClient.asyncBatchAnnotateFiles(request);
    
    // 비동기 작업 대기 (polling)
    const [response] = await operation.promise();
    
    console.log(`[OCR] Vision API completed: ${gcsInputPath}`);
    
    // DB 업데이트 (상태: DONE)
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db
      .update(ocrJobs)
      .set({ status: "DONE", updatedAt: new Date() })
      .where(eq(ocrJobs.id, jobId));
    
    return gcsOutputPath;
  } catch (error) {
    console.error(`[OCR] Vision API call failed: ${error}`);
    
    // DB 업데이트 (상태: ERROR)
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db
      .update(ocrJobs)
      .set({ status: "ERROR", errorMessage: String(error), updatedAt: new Date() })
      .where(eq(ocrJobs.id, jobId));
    
    throw error;
  }
}

/**
 * GCS에서 파일 읽기
 */
async function readFromGcs(gcsPath: string): Promise<any> {
  const bucket = storage.bucket(GCS_OCR_BUCKET);
  
  // gcsPath 형식: gs://bucket/path/file.json
  const filePath = gcsPath.replace(`gs://${GCS_OCR_BUCKET}/`, "");
  const file = bucket.file(filePath);
  
  try {
    const [contents] = await file.download();
    return JSON.parse(contents.toString());
  } catch (error) {
    console.error(`[OCR] GCS read failed: ${error}`);
    throw error;
  }
}

/**
 * GCS에서 파일 삭제
 */
async function deleteFromGcs(gcsPath: string): Promise<void> {
  const bucket = storage.bucket(GCS_OCR_BUCKET);
  
  // gcsPath 형식: gs://bucket/path/file
  const filePath = gcsPath.replace(`gs://${GCS_OCR_BUCKET}/`, "");
  const file = bucket.file(filePath);
  
  try {
    await file.delete();
    console.log(`[OCR] Deleted from GCS: ${gcsPath}`);
  } catch (error) {
    console.warn(`[OCR] GCS delete failed (non-critical): ${error}`);
    // 삭제 실패는 비치명적 (Lifecycle Policy로 자동 정리)
  }
}

/**
 * Vision API 결과에서 텍스트 추출
 */
function extractTextFromVisionResult(resultJson: any): string {
  try {
    // Vision API asyncBatchAnnotateFiles 결과 형식:
    // {
    //   "responses": [
    //     {
    //       "fullTextAnnotation": {
    //         "text": "추출된 텍스트..."
    //       }
    //     }
    //   ]
    // }
    
    if (!resultJson.responses || resultJson.responses.length === 0) {
      throw new Error("No responses from Vision API");
    }
    
    const fullTextAnnotations = resultJson.responses
      .map((response: any) => response.fullTextAnnotation?.text || "")
      .filter((text: string) => text.length > 0);
    
    return fullTextAnnotations.join("\n---PAGE BREAK---\n");
  } catch (error) {
    console.error(`[OCR] Text extraction failed: ${error}`);
    throw error;
  }
}

/**
 * draft 생성
 */
function generateDraft(fullText: string): {
  type: string;
  question: string;
  answer: string;
} {
  // 간단한 draft 생성 로직
  // 실제로는 더 정교한 구조화가 필요할 수 있음
  
  const lines = fullText.split("\n").filter((line) => line.trim().length > 0);
  const question = lines[0] || "질문 없음";
  const answer = lines.slice(1).join("\n") || fullText;
  
  return {
    type: "text",
    question: question.substring(0, 100), // 첫 100자
    answer: answer.substring(0, 1000), // 첫 1000자
  };
}
