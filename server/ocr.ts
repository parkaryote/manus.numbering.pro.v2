/**
 * OCR Service Module
 * 
 * Uses Google Cloud Vision API with service account authentication.
 * PDF/PPT pages are converted to images first, then OCR is applied.
 * 
 * Authentication: Service account JSON key via GOOGLE_APPLICATION_CREDENTIALS env.
 * The Vision API client library automatically handles authentication.
 */

import { ImageAnnotatorClient } from "@google-cloud/vision";

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
// Google Cloud Vision API - Service Account
// ---------------------------------------------------------------------------

let visionClient: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (!visionClient) {
    visionClient = new ImageAnnotatorClient();
  }
  return visionClient;
}

/**
 * Call Google Cloud Vision API for a single image (base64 encoded).
 * Uses service account authentication via GOOGLE_APPLICATION_CREDENTIALS.
 */
async function callVisionApi(imageBase64: string): Promise<any> {
  const client = getVisionClient();

  const request = {
    image: {
      content: imageBase64,
    },
    features: [
      {
        type: "DOCUMENT_TEXT_DETECTION" as const,
        maxResults: 50,
      },
    ],
    imageContext: {
      languageHints: ["ko", "en"],
    },
  };

  try {
    const [result] = await client.annotateImage(request);
    return result;
  } catch (error: any) {
    console.error("[OCR] Vision API error:", error);
    throw new Error(`Vision API error: ${error.message}`);
  }
}

/**
 * Parse Vision API response into structured OcrPage.
 */
function parseVisionResponse(apiResponse: any, pageNumber: number): OcrPage {
  if (apiResponse.error) {
    const errorMsg = apiResponse.error.message || "Unknown Vision API error";
    console.error("[OCR] Vision API response error:", errorMsg);
    return { pageNumber, text: "", blocks: [] };
  }

  const fullTextAnnotation = apiResponse.fullTextAnnotation;
  if (!fullTextAnnotation) {
    return { pageNumber, text: "", blocks: [] };
  }

  const fullText = fullTextAnnotation.text || "";
  
  // Extract blocks from pages
  const blocks: OcrBlock[] = [];
  
  for (const page of fullTextAnnotation.pages || []) {
    for (const block of page.blocks || []) {
      const blockText = (block.paragraphs || [])
        .map((para: any) =>
          (para.words || [])
            .map((word: any) =>
              (word.symbols || []).map((s: any) => {
                let char = s.text || "";
                // Add space/newline based on detected break
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
    pageNumber,
    text: fullText,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// PDF Processing
// ---------------------------------------------------------------------------

/**
 * Convert PDF buffer to base64 images using poppler (pdftoppm).
 * Returns array of base64-encoded PNG images, one per page.
 */
async function pdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  const fs = await import("fs");
  const path = await import("path");
  const { execSync } = await import("child_process");
  const os = await import("os");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-pdf-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  const outputPrefix = path.join(tmpDir, "page");

  try {
    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Convert PDF to PNG images using poppler's pdftoppm (pre-installed)
    execSync(`pdftoppm -png -r 300 "${pdfPath}" "${outputPrefix}"`, {
      timeout: 120000, // 2 min timeout
    });

    // Read generated images
    const files = fs.readdirSync(tmpDir)
      .filter((f: string) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();

    const images: string[] = [];
    for (const file of files) {
      const imgBuffer = fs.readFileSync(path.join(tmpDir, file));
      images.push(imgBuffer.toString("base64"));
    }

    return images;
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("[OCR] Failed to cleanup temp dir:", tmpDir);
    }
  }
}

// ---------------------------------------------------------------------------
// PPT Processing
// ---------------------------------------------------------------------------

/**
 * Convert PPT/PPTX buffer to base64 images using LibreOffice.
 * Returns array of base64-encoded PNG images, one per slide.
 */
async function pptToImages(pptBuffer: Buffer, filename: string): Promise<string[]> {
  const fs = await import("fs");
  const path = await import("path");
  const { execSync } = await import("child_process");
  const os = await import("os");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-ppt-"));
  const pptPath = path.join(tmpDir, filename);

  try {
    // Write PPT to temp file
    fs.writeFileSync(pptPath, pptBuffer);

    // Convert PPT to PDF first using LibreOffice
    execSync(`libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${pptPath}"`, {
      timeout: 120000,
    });

    // Find the generated PDF
    const pdfFile = fs.readdirSync(tmpDir).find((f: string) => f.endsWith(".pdf"));
    if (!pdfFile) {
      throw new Error("LibreOffice PDF conversion failed");
    }

    const pdfBuffer = fs.readFileSync(path.join(tmpDir, pdfFile));
    return pdfToImages(pdfBuffer);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("[OCR] Failed to cleanup temp dir:", tmpDir);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract text from a PDF file using Google Cloud Vision OCR.
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<OcrResult> {
  console.log("[OCR] Converting PDF to images...");
  const images = await pdfToImages(pdfBuffer);
  console.log(`[OCR] Converted ${images.length} pages to images`);

  const pages: OcrPage[] = [];

  for (let i = 0; i < images.length; i++) {
    console.log(`[OCR] Processing page ${i + 1}/${images.length}...`);
    const apiResponse = await callVisionApi(images[i]);
    const page = parseVisionResponse(apiResponse, i + 1);
    pages.push(page);
  }

  const rawText = pages.map(p => p.text).join("\n\n---\n\n");

  return {
    pages,
    totalPages: pages.length,
    rawText,
  };
}

/**
 * Extract text from a PPT/PPTX file using Google Cloud Vision OCR.
 */
export async function extractTextFromPpt(pptBuffer: Buffer, filename: string): Promise<OcrResult> {
  console.log("[OCR] Converting PPT to images...");
  const images = await pptToImages(pptBuffer, filename);
  console.log(`[OCR] Converted ${images.length} slides to images`);

  const pages: OcrPage[] = [];

  for (let i = 0; i < images.length; i++) {
    console.log(`[OCR] Processing slide ${i + 1}/${images.length}...`);
    const apiResponse = await callVisionApi(images[i]);
    const page = parseVisionResponse(apiResponse, i + 1);
    pages.push(page);
  }

  const rawText = pages.map(p => p.text).join("\n\n---\n\n");

  return {
    pages,
    totalPages: pages.length,
    rawText,
  };
}

/**
 * Extract text from an image file using Google Cloud Vision OCR.
 */
export async function extractTextFromImage(imageBuffer: Buffer): Promise<OcrResult> {
  console.log("[OCR] Processing single image...");
  const base64 = imageBuffer.toString("base64");
  const apiResponse = await callVisionApi(base64);
  const page = parseVisionResponse(apiResponse, 1);

  return {
    pages: [page],
    totalPages: 1,
    rawText: page.text,
  };
}
