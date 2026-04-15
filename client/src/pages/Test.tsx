import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Play, Send, RotateCcw, Mic, MicOff, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";
import { trackTestSubmit } from "@/lib/ga4Events";
import { ConfidencePopup } from "@/components/ConfidencePopup";
import { estimateTestConfidenceDelta } from "@shared/examConfidence";
import { getImageAttribution } from "@/lib/imageAttribution";

interface TestProps {
  questionId: number;
  isDemo?: boolean;
}

type MatchTone = "correct" | "answer";

function buildNonWhitespaceTokens(codepoints: string[]) {
  const tokens: Array<{ ch: string; pos: number }> = [];
  for (let i = 0; i < codepoints.length; i++) {
    const ch = codepoints[i];
    if (/^\s$/.test(ch)) continue;
    tokens.push({ ch: ch.toLocaleLowerCase(), pos: i });
  }
  return tokens;
}

function getMatchedCharPositions(correctText: string, answerText: string) {
  const correctChars = Array.from(correctText ?? "");
  const answerChars = Array.from(answerText ?? "");
  const correctTokens = buildNonWhitespaceTokens(correctChars);
  const answerTokens = buildNonWhitespaceTokens(answerChars);

  const m = correctTokens.length;
  const n = answerTokens.length;
  if (m === 0 || n === 0) {
    return {
      correctMatched: new Set<number>(),
      answerMatched: new Set<number>(),
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (correctTokens[i - 1].ch === answerTokens[j - 1].ch) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const correctMatched = new Set<number>();
  const answerMatched = new Set<number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (correctTokens[i - 1].ch === answerTokens[j - 1].ch) {
      correctMatched.add(correctTokens[i - 1].pos);
      answerMatched.add(answerTokens[j - 1].pos);
      i--;
      j--;
      continue;
    }
    if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }

  return { correctMatched, answerMatched };
}

const WORD_TOKEN_PATTERN = "[a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+(?:['’\\-][a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+)*";

function buildWordTokens(text: string) {
  const tokens: Array<{ token: string; start: number; end: number }> = [];
  const regex = new RegExp(WORD_TOKEN_PATTERN, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const word = match[0] ?? "";
    if (!word) continue;
    tokens.push({
      token: word.toLowerCase(),
      start: match.index,
      end: match.index + word.length,
    });
  }
  return tokens;
}

function getMatchedWordPositions(correctText: string, answerText: string) {
  const correctTokens = buildWordTokens(correctText ?? "");
  const answerTokens = buildWordTokens(answerText ?? "");
  const m = correctTokens.length;
  const n = answerTokens.length;

  if (m === 0 || n === 0) {
    return {
      correctMatched: new Set<number>(),
      answerMatched: new Set<number>(),
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (correctTokens[i - 1].token === answerTokens[j - 1].token) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const matchedCorrectTokenIndexes = new Set<number>();
  const matchedAnswerTokenIndexes = new Set<number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (correctTokens[i - 1].token === answerTokens[j - 1].token) {
      matchedCorrectTokenIndexes.add(i - 1);
      matchedAnswerTokenIndexes.add(j - 1);
      i--;
      j--;
      continue;
    }
    if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }

  const correctMatched = new Set<number>();
  const answerMatched = new Set<number>();
  matchedCorrectTokenIndexes.forEach((idx) => {
    const token = correctTokens[idx];
    for (let p = token.start; p < token.end; p++) correctMatched.add(p);
  });
  matchedAnswerTokenIndexes.forEach((idx) => {
    const token = answerTokens[idx];
    for (let p = token.start; p < token.end; p++) answerMatched.add(p);
  });

  return { correctMatched, answerMatched };
}

function isLikelyEnglishText(text: string): boolean {
  const latinCount = (text.match(/[a-z]/gi) ?? []).length;
  const hangulCount = (text.match(/[가-힣]/g) ?? []).length;
  if (latinCount === 0) return false;
  return hangulCount === 0 || latinCount >= hangulCount * 2;
}

function getMatchedPositions(
  correctText: string,
  answerText: string,
  preferredMode?: string | null
) {
  const mode = preferredMode === "word"
    ? "word"
    : preferredMode === "typing"
      ? "char"
      : isLikelyEnglishText(`${correctText ?? ""} ${answerText ?? ""}`)
        ? "word"
        : "char";
  return mode === "word"
    ? { ...getMatchedWordPositions(correctText, answerText), mode: "word" as const }
    : { ...getMatchedCharPositions(correctText, answerText), mode: "char" as const };
}

function renderComparedText(
  text: string,
  matchedPositions: Set<number>,
  tone: MatchTone
) {
  const chars = Array.from(text ?? "");
  return (
    <span className="whitespace-pre-wrap break-words">
      {chars.map((ch, idx) => {
        const isWhitespace = /^\s$/.test(ch);
        const isSymbolOrPunctuation = /[\p{P}\p{S}]/u.test(ch);
        const isMatched = !isWhitespace && matchedPositions.has(idx);
        const className = isWhitespace
          ? "text-current"
          : isMatched
            ? "rounded-sm bg-emerald-100 text-emerald-900 dark:bg-emerald-900/45 dark:text-emerald-100"
            : isSymbolOrPunctuation
              ? "text-muted-foreground"
            : tone === "correct"
              ? "text-foreground/85 dark:text-zinc-100/90"
              : "rounded-sm bg-rose-100 text-rose-800 dark:bg-rose-900/45 dark:text-rose-100";
        return (
          <span key={`${idx}-${ch}`} className={className}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}

function deleteCurrentLineAtCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; nextCursor: number } {
  if (value.length === 0) return { nextValue: value, nextCursor: 0 };

  if (selectionStart !== selectionEnd) {
    return {
      nextValue: value.slice(0, selectionStart) + value.slice(selectionEnd),
      nextCursor: selectionStart,
    };
  }

  const cursor = selectionStart;
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const rawLineEnd = value.indexOf("\n", cursor);
  const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;

  let removeStart = lineStart;
  let removeEnd = lineEnd;

  if (lineStart === 0 && lineEnd < value.length) {
    removeEnd = lineEnd + 1;
  } else if (lineStart > 0 && lineEnd === value.length) {
    removeStart = lineStart - 1;
  } else if (lineStart > 0 && lineEnd < value.length) {
    removeEnd = lineEnd + 1;
  }

  return {
    nextValue: value.slice(0, removeStart) + value.slice(removeEnd),
    nextCursor: removeStart,
  };
}

function deleteWordBeforeCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; nextCursor: number } {
  if (value.length === 0) return { nextValue: value, nextCursor: 0 };

  if (selectionStart !== selectionEnd) {
    return {
      nextValue: value.slice(0, selectionStart) + value.slice(selectionEnd),
      nextCursor: selectionStart,
    };
  }

  let cursor = selectionStart;
  while (cursor > 0 && /\s/.test(value[cursor - 1])) cursor--;
  while (cursor > 0 && !/\s/.test(value[cursor - 1])) cursor--;

  return {
    nextValue: value.slice(0, cursor) + value.slice(selectionEnd),
    nextCursor: cursor,
  };
}

export default function Test({ questionId, isDemo = false }: TestProps) {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const shouldAutoStart = searchParams.get("autostart") === "1";
  const [userAnswer, setUserAnswer] = useState("");
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, string>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [recallTime, setRecallTime] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [answerHistory, setAnswerHistory] = useState<string[]>([""]);
  const [answerHistoryIndex, setAnswerHistoryIndex] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showConfidencePopup, setShowConfidencePopup] = useState(false);
  const [confidenceBefore, setConfidenceBefore] = useState(0);
  const [confidenceAfter, setConfidenceAfter] = useState(0);

  // 타이핑 속도 보너스 수집 상태
  const typingStartTimeRef = useRef<number | null>(null);
  const timeToFirstKeyRef = useRef<number | null>(null);
  const backspaceCountRef = useRef(0);
  const pasteDetectedRef = useRef(false);
  const inputCharsRef = useRef(0);
  const [speedBonus, setSpeedBonus] = useState<{ bonus: number; label: string; ratio: number } | null>(null);
  const isMacPlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const { data: confidenceData, refetch: refetchConfidence } = trpc.confidence.getByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const examPrediction = (confidenceData as any)?.examDatePrediction;
  const estimatedHoursUntilExam = typeof examPrediction?.hoursUntilExam === "number"
    ? examPrediction.hoursUntilExam
    : (typeof examPrediction?.daysUntilExam === "number" ? examPrediction.daysUntilExam * 24 : null);

  // confidenceData가 로드되면 confidenceBefore 초기화
  useEffect(() => {
    if (confidenceData && !isSubmitted) {
      setConfidenceBefore(Math.round(confidenceData.displayScore));
    }
  }, [confidenceData, isSubmitted]);
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;
  const imageAttribution = useMemo(
    () => getImageAttribution(question?.id, question?.imageUrl),
    [question?.id, question?.imageUrl]
  );
  const tableData: TableData | null = question?.tableData ? JSON.parse(question.tableData) : null;
  const isTableQuestion = !!tableData;
  const [tableAnswers, setTableAnswers] = useState<Record<string, string>>({});
  const [tableResults, setTableResults] = useState<Record<string, boolean> | null>(null);
  const [tableScore, setTableScore] = useState<{ score: number; total: number } | null>(null);
  const updateReviewMutation = trpc.review.updateAfterReview.useMutation({
    onError: (error) => {
      if (!isDemo) {
        console.error('Failed to update review:', error);
      }
    },
  });
  
  const triggerConfidencePopup = useCallback(async (data: any) => {
    const prevScore = confidenceBefore;
    // DB에서 최신 점수 가져와서 실제 변화량 계산
    let newScore = prevScore;
    if (!isDemo) {
      try {
        const result = await refetchConfidence();
        newScore = Math.round(result.data?.displayScore ?? prevScore);
      } catch {
        // refetch 실패 시, 공유 추정식(서버 정책 기반)으로 fallback
        const scoreChange = estimateTestConfidenceDelta({
          currentScore: prevScore,
          isCorrect: !!data.isCorrect,
          similarityScore: data.similarityScore || 0,
          recallTime,
          hoursUntilExam: estimatedHoursUntilExam,
        });
        newScore = Math.max(0, Math.min(100, prevScore + scoreChange));
      }
    } else {
      // 데모 모드: 공유 추정식 사용
      const scoreChange = estimateTestConfidenceDelta({
        currentScore: prevScore,
        isCorrect: !!data.isCorrect,
        similarityScore: data.similarityScore || 0,
        recallTime,
        hoursUntilExam: estimatedHoursUntilExam,
      });
      newScore = Math.max(0, Math.min(100, prevScore + scoreChange));
    }
    setConfidenceBefore(prevScore);
    setConfidenceAfter(newScore);
    setShowConfidencePopup(true);
  }, [confidenceBefore, recallTime, isDemo, refetchConfidence, estimatedHoursUntilExam]);

  const recordAttemptMutation = trpc.typing.recordAttempt.useMutation({
    onSuccess: (data) => {
      if (data.bonus > 0) {
        setSpeedBonus({ bonus: data.bonus, label: data.label, ratio: data.ratio });
      }
    },
  });

  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: async (data: any) => {
      setResult(data);
      setIsSubmitted(true);
      triggerConfidencePopup(data);
      
      // Update review schedule based on performance
      if (question) {
        const similarity = data.similarityScore ?? 0;
        const quality = data.isCorrect
          ? (recallTime <= 15 ? 5 : recallTime <= 35 ? 4 : 3)
          : (similarity >= 80 ? 2 : similarity >= 60 ? 1 : 0);
        await updateReviewMutation.mutateAsync({
          questionId: question.id,
          quality,
        });
      }
    },
    onError: (error: any) => {
      toast.error("평가 실패: " + error.message);
    },
  });

  const demoEvaluateMutation = trpc.demo.evaluate.useMutation({
    onSuccess: (data: any) => {
      setResult(data);
      setIsSubmitted(true);
      triggerConfidencePopup(data);
    },
    onError: (error: any) => {
      toast.error("평가 실패: " + error.message);
    },
  });

  const transcribeMutation = trpc.voice.transcribe.useMutation({
    onSuccess: (data: any) => {
      setUserAnswer(data.text);
      toast.success("음성이 텍스트로 변환되었습니다");
    },
    onError: (error: any) => {
      toast.error("음성 변환 실패: " + error.message);
    },
  });

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStarted && startTime && !isSubmitted) {
      interval = setInterval(() => {
        setRecallTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isStarted, startTime, isSubmitted]);

  const handleStart = () => {
    const initialAnswer = "";
    setIsStarted(true);
    setStartTime(Date.now());
    setUserAnswer(initialAnswer);
    setRecallTime(0);
    setIsSubmitted(false);
    setResult(null);
    setTableAnswers({});
    setTableResults(null);
    setTableScore(null);
    setAnswerHistory([initialAnswer]);
    setAnswerHistoryIndex(0);
    setSpeedBonus(null);
    // 타이핑 수집 리셋
    typingStartTimeRef.current = null;
    timeToFirstKeyRef.current = null;
    backspaceCountRef.current = 0;
    pasteDetectedRef.current = false;
    inputCharsRef.current = 0;
  };

  useEffect(() => {
    if (!question || !shouldAutoStart || isStarted || isSubmitted) return;
    handleStart();
  }, [question, shouldAutoStart, isStarted, isSubmitted]);

  useEffect(() => {
    if (!isStarted || isSubmitted || isImageQuestion || isTableQuestion) return;
    const timer = window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isStarted, isSubmitted, isImageQuestion, isTableQuestion]);

  const handleReset = () => {
    const resetAnswer = "";
    setIsStarted(false);
    setStartTime(null);
    setUserAnswer(resetAnswer);
    setRecallTime(0);
    setIsSubmitted(false);
    setResult(null);
    setAudioBlob(null);
    setAnswerHistory([resetAnswer]);
    setAnswerHistoryIndex(0);
    setTableAnswers({});
    setTableResults(null);
    setTableScore(null);
    setSpeedBonus(null);
    typingStartTimeRef.current = null;
    timeToFirstKeyRef.current = null;
    backspaceCountRef.current = 0;
    pasteDetectedRef.current = false;
    inputCharsRef.current = 0;
  };

  const handleSubmit = async () => {
    if (!question) return;

    // 표 문제인 경우
    if (isTableQuestion && tableData) {
      const blankCells = getBlankCells(tableData);
      const hasAllAnswers = blankCells.every((key) => tableAnswers[key]?.trim());
      if (!hasAllAnswers) {
        toast.error("모든 빈칸을 채우세요");
        return;
      }
      const { results, score, total } = gradeTable(tableData, tableAnswers);
      setTableResults(results);
      setTableScore({ score, total });
      setIsSubmitted(true);

      // GA4 이벤트 추적: 시험 제출
      trackTestSubmit(
        question.subjectId,
        Math.round((score / total) * 100),
        total,
        score,
        recallTime
      );

      // Update review schedule
      const accuracyRate = Math.round((score / total) * 100);
      const quality = score === total
        ? (recallTime <= 15 ? 5 : 4)
        : (accuracyRate >= 80 ? 2 : accuracyRate >= 60 ? 1 : 0);
      await updateReviewMutation.mutateAsync({
        questionId: question.id,
        quality,
      });

      // 표 문제 안정도 팝업
      const tableScoreData = { isCorrect: score === total, similarityScore: Math.round((score / total) * 100) };
      triggerConfidencePopup(tableScoreData);
      return;
    }

    // 이미지 문제인 경우 라벨 답안 확인
    if (isImageQuestion) {
      const hasAllAnswers = imageLabels.every((_: any, index: number) => 
        imageLabelAnswers[index]?.trim()
      );
      if (!hasAllAnswers) {
        toast.error("모든 영역의 답안을 입력하세요");
        return;
      }
      // 라벨 답안을 합쳐서 전송
      const combinedAnswer = imageLabels.map((_: any, index: number) => 
        `${index + 1}. ${imageLabelAnswers[index]}`
      ).join("\n");
      if (isDemo) {
        await demoEvaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: combinedAnswer,
          recallTime,
        });
      } else {
        await evaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: combinedAnswer,
          recallTime,
        });
      }
    } else {
      // 텍스트 문제인 경우
      if (!userAnswer.trim()) {
        toast.error("답안을 입력하세요");
        return;
      }
      if (isDemo) {
        await demoEvaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: userAnswer.trim(),
          recallTime,
        });
      } else {
        await evaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: userAnswer.trim(),
          recallTime,
        });
        // 타이핑 속도 데이터 기록
        if (typingStartTimeRef.current !== null) {
          const typingEndTime = Date.now();
          recordAttemptMutation.mutate({
            questionId: question.id,
            answerLength: question.answer?.length ?? 0,
            inputChars: inputCharsRef.current,
            timeToFirstKey: timeToFirstKeyRef.current ?? 0,
            typingStartTime: typingStartTimeRef.current,
            typingEndTime,
            backspaceCount: backspaceCountRef.current,
            pasteDetected: pasteDetectedRef.current,
            mode: "exam",
          });
        }
      }
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.success("녹음 시작");
    } catch (error) {
      toast.error("마이크 접근 실패");
      console.error(error);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast.success("녹음 완료");
    }
  };

  const handleTranscribe = async () => {
    if (!audioBlob) {
      toast.error("녹음된 음성이 없습니다");
      return;
    }

    try {
      // Upload audio to S3
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");
      
      const uploadResponse = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        throw new Error("음성 파일 업로드 실패");
      }
      
      const { audioUrl } = await uploadResponse.json();
      await transcribeMutation.mutateAsync({ audioUrl });
    } catch (error) {
      console.error(error);
      toast.error("음성 처리 중 오류가 발생했습니다");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const speedBonusText = speedBonus && speedBonus.bonus > 0
    ? `⚡ 속도 보너스 +${speedBonus.bonus} (${speedBonus.label === "great" ? "매우 빠름" : "빠름"})`
    : null;

  const canSubmitNow = () => {
    if (evaluateMutation.isPending) return false;
    if (isTableQuestion && tableData) {
      return getBlankCells(tableData).every((key) => tableAnswers[key]?.trim());
    }
    if (isImageQuestion) {
      return imageLabels.every((_: any, index: number) => imageLabelAnswers[index]?.trim());
    }
    return userAnswer.trim().length > 0;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const keyLower = e.key.toLowerCase();
    const hasPrimaryModifier = e.ctrlKey || e.metaKey;

    const pushAnswerHistory = (nextValue: string) => {
      const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
      if (newHistory[newHistory.length - 1] !== nextValue) {
        newHistory.push(nextValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      setAnswerHistory(newHistory);
      setAnswerHistoryIndex(Math.max(0, newHistory.length - 1));
    };

    // Shift+Enter: 즉시 제출
    if (e.key === "Enter" && e.shiftKey && !hasPrimaryModifier && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      if (canSubmitNow()) {
        void handleSubmit();
      }
      return;
    }

    // Cmd/Ctrl+Z: Undo
    if (hasPrimaryModifier && !e.shiftKey && !e.altKey && keyLower === "z") {
      e.preventDefault();
      e.stopPropagation();
      
      if (answerHistoryIndex > 0) {
        const newIndex = answerHistoryIndex - 1;
        setAnswerHistoryIndex(newIndex);
        setUserAnswer(answerHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(answerHistory[newIndex].length, answerHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Redo:
    // - Mac: Cmd+Shift+Z
    // - Windows/Linux: Ctrl+Shift+Z 또는 Ctrl+Y
    const isRedoShortcut =
      (hasPrimaryModifier && e.shiftKey && !e.altKey && keyLower === "z") ||
      (!isMacPlatform && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && keyLower === "y");
    if (isRedoShortcut) {
      e.preventDefault();
      e.stopPropagation();
      
      if (answerHistoryIndex < answerHistory.length - 1) {
        const newIndex = answerHistoryIndex + 1;
        setAnswerHistoryIndex(newIndex);
        setUserAnswer(answerHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(answerHistory[newIndex].length, answerHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Shift+Backspace: 현재 커서 줄 삭제 (Mac Option+Shift+Backspace 포함)
    if (e.key === "Backspace" && e.shiftKey && !hasPrimaryModifier) {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing;

      const applyDeleteLine = () => {
        const currentValue = textarea.value;
        const selectionStart = textarea.selectionStart ?? currentValue.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const { nextValue, nextCursor } = deleteCurrentLineAtCursor(
          currentValue,
          selectionStart,
          selectionEnd
        );
        setUserAnswer(nextValue);
        pushAnswerHistory(nextValue);

        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      };

      if (composing) {
        textarea.blur();
        setTimeout(applyDeleteLine, 10);
      } else {
        applyDeleteLine();
      }
      return;
    }
    
    // Alt/Option+Backspace: 현재 커서 기준 이전 단어 삭제
    if (e.key === "Backspace" && e.altKey && !e.shiftKey && !hasPrimaryModifier) {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing;

      const applyDeleteWord = () => {
        const currentValue = textarea.value;
        const selectionStart = textarea.selectionStart ?? currentValue.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const { nextValue, nextCursor } = deleteWordBeforeCursor(
          currentValue,
          selectionStart,
          selectionEnd
        );
        setUserAnswer(nextValue);
        pushAnswerHistory(nextValue);

        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      };

      if (composing) {
        textarea.blur();
        setTimeout(applyDeleteWord, 10);
      } else {
        applyDeleteWord();
      }
      return;
    }
  };

  // Render mistake highlights
  const renderMistakes = () => {
    if (!result?.mistakeHighlights) return null;

    try {
      const mistakes = JSON.parse(result.mistakeHighlights);
      return (
        <div className="space-y-2">
          {mistakes.map((mistake: any, index: number) => (
            <div key={index} className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-800/40 dark:bg-rose-950/20">
              <p className="text-sm font-medium text-rose-900 dark:text-rose-200">
                위치: {mistake.position} | 유형: {mistake.type}
              </p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{mistake.description}</p>
            </div>
          ))}
        </div>
      );
    } catch {
      return <p className="text-sm text-muted-foreground">오류 분석 데이터 없음</p>;
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (!question) {
    return (
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>문제를 찾을 수 없습니다</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setLocation("/")}>메인으로</Button>
        </CardContent>
      </Card>
    );
  }

  const isSubmitDisabled = !canSubmitNow();

  return (
    <div className="relative space-y-6">
      <ConfidencePopup
        show={showConfidencePopup}
        previousScore={confidenceBefore}
        currentScore={confidenceAfter}
        onComplete={() => setShowConfidencePopup(false)}
      />
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/questions/${question.subjectId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">시험 모드</h1>
          <p className="text-muted-foreground mt-1">문제를 보고 답안을 작성하세요</p>
        </div>
      </div>

      {/* Question - 시험 시작 전에만 표시 */}
      {!isStarted && (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>문제</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-lg whitespace-pre-wrap">{question.question}</p>
            {isTableQuestion && tableData && (
              <div className="mt-4">
                <TableView
                  tableData={tableData}
                  showAnswers={true}
                  readOnly={true}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  빈칸 {getBlankCells(tableData).length}개를 채워야 합니다. 시작 버튼을 누르면 빈칸이 가려집니다.
                </p>
              </div>
            )}
            {isImageQuestion && (
              <div className="relative w-full">
                {!imageLoaded && (
                  <div className="w-full min-h-[300px] md:min-h-[400px] bg-muted animate-pulse rounded-lg border-2 border-border flex items-center justify-center">
                    <p className="text-muted-foreground">이미지 로딩 중...</p>
                  </div>
                )}
                <img
                  src={question.imageUrl || ""}
                  alt="Question image"
                  className={`w-full h-auto rounded-lg border-2 border-border ${!imageLoaded ? 'hidden' : ''}`}
                  onLoad={() => setImageLoaded(true)}
                  loading="eager"
                  fetchPriority="high"
                />
                {/* 암기 시간에 라벨 영역 표시 (완전 불투명 박스로 가리기) */}
                {imageLoaded && !isStarted && imageLabels.map((label: any, index: number) => (
                  <div
                    key={index}
                    className="absolute bg-black border-2 border-primary flex items-center justify-center"
                    style={{
                      left: `${label.x}%`,
                      top: `${label.y}%`,
                      width: `${label.width}%`,
                      height: `${label.height}%`,
                    }}
                  >
                    <span className="text-white font-bold text-2xl">{index + 1}</span>
                  </div>
                ))}
                {imageAttribution && (
                  <div className="mt-3 text-[10px] text-muted-foreground/75 space-y-0.5 border-t border-border/50 pt-2 select-none">
                    {imageAttribution.lines.map((line, index) =>
                      line.href ? (
                        <p key={`${line.text}-${index}`}>
                          <a
                            href={line.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:underline underline-offset-2"
                          >
                            {line.text}
                          </a>
                        </p>
                      ) : (
                        <p key={`${line.text}-${index}`}>{line.text}</p>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      {!isStarted ? (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>시험 시작</CardTitle>
            <CardDescription>준비되면 시작 버튼을 눌러주세요</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleStart} className="gap-2">
              <Play className="h-4 w-4" />
              시작
            </Button>
          </CardContent>
        </Card>
      ) : !isSubmitted ? (
        <>
          <Card className="shadow-elegant">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>답안 작성</CardTitle>
                  <CardDescription>기억나는 대로 답안을 작성하세요</CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{formatTime(recallTime)}</p>
                  <p className="text-sm text-muted-foreground">경과 시간</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 문제 텍스트 표시 */}
              <div className="p-4 bg-muted/30 rounded-lg border">
                <p className="text-sm font-semibold text-muted-foreground mb-2">문제</p>
                <p className="text-base whitespace-pre-wrap">{question.question}</p>
              </div>

              {isTableQuestion && tableData ? (
                <div className="space-y-4">
                  <TableView
                    tableData={tableData}
                    answers={tableAnswers}
                    onAnswerChange={(key, value) => {
                      setTableAnswers((prev) => ({ ...prev, [key]: value }));
                    }}
                  />
                </div>
              ) : isImageQuestion ? (
                <div className="space-y-4">
                  {/* 이미지 표시 (불투명 박스로 라벨 영역 표시) */}
                  <div className="relative w-full">
                    <img
                      src={question.imageUrl || ""}
                      alt="Question image"
                      className="w-full h-auto rounded-lg border-2 border-border"
                      loading="eager"
                      fetchPriority="high"
                    />
                    {/* 불투명 박스로 라벨 영역 표시 */}
                    {imageLabels.map((label: any, index: number) => (
                      <div
                        key={index}
                        className="absolute bg-black border-2 border-primary flex items-center justify-center"
                        style={{
                          left: `${label.x}%`,
                          top: `${label.y}%`,
                          width: `${label.width}%`,
                          height: `${label.height}%`,
                        }}
                      >
                        <span className="text-white font-bold text-2xl">{index + 1}</span>
                      </div>
                    ))}
                  </div>
                  {/* 라벨별 입력 필드 */}
                  <div className="space-y-3">
                    {imageLabels.map((label: any, index: number) => (
                      <div key={index} className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-primary min-w-[24px]">{index + 1}.</span>
                        <input
                          type="text"
                          value={imageLabelAnswers[index] || ""}
                          onChange={(e) => setImageLabelAnswers({ ...imageLabelAnswers, [index]: e.target.value })}
                          className="flex-1 px-3 py-2 rounded-lg border-2 border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="정답 입력"
                          autoFocus={index === 0}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Textarea
                    ref={textareaRef}
                    autoFocus
                    value={userAnswer}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      const now = Date.now();
                      if (typingStartTimeRef.current === null && newValue.length > 0) {
                        typingStartTimeRef.current = now;
                        if (startTime !== null && timeToFirstKeyRef.current === null) {
                          timeToFirstKeyRef.current = now - startTime;
                        }
                      }
                      inputCharsRef.current = newValue.length;
                      setUserAnswer(newValue);

                      const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
                      newHistory.push(newValue);
                      if (newHistory.length > 50) {
                        newHistory.shift();
                      }
                      setAnswerHistory(newHistory);
                      setAnswerHistoryIndex(newHistory.length - 1);
                    }}
                    onPaste={() => { pasteDetectedRef.current = true; }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace') backspaceCountRef.current++;
                      handleKeyDown(e);
                    }}
                    placeholder="기억나는 답안을 큰 흐름부터 써보세요"
                    rows={7}
                    className="min-h-[180px] rounded-xl border-2 border-border bg-muted/10 px-5 py-4 text-xl font-semibold leading-[1.85] tracking-tight placeholder:text-sm placeholder:font-normal placeholder:tracking-normal"
                  />
                  <p className="text-xs text-muted-foreground/85">제출: Shift+Enter</p>
                </>
              )}

              {!isImageQuestion && (
                <>
                  <Separator />

                  <div className="space-y-3">
                    <p className="text-sm font-medium">음성 입력</p>
                <div className="flex gap-2">
                  {!isRecording ? (
                    <Button
                      onClick={handleStartRecording}
                      variant="outline"
                      className="gap-2"
                    >
                      <Mic className="h-4 w-4" />
                      녹음 시작
                    </Button>
                  ) : (
                    <Button
                      onClick={handleStopRecording}
                      variant="destructive"
                      className="gap-2"
                    >
                      <MicOff className="h-4 w-4" />
                      녹음 중지
                    </Button>
                  )}
                  {audioBlob && (
                    <Button
                      onClick={handleTranscribe}
                      variant="outline"
                      disabled={transcribeMutation.isPending}
                    >
                      {transcribeMutation.isPending ? "변환 중..." : "텍스트 변환"}
                    </Button>
                  )}
                  </div>
                </div>

                <Separator />
              </>
              )}

              {isImageQuestion && <Separator />}

              <div className="flex gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitDisabled}
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  {evaluateMutation.isPending ? "평가 중..." : "제출"}
                </Button>
                <Button onClick={handleReset} variant="outline" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  다시 시작
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Results */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle>평가 결과</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {isTableQuestion && tableScore ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-3xl font-bold">
                        {tableScore.score === tableScore.total ? "✓" : "✗"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">정답 여부</p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-3xl font-bold">{tableScore.score}/{tableScore.total}</p>
                      <p className="text-sm text-muted-foreground mt-1">정답 수</p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-3xl font-bold">{formatTime(recallTime)}</p>
                      <p className="text-sm text-muted-foreground mt-1">회상 시간</p>
                      {speedBonusText && <p className="text-xs font-bold text-blue-500 mt-1">{speedBonusText}</p>}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-semibold">정답 비교</h3>
                    {tableData && (
                      <TableView
                        tableData={tableData}
                        answers={tableAnswers}
                        results={tableResults || undefined}
                        showAnswers={true}
                        readOnly={true}
                      />
                    )}
                  </div>
                </>
              ) : (
              <>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">
                    {result?.isCorrect ? "✓" : "✗"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">정답 여부</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{result?.correctLineCount ?? '?'}/{result?.totalLines ?? '?'}</p>
                  <p className="text-sm text-muted-foreground mt-1">정확도</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{result?.similarityScore ?? 0}%</p>
                  <p className="text-sm text-muted-foreground mt-1">유사도</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{formatTime(recallTime)}</p>
                  <p className="text-sm text-muted-foreground mt-1">회상 시간</p>
                  {speedBonusText && <p className="text-xs font-bold text-blue-500 mt-1">{speedBonusText}</p>}
                </div>
              </div>

              {result?.mistakeHighlights && (
                <div className="space-y-2">
                  <h3 className="font-semibold">자주 틀린 부분</h3>
                  {renderMistakes()}
                </div>
              )}

              {result?.llmFeedback && (
                <div className="space-y-2">
                  <h3 className="font-semibold">AI 피드백</h3>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <Streamdown>{result.llmFeedback}</Streamdown>
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-3">
                <h3 className="font-semibold">정답 비교</h3>
                {isImageQuestion ? (
                  <div className="space-y-2">
                    {result?.mistakes && result.mistakes.map((mistake: any) => (
                      <div key={mistake.labelIndex} className={`rounded-lg border p-3 ${mistake.isCorrect ? 'border-green-300 bg-green-50 dark:border-green-800/60 dark:bg-green-950/30' : 'border-rose-300 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/20'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold">라벨 {mistake.labelIndex}</span>
                          <span className={`text-lg ${mistake.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-rose-700 dark:text-rose-300'}`}>{mistake.isCorrect ? '✓' : '✗'}</span>
                        </div>
                        <div className="text-xs space-y-1">
                          <div><span className="font-semibold">정답:</span> {mistake.correctAnswer}</div>
                          <div className={mistake.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-rose-700 dark:text-rose-300'}><span className="font-semibold">내 답:</span> {mistake.userAnswer || '(입력 없음)'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/45" />
                        일치한 부분
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-900/45" />
                        내 답에서 다른 부분
                      </span>
                    </div>
                    {result?.mistakes && result.mistakes.length > 0 ? (
                      // Line-by-line comparison for multi-line text questions
                      result.mistakes.map((mistake: any) => {
                        const { correctMatched, answerMatched } = getMatchedPositions(
                          mistake.correctAnswer || "",
                          mistake.userAnswer || "",
                          mistake.compareMode
                        );
                        return (
                          <div key={mistake.lineIndex} className={`rounded-lg border p-3 ${mistake.isCorrect ? 'border-green-300 bg-green-50 dark:border-green-800/60 dark:bg-green-950/30' : 'border-rose-300 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/20'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold">{mistake.lineIndex}번째 줄</span>
                              <span className={`text-lg ${mistake.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-rose-700 dark:text-rose-300'}`}>{mistake.isCorrect ? '✓' : '✗'}</span>
                            </div>
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span>점수 {mistake.lineScore ?? 0}점</span>
                              {typeof mistake.matchedUserLineIndex === "number" && (
                                <span>입력 {mistake.matchedUserLineIndex}번째 줄 매칭</span>
                              )}
                              <span>{mistake.compareMode === "word" ? "영어 단어 단위 채점" : "문자열 채점"}</span>
                            </div>
                            <div className="text-xs space-y-1">
                              <div>
                                <span className="font-semibold">정답:</span>{" "}
                                {renderComparedText(mistake.correctAnswer || "", correctMatched, "correct")}
                              </div>
                              <div className={mistake.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-rose-700 dark:text-rose-300'}>
                                <span className="font-semibold">내 답:</span>{" "}
                                {mistake.userAnswer
                                  ? renderComparedText(mistake.userAnswer, answerMatched, "answer")
                                  : "(입력 없음)"}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // Fallback for single-line or old format
                      <>
                        {(() => {
                          const { correctMatched, answerMatched } = getMatchedPositions(
                            question?.answer || "",
                            userAnswer || ""
                          );
                          return (
                            <>
                        <div className="rounded-lg border border-green-300 bg-green-50 p-3 dark:border-green-800/60 dark:bg-green-950/30">
                          <p className="text-xs font-semibold text-muted-foreground mb-1">정답</p>
                          <p className="text-sm font-medium whitespace-pre-wrap">
                            {renderComparedText(question?.answer || "", correctMatched, "correct")}
                          </p>
                        </div>
                        <div className={`rounded-lg border p-3 ${result?.isCorrect ? 'border-green-300 bg-green-50 dark:border-green-800/60 dark:bg-green-950/30' : 'border-rose-300 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/20'}`}>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">내 답</p>
                          <p className={`text-sm font-medium whitespace-pre-wrap ${result?.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-rose-700 dark:text-rose-300'}`}>
                            {renderComparedText(userAnswer || "", answerMatched, "answer")}
                          </p>
                        </div>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleReset} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  다시 풀기
                </Button>
                <Button
                  onClick={() => setLocation(`/questions/${question.subjectId}`)}
                  variant="outline"
                >
                  문제 목록으로
                </Button>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}
