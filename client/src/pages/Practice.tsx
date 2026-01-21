import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface PracticeProps {
  questionId: number;
}

export default function Practice({ questionId }: PracticeProps) {
  const [, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, string>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [revealedLabels, setRevealedLabels] = useState<Set<number>>(new Set()); // 클릭하여 공개된 라벨
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isActive, setIsActive] = useState(true); // 측정 중 여부
  const [lastInputTime, setLastInputTime] = useState<number>(Date.now());
  const [isComposing, setIsComposing] = useState(false); // 한글 조합 중
  const [completedLength, setCompletedLength] = useState(0); // 조합이 완료된 글자 길이
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const createSession = trpc.practice.create.useMutation({
    onSuccess: () => {
      toast.success("연습 기록이 저장되었습니다");
      setLocation(`/questions/${question?.subjectId || 1}`);
    },
  });

  const targetText = question?.answer || "";
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;

  // Normalize text: remove all spaces for comparison
  const normalizeText = (text: string) => text.replace(/\s+/g, "");

  // Auto-start on mount
  useEffect(() => {
    if (question && !startTime) {
      setStartTime(Date.now());
      textareaRef.current?.focus();
    }
  }, [question]);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isActive && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, startTime]);

  // Inactivity detection (1 minute)
  useEffect(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    if (isActive) {
      inactivityTimerRef.current = setTimeout(() => {
        setIsActive(false);
        toast.info("1분간 입력이 없어 측정이 중단되었습니다");
      }, 60000); // 1 minute
    }

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [lastInputTime, isActive]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newInput = e.target.value;
    setUserInput(newInput);
    setLastInputTime(Date.now());

    // 삭제 시 completedLength도 업데이트
    const normalized = normalizeText(newInput);
    if (normalized.length < completedLength) {
      setCompletedLength(normalized.length);
    }

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }

    // Auto-complete when normalized text matches
    if (normalized === normalizeText(targetText)) {
      handleComplete();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter: Complete
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleComplete();
    }
    // Esc: Go back
    if (e.key === "Escape") {
      e.preventDefault();
      setLocation(`/questions/${question?.subjectId || 1}`);
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
    // 조합 종료 시 현재 입력 길이를 완료된 길이로 저장
    const normalized = normalizeText(userInput);
    setCompletedLength(normalized.length);
  };

  const handleComplete = async () => {
    if (!question || elapsedTime === 0) return;

    const timeInMinutes = elapsedTime / 60;
    const speed = timeInMinutes > 0 ? Math.round(userInput.length / timeInMinutes) : 0;

    await createSession.mutateAsync({
      questionId: question.id,
      duration: elapsedTime,
      typingSpeed: speed,
      accuracy: 100, // Not tracking accuracy anymore
      errorCount: 0, // Not tracking errors anymore
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Render each character with visual feedback
  const renderTextWithFeedback = () => {
    const normalizedInput = normalizeText(userInput);
    const normalizedTarget = normalizeText(targetText);
    const targetChars = targetText.split("");
    let inputIndex = 0;

    return targetChars.map((char, targetIndex) => {
      // Skip spaces in target for comparison
      if (char === " ") {
        return (
          <span key={targetIndex} className="text-muted-foreground">
            {" "}
          </span>
        );
      }

      const currentChar = normalizedInput[inputIndex];
      const isTyped = inputIndex < normalizedInput.length;
      
      // 조합이 완료된 글자만 채점
      const isCompleted = inputIndex < completedLength;
      const isCorrect = isCompleted && isTyped && currentChar === normalizedTarget[inputIndex];
      const isError = isCompleted && isTyped && currentChar !== normalizedTarget[inputIndex];
      
      // 언더바는 다음 입력할 글자에 표시
      const isNext = inputIndex === normalizedInput.length;

      inputIndex++;

      let className = "text-gray-400 relative font-semibold text-xl"; // Default: not typed yet
      
      if (isNext && !isComposing) {
        // 다음 입력 위치: 두꺼운 언더바 + 깜빡이는 커서
        className = "border-b-4 border-gray-600 text-gray-400 relative font-semibold text-xl animate-pulse";
      } else if (isCorrect) {
        // 정답: 검은색
        className = "text-foreground relative font-semibold text-xl";
      } else if (isError) {
        // 오답: 빨간색
        className = "text-red-500 relative font-semibold text-xl";
      } else if (isTyped) {
        // 조합 중이거나 아직 채점 전: 회색
        className = "text-gray-400 relative font-semibold text-xl";
      }

      return (
        <span key={targetIndex} className={className}>
          {char}
        </span>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation(`/subjects`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <Card className="shadow-elegant">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">로딩 중...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation(`/subjects`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <Card className="shadow-elegant">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">문제를 찾을 수 없습니다</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation(`/questions/${question?.subjectId || 1}`)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <div className="flex items-center gap-2">
          <Circle
            className={`h-3 w-3 ${isActive ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}`}
          />
          <span className="text-sm text-muted-foreground">
            {isActive ? "측정 중" : "중단됨"}
          </span>
        </div>
      </div>

      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>{question.question}</CardTitle>
          <CardDescription>
            {isImageQuestion ? "이미지의 표시된 영역에 정답을 입력하세요" : "정답을 따라 입력하세요 (띄어쓰기 무시)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isImageQuestion ? (
            /* Image question - flashcard mode only */
            <div className="space-y-4">
              <div className="relative inline-block">
                {!imageLoaded && (
                  <div className="w-full h-64 bg-muted animate-pulse rounded-lg border-2 border-border flex items-center justify-center">
                    <p className="text-muted-foreground">이미지 로딩 중...</p>
                  </div>
                )}
                <img
                  src={question.imageUrl || ""}
                  alt="Question image"
                  className={`max-w-full h-auto rounded-lg border-2 border-border ${!imageLoaded ? 'hidden' : ''}`}
                  onLoad={() => setImageLoaded(true)}
                  loading="lazy"
                />
                {imageLabels.map((label: any, index: number) => {
                  const isRevealed = revealedLabels.has(index);
                  return (
                    <div
                      key={index}
                      className={`absolute border-2 transition-all cursor-pointer ${
                        isRevealed
                          ? "border-transparent bg-transparent"
                          : "border-primary bg-black hover:bg-black/90"
                      }`}
                      style={{
                        left: `${label.x}%`,
                        top: `${label.y}%`,
                        width: `${label.width}%`,
                        height: `${label.height}%`,
                      }}
                      onClick={() => {
                        const newRevealed = new Set(revealedLabels);
                        if (isRevealed) {
                          newRevealed.delete(index);
                        } else {
                          newRevealed.add(index);
                        }
                        setRevealedLabels(newRevealed);
                      }}
                    >
                      {!isRevealed && (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-white font-bold text-2xl">{index + 1}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 정답 목록 (이미지 외부에 표시) */}
              <div className="p-4 bg-muted/50 rounded-lg border space-y-2">
                <p className="text-sm font-semibold text-muted-foreground mb-3">
                  박스를 클릭하여 정답을 확인하세요 ({revealedLabels.size}/{imageLabels.length})
                </p>
                {imageLabels.map((label: any, index: number) => {
                  const isRevealed = revealedLabels.has(index);
                  return (
                    <div key={index} className="flex items-start gap-3 p-2 rounded bg-background/50">
                      <span className="text-sm font-semibold text-primary min-w-[24px] mt-0.5">{index + 1}.</span>
                      <span className={`text-sm flex-1 ${
                        isRevealed ? "text-foreground font-medium" : "text-muted-foreground"
                      }`}>
                        {isRevealed ? label.answer : "●●●●●"}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* 플래시카드 모드 only - 위에 이미 표시됨 */}
            </div>
          ) : (
            /* Text question with visual feedback */
            <>
              <div className="p-6 bg-muted/30 rounded-lg border-2 border-border">
                <div className="leading-relaxed whitespace-pre-wrap">
                  {renderTextWithFeedback()}
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={userInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                className="w-full min-h-[120px] p-4 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground"
                placeholder="여기에 입력하세요..."
                autoFocus
              />
            </>
          )}

          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <div>Ctrl+Enter: 완료 | Esc: 나가기</div>
            <Button onClick={handleComplete} disabled={createSession.isPending}>
              {createSession.isPending ? "저장 중..." : "완료"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
