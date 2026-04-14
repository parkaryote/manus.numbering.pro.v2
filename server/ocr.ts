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
const OPERATION_OUTPUT_MARKER = "||output||";
const OCR_ENABLED = process.env.OCR_ENABLED === "true";
const OCR_ASYNC_DOCUMENT_ENABLED = OCR_ENABLED && Boolean(GCS_TEMP_BUCKET);
const OCR_USE_ADC = process.env.GCP_USE_ADC === "true";
const TESSERACT_LANG = process.env.TESSERACT_LANG?.trim() || "kor+eng";
const TESSERACT_LANG_PATH = process.env.TESSERACT_LANG_PATH?.trim();
const OCR_OUTPUT_BATCH_SIZE = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.OCR_OUTPUT_BATCH_SIZE ?? "100", 10) || 100)
);
const OCR_INLINE_DOCUMENT_ENABLED = process.env.OCR_INLINE_DOCUMENT_ENABLED === "true";
const OCR_INLINE_DOCUMENT_MAX_BYTES = Math.max(
  1 * 1024 * 1024,
  Number.parseInt(process.env.OCR_INLINE_DOCUMENT_MAX_BYTES ?? `${8 * 1024 * 1024}`, 10) ||
    8 * 1024 * 1024
);
const OCR_STRICT_MEMO_FILTER_ENABLED = process.env.OCR_STRICT_MEMO_FILTER !== "false";
const OCR_SMALL_FONT_RATIO = Math.min(
  0.9,
  Math.max(0.55, Number.parseFloat(process.env.OCR_SMALL_FONT_RATIO ?? "0.72") || 0.72)
);

if (!OCR_ENABLED) {
  console.warn(
    "[OCR] Disabled. Set OCR_ENABLED=true with GCP_PROJECT_ID and GCS_TEMP_BUCKET to enable."
  );
} else if (!OCR_ASYNC_DOCUMENT_ENABLED) {
  console.info(
    "[OCR] Enabled in image mode. Set GCS_TEMP_BUCKET to enable PDF/문서 OCR as well."
  );
}

function parseServiceAccountCredentials():
  | { client_email?: string; private_key?: string; [key: string]: unknown }
  | undefined {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;

  const parseRaw = (input: string) => {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as any;
    return undefined;
  };

  try {
    if (raw.startsWith("{")) return parseRaw(raw);
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return parseRaw(decoded);
  } catch (error) {
    console.warn("[OCR] Failed to parse GCP_SERVICE_ACCOUNT_JSON:", error);
    return undefined;
  }
}

const serviceAccountCredentials = parseServiceAccountCredentials();
const GOOGLE_APPLICATION_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? "";
const HAS_EXPLICIT_GOOGLE_CREDENTIALS =
  Boolean(serviceAccountCredentials) || GOOGLE_APPLICATION_CREDENTIALS_PATH.length > 0;
const HAS_GOOGLE_AUTH = HAS_EXPLICIT_GOOGLE_CREDENTIALS || OCR_USE_ADC;
const ocrClientOptions: {
  projectId?: string;
  credentials?: { client_email?: string; private_key?: string; [key: string]: unknown };
} = {};

if (PROJECT_ID) {
  ocrClientOptions.projectId = PROJECT_ID;
}
if (serviceAccountCredentials) {
  ocrClientOptions.credentials = serviceAccountCredentials;
}

const storage = OCR_ASYNC_DOCUMENT_ENABLED && HAS_GOOGLE_AUTH
  ? new Storage(ocrClientOptions)
  : null;
const visionClient = OCR_ENABLED && HAS_GOOGLE_AUTH
  ? new ImageAnnotatorClient(ocrClientOptions)
  : null;
const OCR_LOCAL_IMAGE_FALLBACK = OCR_ENABLED && !HAS_GOOGLE_AUTH;

if (OCR_LOCAL_IMAGE_FALLBACK) {
  console.info("[OCR] Google credentials missing. Falling back to local image OCR (tesseract.js).");
} else if (OCR_ENABLED && OCR_USE_ADC && !HAS_EXPLICIT_GOOGLE_CREDENTIALS) {
  console.info("[OCR] Using ADC (gcloud auth application-default login).");
}

export function isOCREnabled(): boolean {
  return OCR_ENABLED;
}

function assertOCREnabled(): void {
  if (!OCR_ENABLED) {
    throw new Error(
      "OCR is disabled. Set OCR_ENABLED=true and configure Google Cloud credentials."
    );
  }
}

function assertAsyncDocumentOCREnabled(): void {
  assertOCREnabled();
  if (!OCR_ASYNC_DOCUMENT_ENABLED || !storage || !GCS_TEMP_BUCKET) {
    throw new Error(
      "문서 OCR(PDF)은 아직 설정되지 않았습니다. GCS_TEMP_BUCKET을 설정하면 활성화됩니다."
    );
  }
  if (!visionClient) {
    throw new Error(
      "문서 OCR(PDF)은 Google credentials가 필요합니다. GCP_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS 또는 GCP_USE_ADC=true + gcloud ADC 로그인 설정이 필요합니다."
    );
  }
}

/**
 * Upload file to GCS temporary bucket
 * Returns: gs:// URI for Vision API
 */
export async function uploadToGCS(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = "application/octet-stream"
): Promise<string> {
  assertAsyncDocumentOCREnabled();
  const bucket = storage!.bucket(GCS_TEMP_BUCKET);
  const file = bucket.file(`ocr-temp/${Date.now()}-${fileName}`);

  await file.save(fileBuffer, { contentType: mimeType });

  return `gs://${GCS_TEMP_BUCKET}/${file.name}`;
}

function encodeOperationRef(operationName: string, outputUri: string): string {
  return `${operationName}${OPERATION_OUTPUT_MARKER}${outputUri}`;
}

function decodeOperationRef(operationRef: string): { operationName: string; outputUri: string | null } {
  const markerIndex = operationRef.indexOf(OPERATION_OUTPUT_MARKER);
  if (markerIndex < 0) {
    return { operationName: operationRef, outputUri: null };
  }
  const operationName = operationRef.slice(0, markerIndex);
  const outputUri = operationRef.slice(markerIndex + OPERATION_OUTPUT_MARKER.length);
  return {
    operationName,
    outputUri: outputUri || null,
  };
}

function parseGcsUri(gcsUri: string): { bucket: string; path: string } {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  return { bucket: match[1], path: match[2] };
}

type VisionWordNode = {
  text: string;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  height: number;
};

type VisionLineNode = {
  text: string;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  words: VisionWordNode[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  avgHeight: number;
  isSmall: boolean;
  memoHint: boolean;
};

type ImageSampler = {
  width: number;
  height: number;
  data: Uint8Array;
};

type LineColorSignals = {
  blueRatio: number;
  redBorderRatio: number;
  greenBorderRatio: number;
  hasColoredBorder: boolean;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseBoundingVertices(
  source: any,
  pageWidth: number,
  pageHeight: number
): Array<{ x: number; y: number }> | null {
  const vertices = Array.isArray(source?.vertices)
    ? source.vertices
    : Array.isArray(source?.normalizedVertices)
      ? source.normalizedVertices
      : null;
  if (!vertices || vertices.length === 0) return null;

  const parsed = vertices
    .map((vertex: any) => {
      const rawX = Number(vertex?.x ?? 0);
      const rawY = Number(vertex?.y ?? 0);
      const useNormalized =
        rawX >= 0 &&
        rawX <= 1 &&
        rawY >= 0 &&
        rawY <= 1 &&
        pageWidth > 1 &&
        pageHeight > 1;
      const x = useNormalized ? rawX * pageWidth : rawX;
      const y = useNormalized ? rawY * pageHeight : rawY;
      return { x, y };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  return parsed.length >= 3 ? parsed : null;
}

function normalizeLineText(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const MEMO_HINT_REGEX =
  /(?:^|\s)(?:q\s*[.:]|a\s*[.:]|참고|주의|메모|note|tip|근데|그러면|그래서|쉽게|헷갈|설명|부연|정리)/i;

function extractVisionLines(fullTextAnnotation: any): VisionLineNode[] {
  const pages = Array.isArray(fullTextAnnotation?.pages) ? fullTextAnnotation.pages : [];
  if (pages.length === 0) return [];

  const lines: VisionLineNode[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const pageWidth = Number(page?.width ?? 0) || 1;
    const pageHeight = Number(page?.height ?? 0) || 1;
    const words: VisionWordNode[] = [];

    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const block of blocks) {
      const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
      for (const paragraph of paragraphs) {
        const paragraphWords = Array.isArray(paragraph?.words) ? paragraph.words : [];
        for (const word of paragraphWords) {
          const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
          const text = symbols.map((symbol: any) => String(symbol?.text ?? "")).join("").trim();
          if (!text) continue;
          const vertices = parseBoundingVertices(word?.boundingBox, pageWidth, pageHeight);
          if (!vertices) continue;

          const xs = vertices.map((point) => point.x);
          const ys = vertices.map((point) => point.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const height = Math.max(1, maxY - minY);
          words.push({
            text,
            pageIndex,
            pageWidth,
            pageHeight,
            minX,
            minY,
            maxX,
            maxY,
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
            height,
          });
        }
      }
    }

    if (words.length === 0) continue;
    words.sort((a, b) => (a.cy === b.cy ? a.cx - b.cx : a.cy - b.cy));

    type TempLine = {
      words: VisionWordNode[];
      centerY: number;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };

    const tempLines: TempLine[] = [];

    for (const word of words) {
      let bestIdx = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < tempLines.length; i += 1) {
        const candidate = tempLines[i];
        const candidateMedianHeight = median(candidate.words.map((item) => item.height));
        const threshold = Math.max(6, candidateMedianHeight * 0.75, pageHeight * 0.008);
        const distance = Math.abs(word.cy - candidate.centerY);
        if (distance <= threshold && distance < bestDistance) {
          bestIdx = i;
          bestDistance = distance;
        }
      }

      if (bestIdx < 0) {
        tempLines.push({
          words: [word],
          centerY: word.cy,
          minX: word.minX,
          minY: word.minY,
          maxX: word.maxX,
          maxY: word.maxY,
        });
        continue;
      }

      const target = tempLines[bestIdx];
      target.words.push(word);
      target.centerY =
        (target.centerY * (target.words.length - 1) + word.cy) / target.words.length;
      target.minX = Math.min(target.minX, word.minX);
      target.minY = Math.min(target.minY, word.minY);
      target.maxX = Math.max(target.maxX, word.maxX);
      target.maxY = Math.max(target.maxY, word.maxY);
    }

    tempLines.sort((a, b) => a.centerY - b.centerY);
    const lineHeights = tempLines.map((line) => median(line.words.map((word) => word.height)));
    const medianHeight = Math.max(1, median(lineHeights));
    const smallThreshold = medianHeight * OCR_SMALL_FONT_RATIO;

    for (const line of tempLines) {
      const sortedWords = [...line.words].sort((a, b) => a.minX - b.minX);
      const text = normalizeLineText(sortedWords.map((word) => word.text).join(" "));
      if (!text) continue;

      const avgHeight = median(sortedWords.map((word) => word.height));
      lines.push({
        text,
        pageIndex,
        pageWidth,
        pageHeight,
        words: sortedWords,
        minX: line.minX,
        minY: line.minY,
        maxX: line.maxX,
        maxY: line.maxY,
        cx: (line.minX + line.maxX) / 2,
        cy: line.centerY,
        avgHeight,
        isSmall: avgHeight <= smallThreshold,
        memoHint: MEMO_HINT_REGEX.test(text),
      });
    }
  }

  return lines;
}

function getPixel(sampler: ImageSampler, x: number, y: number) {
  const clampedX = clampInt(x, 0, sampler.width - 1);
  const clampedY = clampInt(y, 0, sampler.height - 1);
  const idx = (clampedY * sampler.width + clampedX) * 4;
  const data = sampler.data;
  return {
    r: data[idx] ?? 255,
    g: data[idx + 1] ?? 255,
    b: data[idx + 2] ?? 255,
    a: data[idx + 3] ?? 255,
  };
}

function isNearWhite(rgb: { r: number; g: number; b: number }) {
  return rgb.r > 238 && rgb.g > 238 && rgb.b > 238;
}

function isBlueInk(rgb: { r: number; g: number; b: number }) {
  return rgb.b > 85 && rgb.b > rgb.r + 18 && rgb.b > rgb.g + 10;
}

function isRedInk(rgb: { r: number; g: number; b: number }) {
  return rgb.r > 130 && rgb.r > rgb.g + 25 && rgb.r > rgb.b + 25;
}

function isGreenInk(rgb: { r: number; g: number; b: number }) {
  return rgb.g > 130 && rgb.g > rgb.r + 15 && rgb.g > rgb.b + 15;
}

function getLineColorSignals(
  line: VisionLineNode,
  sampler: ImageSampler | null
): LineColorSignals {
  if (!sampler) {
    return {
      blueRatio: 0,
      redBorderRatio: 0,
      greenBorderRatio: 0,
      hasColoredBorder: false,
    };
  }

  const scaleX = sampler.width / Math.max(line.pageWidth, 1);
  const scaleY = sampler.height / Math.max(line.pageHeight, 1);
  const samples: Array<{ r: number; g: number; b: number }> = [];

  const wordSampleTargets = line.words.slice(0, 40);
  for (const word of wordSampleTargets) {
    const samplePoints = [
      { x: word.cx, y: word.cy },
      { x: word.minX + (word.maxX - word.minX) * 0.35, y: word.cy },
      { x: word.minX + (word.maxX - word.minX) * 0.65, y: word.cy },
    ];
    for (const point of samplePoints) {
      const color = getPixel(sampler, point.x * scaleX, point.y * scaleY);
      if (isNearWhite(color)) continue;
      samples.push(color);
    }
  }

  const blueCount = samples.filter((color) => isBlueInk(color)).length;
  const blueRatio = samples.length > 0 ? blueCount / samples.length : 0;

  const expandedMinX = (line.minX - 8) * scaleX;
  const expandedMaxX = (line.maxX + 8) * scaleX;
  const expandedMinY = (line.minY - 6) * scaleY;
  const expandedMaxY = (line.maxY + 6) * scaleY;

  const borderSamples: Array<{ r: number; g: number; b: number }> = [];
  const steps = 28;
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / Math.max(steps, 1);
    const x = expandedMinX + (expandedMaxX - expandedMinX) * ratio;
    borderSamples.push(getPixel(sampler, x, expandedMinY));
    borderSamples.push(getPixel(sampler, x, expandedMaxY));
    const y = expandedMinY + (expandedMaxY - expandedMinY) * ratio;
    borderSamples.push(getPixel(sampler, expandedMinX, y));
    borderSamples.push(getPixel(sampler, expandedMaxX, y));
  }

  const validBorder = borderSamples.filter((color) => !isNearWhite(color));
  const redBorder = validBorder.filter((color) => isRedInk(color)).length;
  const greenBorder = validBorder.filter((color) => isGreenInk(color)).length;
  const redBorderRatio = validBorder.length > 0 ? redBorder / validBorder.length : 0;
  const greenBorderRatio = validBorder.length > 0 ? greenBorder / validBorder.length : 0;
  const hasColoredBorder = redBorderRatio >= 0.06 || greenBorderRatio >= 0.06;

  return {
    blueRatio,
    redBorderRatio,
    greenBorderRatio,
    hasColoredBorder,
  };
}

function shouldExcludeAsMemo(line: VisionLineNode, colorSignals: LineColorSignals): boolean {
  if (!OCR_STRICT_MEMO_FILTER_ENABLED) {
    return line.memoHint;
  }

  // 파란 글씨 자체를 필기 우선으로 강하게 제외
  if (colorSignals.blueRatio >= 0.08) {
    return true;
  }

  // 빨강/초록 박스 안 파란 글씨는 무조건 필기 취급
  if (colorSignals.hasColoredBorder && colorSignals.blueRatio >= 0.02) {
    return true;
  }

  // 작은 글씨는 필기일 가능성이 높아서 강하게 제외
  if (line.isSmall) {
    return true;
  }

  // 메모형 문구 + 파란 계열은 필기로 제외
  if (line.memoHint && colorSignals.blueRatio >= 0.02) {
    return true;
  }

  return false;
}

async function buildImageSampler(fileBuffer: Buffer): Promise<ImageSampler | null> {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const { data, info } = await sharp(fileBuffer, { failOnError: false })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      data,
    };
  } catch (error) {
    console.warn("[OCR] color sampler unavailable; using text+size filter only:", error);
    return null;
  }
}

function extractFilteredTextFromVisionResponse(
  response: any,
  sampler: ImageSampler | null
): string {
  const annotation = response?.fullTextAnnotation;
  if (!annotation) {
    const firstText = response?.textAnnotations?.[0]?.description;
    return typeof firstText === "string" ? firstText.trim() : "";
  }

  const lines = extractVisionLines(annotation);
  if (lines.length === 0) {
    const fullText = annotation?.text;
    return typeof fullText === "string" ? fullText.trim() : "";
  }

  const keptByPage = new Map<number, string[]>();
  for (const line of lines) {
    const colorSignals = getLineColorSignals(line, sampler);
    if (shouldExcludeAsMemo(line, colorSignals)) continue;
    const bucket = keptByPage.get(line.pageIndex) ?? [];
    bucket.push(line.text);
    keptByPage.set(line.pageIndex, bucket);
  }

  const keptEntries: Array<[number, string[]]> = [];
  keptByPage.forEach((linesInPage, pageIndex) => {
    keptEntries.push([pageIndex, linesInPage]);
  });

  const extracted = keptEntries
    .sort((a, b) => a[0] - b[0])
    .map(([, linesInPage]) => linesInPage.join("\n").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (extracted.length > 0) return extracted;
  const fallbackText = annotation?.text;
  return typeof fallbackText === "string" ? fallbackText.trim() : "";
}

async function extractTextFromVisionPayload(payload: any): Promise<string> {
  const responses = Array.isArray(payload?.responses) ? payload.responses : [];
  const textChunks: string[] = [];
  for (const response of responses) {
    const fullText = extractFilteredTextFromVisionResponse(response, null);
    if (typeof fullText === "string" && fullText.trim().length > 0) {
      textChunks.push(fullText.trim());
      continue;
    }
    const firstText = response?.textAnnotations?.[0]?.description;
    if (typeof firstText === "string" && firstText.trim().length > 0) {
      textChunks.push(firstText.trim());
    }
  }
  return textChunks.join("\n\n").trim();
}

async function readOutputFromGCS(outputUri: string): Promise<string> {
  assertAsyncDocumentOCREnabled();
  const { bucket: bucketName, path } = parseGcsUri(outputUri);
  const prefix = path.endsWith("/") ? path : `${path}/`;
  const bucket = storage!.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix });
  const jsonFiles = files
    .filter((file) => file.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (jsonFiles.length === 0) {
    throw new Error("OCR output JSON files not found in GCS output prefix");
  }

  const extractedPerFile = await Promise.all(
    jsonFiles.map(async (file) => {
      const [buffer] = await file.download();
      const payload = JSON.parse(buffer.toString("utf8"));
      return await extractTextFromVisionPayload(payload);
    })
  );

  return extractedPerFile.filter(Boolean).join("\n\n").trim();
}

function tryExtractOutputUriFromOperation(operation: any): string | null {
  const response = operation?.response ?? operation?.result ?? null;
  if (!response) return null;
  const candidates: string[] = [];

  const walk = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      if (value.startsWith("gs://")) candidates.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      for (const val of Object.values(value as Record<string, unknown>)) {
        walk(val);
      }
    }
  };

  walk(response);
  const outputCandidate = candidates.find((uri) => uri.includes("/ocr-results/"));
  return outputCandidate ?? candidates.find((uri) => uri.endsWith("/")) ?? candidates[0] ?? null;
}

function normalizeOcrMimeType(mimeType: string | undefined | null): string {
  const normalized = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  return normalized || "application/pdf";
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/tiff" && mimeType !== "image/tif";
}

function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type LocalOcrImageVariant = {
  label: string;
  buffer: Buffer;
  psmModes: readonly number[];
};

async function buildLocalOcrImageVariants(fileBuffer: Buffer): Promise<LocalOcrImageVariant[]> {
  const variants: LocalOcrImageVariant[] = [
    { label: "raw", buffer: fileBuffer, psmModes: [6, 4, 11] },
  ];

  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const base = sharp(fileBuffer, { failOnError: false }).rotate();
    const metadata = await base.metadata();
    const width = metadata.width ?? 0;
    const resizedWidth = width > 0 ? Math.min(Math.max(width * 2, 1400), 3600) : 2000;

    const upscaled = await base
      .clone()
      .resize({ width: resizedWidth, withoutEnlargement: false, kernel: "lanczos3" })
      .png({ compressionLevel: 0 })
      .toBuffer();
    variants.push({ label: "upscaled", buffer: upscaled, psmModes: [6, 4, 11] });

    const normalized = await base
      .clone()
      .resize({ width: resizedWidth, withoutEnlargement: false, kernel: "lanczos3" })
      .grayscale()
      .normalise()
      .sharpen()
      .png({ compressionLevel: 0 })
      .toBuffer();
    variants.push({ label: "normalized", buffer: normalized, psmModes: [6, 4, 11] });

    const thresholded = await base
      .clone()
      .resize({ width: resizedWidth, withoutEnlargement: false, kernel: "lanczos3" })
      .grayscale()
      .normalise()
      .sharpen()
      .threshold(165)
      .png({ compressionLevel: 0 })
      .toBuffer();
    variants.push({ label: "thresholded", buffer: thresholded, psmModes: [6, 4, 11] });
  } catch (error) {
    console.warn(
      "[OCR] sharp preprocess unavailable. Install 'sharp' for better local OCR quality:",
      error
    );
  }

  return variants;
}

function scoreLocalOcrCandidate(text: string, confidence: number): number {
  const compactText = text.replace(/\s+/g, "");
  const nonWhitespaceChars = compactText.length;
  const hangulChars = (text.match(/[가-힣]/g) ?? []).length;
  const digitChars = (text.match(/[0-9]/g) ?? []).length;
  const lineCount = text.split("\n").filter((line) => line.trim().length > 0).length;
  const replacementChars = (text.match(/[�□]/g) ?? []).length;
  const punctuationLikeNoise = (text.match(/[~`^|\\/]{2,}/g) ?? []).length;

  const noisePenalty = Math.min(22, replacementChars * 2 + punctuationLikeNoise * 1.5);

  return (
    confidence * 1.25 +
    Math.min(28, nonWhitespaceChars / 14) +
    Math.min(12, hangulChars / 8) +
    Math.min(8, digitChars / 3) +
    Math.min(8, lineCount) -
    noisePenalty
  );
}

export function getOutputUriFromOperationRef(operationRef: string | null | undefined): string | null {
  if (!operationRef) return null;
  return decodeOperationRef(operationRef).outputUri;
}

function createOcrOutputUri(): string {
  return `gs://${GCS_TEMP_BUCKET}/ocr-results/${Date.now()}-${Math.random().toString(36).slice(2)}/`;
}

export function canUseInlineDocumentInput(mimeType: string, fileByteLength: number): boolean {
  if (!OCR_INLINE_DOCUMENT_ENABLED) return false;
  const normalizedMimeType = normalizeOcrMimeType(mimeType);
  const isDocument =
    normalizedMimeType === "application/pdf" ||
    normalizedMimeType === "image/tiff" ||
    normalizedMimeType === "image/tif";
  return isDocument && fileByteLength <= OCR_INLINE_DOCUMENT_MAX_BYTES;
}

/**
 * Extract text from PDF/image using asyncBatchAnnotateFiles
 * Returns: Operation name for polling
 */
export async function startOCRJob(gcsUri: string, mimeType?: string): Promise<string> {
  assertAsyncDocumentOCREnabled();
  const normalizedMimeType = normalizeOcrMimeType(mimeType);
  if (isImageMimeType(normalizedMimeType)) {
    throw new Error("startOCRJob is for async document OCR only. Use extractTextFromImageBuffer for images.");
  }
  const outputUri = createOcrOutputUri();
  const request = {
    requests: [
      {
        inputConfig: {
          gcsSource: {
            uri: gcsUri,
          },
          mimeType: normalizedMimeType,
        },
        features: [
          {
            type: "DOCUMENT_TEXT_DETECTION" as const,
          },
        ],
        outputConfig: {
          gcsDestination: {
            uri: outputUri,
          },
          batchSize: OCR_OUTPUT_BATCH_SIZE,
        },
      },
    ],
  };

  const [operation] = await visionClient!.asyncBatchAnnotateFiles(request);

  if (!operation.name) {
    throw new Error("No operation name returned from Vision API");
  }

  return encodeOperationRef(operation.name, outputUri);
}

export async function startOCRJobFromBuffer(
  fileBuffer: Buffer,
  mimeType?: string
): Promise<string> {
  assertAsyncDocumentOCREnabled();
  const normalizedMimeType = normalizeOcrMimeType(mimeType);
  if (isImageMimeType(normalizedMimeType)) {
    throw new Error(
      "startOCRJobFromBuffer is for async document OCR only. Use extractTextFromImageBuffer for images."
    );
  }
  const outputUri = createOcrOutputUri();
  const request = {
    requests: [
      {
        inputConfig: {
          content: fileBuffer,
          mimeType: normalizedMimeType,
        },
        features: [
          {
            type: "DOCUMENT_TEXT_DETECTION" as const,
          },
        ],
        outputConfig: {
          gcsDestination: {
            uri: outputUri,
          },
          batchSize: OCR_OUTPUT_BATCH_SIZE,
        },
      },
    ],
  };

  const [operation] = await visionClient!.asyncBatchAnnotateFiles(request);

  if (!operation.name) {
    throw new Error("No operation name returned from Vision API");
  }

  return encodeOperationRef(operation.name, outputUri);
}

/**
 * Poll operation status
 * Returns: true if complete, false if still processing
 */
export async function checkOCRJobStatus(operationRef: string): Promise<boolean> {
  assertOCREnabled();
  const { operationName } = decodeOperationRef(operationRef);
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
export async function getOCRResults(operationRef: string): Promise<string> {
  assertOCREnabled();
  const { operationName, outputUri: outputUriFromRef } = decodeOperationRef(operationRef);
  const result = await visionClient!.checkAsyncBatchAnnotateFilesProgress(
    operationName
  );
  const operation = Array.isArray(result) ? result[0] : result;

  if (!operation.done) {
    throw new Error("Operation not yet complete");
  }

  const outputUri = outputUriFromRef ?? tryExtractOutputUriFromOperation(operation);
  if (!outputUri) {
    throw new Error("Cannot resolve OCR output URI from operation");
  }
  return await readOutputFromGCS(outputUri);
}

export async function extractTextFromImageBuffer(
  fileBuffer: Buffer,
  mimeType?: string
): Promise<string> {
  assertOCREnabled();
  const normalizedMimeType = normalizeOcrMimeType(mimeType);
  if (!isImageMimeType(normalizedMimeType)) {
    throw new Error(`Unsupported image mimeType for sync OCR: ${normalizedMimeType}`);
  }

  if (visionClient) {
    try {
      const [response] = await visionClient.documentTextDetection({
        image: { content: fileBuffer },
      });
      const sampler = await buildImageSampler(fileBuffer);
      const filtered = extractFilteredTextFromVisionResponse(response, sampler);
      if (filtered.trim().length > 0) {
        return filtered;
      }
      return response.fullTextAnnotation?.text ?? response.textAnnotations?.[0]?.description ?? "";
    } catch (error) {
      // Explicit key/env가 없는 경우, ADC 미설정 상황이면 이미지 OCR은 로컬로 자동 폴백
      if (!HAS_EXPLICIT_GOOGLE_CREDENTIALS) {
        console.warn("[OCR] Vision image OCR failed; falling back to local OCR:", error);
      } else {
        throw error;
      }
    }
  }

  const { createWorker } = await import("tesseract.js");
  const workerOptions: Record<string, unknown> = {};
  if (TESSERACT_LANG_PATH) {
    workerOptions.langPath = TESSERACT_LANG_PATH;
  }
  const worker = await createWorker(TESSERACT_LANG, 1, workerOptions);
  try {
    const variants = await buildLocalOcrImageVariants(fileBuffer);
    let best:
      | {
          text: string;
          score: number;
          confidence: number;
          mode: number;
          variant: string;
        }
      | null = null;

    for (const variant of variants) {
      for (const mode of variant.psmModes) {
        await worker.setParameters({
          tessedit_pageseg_mode: String(mode),
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
          textord_tabfind_find_tables: "1",
          textord_tablefind_recognize_tables: "1",
        } as Record<string, string>);

        const result = await worker.recognize(variant.buffer);
        const rawText = result?.data?.text ?? "";
        const text = normalizeOcrText(rawText);
        const confidence = Number.isFinite(result?.data?.confidence)
          ? Number(result.data.confidence)
          : 0;
        const score = scoreLocalOcrCandidate(text, confidence);

        if (!best || score > best.score) {
          best = { text, score, confidence, mode, variant: variant.label };
        }

        const compactLength = text.replace(/\s+/g, "").length;
        if (confidence >= 93 && compactLength >= 45) {
          break;
        }
      }
    }

    if (!best) return "";
    console.info(
      `[OCR] Local image OCR selected variant=${best.variant}, mode=${best.mode}, confidence=${best.confidence.toFixed(1)}`
    );
    return best.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Clean up temporary GCS files
 */
export async function cleanupGCSFiles(gcsUri: string): Promise<void> {
  if (!OCR_ASYNC_DOCUMENT_ENABLED) return;

  try {
    // Extract bucket and file path from gs:// URI
    const { bucket: bucketName, path: filePath } = parseGcsUri(gcsUri);
    const bucket = storage!.bucket(bucketName);
    if (filePath.endsWith("/")) {
      const [files] = await bucket.getFiles({ prefix: filePath });
      await Promise.all(
        files.map((file) =>
          file.delete().catch(() => {
            // ignore
          })
        )
      );
      return;
    }
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
  if (!OCR_ASYNC_DOCUMENT_ENABLED) return;

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
