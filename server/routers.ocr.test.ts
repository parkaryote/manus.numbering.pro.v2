import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "./db";
import * as ocrModule from "./ocr";

describe("OCR Router - Integration Tests", () => {
  describe("Database Operations", () => {
    it("should create OCR job record", async () => {
      const job = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "projects/123/locations/us/operations/456",
        status: "processing",
      });

      expect(job).toBeDefined();
      expect(job.id).toBeGreaterThan(0);
      expect(job.userId).toBe(1);
      expect(job.status).toBe("processing");
    });

    it("should retrieve OCR job by ID", async () => {
      const created = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "projects/123/locations/us/operations/456",
        status: "processing",
      });

      const retrieved = await db.getOcrJobById(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.fileName).toBe("test.pdf");
    });

    it("should update OCR job status", async () => {
      const created = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "projects/123/locations/us/operations/456",
        status: "processing",
      });

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

      // Create multiple jobs
      await db.createOcrJob({
        userId,
        fileName: "test1.pdf",
        s3Url: "https://example.com/test1.pdf",
        gcsUri: "gs://bucket/test1.pdf",
        operationName: "op1",
        status: "processing",
      });

      await db.createOcrJob({
        userId,
        fileName: "test2.pdf",
        s3Url: "https://example.com/test2.pdf",
        gcsUri: "gs://bucket/test2.pdf",
        operationName: "op2",
        status: "completed",
      });

      const jobs = await db.getOcrJobsByUserId(userId);
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.every(j => j.userId === userId)).toBe(true);
    });

    it("should delete OCR job", async () => {
      const created = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "projects/123/locations/us/operations/456",
        status: "processing",
      });

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

  describe("Job Status Workflow", () => {
    it("should track job lifecycle: pending -> processing -> completed", async () => {
      // Create job in pending state
      const job = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "op123",
        status: "pending",
      });

      expect(job.status).toBe("pending");

      // Update to processing
      await db.updateOcrJob(job.id, { status: "processing" });
      let updated = await db.getOcrJobById(job.id);
      expect(updated?.status).toBe("processing");

      // Update to completed
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
      const job = await db.createOcrJob({
        userId: 1,
        fileName: "test.pdf",
        s3Url: "https://example.com/test.pdf",
        gcsUri: "gs://bucket/test.pdf",
        operationName: "op123",
        status: "pending",
      });

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
