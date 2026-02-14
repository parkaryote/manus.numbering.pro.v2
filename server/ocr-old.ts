/**
 * OCR Service Module
 * 
 * Uses Google Cloud Vision API with asyncBatchAnnotateFiles for PDF/PPT processing.
 * Files are uploaded to Cloud Storage, processed asynchronously, and results are parsed.
 * 
 * Authentication: Application Default Credentials (IAM) - no JSON key required.
 * Suitable for Cloud Run environments with proper IAM roles.
 */

import { ImageAnnotatorClient } from "@google-cloud/vision";
import { Storage } from "@google-cloud/storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrPage {
  pageNumber: number;
  text: string;           // Full extracted text for this page
  blocks: OcrBlock[];     // Structured blocks (paragraphs, tables, etc.)
}

export interface OcrBlock {
  type: "paragraph" | "table" | "unknown";
  text: string;
  confidence: number;
}

export interface OcrResult {
  pages: OcrPage[];
  totalPages: number;
  rawText: string;        // All pages concatenated
}

// ---------------------------------------------------------------------------
// Google Cloud Clients - Application Default Credentials
// ---------------------------------------------------------------------------

let visionClient: ImageAnnotatorClient | null = null;
let storageClient: Storage | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (!visionClient) {
    // Uses Application Default Credentials (IAM)
    visionClient = new ImageAnnotatorClient();
  }
  return visionClient;
}

function getStorageClient(): Storage {
  if (!storageClient) {
    // Uses Application Default Credentials (IAM)
    storageClient = new Storage();
  }
  return storageClient;
}

// ---------------------------------------------------------------------------
// Cloud Storage Operations
// ---------------------------------------------------------------------------

/**
 * Upload file to Cloud Storage and return GCS URI.
 * Format: gs://bucket-name/path/to/file
 */
async function uploadToGcs(buffer: Buffer, filename: string): Promise<string> {
  const storage = getStorageClient();
  
  // Use environment variable for bucket name, fallback to default
  const bucketName = process.env.GCS_BUCKET_NAME || "typing-quiz-ocr-temp";
  const bucket = storage.bucket(bucketName);
  
  // Generate unique filename with timestamp
  const timestamp = Date.now();
  const gcsFilename = `ocr-uploads/${timestamp}-${filename}`;
  const file = bucket.file(gcsFilename);

  await file.save(buffer, {
    metadata: {
      contentType: "application/pdf", // Adjust based on file type
    },
  });

  return `gs://${bucketName}/${gcsFilename}`;
}

/**
 * Delete file from Cloud Storage after processing.
 */
async function deleteFromGcs(gcsUri: string): Promise<void> {
  try {
    const storage = getStorageClient();
    const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      console.warn("[OCR] Invalid GCS URI:", gcsUri);
      return;
    }
    const [, bucketName, filename] = match;
    await storage.bucket(bucketName).file(filename).delete();
    console.log("[OCR] Deleted temp file:", gcsUri);
  } catch (error: any) {
    console.warn("[OCR] Failed to delete temp file:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Vision API - asyncBatchAnnotateFiles
// ---------------------------------------------------------------------------

/**
 * Process PDF/PPT using Vision API's asyncBatchAnnotateFiles.
 * This method supports multi-page documents natively.
 */
async function processDocumentWithVisionApi(gcsUri: string): Promise<OcrResult> {
  const client = getVisionClient();

  const request = {
    requests: [
      {
        inputConfig: {
          gcsSource: {
            uri: gcsUri,
          },
          mimeType: "application/pdf", // Adjust for PPT if needed
        },
        features: [
          {
            type: "DOCUMENT_TEXT_DETECTION" as const,
          },
        ],
        outputConfig: {
          gcsDestination: {
            uri: gcsUri.replace(/\/[^\/]+$/, "/output-"), // Output to same bucket
          },
          batchSize: 1,
        },
      },
    ],
  };

  try {
    console.log("[OCR] Starting async batch annotation...");
    const [operation] = await client.asyncBatchAnnotateFiles(request);
    console.log("[OCR] Waiting for operation to complete...");
    const [filesResponse] = await operation.promise();

    // Parse results
    const pages: OcrPage[] = [];
    let pageNum = 1;

    for (const response of filesResponse.responses || []) {
      for (const outputFile of response.outputConfig?.gcsDestination?.uri ? [response.outputConfig.gcsDestination.uri] : []) {
        // Download and parse output JSON from GCS
        const page = await parseVisionOutputFromGcs(outputFile, pageNum);
        pages.push(page);
        pageNum++;
      }
    }

    const rawText = pages.map(p => p.text).join("\n\n---\n\n");

    return {
      pages,
      totalPages: pages.length,
      rawText,
    };
  } catch (error: any) {
    console.error("[OCR] Vision API error:", error);
    throw new Error(`Vision API error: ${error.message}`);
  }
}

/**
 * Parse Vision API output JSON from GCS.
 */
async function parseVisionOutputFromGcs(gcsUri: string, pageNumber: number): Promise<OcrPage> {
  const storage = getStorageClient();
  const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
  if (!match) {
    return { pageNumber, text: "", blocks: [] };
  }

  const [, bucketName, filename] = match;
  const file = storage.bucket(bucketName).file(filename);
  
  try {
    const [contents] = await file.download();
    const jsonData = JSON.parse(contents.toString());
    
    // Extract text from Vision API response
    const fullText = jsonData.responses?.[0]?.fullTextAnnotation?.text || "";
    const blocks: OcrBlock[] = [];

    // Parse blocks
    for (const page of jsonData.responses?.[0]?.fullTextAnnotation?.pages || []) {
      for (const block of page.blocks || []) {
        const blockText = extractTextFromBlock(block);
        const confidence = block.confidence || 0;
        const blockType = block.blockType === "TABLE" ? "table" as const : "paragraph" as const;
        
        if (blockText.trim()) {
          blocks.push({
            type: blockType,
            text: blockText.trim(),
            confidence,
          });
        }
      }
    }

    // Cleanup output file
    await deleteFromGcs(gcsUri);

    return {
      pageNumber,
      text: fullText,
      blocks,
    };
  } catch (error: any) {
    console.error("[OCR] Failed to parse output from GCS:", error);
    return { pageNumber, text: "", blocks: [] };
  }
}

/**
 * Extract text from a Vision API block structure.
 */
function extractTextFromBlock(block: any): string {
  return (block.paragraphs || [])
    .map((para: any) =>
      (para.words || [])
        .map((word: any) =>
          (word.symbols || []).map((s: any) => {
            let char = s.text || "";
            const breakType = s.property?.detectedBreak?.type;
            if (breakType === "SPACE" || breakType === "SURE_SPACE") {
              char += " ";
            } else if (breakType === "EOL_SURE_SPACE" || breakType === "LINE_BREAK") {
              char += "\n";
            }
            return char;
          }).join("")
        ).join("")
    ).join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract text from a PDF file using Google Cloud Vision OCR.
 * Uses asyncBatchAnnotateFiles for native PDF processing.
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<OcrResult> {
  console.log("[OCR] Uploading PDF to Cloud Storage...");
  const gcsUri = await uploadToGcs(pdfBuffer, "input.pdf");
  
  try {
    console.log("[OCR] Processing PDF with Vision API...");
    const result = await processDocumentWithVisionApi(gcsUri);
    return result;
  } finally {
    // Cleanup uploaded file
    await deleteFromGcs(gcsUri);
  }
}

/**
 * Extract text from a PPT/PPTX file using Google Cloud Vision OCR.
 * Note: PPT files need to be converted to PDF first using LibreOffice.
 */
export async function extractTextFromPpt(pptBuffer: Buffer, filename: string): Promise<OcrResult> {
  console.log("[OCR] Converting PPT to PDF...");
  
  const fs = await import("fs");
  const path = await import("path");
  const { execSync } = await import("child_process");
  const os = await import("os");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-ppt-"));
  const pptPath = path.join(tmpDir, filename);

  try {
    // Write PPT to temp file
    fs.writeFileSync(pptPath, pptBuffer);

    // Convert PPT to PDF using LibreOffice
    execSync(`libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${pptPath}"`, {
      timeout: 120000,
      stdio: "pipe",
    });

    // Find the generated PDF
    const pdfFile = fs.readdirSync(tmpDir).find((f: string) => f.endsWith(".pdf"));
    if (!pdfFile) {
      throw new Error("LibreOffice PDF conversion failed");
    }

    const pdfBuffer = fs.readFileSync(path.join(tmpDir, pdfFile));
    return extractTextFromPdf(pdfBuffer);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("[OCR] Failed to cleanup temp dir:", tmpDir);
    }
  }
}

/**
 * Extract text from an image file using Google Cloud Vision OCR.
 * Uses synchronous annotateImage for single images.
 */
export async function extractTextFromImage(imageBuffer: Buffer): Promise<OcrResult> {
  console.log("[OCR] Processing single image...");
  const client = getVisionClient();

  const request = {
    image: {
      content: imageBuffer.toString("base64"),
    },
    features: [
      {
        type: "DOCUMENT_TEXT_DETECTION" as const,
      },
    ],
    imageContext: {
      languageHints: ["ko", "en"],
    },
  };

  try {
    const [result] = await client.annotateImage(request);
    const fullText = result.fullTextAnnotation?.text || "";
    const blocks: OcrBlock[] = [];

    for (const page of result.fullTextAnnotation?.pages || []) {
      for (const block of page.blocks || []) {
        const blockText = extractTextFromBlock(block);
        const confidence = block.confidence || 0;
        const blockType = block.blockType === "TABLE" ? "table" as const : "paragraph" as const;
        
        if (blockText.trim()) {
          blocks.push({
            type: blockType,
            text: blockText.trim(),
            confidence,
          });
        }
      }
    }

    return {
      pages: [{ pageNumber: 1, text: fullText, blocks }],
      totalPages: 1,
      rawText: fullText,
    };
  } catch (error: any) {
    console.error("[OCR] Vision API error:", error);
    throw new Error(`Vision API error: ${error.message}`);
  }
}
