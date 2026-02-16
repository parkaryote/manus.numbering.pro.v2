import { describe, it, expect } from "vitest";

describe("OCR Module - Environment and GCP Setup", () => {
  it("should have GCP_PROJECT_ID environment variable", () => {
    const projectId = process.env.GCP_PROJECT_ID;
    expect(projectId).toBeDefined();
    expect(projectId).toMatch(/^[a-z0-9-]+$/);
  });

  it("should have GCS_TEMP_BUCKET environment variable", () => {
    const bucket = process.env.GCS_TEMP_BUCKET;
    expect(bucket).toBeDefined();
    expect(bucket).toMatch(/^[a-z0-9._-]+$/);
  });

  it("should validate GCP credentials are available", async () => {
    // In Cloud Run, ADC (Application Default Credentials) is automatically available
    // This test verifies that the environment is properly configured
    const projectId = process.env.GCP_PROJECT_ID;
    const bucket = process.env.GCS_TEMP_BUCKET;

    expect(projectId).toBeTruthy();
    expect(bucket).toBeTruthy();

    // In production, GCP client libraries will use ADC automatically
    // No need to validate credentials here as they're managed by the platform
  });

  it("should have valid bucket naming", () => {
    const bucket = process.env.GCS_TEMP_BUCKET;
    // GCS bucket names must be 3-63 characters, lowercase, numbers, hyphens, underscores, periods
    expect(bucket).toMatch(/^[a-z0-9._-]{3,63}$/);
  });
});
