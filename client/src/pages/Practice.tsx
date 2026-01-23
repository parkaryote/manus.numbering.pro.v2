import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef } from "react";
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
  const [practiceNote, setPracticeNote] = useState(""); // 연습용 메모장
  const [isFadingOut, setIsFadingOut] = useState(false); // fade out 애니메이션 상태
  const [practiceCount, setPracticeCount] = useState(0); // 연습 횟수
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastInputRef = useRef<string>(""); // 마지막 입력값 추적 (모바일용)

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

  // Global keyboard event listener for ESC and Ctrl+Enter
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // ESC or Ctrl+Enter: Complete and save
      if (e.key === "Escape" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        handleComplete();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [question, userInput, imageLabelAnswers, revealedLabels, elapsedTime, createSession]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newInput = e.target.value;
    setUserInput(newInput);
    setLastInputTime(Date.now());
    lastInputRef.current = newInput;

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeText(newInput);
    const normalizedTarget = normalizeText(targetText);
    if (normalized === normalizedTarget) {
      handleCorrectAnswer();
    }
  };



  // 띄어쓰기 입력 시 강제 리렌더링을 위한 트리거
  const renderTrigger = useMemo(() => {
    return userInput[userInput.length - 1] === ' ' ? Date.now() : null;
  }, [userInput]);

  const practiceCountDisplay = useMemo(() => {
    return practiceCount;
  }, [practiceCount]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Esc: Complete and save
    if ((e.ctrlKey && e.key === "Enter") || e.key === "Escape") {
      e.preventDefault();
      handleComplete();
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    // 모바일에서 compositionEnd 이벤트가 발생하지 않을 수 있으므로
    // input 이벤트에서 이미 처리됨
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

  // 정답 일치 시 fade out 애니메이션 후 입력 초기화
  const handleCorrectAnswer = () => {
    setIsFadingOut(true);
    setPracticeCount(prev => prev + 1);
    
    // 1.5초 후 입력 초기화 및 fade out 상태 해제
    setTimeout(() => {
      setUserInput("");
      setIsFadingOut(false);
      textareaRef.current?.focus();
    }, 1500);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // 채점된 글자 수 계산 - 모바일 호환성을 위해 input 이벤트 기반으로 변경
  // 마지막 글자는 회색으로 유지하되, 띄어쓰기 후에는 즉시 채점 반영
  const getCompletedLength = useMemo(() => {
    const normalized = normalizeText(userInput);
    const lastChar = userInput[userInput.length - 1];
    
    // 마지막 입력이 띄어쓰기인 경우, 정규화된 길이 전체를 반환
    if (lastChar === ' ') {
      return normalized.length;
    }
    
    // 마지막 글자는 조합 중일 수 있으므로 회색으로 표시
    return Math.max(0, normalized.length - 1);
  }, [userInput, targetText]);

  // Render each character with visual feedback
  const renderTextWithFeedback = useMemo(() => {
    const normalizedInput = normalizeText(userInput);
    const normalizedTarget = normalizeText(targetText);
    const targetChars = targetText.split("");
    let inputIndex = 0;
    const completedLength = getCompletedLength;

    return targetChars.map((char, targetIndex) => {
      // Skip spaces and newlines in target for comparison
      if (char === " " || char === "\n") {
        return (
          <span key={targetIndex} className="text-muted-foreground">
            {char === "\n" ? "\n" : " "}
          </span>
        );
      }

      const currentChar = normalizedInput[inputIndex];
      const isTyped = inputIndex < normalizedInput.length;
      
      // 채점 완료된 글자만 색상 표시
      const isCompleted = inputIndex < completedLength;
      const isCorrect = isCompleted && isTyped && currentChar === normalizedTarget[inputIndex];
      const isError = isCompleted && isTyped && currentChar !== normalizedTarget[inputIndex];
      
      // 언더바는 completedLength 위치에 표시 (정답 글자 다음)
      const isNext = inputIndex === completedLength;

      inputIndex++;

      let className = "text-gray-400 relative font-semibold text-xl"; // Default: not typed yet
      
      if (isNext) {
        // 다음 입력 위치: 두꺼운 언더바 + 깜빡이는 커서
        className = "border-b-4 border-gray-600 text-gray-400 relative font-semibold text-xl animate-pulse";
      } else if (isCorrect) {
        // 정답: 검은색 또는 fade out 중이면 회색
        className = isFadingOut ? "text-gray-400 relative font-semibold text-xl transition-colors duration-1500" : "text-foreground relative font-semibold text-xl";
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
  }, [userInput, targetText, getCompletedLength, renderTrigger, isFadingOut]);

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
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold">{practiceCountDisplay}</p>
            <p className="text-xs text-muted-foreground">연습 횟수</p>
          </div>
          <div className="flex items-center gap-2">
            <Circle
              className={`h-3 w-3 ${isActive ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}`}
            />
            <span className="text-sm text-muted-foreground">
              {isActive ? "측정 중" : "중단됨"}
            </span>
          </div>
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
            /* Image question with label boxes - 2 column layout */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Image with labels */}
              <div className="space-y-4">
                <div className="relative w-full">
                  {!imageLoaded && (
                    <div className="flex items-center justify-center min-h-[300px] md:min-h-[400px] bg-muted/30 rounded-lg border-2 border-border">
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
              </div>

              {/* Right: Practice note */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground">
                  타이핑 연습용 메모장
                </label>
                <textarea
                  value={practiceNote}
                  onChange={(e) => setPracticeNote(e.target.value)}
                  onPaste={(e) => e.preventDefault()}
                  className="w-full h-[400px] p-4 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="여기에 답안을 연습해보세요... (저장되지 않습니다)"
                />
              </div>
            </div>
          ) : (
            /* Text question with visual feedback */
            <>
              <div className="p-6 bg-muted/30 rounded-lg border-2 border-border">
                <div className="leading-relaxed whitespace-pre-wrap">
                  {renderTextWithFeedback}
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={userInput}
                onChange={handleInputChange}
                onPaste={(e) => e.preventDefault()}
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
            <div>Ctrl+Enter 또는 Esc: 연습 완료</div>
            <Button onClick={handleComplete} disabled={createSession.isPending}>
              {createSession.isPending ? "저장 중..." : "완료"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
