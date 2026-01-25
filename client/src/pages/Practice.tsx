import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { splitGraphemes, isPartialMatch, isHangul, decomposeHangul } from "@/lib/hangul";

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
  const [showShortcutHelp, setShowShortcutHelp] = useState(() => {
    const saved = localStorage.getItem("showShortcutHelp");
    return saved !== null ? saved === "true" : true;
  });
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
    const newValue = e.target.value;
    setUserInput(newValue);
    setLastInputTime(Date.now());
    lastInputRef.current = newValue;

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeText(newValue);
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

  const toggleShortcutHelp = () => {
    const newValue = !showShortcutHelp;
    setShowShortcutHelp(newValue);
    localStorage.setItem("showShortcutHelp", String(newValue));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Esc: Complete and save
    if ((e.ctrlKey && e.key === "Enter") || e.key === "Escape") {
      e.preventDefault();
      handleComplete();
      return;
    }
    
    // Shift+Backspace: 문장 삭제 (마지막 줄 삭제)
    if (e.shiftKey && !e.altKey && !e.ctrlKey && e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing || isComposing;
      
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };
      
      if (composing) {
        textarea.blur();
        setTimeout(() => {
          setUserInput(deleteLine(textarea.value));
          textarea.focus();
        }, 10);
      } else {
        setUserInput(deleteLine(textarea.value));
      }
      return;
    }
    
    // Alt+Backspace: 띄어쓰기 단위 단어 삭제
    if (e.altKey && !e.shiftKey && !e.ctrlKey && e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      
      // 한글 조합 중인지 확인 (nativeEvent.isComposing 또는 state)
      const composing = e.nativeEvent.isComposing || isComposing;
      
      if (composing) {
        // 조합 중일 때: blur로 조합 강제 종료 후 삭제
        textarea.blur();
        
        // blur 후 약간의 지연 후 삭제 처리
        setTimeout(() => {
          const currentValue = textarea.value;
          const trimmed = currentValue.trimEnd();
          const lastSpaceIndex = trimmed.lastIndexOf(" ");
          
          let newValue: string;
          if (lastSpaceIndex === -1) {
            newValue = "";
          } else {
            newValue = currentValue.substring(0, lastSpaceIndex + 1);
          }
          
          setUserInput(newValue);
          textarea.focus();
        }, 10);
      } else {
        // 조합 중이 아닐 때: 즉시 삭제
        const currentValue = textarea.value;
        const trimmed = currentValue.trimEnd();
        const lastSpaceIndex = trimmed.lastIndexOf(" ");
        
        let newValue: string;
        if (lastSpaceIndex === -1) {
          newValue = "";
        } else {
          newValue = currentValue.substring(0, lastSpaceIndex + 1);
        }
        
        setUserInput(newValue);
      }
      return;
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

  // 한컴타자연습 스타일 채점 로직:
  // 1. 조합 중인 글자도 정답의 일부이면 검은색
  // 2. 종성 예약: 다음 글자의 초성과 일치하면 정답
  // 3. 언더바는 글자가 완성된 후에만 이동
  // 4. partial_complete: 겹받침 조합 중이지만 현재 글자는 완성됨 (언더바 다음 글자로)
  const completionInfo = useMemo(() => {
    const userChars = splitGraphemes(normalizeText(userInput));
    const targetChars = splitGraphemes(normalizeText(targetText));
    
    // 완성된 글자 수 계산 (언더바 위치 결정용)
    let completedCount = 0;
    
    for (let i = 0; i < userChars.length && i < targetChars.length; i++) {
      const userChar = userChars[i];
      const targetChar = targetChars[i];
      const nextTargetChar = targetChars[i + 1];
      
      const matchResult = isPartialMatch(userChar, targetChar, nextTargetChar);
      
      if (matchResult === 'complete' || matchResult === 'partial_complete') {
        // complete: 완전 일치
        // partial_complete: 겹받침 조합 중이지만 현재 글자는 완성됨 ("묽" -> "물")
        completedCount = i + 1;
      } else if (matchResult === 'partial') {
        // 조합 중: 언더바는 현재 위치에 유지
        completedCount = i;
        break;
      } else {
        // 오답: 언더바는 다음 글자로 이동
        completedCount = i + 1;
      }
    }
    
    // 사용자 입력이 정답보다 길 경우: 언더바는 정답 끝에 유지
    if (userChars.length > targetChars.length) {
      completedCount = targetChars.length;
    }
    
    // 마지막 글자가 조합 중인지 확인
    const lastUserChar = userChars[userChars.length - 1];
    const lastTargetChar = targetChars[userChars.length - 1];
    const nextTargetChar = targetChars[userChars.length];
    const lastMatchResult = lastUserChar && lastTargetChar 
      ? isPartialMatch(lastUserChar, lastTargetChar, nextTargetChar)
      : null;
    const isLastCharPartial = lastMatchResult === 'partial' || lastMatchResult === 'partial_complete';
    
    return { completedCount, userChars, targetChars, isLastCharPartial, lastCharMatchResult: lastMatchResult };
  }, [userInput, targetText, renderTrigger]);

  // 한컴타자연습 스타일 렌더링
  const renderTextWithFeedback = useMemo(() => {
    const { completedCount, userChars, targetChars: targetCharsNormalized, isLastCharPartial, lastCharMatchResult } = completionInfo;
    const targetChars = targetText.split("");
    let inputIndex = 0;

    return targetChars.map((char, targetIndex) => {
      // 띠어쓰기와 줄바꿈은 그대로 표시 (채점 제외)
      if (char === " " || char === "\n") {
        return (
          <span key={targetIndex} className="text-muted-foreground">
            {char === "\n" ? "\n" : " "}
          </span>
        );
      }

      const currentInputIndex = inputIndex;
      inputIndex++;

      // 아직 입력하지 않은 글자
      if (currentInputIndex >= userChars.length) {
        // 현재 입력 위치 (다음에 입력할 글자) - 언더바 표시
        // 언더바는 완성된 글자 다음 위치에 표시
        if (currentInputIndex === completedCount) {
          return (
            <span key={targetIndex} className="border-b-4 border-gray-600 text-gray-400 relative font-semibold text-xl animate-pulse">
              {char}
            </span>
          );
        }
        // 미입력 글자
        return (
          <span key={targetIndex} className="text-gray-400 relative font-semibold text-xl">
            {char}
          </span>
        );
      }

      // 입력한 글자 채점
      const userChar = userChars[currentInputIndex];
      const targetChar = targetCharsNormalized[currentInputIndex];
      const nextTargetChar = targetCharsNormalized[currentInputIndex + 1];
      
      // 마지막 글자는 lastCharMatchResult 사용
      const isLastChar = currentInputIndex === userChars.length - 1;
      const matchResult = isLastChar && lastCharMatchResult ? lastCharMatchResult : isPartialMatch(userChar, targetChar, nextTargetChar);

      if (matchResult === 'complete') {
        // 정답 (완전 일치): 검은색
        return (
          <span key={targetIndex} className={isFadingOut ? "text-gray-400 relative font-semibold text-xl transition-colors duration-1500" : "text-foreground relative font-semibold text-xl"}>
            {char}
          </span>
        );
      } else if (matchResult === 'partial' || matchResult === 'partial_complete') {
        // 조합 중 (부분 일치): 검은색 + 언더바 (partial) 또는 검은색만 (partial_complete)
        // partial_complete: 겹받침 조합 중이지만 현재 글자는 완성됨 ("묽" -> "물")
        if (matchResult === 'partial_complete') {
          // 겹받침 조합 중: 검은색만 (언더바는 다음 글자에)
          return (
            <span key={targetIndex} className={isFadingOut ? "text-gray-400 relative font-semibold text-xl transition-colors duration-1500" : "text-foreground relative font-semibold text-xl"}>
              {char}
            </span>
          );
        }
        // partial: 조합 중 (검은색 + 언더바)
        return (
          <span key={targetIndex} className="border-b-4 border-gray-600 text-foreground relative font-semibold text-xl">
            {char}
          </span>
        );
      } else {
        // 오답: 빨간색
        return (
          <span key={targetIndex} className="text-red-500 relative font-semibold text-xl">
            {char}
          </span>
        );
      }
    });
  }, [userInput, targetText, completionInfo, isFadingOut]);

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
                  // onPaste={(e) => e.preventDefault()} // TODO: 테스트 완료 후 활성화
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
                // onPaste={(e) => e.preventDefault()} // TODO: 테스트 완료 후 활성화
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                className="w-full min-h-[120px] p-4 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground"
                placeholder="여기에 입력하세요..."
                autoFocus
              />
            </>
          )}

          <div className="flex flex-col gap-2">
            {showShortcutHelp && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Alt</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 단어 삭제</span>
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Shift</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 문장 삭제</span>
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">A</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 전체 삭제</span>
                <button onClick={toggleShortcutHelp} className="text-muted-foreground/50 hover:text-muted-foreground underline">숨기기</button>
              </div>
            )}
            {!showShortcutHelp && (
              <button onClick={toggleShortcutHelp} className="text-xs text-muted-foreground/50 hover:text-muted-foreground underline self-start">단축키 안내 보기</button>
            )}
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <div><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd> 또는 <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Esc</kbd> 연습 완료</div>
              <Button onClick={handleComplete} disabled={createSession.isPending}>
                {createSession.isPending ? "저장 중..." : "완료"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
