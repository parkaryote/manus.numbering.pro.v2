import { describe, it, expect, afterAll } from "vitest";
import * as db from "./db";
import * as ocrModule from "./ocr";
import { getDb } from "./db";
import { ocrJobs } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

// 테스트에서 생성된 OCR job ID 추적 - 테스트 후 정리용
const createdJobIds: number[] = [];
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabase ? describe : describe.skip;

async function createTestOcrJob(overrides: Partial<Parameters<typeof db.createOcrJob>[0]> = {}) {
  const job = await db.createOcrJob({
    userId: 1,
    fileName: "test.pdf",
    s3Url: "https://example.com/test.pdf",
    gcsUri: "gs://bucket/test.pdf",
    operationName: "projects/123/locations/us/operations/456",
    status: "processing",
    ...overrides,
  });
  createdJobIds.push(job.id);
  return job;
}

describe("OCR Router - Integration Tests", () => {
  afterAll(async () => {
    // 테스트에서 생성된 OCR jobs 모두 정리
    try {
      const database = await getDb();
      if (database && createdJobIds.length > 0) {
        await database.delete(ocrJobs).where(inArray(ocrJobs.id, createdJobIds));
      }
    } catch {
      // DB 연결 실패 시 무시
    }
  });

  describeIfDb("Database Operations", () => {
    it("should create OCR job record", async () => {
      const job = await createTestOcrJob();

      expect(job).toBeDefined();
      expect(job.id).toBeGreaterThan(0);
      expect(job.userId).toBe(1);
      expect(job.status).toBe("processing");
    });

    it("should retrieve OCR job by ID", async () => {
      const created = await createTestOcrJob();

      const retrieved = await db.getOcrJobById(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.fileName).toBe("test.pdf");
    });

    it("should update OCR job status", async () => {
      const created = await createTestOcrJob();

      await db.updateOcrJob(created.id, {
        status: "completed",
        extractedText: "Sample extracted text",
        completedAt: new Date(),
      });

      const updated = await db.getOcrJobById(created.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.extractedText).toBe("Sample extracted text");
    });

    it("should list OCR jobs by user", async () => {
      const userId = 1;

      // Create multiple jobs (ID 추적됨)
      await createTestOcrJob({ userId, fileName: "test1.pdf", s3Url: "https://example.com/test1.pdf", gcsUri: "gs://bucket/test1.pdf", operationName: "op1", status: "processing" });
      await createTestOcrJob({ userId, fileName: "test2.pdf", s3Url: "https://example.com/test2.pdf", gcsUri: "gs://bucket/test2.pdf", operationName: "op2", status: "completed" });

      const jobs = await db.getOcrJobsByUserId(userId);
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.every(j => j.userId === userId)).toBe(true);
    });

    it("should delete OCR job", async () => {
      const created = await createTestOcrJob();
      // 이 job은 테스트 내에서 직접 삭제하므로 afterAll 목록에서 제거
      const idx = createdJobIds.indexOf(created.id);
      if (idx !== -1) createdJobIds.splice(idx, 1);

      await db.deleteOcrJob(created.id);

      const retrieved = await db.getOcrJobById(created.id);
      expect(retrieved).toBeUndefined();
    });
  });

  describe("OCR Module Functions", () => {
    it("should validate GCS URI format", () => {
      const validUri = "gs://bucket-name/path/to/file.pdf";
      const match = validUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
      expect(match).toBeDefined();
      expect(match?.[1]).toBe("bucket-name");
      expect(match?.[2]).toBe("path/to/file.pdf");
    });

    it("should handle invalid GCS URI gracefully", async () => {
      const invalidUri = "invalid-uri";
      // cleanupGCSFiles should not throw for invalid URIs
      await expect(ocrModule.cleanupGCSFiles(invalidUri)).resolves.toBeUndefined();
    });
  });

  describeIfDb("Job Status Workflow", () => {
    it("should track job lifecycle: pending -> processing -> completed", async () => {
      const job = await createTestOcrJob({ status: "pending", operationName: "op123" });

      expect(job.status).toBe("pending");

      await db.updateOcrJob(job.id, { status: "processing" });
      let updated = await db.getOcrJobById(job.id);
      expect(updated?.status).toBe("processing");

      await db.updateOcrJob(job.id, {
        status: "completed",
        extractedText: "Extracted text",
        completedAt: new Date(),
      });
      updated = await db.getOcrJobById(job.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.extractedText).toBe("Extracted text");
    });

    it("should track job lifecycle: pending -> failed", async () => {
      const job = await createTestOcrJob({ status: "pending", operationName: "op123" });

      await db.updateOcrJob(job.id, {
        status: "failed",
        errorMessage: "Vision API error",
      });

      const updated = await db.getOcrJobById(job.id);
      expect(updated?.status).toBe("failed");
      expect(updated?.errorMessage).toBe("Vision API error");
    });
  });
});
