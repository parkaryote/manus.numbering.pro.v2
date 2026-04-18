import { useEffect, useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, CheckCircle, AlertCircle } from "lucide-react";
import { trackOCRComplete, trackOCRError, trackOCRStart } from "@/lib/ga4Events";

const NUMBERED_LINE_REGEX = /^\s*(?:\d{1,3}[.)]|[①-⑳]|[A-Za-z가-힣][.)])\s*/;
const BULLET_LINE_REGEX = /^\s*(?:[-–—*•·▪◦])\s+/;
const TOP_BULLET_LINE_REGEX = /^\s*(?:[*•·▪◦])\s+/;
const DASH_BULLET_LINE_REGEX = /^\s*(?:[-–—])\s+/;
const BOX_BULLET_LINE_REGEX = /^\s*(?:[■□▣▤▥▦▧▨▩◆◇◼◻◾◽⬛⬜🟦🟩🟥🟨])\s*/;
const STRONG_TITLE_LINE_REGEX =
  /^\s*(?:(?:box|table|tbl)\s*[-–—]?\s*[A-Za-z0-9가-힣]+|표\s*[A-Za-z0-9가-힣-]+|문제\s*\d+)\b/i;
const BOX_QA_LINE_REGEX =
  /^\s*(?:Q|A)\s*[.:：]\s*/i;
const NOTE_HINT_REGEX =
  /^\s*(?:※|참고|주의|메모|note|tip|cf\.?|supplement|appendix|별첨|부연)\b/i;
const CONVERSATIONAL_NOTE_HINT_REGEX =
  /(근데|그러면|그래서|쉽게|어렵|헷갈|설명|정리|생각|도움|외우|암기|포인트|시험|문제라고|적어|써요|라고)/i;
const SENTENCE_ENDING_REGEX = /(입니다|습니다|해요|돼요|되요|된다|좋다|같다|거다|거예요|거에요)([.!?…])?$/;

type OCRJobStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

export interface OCRExtractedPayload {
  blockText: string;
  fullText: string;
  rawText: string;
  includeMemoLines: boolean;
  selectedPages: number[] | null;
}

interface OCRUploaderProps {
  onExtractedText?: (payload: OCRExtractedPayload) => void;
  prefillFile?: File | null;
  onPrefillConsumed?: () => void;
}

type ProcessedOcrText = {
  blockText: string;
  fullText: string;
};

function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isLikelyMemoLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (BOX_QA_LINE_REGEX.test(trimmed)) return true;
  if (BOX_BULLET_LINE_REGEX.test(trimmed) && !NUMBERED_LINE_REGEX.test(trimmed)) return true;
  if (NUMBERED_LINE_REGEX.test(trimmed)) return false;
  if (TOP_BULLET_LINE_REGEX.test(trimmed) || DASH_BULLET_LINE_REGEX.test(trimmed)) return false;
  if (trimmed.length <= 3) return true;
  if (NOTE_HINT_REGEX.test(trimmed)) return true;
  if (CONVERSATIONAL_NOTE_HINT_REGEX.test(trimmed)) return true;
  if (/[!?]/.test(trimmed)) return true;
  if (trimmed.startsWith("(") && trimmed.endsWith(")") && trimmed.length <= 60) return true;
  const cleaned = cleanTitleLine(trimmed);
  if (cleaned.length >= 28 && SENTENCE_ENDING_REGEX.test(cleaned)) return true;
  if (cleaned.length >= 40 && !isStrongTitleLine(cleaned)) return true;
  const symbolRatio =
    (trimmed.match(/[~`!@#$%^&*_=+|\\/<>[\]{}]/g) ?? []).length / Math.max(trimmed.length, 1);
  return symbolRatio > 0.28;
}

function isAlwaysExcludedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  // 색상 박스의 Q./A. 문구는 강의록 본문/불렛이 아니므로 항상 제외
  if (BOX_QA_LINE_REGEX.test(trimmed)) return true;

  // 박스성 마커 문구(네모 글머리) 중 번호형 본문이 아닌 라인은 제외
  if (
    BOX_BULLET_LINE_REGEX.test(trimmed) &&
    !NUMBERED_LINE_REGEX.test(trimmed) &&
    !BULLET_LINE_REGEX.test(trimmed)
  ) {
    return true;
  }

  return false;
}

function cleanTitleLine(line: string): string {
  return line.replace(NUMBERED_LINE_REGEX, "").replace(BULLET_LINE_REGEX, "").trim();
}

function isContentLine(line: string): boolean {
  return NUMBERED_LINE_REGEX.test(line) || TOP_BULLET_LINE_REGEX.test(line) || DASH_BULLET_LINE_REGEX.test(line);
}

function isStrongTitleLine(line: string): boolean {
  if (isContentLine(line)) return false;
  const cleaned = cleanTitleLine(line);
  if (!cleaned) return false;
  if (NOTE_HINT_REGEX.test(cleaned)) return false;
  return STRONG_TITLE_LINE_REGEX.test(cleaned);
}

function romanToInt(input: string): number | null {
  const roman = input.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) return null;
  const map: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let i = 0; i < roman.length; i += 1) {
    const current = map[roman[i]];
    const next = map[roman[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && total <= 50 ? total : null;
}

function normalizeMajorTitle(line: string): string {
  const cleaned = cleanTitleLine(line);
  const romanMatch = cleaned.match(/^([IVXLCDM]+)\s*[.)]?\s*(.+)$/i);
  if (romanMatch) {
    const num = romanToInt(romanMatch[1]);
    if (num !== null) return `${num}) ${romanMatch[2].trim()}`;
  }
  const numericMatch = cleaned.match(/^(\d+)\s*[.)]\s*(.+)$/);
  if (numericMatch) {
    return `${numericMatch[1]}) ${numericMatch[2].trim()}`;
  }
  return cleaned;
}

function normalizeContentLine(raw: string, mainIndexRef: { value: number }): string {
  const line = raw.trim();
  if (NUMBERED_LINE_REGEX.test(line)) {
    const text = cleanTitleLine(line);
    const numberMatch = line.match(/^\s*(\d{1,3})[.)]/);
    if (numberMatch) {
      const n = Number.parseInt(numberMatch[1], 10);
      if (Number.isFinite(n)) mainIndexRef.value = n;
      return `${n}. ${text}`;
    }
    mainIndexRef.value += 1;
    return `${mainIndexRef.value}. ${text}`;
  }
  if (TOP_BULLET_LINE_REGEX.test(line)) {
    mainIndexRef.value += 1;
    return `${mainIndexRef.value}. ${cleanTitleLine(line)}`;
  }
  if (DASH_BULLET_LINE_REGEX.test(line)) {
    return `- ${cleanTitleLine(line)}`;
  }
  return cleanTitleLine(line);
}

function isMainItemCandidate(line: string): boolean {
  if (!line.trim()) return false;
  if (isContentLine(line)) return false;
  if (isStrongTitleLine(line)) return false;
  if (isLikelyMemoLine(line)) return false;
  const cleaned = cleanTitleLine(line);
  if (cleaned.length < 4 || cleaned.length > 42) return false;
  if (SENTENCE_ENDING_REGEX.test(cleaned)) return false;
  if (/[!?]/.test(cleaned)) return false;
  return /(역할|효과|기능|저항|감소|유지|보철|guiding|rest|indication|splinting|denture|relining)/i.test(cleaned);
}

function buildNumberingBlocks(lines: string[]): Array<{ title: string; body: string[] }> {
  const blocks: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  let pendingTitle = "";
  let mainIndex = { value: 0 };

  const flush = () => {
    if (!current) return;
    const body = current.body.map((line) => line.trim()).filter(Boolean);
    if (body.length > 0) {
      const title = current.title.trim() || cleanTitleLine(body[0]);
      blocks.push({
        title,
        body,
      });
    }
    current = null;
    mainIndex = { value: 0 };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    if (isLikelyMemoLine(line)) continue;

    const contentLine = isContentLine(line);

    if (contentLine) {
      if (!current) current = { title: pendingTitle, body: [] };
      current.body.push(normalizeContentLine(line, mainIndex));
      continue;
    }

    if (isMainItemCandidate(line)) {
      if (!current) current = { title: pendingTitle, body: [] };
      mainIndex.value += 1;
      current.body.push(`${mainIndex.value}. ${cleanTitleLine(line)}`);
      continue;
    }

    const nextNonEmpty = lines.slice(i + 1).find((candidate) => candidate.trim().length > 0) ?? "";
    const nextIsContent = isContentLine(nextNonEmpty);
    const isBoundaryTitle = isStrongTitleLine(line) || nextIsContent;
    if (!isBoundaryTitle) continue;

    if (current && current.body.length > 0) {
      flush();
    }
    pendingTitle = normalizeMajorTitle(line);
  }

  flush();
  return blocks.filter((block) => block.title.trim().length > 0);
}

function processOcrText(rawText: string, includeMemoLines: boolean): ProcessedOcrText {
  const normalized = normalizeText(rawText);
  if (!normalized) return { blockText: "", fullText: "" };

  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dedupedLines: string[] = [];
  let previous = "";
  for (const line of rawLines) {
    if (isAlwaysExcludedLine(line)) continue;
    if (line === previous) continue;
    previous = line;
    dedupedLines.push(line);
  }

  const baseLines: string[] = [];

  for (const line of dedupedLines) {
    if (isLikelyMemoLine(line)) {
      if (includeMemoLines) baseLines.push(line);
      continue;
    }
    baseLines.push(line);
  }

  const fullText = [...baseLines].join("\n");
  const blocks = buildNumberingBlocks(baseLines);
  const blockText = blocks
    .map((block) => [block.title, ...block.body].filter(Boolean).join("\n"))
    .join("\n---\n")
    .trim();

  return { blockText, fullText };
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function toSequentialPages(count: number): number[] {
  return Array.from({ length: count }, (_, idx) => idx + 1);
}

function parsePageSelectionSpec(raw: string, maxPage: number): number[] {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) return [];

  const selected = new Set<number>();
  const chunks = normalized.split(",").filter(Boolean);

  for (const chunk of chunks) {
    const rangeMatch = chunk.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = Number.parseInt(rangeMatch[1], 10);
      const to = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      const start = Math.max(1, Math.min(from, to));
      const end = Math.min(maxPage, Math.max(from, to));
      for (let page = start; page <= end; page++) {
        selected.add(page);
      }
      continue;
    }

    const single = Number.parseInt(chunk, 10);
    if (Number.isFinite(single) && single >= 1 && single <= maxPage) {
      selected.add(single);
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function serializePageSelection(pages: number[]): string {
  if (pages.length === 0) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    if (start === prev) ranges.push(`${start}`);
    else ranges.push(`${start}-${prev}`);
    start = current;
    prev = current;
  }

  return ranges.join(", ");
}

async function readPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

export function OCRUploader({ onExtractedText, prefillFile = null, onPrefillConsumed }: OCRUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<OCRJobStatus>("idle");
  const [rawExtractedText, setRawExtractedText] = useState<string>("");
  const [blockTextDraft, setBlockTextDraft] = useState<string>("");
  const [fullTextDraft, setFullTextDraft] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [includeMemoLines, setIncludeMemoLines] = useState(false);
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [selectedPdfPages, setSelectedPdfPages] = useState<number[]>([]);
  const [pageSelectionInput, setPageSelectionInput] = useState("");
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);

  const isPdf = useMemo(() => (file ? isPdfFile(file) : false), [file]);
  const selectedPdfPageCount = selectedPdfPages.length;
  const hasBulkDelimiter = useMemo(
    () => /(?:^|\n)\s*---+\s*(?:\n|$)/.test(blockTextDraft),
    [blockTextDraft]
  );

  const applyProcessedText = (text: string, includeMemo: boolean) => {
    const processed = processOcrText(text, includeMemo);
    setRawExtractedText(text);
    setBlockTextDraft(processed.blockText);
    setFullTextDraft(processed.fullText);
  };

  const startJobMutation = trpc.ocr.startJob.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      if (data.status === "completed") {
        const text = data.extractedText || "";
        applyProcessedText(text, includeMemoLines);
        setStatus("completed");
        trackOCRComplete(file?.name ?? "", text.length, 0);
        return;
      }
      setStatus("processing");
      setErrorMessage("");
    },
    onError: (error) => {
      setStatus("failed");
      setErrorMessage(error.message);
      trackOCRError(file?.name ?? "", error.message);
    },
  });

  const statusQuery = trpc.ocr.getStatus.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null && status === "processing",
      refetchInterval: 2000,
    }
  );

  useEffect(() => {
    if (statusQuery.data) {
      const data = statusQuery.data;
      if (data.status === "completed") {
        const text = data.extractedText || "";
        applyProcessedText(text, includeMemoLines);
        setStatus("completed");
        trackOCRComplete(file?.name ?? "", text.length, 0);
      } else if (data.status === "failed") {
        setStatus("failed");
        setErrorMessage(data.errorMessage || "OCR processing failed");
        trackOCRError(file?.name ?? "", data.errorMessage || "OCR processing failed");
      }
    }

    if (statusQuery.error) {
      setStatus("failed");
      setErrorMessage(statusQuery.error.message);
    }
  }, [file?.name, includeMemoLines, statusQuery.data, statusQuery.error]);

  useEffect(() => {
    if (!rawExtractedText) return;
    const processed = processOcrText(rawExtractedText, includeMemoLines);
    setBlockTextDraft(processed.blockText);
    setFullTextDraft(processed.fullText);
  }, [rawExtractedText, includeMemoLines]);

  const isSupportedOcrFile = (selectedFile: File) => {
    if (isPdfFile(selectedFile)) return true;
    const mime = (selectedFile.type || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const lowerName = selectedFile.name.toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif"].some((ext) =>
      lowerName.endsWith(ext)
    );
  };

  const applySelectedFile = async (selectedFile: File) => {
    if (!isSupportedOcrFile(selectedFile)) {
      setStatus("failed");
      setErrorMessage("지원하지 않는 파일 형식입니다. PDF 또는 이미지 파일만 가능합니다.");
      return;
    }

    setIsDropActive(false);
    setFile(selectedFile);
    setStatus("idle");
    setRawExtractedText("");
    setBlockTextDraft("");
    setFullTextDraft("");
    setErrorMessage("");
    setJobId(null);
    setTotalPdfPages(0);
    setSelectedPdfPages([]);
    setPageSelectionInput("");

    if (!isPdfFile(selectedFile)) {
      return;
    }

    setIsPreparingPdf(true);
    try {
      const pageCount = await readPdfPageCount(selectedFile);
      const allPages = toSequentialPages(pageCount);
      setTotalPdfPages(pageCount);
      setSelectedPdfPages(allPages);
      setPageSelectionInput(serializePageSelection(allPages));
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF 페이지 정보를 읽는 데 실패했습니다.";
      setErrorMessage(message);
      trackOCRError(selectedFile.name, message);
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await applySelectedFile(selectedFile);
    e.currentTarget.value = "";
  };

  const applyParsedSelection = (parsedPages: number[]) => {
    const normalized = [...parsedPages].sort((a, b) => a - b);
    setSelectedPdfPages(normalized);
    setPageSelectionInput(serializePageSelection(normalized));
  };

  const togglePdfPage = (pageNumber: number) => {
    setSelectedPdfPages((prev) => {
      const next = prev.includes(pageNumber)
        ? prev.filter((page) => page !== pageNumber)
        : [...prev, pageNumber];
      const sorted = next.sort((a, b) => a - b);
      setPageSelectionInput(serializePageSelection(sorted));
      return sorted;
    });
  };

  const handleApplySelectionInput = () => {
    if (totalPdfPages <= 0) return;
    const parsed = parsePageSelectionSpec(pageSelectionInput, totalPdfPages);
    if (parsed.length === 0) {
      setErrorMessage("페이지 선택 형식이 올바르지 않습니다. 예: 1-3,5,8");
      return;
    }
    setErrorMessage("");
    applyParsedSelection(parsed);
  };

  const handleUpload = async () => {
    if (!file) return;
    if (isPdf && totalPdfPages > 0 && selectedPdfPageCount === 0) {
      setStatus("failed");
      setErrorMessage("OCR할 슬라이드를 최소 1개 이상 선택해주세요.");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");
    trackOCRStart(file.name, file.size);

    try {
      const arrayBuffer = await file.arrayBuffer();
      startJobMutation.mutate({
        fileBuffer: new Uint8Array(arrayBuffer),
        fileName: file.name,
        mimeType: file.type,
        selectedPages: isPdf ? selectedPdfPages : undefined,
      });
    } catch (error) {
      setStatus("failed");
      const message = error instanceof Error ? error.message : "Upload failed";
      setErrorMessage(message);
      trackOCRError(file.name, message);
    }
  };

  const handleApply = () => {
    onExtractedText?.({
      blockText: blockTextDraft,
      fullText: fullTextDraft,
      rawText: rawExtractedText,
      includeMemoLines,
      selectedPages: isPdf ? selectedPdfPages : null,
    });
  };

  const handleReset = () => {
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setRawExtractedText("");
    setBlockTextDraft("");
    setFullTextDraft("");
    setErrorMessage("");
    setTotalPdfPages(0);
    setSelectedPdfPages([]);
    setPageSelectionInput("");
    setIsPreparingPdf(false);
    setIsDropActive(false);
  };

  useEffect(() => {
    if (!prefillFile) return;
    void applySelectedFile(prefillFile).finally(() => {
      onPrefillConsumed?.();
    });
  }, [onPrefillConsumed, prefillFile]);

  const handleDropAreaDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (file || status !== "idle") return;
    setIsDropActive(true);
  };

  const handleDropAreaDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
    setIsDropActive(false);
  };

  const handleDropAreaDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropActive(false);
    if (file || status !== "idle") return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;
    void applySelectedFile(droppedFile);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          OCR 문서 인식
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "idle" && !file && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDropActive ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={handleDropAreaDragOver}
            onDragEnter={handleDropAreaDragOver}
            onDragLeave={handleDropAreaDragLeave}
            onDrop={handleDropAreaDrop}
          >
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif"
              onChange={handleFileSelect}
              className="hidden"
              id="ocr-file-input"
            />
            <label htmlFor="ocr-file-input" className="cursor-pointer">
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">PDF 또는 이미지 파일을 선택하거나 드래그하세요</p>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG, WEBP, BMP, TIFF, GIF 지원</p>
              </div>
            </label>
          </div>
        )}

        {file && status === "idle" && (
          <div className="space-y-4">
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>

            {isPdf && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">슬라이드 선택</p>
                  <span className="text-xs text-muted-foreground">
                    {selectedPdfPageCount}/{totalPdfPages || 0} 선택
                  </span>
                </div>

                {isPreparingPdf ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    PDF 페이지 수를 확인하는 중...
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      미리보기 없이 페이지 번호만 선택합니다. 예: <code>1-3,5,8</code>
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => applyParsedSelection(toSequentialPages(totalPdfPages))}
                        disabled={totalPdfPages === 0}
                      >
                        전체
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => applyParsedSelection([])}
                        disabled={totalPdfPages === 0}
                      >
                        해제
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          applyParsedSelection(
                            toSequentialPages(totalPdfPages).filter((page) => page % 2 === 1)
                          )
                        }
                        disabled={totalPdfPages === 0}
                      >
                        홀수
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          applyParsedSelection(
                            toSequentialPages(totalPdfPages).filter((page) => page % 2 === 0)
                          )
                        }
                        disabled={totalPdfPages === 0}
                      >
                        짝수
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Textarea
                        value={pageSelectionInput}
                        onChange={(event) => setPageSelectionInput(event.target.value)}
                        className="min-h-12 text-sm"
                        placeholder="예: 2,4,7-10"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="self-start"
                        onClick={handleApplySelectionInput}
                        disabled={totalPdfPages === 0}
                      >
                        적용
                      </Button>
                    </div>

                    {totalPdfPages > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5">
                          {toSequentialPages(totalPdfPages).map((page) => {
                            const selected = selectedPdfPages.includes(page);
                            return (
                              <button
                                key={page}
                                type="button"
                                onClick={() => togglePdfPage(page)}
                                className={`h-7 rounded text-xs border transition-colors ${
                                  selected
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleUpload} className="flex-1" disabled={isPreparingPdf}>
                OCR 시작
              </Button>
              <Button onClick={handleReset} variant="outline">
                취소
              </Button>
            </div>
          </div>
        )}

        {status === "processing" && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-sm text-muted-foreground">문서를 인식 중입니다...</p>
          </div>
        )}

        {status === "completed" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <p className="text-sm font-medium">OCR 완료</p>
            </div>

            <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                OCR 자동 블록화: 각 블록 첫 줄은 제목, 아래는 내용. 블록 사이는 `---` 로 구분됩니다.
              </p>
              {hasBulkDelimiter ? (
                <p className="text-xs text-muted-foreground">
                  구분자 `---`가 감지되었습니다. 적용 후 텍스트 문제 탭에서 생성 버튼을 누르면 일괄 생성됩니다.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  블록이 1개만 감지되었습니다. 필요하면 제목/내용을 직접 수정해서 분리할 수 있습니다.
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeMemoLines}
                onChange={(event) => setIncludeMemoLines(event.target.checked)}
                className="w-4 h-4"
              />
              학습부 필기 포함
            </label>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                블록 일괄 입력 (첫 줄=제목, 아래=내용)
              </p>
              <Textarea
                value={blockTextDraft}
                onChange={(event) => setBlockTextDraft(event.target.value)}
                className="min-h-48 text-sm"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">인식 원문 (Raw OCR)</p>
              <Textarea
                value={rawExtractedText}
                onChange={(event) => setRawExtractedText(event.target.value)}
                className="min-h-40 text-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleApply} className="flex-1">
                일괄입력에 적용
              </Button>
              <Button onClick={handleReset} variant="outline">
                다시 시작
              </Button>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">오류 발생</p>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{errorMessage}</p>
            <Button onClick={handleReset} className="w-full">
              다시 시도
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
