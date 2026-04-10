import { useEffect, useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, CheckCircle, AlertCircle } from "lucide-react";
import { trackOCRComplete, trackOCRError, trackOCRStart } from "@/lib/ga4Events";

const NUMBERED_LINE_REGEX = /^\s*(?:\d{1,3}[.)]|[①-⑳]|[A-Za-z가-힣][.)])\s*/;
const BULLET_LINE_REGEX = /^\s*(?:[-*•·▪◦])\s+/;
const NOTE_HINT_REGEX =
  /^\s*(?:※|참고|주의|메모|note|tip|cf\.?|supplement|appendix|별첨|부연)\b/i;

type OCRJobStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

export interface OCRExtractedPayload {
  autoText: string;
  fullText: string;
  detectedTitle: string;
  rawText: string;
  includeMemoLines: boolean;
  selectedPages: number[] | null;
}

interface OCRUploaderProps {
  onExtractedText?: (payload: OCRExtractedPayload) => void;
}

type ProcessedOcrText = {
  fullText: string;
  autoText: string;
  detectedTitle: string;
};

function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isLikelyMemoLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (NUMBERED_LINE_REGEX.test(trimmed)) return false;
  if (trimmed.length <= 3) return true;
  if (NOTE_HINT_REGEX.test(trimmed)) return true;
  if (trimmed.startsWith("(") && trimmed.endsWith(")") && trimmed.length <= 60) return true;
  const symbolRatio =
    (trimmed.match(/[~`!@#$%^&*_=+|\\/<>[\]{}]/g) ?? []).length / Math.max(trimmed.length, 1);
  return symbolRatio > 0.28;
}

function cleanTitleLine(line: string): string {
  return line.replace(NUMBERED_LINE_REGEX, "").replace(BULLET_LINE_REGEX, "").trim();
}

function isLectureTitleCandidate(line: string): boolean {
  const title = cleanTitleLine(line);
  if (!title) return false;
  if (NUMBERED_LINE_REGEX.test(line) || BULLET_LINE_REGEX.test(line)) return false;
  if (NOTE_HINT_REGEX.test(title)) return false;
  if (title.length < 4 || title.length > 72) return false;
  if (/^[\d\s\-–—.:,;()]+$/.test(title)) return false;
  if (title.startsWith("(") || title.startsWith("[") || title.startsWith("{")) return false;
  return true;
}

function detectTopTitle(lines: string[]): string {
  if (lines.length === 0) return "";

  // 강의록 제목은 보통 문서 상단 본문에 오므로, 본문 시작 전 상단 영역만 제목 후보로 본다.
  const bodyStartIndex = lines.findIndex(
    (line) => NUMBERED_LINE_REGEX.test(line) || BULLET_LINE_REGEX.test(line)
  );
  const topRangeEnd =
    bodyStartIndex > 0 ? Math.min(bodyStartIndex, 6) : Math.min(lines.length, 4);
  const topLines = lines.slice(0, topRangeEnd);

  for (const line of topLines) {
    if (isLectureTitleCandidate(line)) {
      return cleanTitleLine(line);
    }
  }

  for (const line of lines.slice(0, Math.min(lines.length, 3))) {
    const title = cleanTitleLine(line);
    if (title.length >= 4 && !NOTE_HINT_REGEX.test(title)) return title;
  }

  return "";
}

function processOcrText(rawText: string, includeMemoLines: boolean): ProcessedOcrText {
  const normalized = normalizeText(rawText);
  if (!normalized) return { fullText: "", autoText: "", detectedTitle: "" };

  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dedupedLines: string[] = [];
  const seen = new Set<string>();
  for (const line of rawLines) {
    if (seen.has(line)) continue;
    seen.add(line);
    dedupedLines.push(line);
  }

  const memoLines: string[] = [];
  const baseLines: string[] = [];

  for (const line of dedupedLines) {
    if (isLikelyMemoLine(line)) {
      memoLines.push(line);
      if (includeMemoLines) baseLines.push(line);
      continue;
    }
    baseLines.push(line);
  }

  const detectedTitle = detectTopTitle(rawLines);
  const numberedLines = baseLines.filter((line) => NUMBERED_LINE_REGEX.test(line));
  const bulletLines = baseLines.filter(
    (line) => !NUMBERED_LINE_REGEX.test(line) && BULLET_LINE_REGEX.test(line)
  );
  const remainingLines = baseLines.filter(
    (line) =>
      !NUMBERED_LINE_REGEX.test(line) &&
      !BULLET_LINE_REGEX.test(line) &&
      (!detectedTitle || cleanTitleLine(line) !== detectedTitle)
  );

  const autoCandidates = [...numberedLines, ...bulletLines];
  if (includeMemoLines && memoLines.length > 0) {
    autoCandidates.push(...memoLines);
  }

  const autoText =
    autoCandidates.length > 0
      ? autoCandidates.join("\n")
      : (remainingLines.length > 0 ? remainingLines : baseLines).join("\n");
  const fullText = [...baseLines].join("\n");

  return { fullText, autoText, detectedTitle };
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

export function OCRUploader({ onExtractedText }: OCRUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<OCRJobStatus>("idle");
  const [rawExtractedText, setRawExtractedText] = useState<string>("");
  const [autoTextDraft, setAutoTextDraft] = useState<string>("");
  const [fullTextDraft, setFullTextDraft] = useState<string>("");
  const [detectedTitleDraft, setDetectedTitleDraft] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [includeMemoLines, setIncludeMemoLines] = useState(false);
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [selectedPdfPages, setSelectedPdfPages] = useState<number[]>([]);
  const [pageSelectionInput, setPageSelectionInput] = useState("");
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);

  const isPdf = useMemo(() => (file ? isPdfFile(file) : false), [file]);
  const selectedPdfPageCount = selectedPdfPages.length;
  const hasBulkDelimiter = useMemo(
    () => /(?:^|\n)\s*---+\s*(?:\n|$)/.test(`${fullTextDraft}\n${autoTextDraft}`),
    [autoTextDraft, fullTextDraft]
  );

  const applyProcessedText = (text: string, includeMemo: boolean) => {
    const processed = processOcrText(text, includeMemo);
    setRawExtractedText(text);
    setAutoTextDraft(processed.autoText);
    setFullTextDraft(processed.fullText);
    setDetectedTitleDraft(processed.detectedTitle);
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
    setAutoTextDraft(processed.autoText);
    setFullTextDraft(processed.fullText);
    setDetectedTitleDraft(processed.detectedTitle);
  }, [rawExtractedText, includeMemoLines]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setStatus("idle");
    setRawExtractedText("");
    setAutoTextDraft("");
    setFullTextDraft("");
    setDetectedTitleDraft("");
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
      autoText: autoTextDraft,
      fullText: fullTextDraft,
      detectedTitle: detectedTitleDraft,
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
    setAutoTextDraft("");
    setFullTextDraft("");
    setDetectedTitleDraft("");
    setErrorMessage("");
    setTotalPdfPages(0);
    setSelectedPdfPages([]);
    setPageSelectionInput("");
    setIsPreparingPdf(false);
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
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
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
                <p className="text-sm font-medium">PDF 또는 이미지 파일을 선택하세요</p>
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
                블록 일괄 입력: `---` 로 블록 구분, 각 블록 첫 줄은 문제 제목, 아래는 답안/표 본문
              </p>
              {hasBulkDelimiter ? (
                <p className="text-xs text-muted-foreground">
                  구분자 `---`가 감지되었습니다. 적용 후 텍스트 문제 탭에서 생성 버튼을 누르면 일괄 생성됩니다.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  OCR 결과를 그대로 적용하면 단일 문제 생성, `---`를 넣으면 여러 문제 일괄 생성이 가능합니다.
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
              색상 박스의 보조 필기(메모) 라인도 포함
            </label>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                감지된 상단 제목 (문제 제목으로 사용)
              </p>
              <Textarea
                value={detectedTitleDraft}
                onChange={(event) => setDetectedTitleDraft(event.target.value)}
                className="min-h-14 text-sm"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                자동 완성 (번호/불릿 문제 우선)
              </p>
              <Textarea
                value={autoTextDraft}
                onChange={(event) => setAutoTextDraft(event.target.value)}
                className="min-h-32 text-sm"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">인식 원문 (Full Text)</p>
              <Textarea
                value={fullTextDraft}
                onChange={(event) => setFullTextDraft(event.target.value)}
                className="min-h-40 text-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleApply} className="flex-1">
                질문/답안에 적용
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
