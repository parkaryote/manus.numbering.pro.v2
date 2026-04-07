/**
 * OCR Module - Google Cloud Vision API Integration
 * 
 * Architecture:
 * - Server-only module (never imported by client)
 * - Uses asyncBatchAnnotateFiles for batch processing
 * - GCS temporary bucket for scratch files
 * - Job-based async processing with polling
 * - ADC (Application Default Credentials) for authentication
 */

import { Storage } from "@google-cloud/storage";
import { ImageAnnotatorClient } from "@google-cloud/vision";

const PROJECT_ID = process.env.GCP_PROJECT_ID as string;
const GCS_TEMP_BUCKET = process.env.GCS_TEMP_BUCKET as string;
const OCR_ENABLED =
  process.env.OCR_ENABLED === "true" && Boolean(PROJECT_ID) && Boolean(GCS_TEMP_BUCKET);

if (!OCR_ENABLED) {
  console.warn(
    "[OCR] Disabled. Set OCR_ENABLED=true with GCP_PROJECT_ID and GCS_TEMP_BUCKET to enable."
  );
}

const storage = OCR_ENABLED ? new Storage({ projectId: PROJECT_ID }) : null;
const visionClient = OCR_ENABLED ? new ImageAnnotatorClient() : null;

export function isOCREnabled(): boolean {
  return OCR_ENABLED;
}

function assertOCREnabled(): void {
  if (!OCR_ENABLED) {
    throw new Error(
      "OCR is temporarily disabled. Set OCR_ENABLED=true with GCP_PROJECT_ID and GCS_TEMP_BUCKET to enable."
    );
  }
}

/**
 * Upload file to GCS temporary bucket
 * Returns: gs:// URI for Vision API
 */
export async function uploadToGCS(
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  assertOCREnabled();
  const bucket = storage!.bucket(GCS_TEMP_BUCKET);
  const file = bucket.file(`ocr-temp/${Date.now()}-${fileName}`);

  await file.save(fileBuffer);

  return `gs://${GCS_TEMP_BUCKET}/${file.name}`;
}

/**
 * Extract text from PDF/image using asyncBatchAnnotateFiles
 * Returns: Operation name for polling
 */
export async function startOCRJob(gcsUri: string): Promise<string> {
  assertOCREnabled();
  const request = {
    requests: [
      {
        inputConfig: {
          gcsSource: {
            uri: gcsUri,
          },
          mimeType: "application/pdf",
        },
        features: [
          {
            type: "DOCUMENT_TEXT_DETECTION" as const,
          },
        ],
        outputConfig: {
          gcsDestination: {
            uri: `gs://${GCS_TEMP_BUCKET}/ocr-results/`,
          },
        },
      },
    ],
  };

  const [operation] = await visionClient!.asyncBatchAnnotateFiles(request);

  if (!operation.name) {
    throw new Error("No operation name returned from Vision API");
  }

  return operation.name;
}

/**
 * Poll operation status
 * Returns: true if complete, false if still processing
 */
export async function checkOCRJobStatus(operationName: string): Promise<boolean> {
  assertOCREnabled();
  const result = await visionClient!.checkAsyncBatchAnnotateFilesProgress(
    operationName
  );
  const operation = Array.isArray(result) ? result[0] : result;

  return operation.done ?? false;
}

/**
 * Get OCR results from GCS
 * Parses fullTextAnnotation from Vision API output
 */
export async function getOCRResults(operationName: string): Promise<string> {
  assertOCREnabled();
  const result = await visionClient!.checkAsyncBatchAnnotateFilesProgress(
    operationName
  );
  const operation = Array.isArray(result) ? result[0] : result;

  if (!operation.done) {
    throw new Error("Operation not yet complete");
  }

  if (operation.response) {
    const response = operation.response as any;
    const responses = response.responses || [];

    if (responses.length === 0) {
      throw new Error("No responses from Vision API");
    }

    // Extract fullTextAnnotation from first response
    const firstResponse = responses[0];
    const fullTextAnnotation = firstResponse.fullTextAnnotation;

    if (!fullTextAnnotation || !fullTextAnnotation.text) {
      return ""; // Empty result
    }

    return fullTextAnnotation.text;
  }

  throw new Error("No response in operation");
}

/**
 * Clean up temporary GCS files
 */
export async function cleanupGCSFiles(gcsUri: string): Promise<void> {
  if (!OCR_ENABLED) return;

  try {
    // Extract bucket and file path from gs:// URI
    const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      console.warn("Invalid GCS URI:", gcsUri);
      return;
    }

    const [, bucketName, filePath] = match;
    const bucket = storage!.bucket(bucketName);
    const file = bucket.file(filePath);

    await file.delete().catch(() => {
      // File may not exist, ignore
    });
  } catch (error) {
    console.error("Error cleaning up GCS files:", error);
    // Don't throw, cleanup is best-effort
  }
}

/**
 * Clean up all temporary OCR files in bucket
 * Called periodically or on demand
 */
export async function cleanupOldOCRFiles(maxAgeHours: number = 24): Promise<void> {
  if (!OCR_ENABLED) return;

  try {
    const bucket = storage!.bucket(GCS_TEMP_BUCKET);
    const [files] = await bucket.getFiles({ prefix: "ocr-temp/" });

    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    for (const file of files) {
      const metadata = await file.getMetadata();
      const createdTime = new Date(metadata[0].timeCreated || '').getTime();

      if (now - createdTime > maxAge) {
        await file.delete().catch(() => {
          // File may not exist, ignore
        });
      }
    }
  } catch (error) {
    console.error("Error cleaning up old OCR files:", error);
  }
}
