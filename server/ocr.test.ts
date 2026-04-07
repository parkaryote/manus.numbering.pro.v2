import { describe, it, expect } from "vitest";
import * as ocrModule from "./ocr";

const describeWhenDisabled = ocrModule.isOCREnabled()
  ? describe.skip
  : describe;

describeWhenDisabled("OCR Module - Temporary Disabled Mode", () => {
  it("should report OCR as disabled", () => {
    expect(ocrModule.isOCREnabled()).toBe(false);
  });

  it("should fail fast with clear message when OCR job starts while disabled", async () => {
    await expect(ocrModule.startOCRJob("gs://bucket/file.pdf")).rejects.toThrow(
      /OCR is temporarily disabled/i
    );
  });

  it("should keep cleanup no-op and non-throwing while disabled", async () => {
    await expect(
      ocrModule.cleanupGCSFiles("invalid-uri")
    ).resolves.toBeUndefined();
    await expect(ocrModule.cleanupOldOCRFiles()).resolves.toBeUndefined();
  });
});
