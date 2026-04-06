import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Clock, Trophy, RotateCcw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TableView, TableData, getBlankCells } from "@/components/TableEditor";

interface SubjectExamProps {
  subjectId: number;
}

export default function SubjectExam({ subjectId }: SubjectExamProps) {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<"intro" | "exam" | "result">("intro");
  const [currentIndex, setCurrentIndex] = useState(0);
  // 답안 임시저장: questionId → 텍스트 답안
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});
  // 표 문제 답안: questionId → { cellKey: value }
  const [tableAnswers, setTableAnswers] = useState<Record<number, Record<string, string>>>({});
  // 이미지 라벨 답안: questionId → { index: value }
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, Record<number, string>>>({});
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isRandom, setIsRandom] = useState(false);
  const [examQuestions, setExamQuestions] = useState<any[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions } = trpc.questions.listBySubject.useQuery({ subjectId });
  const utils = trpc.useUtils();

  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: () => {
      utils.confidence.getBySubject.invalidate({ subjectId });
    },
  });

  // 타이머
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (phase === "exam" && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [phase, startTime]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStart = useCallback(() => {
    if (!questions || questions.length === 0) {
      toast.error("문제가 없습니다.");
      return;
    }
    const ordered = isRandom
      ? [...questions].sort(() => Math.random() - 0.5)
      : [...questions];
    setExamQuestions(ordered);
    setPhase("exam");
    setCurrentIndex(0);
    setTextAnswers({});
    setTableAnswers({});
    setImageLabelAnswers({});
    const now = Date.now();
    setStartTime(now);
    setElapsedTime(0);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [questions, isRandom]);

  // 시험 종료 - 모든 문제 일괄 채점 후 결과 화면
  const handleFinishExam = useCallback(async () => {
    if (isSubmitting) return;
    if (!confirm("시험을 종료하시겠습니까? 제출되지 않은 답안도 함께 채점됩니다.")) return;

    setIsSubmitting(true);
    try {
      for (const q of examQuestions) {
        const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
        const imageLabels = q.imageLabels ? JSON.parse(q.imageLabels) : [];
        const isTableQuestion = !!tableData;
        const isImageQuestion = !!q.imageUrl && imageLabels.length > 0;

        let ans = "";
        if (isTableQuestion && tableData) {
          // 표 문제: 빈칸 답안 합치기
          const blankCells = getBlankCells(tableData);
          const tAns = tableAnswers[q.id] || {};
          ans = blankCells.map((k) => tAns[k] || "").join("\n");
        } else if (isImageQuestion) {
          // 이미지 문제: 라벨 답안 합치기
          const lAns = imageLabelAnswers[q.id] || {};
          ans = imageLabels.map((_: any, i: number) => `${i + 1}. ${lAns[i] || ""}`).join("\n");
        } else {
          ans = (textAnswers[q.id] || "").trim();
        }

        if (ans) {
          await evaluateMutation.mutateAsync({
            questionId: q.id,
            userAnswer: ans,
            recallTime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
          });
        }
      }
    } catch (error: any) {
      toast.error("채점 실패: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
    setPhase("result");
  }, [isSubmitting, examQuestions, textAnswers, tableAnswers, imageLabelAnswers, startTime, evaluateMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.shiftKey && !isComposing) {
        e.preventDefault();
        // Shift+Enter로 다음 문제로 이동
        if (currentIndex < examQuestions.length - 1) {
          setCurrentIndex(currentIndex + 1);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }
      }
    },
    [currentIndex, examQuestions.length, isComposing]
  );

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  // ── 인트로 화면 ──────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5"
          onClick={() => setLocation(`/questions/${subjectId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
          과목으로 돌아가기
        </Button>

        <div className="text-center py-8">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold mb-2">{subject?.name} 모의고사</h1>
          <p className="text-muted-foreground mb-6">
            과목 내 모든 문제를 풀어봅니다.
          </p>

          <div className="flex items-center justify-center gap-3 mb-6">
            <button
              onClick={() => setIsRandom(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !isRandom
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              순서대로
            </button>
            <button
              onClick={() => setIsRandom(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isRandom
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              랜덤 순서
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8 max-w-sm mx-auto">
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{questions.length}</div>
              <div className="text-xs text-muted-foreground mt-1">문제 수</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-500">자유</div>
              <div className="text-xs text-muted-foreground mt-1">이동 가능</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">∞</div>
              <div className="text-xs text-muted-foreground mt-1">제한 없음</div>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-4 mb-8 text-sm text-muted-foreground text-left max-w-sm mx-auto">
            <p className="font-medium text-foreground mb-2">안내</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>문제 간 자유롭게 이동하며 답안 작성</li>
              <li>답안은 자동 임시저장됩니다</li>
              <li>텍스트 문제: <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd>로 다음 문제 이동</li>
              <li>모든 문제 작성 후 시험 종료 버튼으로 제출</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={handleStart}
            disabled={questions.length === 0}
          >
            <ChevronRight className="h-5 w-5" />
            시험 시작
          </Button>
        </div>
      </div>
    );
  }

  // ── 시험 화면 ──────────────────────────────────────────────────
  if (phase === "exam") {
    const question = examQuestions[currentIndex];
    const tableData: TableData | null = question?.tableData ? JSON.parse(question.tableData) : null;
    const imageLabels: any[] = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
    const isTableQuestion = !!tableData;
    const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;

    const answeredCount = examQuestions.filter((q) => {
      const td: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
      const il: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
      if (td) return Object.values(tableAnswers[q.id] || {}).some((v) => v.trim());
      if (q.imageUrl && il.length > 0) return Object.values(imageLabelAnswers[q.id] || {}).some((v: any) => v.trim());
      return (textAnswers[q.id] || "").trim().length > 0;
    }).length;

    return (
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (confirm("시험을 중단하시겠습니까?")) {
                setPhase("intro");
                setTextAnswers({});
                setTableAnswers({});
                setImageLabelAnswers({});
                setCurrentIndex(0);
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">
                {currentIndex + 1} / {examQuestions.length}
                {answeredCount > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({answeredCount}개 작성)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatTime(elapsedTime)}
              </div>
            </div>
            <Progress value={(answeredCount / examQuestions.length) * 100} className="h-1.5" />
          </div>
        </div>

        {/* 문제 번호 빠른 이동 */}
        <div className="flex gap-1.5 flex-wrap">
          {examQuestions.map((q, i) => {
            const td: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
            const il: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
            const hasInput = td
              ? Object.values(tableAnswers[q.id] || {}).some((v) => v.trim())
              : q.imageUrl && il.length > 0
              ? Object.values(imageLabelAnswers[q.id] || {}).some((v: any) => v.trim())
              : (textAnswers[q.id] || "").trim().length > 0;
            const isActive = i === currentIndex;
            const typeIcon = td ? "📊" : q.imageUrl && il.length > 0 ? "🖼" : "";
            return (
              <button
                key={i}
                onClick={() => {
                  setCurrentIndex(i);
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                  ${isActive
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/40"
                    : hasInput
                    ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                title={`Q${i + 1}${typeIcon ? ` ${typeIcon}` : ""}${hasInput ? " (작성 중)" : ""}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* 문제 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
              Q{currentIndex + 1}
              {isTableQuestion && " 📊"}
              {isImageQuestion && " 🖼"}
            </Badge>
            <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">
              {question?.question}
            </p>
          </div>

          {/* 이미지 문제 */}
          {isImageQuestion && (
            <div className="space-y-3">
              <div className="relative">
                <img
                  src={question.imageUrl}
                  alt="문제 이미지"
                  className="w-full rounded-lg border border-border"
                />
                {imageLabels.map((_: any, idx: number) => (
                  <div
                    key={idx}
                    className="absolute w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold"
                    style={{ left: `${imageLabels[idx]?.x ?? 0}%`, top: `${imageLabels[idx]?.y ?? 0}%`, transform: "translate(-50%, -50%)" }}
                  >
                    {idx + 1}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {imageLabels.map((_: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary min-w-[24px]">{idx + 1}.</span>
                    <input
                      type="text"
                      value={(imageLabelAnswers[question.id] || {})[idx] || ""}
                      onChange={(e) =>
                        setImageLabelAnswers((prev) => ({
                          ...prev,
                          [question.id]: { ...(prev[question.id] || {}), [idx]: e.target.value },
                        }))
                      }
                      placeholder={`영역 ${idx + 1} 답안`}
                      className="flex-1 h-8 px-3 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 표 문제 */}
          {isTableQuestion && tableData && (
            <TableView
              tableData={tableData}
              answers={tableAnswers[question.id] || {}}
              onAnswerChange={(key, value) =>
                setTableAnswers((prev) => ({
                  ...prev,
                  [question.id]: { ...(prev[question.id] || {}), [key]: value },
                }))
              }
            />
          )}

          {/* 텍스트 문제 */}
          {!isTableQuestion && !isImageQuestion && (
            <Textarea
              ref={textareaRef}
              value={textAnswers[question?.id] || ""}
              onChange={(e) =>
                setTextAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
              }
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onKeyDown={handleKeyDown}
              placeholder="정답을 입력하세요..."
              className="min-h-[160px] resize-none font-medium"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          )}

          {/* 이전/다음 + 시험 종료 */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (currentIndex > 0) {
                    setCurrentIndex(currentIndex - 1);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }
                }}
                disabled={currentIndex === 0}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {!isTableQuestion && !isImageQuestion && (
                <span className="text-xs text-muted-foreground px-1">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd> 다음
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (currentIndex < examQuestions.length - 1) {
                    setCurrentIndex(currentIndex + 1);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }
                }}
                disabled={currentIndex === examQuestions.length - 1}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleFinishExam}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? "채점 중..." : "시험 종료"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── 결과 화면 (정답/오답 표시 없음) ──────────────────────────────
  const answeredFinal = examQuestions.filter((q) => {
    const td: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
    const il: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
    if (td) return Object.values(tableAnswers[q.id] || {}).some((v) => v.trim());
    if (q.imageUrl && il.length > 0) return Object.values(imageLabelAnswers[q.id] || {}).some((v: any) => v.trim());
    return (textAnswers[q.id] || "").trim().length > 0;
  }).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="rounded-xl p-6 text-center bg-primary/5 border border-primary/20">
        <div className="text-4xl mb-3">📝</div>
        <h2 className="text-xl font-bold mb-1">시험 완료</h2>
        <p className="text-muted-foreground text-sm mb-4">
          {answeredFinal}/{examQuestions.length}개 문제 답안 작성 · {formatTime(elapsedTime)} 소요
        </p>
        <p className="text-xs text-muted-foreground">
          학습 기록이 안정도에 반영되었습니다.
        </p>
      </div>

      {/* 문제 목록 (답안만 표시) */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">제출한 답안</h3>
        {examQuestions.map((q, i) => {
          const td: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
          const il: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
          const isImg = !!q.imageUrl && il.length > 0;
          let ansDisplay = "";
          if (td) {
            const blankCells = getBlankCells(td);
            ansDisplay = blankCells.map((k) => `${k}: ${(tableAnswers[q.id] || {})[k] || "(미작성)"}`).join("\n");
          } else if (isImg) {
            ansDisplay = il.map((_: any, idx: number) => `${idx + 1}. ${(imageLabelAnswers[q.id] || {})[idx] || "(미작성)"}`).join("\n");
          } else {
            ansDisplay = (textAnswers[q.id] || "").trim() || "";
          }
          return (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                  Q{i + 1}{td ? " 📊" : isImg ? " 🖼" : ""}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug mb-2">{q.question}</p>
                  {ansDisplay ? (
                    <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap font-mono">
                      {ansDisplay}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground/50 italic">미작성</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={() => {
            setPhase("intro");
            setTextAnswers({});
            setTableAnswers({});
            setImageLabelAnswers({});
            setCurrentIndex(0);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          다시 시험
        </Button>
        <Button
          className="flex-1 gap-1.5"
          onClick={() => setLocation(`/questions/${subjectId}`)}
        >
          <Trophy className="h-4 w-4" />
          과목으로 돌아가기
        </Button>
      </div>
    </div>
  );
}
