import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Clock, Trophy, RotateCcw, ChevronRight, Send } from "lucide-react";
import { toast } from "sonner";

interface SubjectExamProps {
  subjectId: number;
}

export default function SubjectExam({ subjectId }: SubjectExamProps) {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<"intro" | "exam" | "result">("intro");
  const [currentIndex, setCurrentIndex] = useState(0);
  // 답안 임시저장: questionId → 입력값
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // 제출 완료된 문제 인덱스 집합
  const [submitted, setSubmitted] = useState<Set<number>>(new Set());
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

  // 텍스트 문제만 필터링
  const textQuestions = questions?.filter((q) => !q.imageUrl && !q.tableData) || [];

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
    if (textQuestions.length === 0) {
      toast.error("연습할 텍스트 문제가 없습니다.");
      return;
    }
    const ordered = isRandom
      ? [...textQuestions].sort(() => Math.random() - 0.5)
      : [...textQuestions];
    setExamQuestions(ordered);
    setPhase("exam");
    setCurrentIndex(0);
    setAnswers({});
    setSubmitted(new Set());
    const now = Date.now();
    setStartTime(now);
    setElapsedTime(0);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [textQuestions, isRandom]);

  // 현재 문제 답안 제출 (채점은 하지만 결과는 숨김)
  const handleSubmitCurrent = useCallback(async () => {
    if (isSubmitting) return;
    const question = examQuestions[currentIndex];
    if (!question) return;
    const ans = (answers[question.id] || "").trim();
    if (!ans) {
      toast.error("답안을 입력하세요");
      return;
    }

    setIsSubmitting(true);
    try {
      await evaluateMutation.mutateAsync({
        questionId: question.id,
        userAnswer: ans,
        recallTime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      });
      setSubmitted((prev) => new Set(Array.from(prev).concat(currentIndex)));

      // 다음 미제출 문제로 이동
      const nextUnsubmitted = examQuestions.findIndex(
        (_, i) => i > currentIndex && !submitted.has(i)
      );
      if (nextUnsubmitted !== -1) {
        setCurrentIndex(nextUnsubmitted);
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        // 모두 제출 완료 여부 확인
        const allDone = examQuestions.every((_, i) =>
          i === currentIndex || submitted.has(i)
        );
        if (allDone) {
          setPhase("result");
        } else {
          toast.success("제출 완료! 아직 남은 문제가 있습니다.");
        }
      }
    } catch (error: any) {
      toast.error("제출 실패: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, examQuestions, currentIndex, answers, submitted, startTime, evaluateMutation]);

  // 전체 제출 완료
  const handleFinishExam = useCallback(async () => {
    if (isSubmitting) return;
    // 미제출 문제들 일괄 제출
    const unsubmitted = examQuestions
      .map((q, i) => ({ q, i }))
      .filter(({ i }) => !submitted.has(i));

    if (unsubmitted.length > 0) {
      setIsSubmitting(true);
      try {
        for (const { q, i } of unsubmitted) {
          const ans = (answers[q.id] || "").trim();
          if (ans) {
            await evaluateMutation.mutateAsync({
              questionId: q.id,
              userAnswer: ans,
              recallTime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
            });
          }
          setSubmitted((prev) => new Set(Array.from(prev).concat(i)));
        }
      } catch (error: any) {
        toast.error("제출 실패: " + error.message);
      } finally {
        setIsSubmitting(false);
      }
    }
    setPhase("result");
  }, [isSubmitting, examQuestions, submitted, answers, startTime, evaluateMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleSubmitCurrent();
      }
    },
    [handleSubmitCurrent]
  );

  const answeredCount = examQuestions.filter(
    (q, i) => submitted.has(i) || (answers[q.id] || "").trim()
  ).length;

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
          onClick={() => setLocation(`/subject-practice/${subjectId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
          연습으로 돌아가기
        </Button>

        <div className="text-center py-8">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold mb-2">{subject?.name} 모의고사</h1>
          <p className="text-muted-foreground mb-6">
            과목 내 텍스트 문제를 모두 풀어봅니다.
          </p>

          {/* 랜덤 순서 토글 */}
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
              <div className="text-2xl font-bold">{textQuestions.length}</div>
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
              <li>
                <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                  Shift+Enter
                </kbd>{" "}
                로 현재 문제 제출
              </li>
              <li>이미지/표 문제는 제외됩니다</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={handleStart}
            disabled={textQuestions.length === 0}
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
    const progress = (submitted.size / examQuestions.length) * 100;
    const allSubmitted = submitted.size === examQuestions.length;

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
                setAnswers({});
                setSubmitted(new Set());
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
                {submitted.size > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({submitted.size}개 제출 완료)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatTime(elapsedTime)}
              </div>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>

        {/* 문제 번호 빠른 이동 */}
        <div className="flex gap-1.5 flex-wrap">
          {examQuestions.map((q, i) => {
            const isActive = i === currentIndex;
            const isDone = submitted.has(i);
            const hasInput = (answers[q.id] || "").trim().length > 0;
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
                    : isDone
                    ? "bg-muted text-muted-foreground"
                    : hasInput
                    ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                title={`Q${i + 1}${isDone ? " (제출 완료)" : hasInput ? " (작성 중)" : ""}`}
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
            </Badge>
            <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">
              {question?.question}
            </p>
          </div>

          <Textarea
            ref={textareaRef}
            value={answers[question?.id] || ""}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
            }
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleKeyDown}
            placeholder={
              submitted.has(currentIndex)
                ? "이미 제출된 문제입니다. 수정 후 다시 제출할 수 있습니다."
                : "정답을 입력하세요..."
            }
            className={`min-h-[160px] resize-none font-medium ${
              submitted.has(currentIndex) ? "border-muted" : ""
            }`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
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
              <span className="text-xs text-muted-foreground">
                <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd> 제출
              </span>
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSubmitCurrent}
                disabled={isSubmitting || !(answers[question?.id] || "").trim()}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                {submitted.has(currentIndex) ? "재제출" : "이 문제 제출"}
              </Button>
              {allSubmitted && (
                <Button
                  size="sm"
                  onClick={() => setPhase("result")}
                  className="gap-1.5"
                >
                  <Trophy className="h-3.5 w-3.5" />
                  결과 보기
                </Button>
              )}
              {!allSubmitted && submitted.size > 0 && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleFinishExam}
                  disabled={isSubmitting}
                  className="gap-1.5"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                  시험 종료
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 결과 화면 (정답/오답 표시 없음) ──────────────────────────────
  const answeredFinal = examQuestions.filter(
    (q) => (answers[q.id] || "").trim()
  ).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      {/* 결과 요약 */}
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

      {/* 문제 목록 (답안만 표시, 정답/오답 없음) */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">제출한 답안</h3>
        {examQuestions.map((q, i) => {
          const ans = (answers[q.id] || "").trim();
          return (
            <div
              key={i}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                  Q{i + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug mb-2">{q.question}</p>
                  {ans ? (
                    <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap font-mono">
                      {ans}
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

      {/* 액션 버튼 */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={() => {
            setPhase("intro");
            setAnswers({});
            setSubmitted(new Set());
            setCurrentIndex(0);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          다시 시험
        </Button>
        <Button
          className="flex-1 gap-1.5"
          onClick={() => setLocation(`/subject-practice/${subjectId}`)}
        >
          <Trophy className="h-4 w-4" />
          연습으로 돌아가기
        </Button>
      </div>
    </div>
  );
}
