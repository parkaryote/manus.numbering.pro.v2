import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, FileText, Loader2, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface ExtractedPage {
  pageNumber: number;
  text: string;
  blocks: { type: string; text: string; confidence: number }[];
}

interface OcrResult {
  success: boolean;
  filename: string;
  totalPages: number;
  pages: ExtractedPage[];
  rawText: string;
}

interface ExtractedProblem {
  id: string;
  question: string;
  answer: string;
  pageNumber: number;
  selected: boolean;
}

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

interface DocumentUploadProps {
  subjectId?: number;
}

export default function DocumentUpload({ subjectId: initialSubjectId }: DocumentUploadProps) {
  const [, setLocation] = useLocation();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [problems, setProblems] = useState<ExtractedProblem[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    initialSubjectId ? String(initialSubjectId) : ""
  );
  const [isRegistering, setIsRegistering] = useState(false);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const { data: subjects } = trpc.subjects.list.useQuery();
  const createMutation = trpc.questions.create.useMutation();
  const utils = trpc.useUtils();

  // Parse OCR result into problems
  const parseProblems = useCallback((result: OcrResult): ExtractedProblem[] => {
    const extracted: ExtractedProblem[] = [];
    let idCounter = 0;

    for (const page of result.pages) {
      if (!page.text.trim()) continue;

      // Split text into meaningful blocks (paragraphs separated by double newlines)
      const paragraphs = page.text
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      for (const paragraph of paragraphs) {
        // Skip very short text (likely headers, page numbers, etc.)
        if (paragraph.length < 5) continue;

        idCounter++;
        extracted.push({
          id: `p${idCounter}`,
          question: `페이지 ${page.pageNumber} - 단락 ${idCounter}`,
          answer: paragraph,
          pageNumber: page.pageNumber,
          selected: true,
        });
      }
    }

    return extracted;
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(async (file: File) => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error("지원하지 않는 파일 형식입니다. PDF, PPT, PPTX, JPEG, PNG 파일만 가능합니다.");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error("파일 크기는 50MB 이하여야 합니다.");
      return;
    }

    setUploadState("uploading");
    setProgress(10);
    setErrorMessage("");
    setOcrResult(null);
    setProblems([]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      setProgress(30);
      setUploadState("processing");

      const response = await fetch("/api/upload/document", {
        method: "POST",
        body: formData,
      });

      setProgress(80);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "서버 오류" }));
        throw new Error(errorData.error || "파일 처리 실패");
      }

      const result: OcrResult = await response.json();
      setOcrResult(result);

      // Parse into problems
      const extracted = parseProblems(result);
      setProblems(extracted);

      setProgress(100);
      setUploadState("done");

      if (extracted.length === 0) {
        toast.warning("텍스트를 추출할 수 없었습니다. 다른 파일을 시도해주세요.");
      } else {
        toast.success(`${result.totalPages}페이지에서 ${extracted.length}개 단락을 추출했습니다.`);
      }
    } catch (error: any) {
      console.error("[DocumentUpload] Error:", error);
      setUploadState("error");
      setErrorMessage(error.message || "파일 처리 중 오류가 발생했습니다.");
      toast.error(error.message || "파일 처리 실패");
    }
  }, [parseProblems]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.add("border-primary", "bg-primary/5");
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove("border-primary", "bg-primary/5");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove("border-primary", "bg-primary/5");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, [handleFileUpload]);

  // Toggle problem selection
  const toggleProblem = useCallback((id: string) => {
    setProblems(prev => prev.map(p =>
      p.id === id ? { ...p, selected: !p.selected } : p
    ));
  }, []);

  // Select/deselect all
  const toggleAll = useCallback((selected: boolean) => {
    setProblems(prev => prev.map(p => ({ ...p, selected })));
  }, []);

  // Toggle page expansion
  const togglePage = useCallback((pageNum: number) => {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      return next;
    });
  }, []);

  // Register selected problems
  const handleRegister = useCallback(async () => {
    if (!selectedSubjectId) {
      toast.error("과목을 선택하세요.");
      return;
    }

    const selectedProblems = problems.filter(p => p.selected);
    if (selectedProblems.length === 0) {
      toast.error("등록할 문제를 선택하세요.");
      return;
    }

    setIsRegistering(true);
    setRegisteredCount(0);

    try {
      for (let i = 0; i < selectedProblems.length; i++) {
        const problem = selectedProblems[i];
        await createMutation.mutateAsync({
          subjectId: parseInt(selectedSubjectId),
          question: problem.question,
          answer: problem.answer,
          difficulty: "medium",
          autoNumbering: 1,
        } as any);
        setRegisteredCount(i + 1);
      }

      toast.success(`${selectedProblems.length}개 문제가 등록되었습니다!`);
      utils.questions.listBySubject.invalidate({ subjectId: parseInt(selectedSubjectId) });
      utils.questions.count.invalidate();

      // Navigate to the subject's questions page
      setLocation(`/questions/${selectedSubjectId}`);
    } catch (error: any) {
      toast.error(`문제 등록 실패: ${error.message}`);
    } finally {
      setIsRegistering(false);
    }
  }, [selectedSubjectId, problems, createMutation, utils, setLocation]);

  // Reset everything
  const handleReset = useCallback(() => {
    setUploadState("idle");
    setProgress(0);
    setErrorMessage("");
    setOcrResult(null);
    setProblems([]);
    setRegisteredCount(0);
  }, []);

  // Group problems by page
  const problemsByPage = problems.reduce<Record<number, ExtractedProblem[]>>((acc, p) => {
    if (!acc[p.pageNumber]) acc[p.pageNumber] = [];
    acc[p.pageNumber].push(p);
    return acc;
  }, {});

  const selectedCount = problems.filter(p => p.selected).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => {
          if (initialSubjectId) {
            setLocation(`/questions/${initialSubjectId}`);
          } else {
            setLocation("/subjects");
          }
        }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">PDF/PPT 가져오기</h1>
          <p className="text-muted-foreground mt-1">
            파일을 업로드하면 OCR로 텍스트를 추출하여 문제로 등록합니다
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      {(uploadState === "idle" || uploadState === "error") && (
        <Card className="shadow-elegant">
          <CardContent className="pt-6">
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center cursor-pointer transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">파일을 드래그하거나 클릭하여 업로드</h3>
              <p className="text-sm text-muted-foreground mb-4">
                PDF, PPT, PPTX, JPEG, PNG 파일 지원 (최대 50MB)
              </p>
              <Button variant="outline" className="gap-2">
                <FileText className="h-4 w-4" />
                파일 선택
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
            {uploadState === "error" && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-destructive">오류 발생</p>
                  <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Processing State */}
      {(uploadState === "uploading" || uploadState === "processing") && (
        <Card className="shadow-elegant">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
              <h3 className="text-lg font-medium mb-2">
                {uploadState === "uploading" ? "파일 업로드 중..." : "OCR 처리 중..."}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {uploadState === "uploading"
                  ? "파일을 서버로 전송하고 있습니다"
                  : "Google Cloud Vision API로 텍스트를 추출하고 있습니다. 페이지 수에 따라 시간이 소요될 수 있습니다."}
              </p>
              <Progress value={progress} className="max-w-md mx-auto" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {uploadState === "done" && ocrResult && (
        <>
          {/* Summary */}
          <Card className="shadow-elegant">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    텍스트 추출 완료
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {ocrResult.filename} - {ocrResult.totalPages}페이지에서 {problems.length}개 단락 추출
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
                  <X className="h-4 w-4" />
                  다시 업로드
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Subject Selection */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-lg">과목 선택</CardTitle>
              <CardDescription>추출된 문제를 등록할 과목을 선택하세요</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="과목을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {subjects?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: s.color || "#3B82F6" }}
                        />
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Extracted Problems */}
          <Card className="shadow-elegant">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">추출된 문제 목록</CardTitle>
                  <CardDescription>
                    {selectedCount}개 선택됨 / 전체 {problems.length}개
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
                    전체 선택
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
                    전체 해제
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {problems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  추출된 텍스트가 없습니다. 다른 파일을 시도해주세요.
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(problemsByPage).map(([pageNum, pageProblems]) => (
                    <div key={pageNum} className="border rounded-lg overflow-hidden">
                      {/* Page Header */}
                      <button
                        onClick={() => togglePage(Number(pageNum))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted/80 transition-colors"
                      >
                        <span className="font-medium text-sm">
                          페이지 {pageNum} ({pageProblems.length}개 단락)
                        </span>
                        {expandedPages.has(Number(pageNum)) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {/* Page Problems */}
                      {expandedPages.has(Number(pageNum)) && (
                        <div className="divide-y">
                          {pageProblems.map(problem => (
                            <div
                              key={problem.id}
                              className={`flex items-start gap-3 p-4 transition-colors ${
                                problem.selected ? "bg-background" : "bg-muted/30 opacity-60"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={problem.selected}
                                onChange={() => toggleProblem(problem.id)}
                                className="mt-1 w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-muted-foreground mb-1">
                                  {problem.question}
                                </p>
                                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                  {problem.answer}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Register Button */}
          {problems.length > 0 && (
            <div className="sticky bottom-4 z-10">
              <Card className="shadow-lg border-primary/20">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">
                      {isRegistering
                        ? `등록 중... (${registeredCount}/${selectedCount})`
                        : `${selectedCount}개 문제를 등록합니다`}
                    </div>
                    <Button
                      onClick={handleRegister}
                      disabled={isRegistering || selectedCount === 0 || !selectedSubjectId}
                      className="gap-2 min-w-[140px]"
                    >
                      {isRegistering ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          등록 중...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          {selectedCount}개 문제 등록
                        </>
                      )}
                    </Button>
                  </div>
                  {isRegistering && (
                    <Progress value={(registeredCount / selectedCount) * 100} className="mt-3" />
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
