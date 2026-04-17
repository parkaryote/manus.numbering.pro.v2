import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Clock, Trophy, RotateCcw, ChevronRight, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";
import { ConfidenceHistoryModal } from "@/components/ConfidenceHistoryModal";
import { SubjectConfidenceHistoryModal } from "@/components/SubjectConfidenceHistoryModal";
import { getAnalyticsRequestMeta } from "@/lib/analyticsSession";
import { estimateTestConfidenceDelta } from "@shared/examConfidence";

interface SubjectExamProps {
  subjectId: number;
  isDemo?: boolean;
}

type ExamQuestion = {
  id: number;
  question: string;
  answer?: string | null;
  tableData?: string | null;
  imageUrl?: string | null;
  imageLabels?: string | null;
  autoNumbering?: number | null;
};

type EvalResult = {
  isCorrect: boolean;
  similarityScore: number;
  accuracyRate: number;
  correctLineCount?: number;
  totalLines?: number;
  mistakes?: Array<{
    lineIndex?: number;
    labelIndex?: number;
    cellKey?: string;
    correctAnswer?: string;
    userAnswer?: string;
    isCorrect?: boolean;
  }>;
  feedback?: string;
  llmFeedback?: string | null;
  userAnswer?: string;
  submitted: boolean;
  wasBlank?: boolean;
};

type QuestionOutcome = {
  eval: EvalResult;
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceDelta: number;
  confidenceDeltaEstimated?: boolean;
  stateBefore?: string;
  stateAfter?: string;
};

type SubjectConfidenceSnapshot = {
  aggregateScore: number;
  questionScoreMap: Record<number, number>;
  questionStateMap: Record<number, string>;
};

type QuestionConfidencePoint = {
  score: number;
  state: string;
};

function normalizeQuestionSignature(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function getTableCorrectAnswerByCellKey(tableData: TableData, key: string): string {
  const [rStr, cStr] = key.split("-");
  const r = Number(rStr);
  const c = Number(cStr);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return "";
  return (tableData.cells?.[r]?.[c]?.content ?? "").toString();
}

function toSubjectConfidenceSnapshot(data: any): SubjectConfidenceSnapshot {
  const questionScoreMap: Record<number, number> = {};
  const questionStateMap: Record<number, string> = {};
  for (const q of data?.questions || []) {
    questionScoreMap[q.questionId] = Math.round(q.displayScore ?? 0);
    questionStateMap[q.questionId] = q.state ?? "red";
  }
  return {
    aggregateScore: Math.round(data?.aggregate?.averageScore ?? 0),
    questionScoreMap,
    questionStateMap,
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function stateFromScore(score: number): string {
  if (score >= 80) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function getConfidenceSignalDotClass(state?: string) {
  if (state === "green") return "bg-emerald-500";
  if (state === "yellow") return "bg-amber-400";
  return "bg-rose-500";
}

function createExamBatchId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `exam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SubjectExam({ subjectId, isDemo = false }: SubjectExamProps) {
  const [location, setLocation] = useLocation();
  const searchParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, [location]);
  const isDemoLinkedMode = !isDemo && searchParams.get("demo") === "1";
  const demoLinkedSubjectIdRaw = Number.parseInt(searchParams.get("demoSubjectId") || "", 10);
  const demoLinkedSubjectId =
    Number.isFinite(demoLinkedSubjectIdRaw) && demoLinkedSubjectIdRaw > 0
      ? demoLinkedSubjectIdRaw
      : null;
  const subjectQuestionsPath = isDemo
    ? `/demo/questions/${subjectId}`
    : isDemoLinkedMode && demoLinkedSubjectId
      ? `/questions/${subjectId}?demo=1&demoSubjectId=${demoLinkedSubjectId}`
      : `/questions/${subjectId}`;

  const [phase, setPhase] = useState<"intro" | "exam" | "result">("intro");
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});
  const [tableAnswers, setTableAnswers] = useState<Record<number, Record<string, string>>>({});
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, Record<number, string>>>({});
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, QuestionOutcome>>({});
  const [subjectScoreBefore, setSubjectScoreBefore] = useState<number | null>(null);
  const [subjectScoreAfter, setSubjectScoreAfter] = useState<number | null>(null);
  const [confidenceHistoryId, setConfidenceHistoryId] = useState<number | null>(null);
  const [confidenceHistoryTitle, setConfidenceHistoryTitle] = useState("");
  const [subjectHistoryOpen, setSubjectHistoryOpen] = useState(false);

  const [isRandom, setIsRandom] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [questionCountInput, setQuestionCountInput] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | null>(null);
  const [timeLimitInput, setTimeLimitInput] = useState("");
  const timeoutSubmitTriggeredRef = useRef(false);
  const examBatchIdRef = useRef<string>(createExamBatchId());
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const userQuestionsQuery = trpc.questions.listBySubject.useQuery(
    { subjectId },
    { enabled: !isDemo }
  );
  const demoQuestionsQuery = trpc.demo.questions.useQuery(
    { subjectId },
    { enabled: isDemo }
  );
  const demoLinkedPreviewQuery = trpc.demo.questions.useQuery(
    { subjectId: demoLinkedSubjectId ?? 0 },
    { enabled: isDemoLinkedMode && !!demoLinkedSubjectId, refetchOnWindowFocus: false }
  );
  const questions = useMemo(() => {
    const baseQuestions = isDemo ? demoQuestionsQuery.data : userQuestionsQuery.data;
    if (!baseQuestions) return baseQuestions;
    if (!isDemoLinkedMode || !demoLinkedSubjectId) return baseQuestions;
    if (!demoLinkedPreviewQuery.data) return baseQuestions;
    const allowedSourceQuestionIds = new Set(demoLinkedPreviewQuery.data.map((question) => question.id));
    const allowedPreviewSignatures = new Set(
      demoLinkedPreviewQuery.data.map((question) => normalizeQuestionSignature(question.question))
    );
    const filtered = baseQuestions.filter((question: any) => {
      const sourceId = Number(question.demoSourceQuestionId ?? 0);
      if (!Number.isFinite(sourceId) || sourceId <= 0) {
        return true;
      }
      if (Number.isFinite(sourceId) && sourceId > 0 && allowedSourceQuestionIds.has(sourceId)) {
        return true;
      }
      const signature = normalizeQuestionSignature(question.question);
      return !!signature && allowedPreviewSignatures.has(signature);
    });

    if (filtered.length > 0) return filtered;

    const hasExplicitSourceMapping = baseQuestions.some((question: any) => {
      const sourceId = Number(question.demoSourceQuestionId ?? 0);
      return Number.isFinite(sourceId) && sourceId > 0;
    });
    // 데모-연결 문제가 source id 없이 저장된 경우(과거 데이터/수정본) 시험 문항 0개로 고정되는 현상을 방지한다.
    if (!hasExplicitSourceMapping && baseQuestions.length > 0) {
      return baseQuestions;
    }
    return filtered;
  }, [
    demoLinkedPreviewQuery.data,
    demoLinkedSubjectId,
    demoQuestionsQuery.data,
    isDemo,
    isDemoLinkedMode,
    userQuestionsQuery.data,
  ]);
  const utils = trpc.useUtils();

  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: () => {
      utils.confidence.getBySubject.invalidate({ subjectId });
    },
  });
  const demoEvaluateMutation = trpc.demo.evaluate.useMutation();
  const createTestMutation = trpc.test.create.useMutation();
  const updateReviewMutation = trpc.review.updateAfterReview.useMutation();

  useEffect(() => {
    if (!questions) return;
    setQuestionCount((prev) => {
      if (prev <= 0) return questions.length;
      if (prev > questions.length) return questions.length;
      return prev;
    });
  }, [questions]);

  useEffect(() => {
    if (!questions || questions.length === 0) return;
    if (questionCount <= 0) return;
    if (questionCountInput.trim().length > 0) return;
    setQuestionCountInput(String(questionCount));
  }, [questionCount, questionCountInput, questions]);

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

  const totalAvailable = questions?.length || 0;
  const timeLimitSeconds = timeLimitMinutes !== null ? timeLimitMinutes * 60 : null;
  const remainingSeconds = timeLimitSeconds !== null ? Math.max(0, timeLimitSeconds - elapsedTime) : null;

  const parseIntInput = useCallback((value: string): number | null => {
    const cleaned = value.replace(/[^0-9]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }, []);

  const commitQuestionCountInput = useCallback((): number => {
    if (totalAvailable <= 0) {
      setQuestionCount(0);
      setQuestionCountInput("");
      return 0;
    }
    const parsed = parseIntInput(questionCountInput);
    const fallback = questionCount > 0 ? questionCount : totalAvailable;
    const raw = parsed ?? fallback;
    const clamped = Math.max(1, Math.min(totalAvailable, Math.floor(raw)));
    setQuestionCount(clamped);
    setQuestionCountInput(String(clamped));
    return clamped;
  }, [parseIntInput, questionCount, questionCountInput, totalAvailable]);

  const commitTimeLimitInput = useCallback((): number | null => {
    const parsed = parseIntInput(timeLimitInput);
    if (parsed === null) {
      setTimeLimitMinutes(null);
      setTimeLimitInput("");
      return null;
    }
    const clamped = Math.max(1, Math.min(600, Math.floor(parsed)));
    setTimeLimitMinutes(clamped);
    setTimeLimitInput(String(clamped));
    return clamped;
  }, [parseIntInput, timeLimitInput]);

  const hasAnswer = useCallback(
    (q: ExamQuestion) => {
      const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
      const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];

      if (tableData) {
        return Object.values(tableAnswers[q.id] || {}).some((v) => v.trim());
      }
      if (q.imageUrl && imageLabels.length > 0) {
        return Object.values(imageLabelAnswers[q.id] || {}).some((v: any) => v.trim());
      }
      return (textAnswers[q.id] || "").trim().length > 0;
    },
    [textAnswers, tableAnswers, imageLabelAnswers]
  );

  const answeredCount = useMemo(() => {
    if (examQuestions.length === 0) return 0;
    return examQuestions.filter((q) => hasAnswer(q)).length;
  }, [examQuestions, hasAnswer]);

  const handleStart = useCallback(() => {
    if (!questions || questions.length === 0) {
      toast.error("문제가 없습니다.");
      return;
    }

    const resolvedCount = commitQuestionCountInput();
    commitTimeLimitInput();
    const count = Math.min(questions.length, Math.max(1, Math.floor(resolvedCount || questions.length)));
    const ordered = isRandom ? [...questions].sort(() => Math.random() - 0.5) : [...questions];
    const selected = ordered.slice(0, count) as ExamQuestion[];

    setExamQuestions(selected);
    setPhase("exam");
    setTextAnswers({});
    setTableAnswers({});
    setImageLabelAnswers({});
    setOutcomes({});
    setSubjectScoreBefore(null);
    setSubjectScoreAfter(null);

    const now = Date.now();
    setStartTime(now);
    setElapsedTime(0);
    timeoutSubmitTriggeredRef.current = false;
    examBatchIdRef.current = createExamBatchId();
  }, [questions, commitQuestionCountInput, commitTimeLimitInput, isRandom]);

  const handleFinishExam = useCallback(async (options?: { skipConfirm?: boolean; timeout?: boolean }) => {
    if (isSubmitting) return;
    if (!options?.skipConfirm && !confirm("시험을 종료하고 제출할까요?")) return;

    setIsSubmitting(true);
    try {
      const recallTimeForExam = startTime ? Math.floor((Date.now() - startTime) / 1000) : elapsedTime;
      const examEndDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;
      const hoursUntilExam = examEndDate ? (examEndDate.getTime() - Date.now()) / (1000 * 60 * 60) : null;

      if (!isDemo) {
        await utils.confidence.getBySubject.invalidate({ subjectId });
      }
      const beforeConfidenceRaw = isDemo
        ? await utils.demo.confidenceBySubject.fetch({ subjectId })
        : await utils.confidence.getBySubject.fetch({ subjectId });
      const beforeSnapshot = toSubjectConfidenceSnapshot(beforeConfidenceRaw);
      const fetchQuestionConfidence = async (
        questionId: number,
        fallback?: QuestionConfidencePoint
      ): Promise<QuestionConfidencePoint> => {
        try {
          const raw = isDemo
            ? await utils.demo.confidenceByQuestion.fetch({ questionId })
            : await utils.confidence.getByQuestion.fetch({ questionId });
          return {
            score: clampScore(Number((raw as any)?.displayScore ?? fallback?.score ?? 0)),
            state: String((raw as any)?.state ?? fallback?.state ?? "red"),
          };
        } catch {
          return {
            score: clampScore(fallback?.score ?? 0),
            state: fallback?.state ?? "red",
          };
        }
      };

      const beforeQuestionEntries = await Promise.all(
        examQuestions.map(async (q) => {
          const fallback = {
            score: beforeSnapshot.questionScoreMap[q.id] ?? 0,
            state: beforeSnapshot.questionStateMap[q.id] ?? "red",
          };
          if (!isDemo) {
            await utils.confidence.getByQuestion.invalidate({ questionId: q.id });
          }
          const point = await fetchQuestionConfidence(q.id, fallback);
          return [q.id, point] as const;
        })
      );
      const beforeQuestionMap = Object.fromEntries(beforeQuestionEntries) as Record<number, QuestionConfidencePoint>;
      const nextOutcomes: Record<number, QuestionOutcome> = {};

      for (const q of examQuestions) {
        const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
        const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];

        let ans = "";
        if (tableData) {
          const blankCells = getBlankCells(tableData);
          const tAns = tableAnswers[q.id] || {};
          ans = blankCells.map((k) => tAns[k] || "").join("\n");
        } else if (q.imageUrl && imageLabels.length > 0) {
          const lAns = imageLabelAnswers[q.id] || {};
          ans = imageLabels.map((_: any, i: number) => `${i + 1}. ${lAns[i] || ""}`).join("\n");
        } else {
          ans = (textAnswers[q.id] || "").trim();
        }

        if (!ans.trim()) {
          if (!isDemo) {
            await createTestMutation.mutateAsync({
              questionId: q.id,
              userAnswer: "",
              isCorrect: 0,
              recallTime: recallTimeForExam,
              similarityScore: 0,
              analytics: {
                ...getAnalyticsRequestMeta(),
                source: "mock_exam_blank",
                testMode: "mock",
                batchId: examBatchIdRef.current,
              },
            });
            await updateReviewMutation.mutateAsync({
              questionId: q.id,
              quality: 0,
            });
          }

          const beforePoint = beforeQuestionMap[q.id];
          const baseScore = beforePoint?.score ?? 0;
          nextOutcomes[q.id] = {
            eval: {
              isCorrect: false,
              similarityScore: 0,
              accuracyRate: 0,
              feedback: "미작성 (오답 처리)",
              userAnswer: "",
              submitted: true,
              wasBlank: true,
            },
            confidenceBefore: baseScore,
            confidenceAfter: baseScore,
            confidenceDelta: 0,
            stateBefore: beforePoint?.state ?? "red",
            stateAfter: beforePoint?.state ?? "red",
          };
          continue;
        }

        if (tableData) {
          const blankCells = getBlankCells(tableData);
          const answerMap = tableAnswers[q.id] || {};
          const tableGrade = gradeTable(tableData, answerMap);
          const similarityScore = tableGrade.total > 0 ? Math.round((tableGrade.score / tableGrade.total) * 100) : 0;
          const tableMistakes = blankCells.map((key, idx) => ({
            lineIndex: idx + 1,
            cellKey: key,
            correctAnswer: getTableCorrectAnswerByCellKey(tableData, key),
            userAnswer: answerMap[key] || "",
            isCorrect: !!tableGrade.results[key],
          }));

          const quality = tableGrade.score === tableGrade.total
            ? (recallTimeForExam <= 15 ? 5 : 4)
            : (similarityScore >= 80 ? 2 : similarityScore >= 60 ? 1 : 0);
          if (!isDemo) {
            await createTestMutation.mutateAsync({
              questionId: q.id,
              userAnswer: ans,
              isCorrect: tableGrade.score === tableGrade.total ? 1 : 0,
              recallTime: recallTimeForExam,
              similarityScore,
              mistakeHighlights: JSON.stringify(tableMistakes),
              analytics: {
                ...getAnalyticsRequestMeta(),
                source: "mock_exam_table",
                testMode: "mock",
                batchId: examBatchIdRef.current,
              },
            });
            await updateReviewMutation.mutateAsync({
              questionId: q.id,
              quality,
            });
          }

          nextOutcomes[q.id] = {
            eval: {
              isCorrect: tableGrade.score === tableGrade.total,
              similarityScore,
              accuracyRate: similarityScore,
              correctLineCount: tableGrade.score,
              totalLines: tableGrade.total,
              mistakes: tableMistakes,
              feedback: tableGrade.score === tableGrade.total
                ? "정확하게 작성하셨습니다!"
                : `${tableGrade.score}/${tableGrade.total} 정답`,
              userAnswer: ans,
              submitted: true,
            },
            confidenceBefore: beforeQuestionMap[q.id]?.score ?? 0,
            confidenceAfter: beforeQuestionMap[q.id]?.score ?? 0,
            confidenceDelta: 0,
            stateBefore: beforeQuestionMap[q.id]?.state ?? "red",
            stateAfter: beforeQuestionMap[q.id]?.state ?? "red",
          };
          continue;
        }

        const evalInput = {
          questionId: q.id,
          userAnswer: ans,
          recallTime: recallTimeForExam,
          analytics: {
            ...getAnalyticsRequestMeta(),
            source: "mock_exam_evaluate",
            testMode: "mock" as const,
            batchId: examBatchIdRef.current,
          },
        };
        const evalRaw = isDemo
          ? await demoEvaluateMutation.mutateAsync({
              questionId: q.id,
              userAnswer: ans,
              recallTime: recallTimeForExam,
            })
          : await evaluateMutation.mutateAsync(evalInput);

        const isCorrect = toBool((evalRaw as any)?.isCorrect);
        const similarityScore = Number((evalRaw as any)?.similarityScore ?? 0);
        const quality = isCorrect
          ? (recallTimeForExam <= 15 ? 5 : recallTimeForExam <= 35 ? 4 : 3)
          : (similarityScore >= 80 ? 2 : similarityScore >= 60 ? 1 : 0);
        if (!isDemo) {
          await updateReviewMutation.mutateAsync({
            questionId: q.id,
            quality,
          });
        }

        nextOutcomes[q.id] = {
          eval: {
            isCorrect,
            similarityScore,
            accuracyRate: Number((evalRaw as any)?.accuracyRate ?? similarityScore),
            correctLineCount: (evalRaw as any)?.correctLineCount,
            totalLines: (evalRaw as any)?.totalLines,
            mistakes: (evalRaw as any)?.mistakes,
            feedback: (evalRaw as any)?.feedback,
            llmFeedback: (evalRaw as any)?.llmFeedback ?? null,
            userAnswer: ans,
            submitted: true,
          },
          confidenceBefore: beforeQuestionMap[q.id]?.score ?? 0,
          confidenceAfter: beforeQuestionMap[q.id]?.score ?? 0,
          confidenceDelta: 0,
          stateBefore: beforeQuestionMap[q.id]?.state ?? "red",
          stateAfter: beforeQuestionMap[q.id]?.state ?? "red",
        };
      }

      let afterSnapshot = beforeSnapshot;
      let afterQuestionMap = beforeQuestionMap;
      if (!isDemo) {
        await Promise.all(
          examQuestions.map((q) => utils.confidence.getByQuestion.invalidate({ questionId: q.id }))
        );
        await utils.confidence.getBySubject.invalidate({ subjectId });
        const afterConfidenceRaw = await utils.confidence.getBySubject.fetch({ subjectId });
        afterSnapshot = toSubjectConfidenceSnapshot(afterConfidenceRaw);
        const afterQuestionEntries = await Promise.all(
          examQuestions.map(async (q) => {
            const fallback = {
              score: afterSnapshot.questionScoreMap[q.id] ?? beforeQuestionMap[q.id]?.score ?? 0,
              state: afterSnapshot.questionStateMap[q.id] ?? beforeQuestionMap[q.id]?.state ?? "red",
            };
            const point = await fetchQuestionConfidence(q.id, fallback);
            return [q.id, point] as const;
          })
        );
        afterQuestionMap = Object.fromEntries(afterQuestionEntries) as Record<number, QuestionConfidencePoint>;
      }

      for (const q of examQuestions) {
        const beforePoint = beforeQuestionMap[q.id];
        const afterPoint = afterQuestionMap[q.id];
        const before = beforePoint?.score ?? 0;
        const after = afterPoint?.score ?? before;
        const item = nextOutcomes[q.id];
        if (!item) continue;

        let displayedAfter = after;
        let deltaEstimated = false;

        // 개별 시험모드와 동일하게, 실측 변화가 0으로 보일 때는 추정 증감을 보강 표시
        if (item.eval.submitted && displayedAfter - before === 0) {
          const estimatedDelta = estimateTestConfidenceDelta({
            currentScore: before,
            isCorrect: item.eval.isCorrect,
            similarityScore: item.eval.similarityScore,
            recallTime: recallTimeForExam,
            hoursUntilExam,
          });
          if (estimatedDelta !== 0) {
            displayedAfter = clampScore(before + estimatedDelta);
            deltaEstimated = true;
          }
        }

        const displayedDelta = displayedAfter - before;
        item.confidenceBefore = before;
        item.confidenceAfter = displayedAfter;
        item.confidenceDelta = displayedDelta;
        item.confidenceDeltaEstimated = deltaEstimated;
        item.stateBefore = beforePoint?.state ?? "red";
        item.stateAfter = deltaEstimated
          ? stateFromScore(displayedAfter)
          : (afterPoint?.state ?? stateFromScore(displayedAfter));
      }

      setOutcomes(nextOutcomes);
      setSubjectScoreBefore(beforeSnapshot.aggregateScore);
      setSubjectScoreAfter(
        isDemo
          ? Math.round(
              examQuestions.reduce((sum, q) => sum + (nextOutcomes[q.id]?.confidenceAfter ?? beforeQuestionMap[q.id]?.score ?? 0), 0) /
                Math.max(1, examQuestions.length)
            )
          : afterSnapshot.aggregateScore
      );
      setPhase("result");
      if (options?.timeout) {
        toast.info("시간이 종료되어 자동 제출되었습니다.");
      }
    } catch (error: any) {
      toast.error("채점 실패: " + (error?.message || "알 수 없는 오류"));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    startTime,
    elapsedTime,
    subjectId,
    examQuestions,
    tableAnswers,
    imageLabelAnswers,
    textAnswers,
    evaluateMutation,
    demoEvaluateMutation,
    createTestMutation,
    updateReviewMutation,
    utils.confidence.getBySubject,
    utils.confidence.getByQuestion,
    utils.demo.confidenceBySubject,
    utils.demo.confidenceByQuestion,
    subject,
    isDemo,
  ]);

  useEffect(() => {
    if (phase !== "exam") {
      timeoutSubmitTriggeredRef.current = false;
      return;
    }
    if (timeLimitSeconds === null || isSubmitting) return;
    if (remainingSeconds === null) return;
    if (remainingSeconds > 0) return;
    if (timeoutSubmitTriggeredRef.current) return;
    timeoutSubmitTriggeredRef.current = true;
    void handleFinishExam({ skipConfirm: true, timeout: true });
  }, [handleFinishExam, isSubmitting, phase, remainingSeconds, timeLimitSeconds]);

  if (!questions) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (phase === "intro") {
    const presetCounts = [10, 20, 30].filter((n) => n <= totalAvailable);

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-1.5"
          onClick={() => setLocation(subjectQuestionsPath)}
        >
          <ArrowLeft className="h-4 w-4" />
          과목으로 돌아가기
        </Button>

        <div className="text-center py-8">
          <div className="text-5xl mb-4">📝</div>
          <h1 className="text-2xl font-bold mb-2">{subject?.name} 모의고사</h1>
          <p className="text-muted-foreground mb-6">시험지 형식으로 한 번에 풀고 마지막에 제출합니다.</p>

          <div className="grid grid-cols-3 gap-4 mb-8 max-w-sm mx-auto">
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{totalAvailable}</div>
              <div className="text-xs text-muted-foreground mt-1">전체 문제</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{Math.max(1, Math.min(questionCount || totalAvailable, totalAvailable))}</div>
              <div className="text-xs text-muted-foreground mt-1">출제 문제</div>
            </div>
            <div className="bg-muted/40 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">
                {timeLimitMinutes === null ? "∞" : `${timeLimitMinutes}분`}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {timeLimitMinutes === null ? "시간 제한 없음" : "시간 제한"}
              </div>
            </div>
          </div>

          <div className="space-y-4 max-w-md mx-auto mb-8">
            <div className="text-left">
              <p className="text-sm font-medium mb-2">문항 수 설정</p>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button
                  onClick={() => {
                    setQuestionCount(totalAvailable);
                    setQuestionCountInput(String(totalAvailable));
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    questionCount === totalAvailable ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  전체 ({totalAvailable})
                </button>
                {presetCounts.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setQuestionCount(n);
                      setQuestionCountInput(String(n));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      questionCount === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {n}문항
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={totalAvailable}
                inputMode="numeric"
                value={questionCountInput}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9]/g, "");
                  setQuestionCountInput(cleaned);
                }}
                onBlur={() => {
                  commitQuestionCountInput();
                }}
                onFocus={(e) => {
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitQuestionCountInput();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="h-8 text-sm"
              />
            </div>

            <div className="text-left">
              <p className="text-sm font-medium mb-2">시간 제한 (분)</p>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button
                  onClick={() => {
                    setTimeLimitMinutes(null);
                    setTimeLimitInput("");
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    timeLimitMinutes === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  무제한
                </button>
                {[20, 30, 45, 60].map((minutes) => (
                  <button
                    key={minutes}
                    onClick={() => {
                      setTimeLimitMinutes(minutes);
                      setTimeLimitInput(String(minutes));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      timeLimitMinutes === minutes ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {minutes}분
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={600}
                inputMode="numeric"
                value={timeLimitInput}
                placeholder="비워두면 무제한"
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9]/g, "");
                  setTimeLimitInput(cleaned);
                }}
                onBlur={() => {
                  commitTimeLimitInput();
                }}
                onFocus={(e) => {
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTimeLimitInput();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="h-8 text-sm"
              />
            </div>

            <div className="text-left">
              <p className="text-sm font-medium mb-2">출제 순서</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsRandom(false)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    !isRandom ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  순서대로
                </button>
                <button
                  onClick={() => setIsRandom(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isRandom ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  랜덤 순서
                </button>
              </div>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-4 mb-8 text-sm text-muted-foreground text-left max-w-md mx-auto">
            <p className="font-medium text-foreground mb-2">안내</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>시험지처럼 아래로 스크롤하며 연속 풀이</li>
              <li>각 문제 답안은 자동 임시저장</li>
              <li>모든 작성 후 상단 "시험 종료"로 일괄 채점</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={handleStart}
            disabled={totalAvailable === 0}
          >
            <ChevronRight className="h-5 w-5" />
            시험 시작
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "exam") {
    return (
      <div className="max-w-4xl mx-auto px-4 pb-8 space-y-4">
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border -mx-4 px-4 py-3">
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
                  setExamQuestions([]);
                  setOutcomes({});
                  setSubjectScoreBefore(null);
                  setSubjectScoreAfter(null);
                }
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">
                  {answeredCount} / {examQuestions.length}개 작성
                </span>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {timeLimitSeconds === null
                    ? formatTime(elapsedTime)
                    : `${formatTime(remainingSeconds ?? 0)} 남음`}
                </div>
              </div>
              <Progress value={(answeredCount / Math.max(1, examQuestions.length)) * 100} className="h-1.5" />
            </div>

            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={handleFinishExam}
              disabled={isSubmitting}
            >
              {isSubmitting ? "채점 중..." : "시험 종료"}
            </Button>
          </div>
        </div>

        {examQuestions.map((q, idx) => {
          const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
          const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
          const isTableQuestion = !!tableData;
          const isImageQuestion = !!q.imageUrl && imageLabels.length > 0;
          const answered = hasAnswer(q);

          return (
            <div key={q.id} className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                    Q{idx + 1}
                    {isTableQuestion && " 📊"}
                    {isImageQuestion && " 🖼"}
                  </Badge>
                  <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">{q.question}</p>
                </div>
                <Badge variant={answered ? "default" : "secondary"} className="text-xs flex-shrink-0">
                  {answered ? "작성됨" : "미작성"}
                </Badge>
              </div>

              {isImageQuestion && (
                <div className="space-y-3">
                  <div className="relative">
                    <img src={q.imageUrl || ""} alt="문제 이미지" className="w-full rounded-lg border border-border" />
                    {imageLabels.map((_: any, labelIdx: number) => (
                      <div
                        key={labelIdx}
                        className="absolute w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold"
                        style={{
                          left: `${imageLabels[labelIdx]?.x ?? 0}%`,
                          top: `${imageLabels[labelIdx]?.y ?? 0}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        {labelIdx + 1}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {imageLabels.map((_: any, labelIdx: number) => (
                      <div key={labelIdx} className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-primary min-w-[24px]">{labelIdx + 1}.</span>
                        <input
                          type="text"
                          value={(imageLabelAnswers[q.id] || {})[labelIdx] || ""}
                          onChange={(e) =>
                            setImageLabelAnswers((prev) => ({
                              ...prev,
                              [q.id]: { ...(prev[q.id] || {}), [labelIdx]: e.target.value },
                            }))
                          }
                          placeholder={`영역 ${labelIdx + 1} 답안`}
                          className="flex-1 h-8 px-3 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isTableQuestion && tableData && (
                <TableView
                  tableData={tableData}
                  answers={tableAnswers[q.id] || {}}
                  onAnswerChange={(key, value) =>
                    setTableAnswers((prev) => ({
                      ...prev,
                      [q.id]: { ...(prev[q.id] || {}), [key]: value },
                    }))
                  }
                />
              )}

              {!isTableQuestion && !isImageQuestion && (
                <Textarea
                  value={textAnswers[q.id] || ""}
                  onChange={(e) => setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="정답을 입력하세요..."
                  className="min-h-[160px] resize-y font-medium"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const subjectScoreDelta = (subjectScoreBefore !== null && subjectScoreAfter !== null)
    ? subjectScoreAfter - subjectScoreBefore
    : null;
  const subjectStateBefore = subjectScoreBefore === null ? null : stateFromScore(subjectScoreBefore);
  const subjectStateAfter = subjectScoreAfter === null ? null : stateFromScore(subjectScoreAfter);
  const gradedOutcomes = examQuestions
    .map((q) => outcomes[q.id])
    .filter((o): o is QuestionOutcome => !!o);
  const totalGradedCount = examQuestions.length;
  const correctCount = gradedOutcomes.filter((o) => o.eval.isCorrect).length;
  const avgSimilarity = totalGradedCount > 0
    ? Math.round(
        examQuestions.reduce((sum, q) => sum + (outcomes[q.id]?.eval.similarityScore ?? 0), 0) /
          totalGradedCount
      )
    : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="rounded-xl p-6 text-center bg-primary/5 border border-primary/20">
        <div className="text-4xl mb-3">📝</div>
        <h2 className="text-xl font-bold mb-1">시험 완료</h2>
        <p className="text-muted-foreground text-sm mb-4">
          {answeredCount}/{examQuestions.length}개 문제 답안 작성 · {formatTime(elapsedTime)} 소요
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">문항 정답</p>
            <p className="font-bold text-sm">{correctCount}/{totalGradedCount}</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">평균 유사도</p>
            <p className="font-bold text-sm">{avgSimilarity}%</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">과목 안정도</p>
            <div className="mt-0.5 flex items-center justify-center gap-1.5 text-sm font-bold">
              {subjectStateBefore && (
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${getConfidenceSignalDotClass(subjectStateBefore)}`} />
              )}
              <span>{subjectScoreBefore ?? 0}</span>
              <span>→</span>
              {subjectStateAfter && (
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${getConfidenceSignalDotClass(subjectStateAfter)}`} />
              )}
              <span>{subjectScoreAfter ?? 0}</span>
            </div>
          </div>
          <div className="rounded-lg bg-background/60 border border-border p-2">
            <p className="text-muted-foreground">과목 증감</p>
            <p className={`font-bold text-sm ${subjectScoreDelta === null ? "" : subjectScoreDelta > 0 ? "text-emerald-600" : subjectScoreDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {subjectScoreDelta === null ? "-" : `${subjectScoreDelta > 0 ? "+" : ""}${subjectScoreDelta}점`}
            </p>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSubjectHistoryOpen(true)}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            과목 그래프 보기
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">문제별 채점 결과 · 안정도 반영</h3>
        {examQuestions.map((q, i) => {
          const tableData: TableData | null = q.tableData ? JSON.parse(q.tableData) : null;
          const imageLabels: any[] = q.imageLabels ? JSON.parse(q.imageLabels) : [];
          const isImageQuestion = !!q.imageUrl && imageLabels.length > 0;
          const outcome = outcomes[q.id];

          let answerDisplay = "";
          if (tableData) {
            const blankCells = getBlankCells(tableData);
            answerDisplay = blankCells.map((k) => `${k}: ${(tableAnswers[q.id] || {})[k] || "(미작성)"}`).join("\n");
          } else if (isImageQuestion) {
            answerDisplay = imageLabels
              .map((_: any, idx: number) => `${idx + 1}. ${(imageLabelAnswers[q.id] || {})[idx] || "(미작성)"}`)
              .join("\n");
          } else {
            answerDisplay = (textAnswers[q.id] || "").trim();
          }

          const accuracySummary = outcome
            ? (typeof outcome.eval.totalLines === "number" && outcome.eval.totalLines > 0
              ? `${outcome.eval.correctLineCount ?? 0}/${outcome.eval.totalLines}`
              : `${Math.round(outcome.eval.accuracyRate)}%`)
            : "-";
          const confidenceBeforeState = outcome
            ? (outcome.stateBefore ?? stateFromScore(outcome.confidenceBefore))
            : "red";
          const confidenceAfterState = outcome
            ? (outcome.stateAfter ?? stateFromScore(outcome.confidenceAfter))
            : "red";

          return (
            <div key={q.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">
                  Q{i + 1}
                  {tableData ? " 📊" : isImageQuestion ? " 🖼" : ""}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-medium leading-snug">{q.question}</p>
                    {outcome ? (
                      <Badge
                        variant={
                          outcome.eval.wasBlank
                            ? "secondary"
                            : outcome.eval.submitted
                              ? (outcome.eval.isCorrect ? "default" : "destructive")
                              : "secondary"
                        }
                        className="text-[11px]"
                      >
                        {outcome.eval.wasBlank ? "미작성" : outcome.eval.submitted ? (outcome.eval.isCorrect ? "정답" : "오답") : "미작성"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">미채점</Badge>
                    )}
                  </div>
                  {outcome && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{outcome.eval.isCorrect ? "✓" : "✗"}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">정답 여부</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{accuracySummary}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">정확도</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className="text-2xl font-bold">{Math.round(outcome.eval.similarityScore)}%</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">유사도</p>
                      </div>
                      <div className="text-center rounded-lg border border-border bg-muted/30 px-2 py-2">
                        <p className={`text-2xl font-bold ${outcome.confidenceDelta > 0 ? "text-emerald-600" : outcome.confidenceDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {outcome.confidenceDelta > 0 ? "+" : ""}{outcome.confidenceDelta}점
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">안정도 증감</p>
                        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${getConfidenceSignalDotClass(confidenceBeforeState)}`} />
                          <span>{outcome.confidenceBefore}</span>
                          <span>→</span>
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${getConfidenceSignalDotClass(confidenceAfterState)}`} />
                          <span>{outcome.confidenceAfter}</span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 h-6 px-2 text-[10px] gap-1"
                          onClick={() => {
                            setConfidenceHistoryId(q.id);
                            setConfidenceHistoryTitle(q.question);
                          }}
                        >
                          <BarChart3 className="h-3 w-3" />
                          그래프
                        </Button>
                        {outcome.confidenceDeltaEstimated && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">실측 0점으로 추정 반영</p>
                        )}
                      </div>
                    </div>
                  )}
                  {outcome?.eval.feedback && (
                    <p className="text-xs text-muted-foreground mt-2">{outcome.eval.feedback}</p>
                  )}
                  {outcome?.eval.llmFeedback && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{outcome.eval.llmFeedback}</p>
                  )}
                  {outcome?.eval.mistakes && outcome.eval.mistakes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">정답 비교</p>
                      {outcome.eval.mistakes.slice(0, 6).map((m, idx) => (
                        <div
                          key={`${q.id}-${idx}`}
                          className={`p-3 rounded-lg border ${m.isCorrect ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"}`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold">
                              {m.lineIndex
                                ? `${m.lineIndex}줄`
                                : m.labelIndex
                                  ? `${m.labelIndex}번 라벨`
                                  : m.cellKey
                                    ? `셀 ${m.cellKey}`
                                    : `항목 ${idx + 1}`}
                            </span>
                            <span className={`text-base ${m.isCorrect ? "text-green-600" : "text-red-600"}`}>
                              {m.isCorrect ? "✓" : "✗"}
                            </span>
                          </div>
                          <div className="text-xs space-y-1">
                            <div><span className="font-semibold">정답:</span> {m.correctAnswer || "(없음)"}</div>
                            <div className={m.isCorrect ? "text-green-700" : "text-red-700"}>
                              <span className="font-semibold">내 답:</span> {m.userAnswer || "(미입력)"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!outcome?.eval.mistakes?.length && (
                    answerDisplay ? (
                      <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap font-mono mt-2">
                        {answerDisplay}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/50 italic mt-2">미작성</p>
                    )
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
            setExamQuestions([]);
            setOutcomes({});
            setSubjectScoreBefore(null);
            setSubjectScoreAfter(null);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          다시 시험
        </Button>
        <Button className="flex-1 gap-1.5" onClick={() => setLocation(subjectQuestionsPath)}>
          <Trophy className="h-4 w-4" />
          과목으로 돌아가기
        </Button>
      </div>

      <ConfidenceHistoryModal
        questionId={confidenceHistoryId}
        questionTitle={confidenceHistoryTitle}
        open={confidenceHistoryId !== null}
        onClose={() => setConfidenceHistoryId(null)}
        isDemo={isDemo}
      />

      <SubjectConfidenceHistoryModal
        subjectId={subjectId}
        subjectName={subject?.name}
        open={subjectHistoryOpen}
        onClose={() => setSubjectHistoryOpen(false)}
        isDemo={isDemo}
      />
    </div>
  );
}
