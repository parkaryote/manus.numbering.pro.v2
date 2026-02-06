import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle, Image as ImageIcon, Table2 } from "lucide-react";
import { toast } from "sonner";
import { splitGraphemes, isPartialMatch, isHangul, decomposeHangul } from "@/lib/hangul";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";

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
  const [inputHistory, setInputHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showInactiveAlert, setShowInactiveAlert] = useState(false); // 입력 시간 알림
  const [currentCursorLineIndex, setCurrentCursorLineIndex] = useState(0); // 현재 커서 위치의 줄 인덱스
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const answerDisplayRef = useRef<HTMLDivElement>(null); // 정답 표시 영역 ref
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactiveAlertTimerRef = useRef<NodeJS.Timeout | null>(null); // 입력 시간 알림 타이머
  const lastInputRef = useRef<string>(""); // 마지막 입력값 추적 (모바일용)

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const { data: practiceCountData } = trpc.practice.countByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId }
  );
  const createSession = trpc.practice.create.useMutation();

  // 페이지 언마운트 또는 돌아가기 시 자동으로 연습 기록 저장 (1회만)
  const hasBeenSaved = useRef(false);
  const utils = trpc.useUtils();
  
  const savePracticeSession = async () => {
    if (!question || elapsedTime === 0 || practiceCount === 0 || hasBeenSaved.current) return;

    hasBeenSaved.current = true;
    const timeInMinutes = elapsedTime / 60;
    const speed = timeInMinutes > 0 ? Math.round(userInput.length / timeInMinutes) : 0;

    try {
      await createSession.mutateAsync({
        questionId: question.id,
        duration: elapsedTime,
        typingSpeed: speed,
        accuracy: 100,
        errorCount: 0,
      });
      // 저장 완료 후 누적 연습 수 실시간 갱신
      const newData = await utils.practice.countByQuestion.fetch({ questionId: question.id });
      if (newData) {
        utils.practice.countByQuestion.setData({ questionId: question.id }, newData);
      }
      // 페이지 나갈 때만 토스트 표시
      toast.success("연습 기록이 저장되었습니다");
    } catch (error) {
      console.error("연습 기록 저장 실패:", error);
      hasBeenSaved.current = false; // 실패 시 다시 시도
    }
  };

  // 페이지 언마운트 시 자동 저장 (단 1회)
  useEffect(() => {
    return () => {
      if (practiceCount > 0 && elapsedTime > 0 && !hasBeenSaved.current) {
        savePracticeSession();
      }
    };
  }, []);

  // 새로운 문제로 이동할 때 hasBeenSaved 초기화
  useEffect(() => {
    hasBeenSaved.current = false;
  }, [questionId]);

  const targetText = question?.answer || "";
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;
  const tableData: TableData | null = question?.tableData ? JSON.parse(question.tableData) : null;
  const isTableQuestion = !!tableData;
  const [tableAnswers, setTableAnswers] = useState<Record<string, string>>({});
  const [tableResults, setTableResults] = useState<Record<string, boolean> | null>(null);
  const [tablePracticeCount, setTablePracticeCount] = useState(0);
  


  // Normalize text: remove spaces and newlines for completion check
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

   // Inactivity detection with alert
  useEffect(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (inactiveAlertTimerRef.current) clearTimeout(inactiveAlertTimerRef.current);

    if (isActive) {
      inactiveAlertTimerRef.current = setTimeout(() => {
        setShowInactiveAlert(true);
      }, 60000);
      
      inactivityTimerRef.current = setTimeout(() => {
        setIsActive(false);
      }, 60000);
    }

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (inactiveAlertTimerRef.current) clearTimeout(inactiveAlertTimerRef.current);
    };
  }, [lastInputTime, isActive]);;

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

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    // 조합 완료 후 입력값 처리
    const newValue = e.currentTarget.value;
    setUserInput(newValue);
    setLastInputTime(Date.now());
    lastInputRef.current = newValue;
    
    // 히스토리에 현재 입력 상태 기록
    setInputHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== newValue) {
        newHistory.push(newValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }
    
    // Hide inactive alert
    if (showInactiveAlert) {
      setShowInactiveAlert(false);
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeText(newValue);
    const normalizedTarget = normalizeText(targetText);
    if (normalized === normalizedTarget) {
      // 즉시 입력 초기화 - textarea value 직접 비우기
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
      setUserInput("");
      // 그 후 완료 처리
      handleCorrectAnswer(newValue.length);
      return; // 이후 코드 실행 중단
    }
    
    // 뷰포트 실시간 이동
    if (question?.autoNumbering === 1 && answerDisplayRef.current) {
      const currentLineIndex = newValue.split('\n').length - 1;
      const lineHeight = 28;
      const scrollTarget = currentLineIndex * lineHeight;
      answerDisplayRef.current.scrollTo({
        top: scrollTarget,
        behavior: 'smooth'
      });
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursorPos = textarea.selectionStart;
    const value = textarea.value;
    
    // 현재 커서 위치의 줄 인덱스 계산
    const lineIndex = value.substring(0, cursorPos).split('\n').length - 1;
    setCurrentCursorLineIndex(lineIndex);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // 현재 커서 위치의 줄 인덱스 계산
    const lineIndex = newValue.substring(0, cursorPos).split('\n').length - 1;
    setCurrentCursorLineIndex(lineIndex);
    
    setUserInput(newValue);
    setLastInputTime(Date.now());
    lastInputRef.current = newValue;

    // 히스토리에 현재 입력 상태 기록
    setInputHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== newValue) {
        newHistory.push(newValue);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }
    
    // Hide inactive alert
    if (showInactiveAlert) {
      setShowInactiveAlert(false);
    }

    // Auto-complete when normalized text matches
    const normalized = normalizeText(newValue);
    const normalizedTarget = normalizeText(targetText);
    if (normalized === normalizedTarget) {
      // 즉시 입력 초기화 - textarea value 직접 비우기
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
      setUserInput("");
      // 그 후 완료 처리
      handleCorrectAnswer(newValue.length);
      return; // 이후 코드 실행 중단
    }
    
    // 뷰포트 실시간 이동: 사용자 입력의 현재 줄 번호에 따라 스크롤
    if (question?.autoNumbering === 1 && answerDisplayRef.current) {
      const currentLineIndex = newValue.split('\n').length - 1;
      const lineHeight = 28; // 대략적인 줄 높이 (px)
      const scrollTarget = currentLineIndex * lineHeight;
      answerDisplayRef.current.scrollTo({
        top: scrollTarget,
        behavior: 'smooth'
      });
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
    // Ctrl+Z: Undo
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      e.stopPropagation();
      
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setUserInput(inputHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(inputHistory[newIndex].length, inputHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Ctrl+Shift+Z: Redo
    if (e.ctrlKey && e.shiftKey && e.key === "z") {
      e.preventDefault();
      e.stopPropagation();
      
      if (historyIndex < inputHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setUserInput(inputHistory[newIndex]);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(inputHistory[newIndex].length, inputHistory[newIndex].length);
          }
        }, 0);
      }
      return;
    }
    
    // Ctrl+Enter or Esc: Complete and save
    if ((e.ctrlKey && e.key === "Enter") || e.key === "Escape") {
      e.preventDefault();
      handleComplete();
      return;
    }
    
    // Enter: 줄바꿈 추가 (autoNumbering=1인 경우, 답안 줄 수만큼 허용)
    if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.altKey && question?.autoNumbering === 1) {
      const lines = targetText.split('\n');
      const maxLines = lines.length;
      const currentLines = userInput.split('\n').length;
      
      // 답안 줄 수만큼만 Enter 허용
      if (currentLines < maxLines) {
        // 기본 Enter 동작 허용 (줄바꿈 추가)
        return;
      } else {
        // 최대 줄 수 도달 시 Enter 차단
        e.preventDefault();
        return;
      }
    }
    
    // Shift+Backspace: 문장 삭제 (마지막 줄 삭제) - Alt+Backspace처럼 즉시 작동
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
        // 조합 중일 때: blur로 조합 강제 종료 후 삭제
        textarea.blur();
        setTimeout(() => {
          const currentValue = textarea.value;
          const newValue = deleteLine(currentValue);
          setUserInput(newValue);
          
          // 히스토리에 기록
          setInputHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            if (newHistory[newHistory.length - 1] !== newValue) {
              newHistory.push(newValue);
              if (newHistory.length > 50) {
                newHistory.shift();
              }
            }
            return newHistory;
          });
          setHistoryIndex(prev => Math.min(prev + 1, 49));
          
          textarea.focus();
        }, 10);
      } else {
        // 조합 중이 아닐 때: 즉시 삭제
        const currentValue = textarea.value;
        const newValue = deleteLine(currentValue);
        setUserInput(newValue);
        
        // 히스토리에 기록
        setInputHistory(prev => {
          const newHistory = prev.slice(0, historyIndex + 1);
          if (newHistory[newHistory.length - 1] !== newValue) {
            newHistory.push(newValue);
            if (newHistory.length > 50) {
              newHistory.shift();
            }
          }
          return newHistory;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 49));
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
          
          // 히스토리에 기록
          setInputHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            if (newHistory[newHistory.length - 1] !== newValue) {
              newHistory.push(newValue);
              if (newHistory.length > 50) {
                newHistory.shift();
              }
            }
            return newHistory;
          });
          setHistoryIndex(prev => Math.min(prev + 1, 49));
          
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
        
        // 히스토리에 기록
        setInputHistory(prev => {
          const newHistory = prev.slice(0, historyIndex + 1);
          if (newHistory[newHistory.length - 1] !== newValue) {
            newHistory.push(newValue);
            if (newHistory.length > 50) {
              newHistory.shift();
            }
          }
          return newHistory;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 49));
      }
      return;
    }
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

  // 돌아가기 버튼 클릭 핸들러
  const handleGoBack = async () => {
    if (practiceCount > 0 && elapsedTime > 0 && !hasBeenSaved.current) {
      await savePracticeSession();
      // 저장 완료 후 바로 이동
      setLocation(`/questions/${question?.subjectId || 1}`);
    } else {
      setLocation(`/questions/${question?.subjectId || 1}`);
    }
  };

  // 정답 일치 시 fade out 애니메이션 후 입력 초기화
  const handleCorrectAnswer = async (currentInputLength?: number) => {
    setIsFadingOut(true);
    setPracticeCount(prev => prev + 1);
    
    // 정답 일치 시 즉시 DB에 저장하여 누적 연습 수 실시간 갱신 (매번 저장)
    if (question && elapsedTime > 0) {
      try {
        const timeInMinutes = elapsedTime / 60;
        const inputLength = currentInputLength !== undefined ? currentInputLength : userInput.length;
        const speed = timeInMinutes > 0 ? Math.round(inputLength / timeInMinutes) : 0;
        
        // 정답 일치 시 즉시 세션 저장 (비동기로 백그라운드에서 진행)
        createSession.mutateAsync({
          questionId: question.id,
          duration: elapsedTime,
          typingSpeed: speed,
          accuracy: 100,
          errorCount: 0,
        }).then(() => {
          // 저장 완료 후 누적 연습 수 직접 증가 (fetch 없이 즉시 반영)
          utils.practice.countByQuestion.setData(
            { questionId: question.id },
            (old) => old ? { count: old.count + 1 } : { count: 1 }
          );
          // 저장 완료 표시 (페이지 나갈 때 중복 저장 방지)
          hasBeenSaved.current = true;
        }).catch(error => {
          console.error("정답 기록 저장 실패:", error);
        });
      } catch (error) {
        console.error("정답 기록 저장 실패:", error);
      }
    }
    
    // 입력 초기화는 handleInputChange에서 이미 처리됨
    // 여기서는 textarea에 포커스만 설정
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 700);
    
    // fade out 상태 0.8초 후 해제 (자연스러운 여운)
    setTimeout(() => {
      setIsFadingOut(false);
    }, 800);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };



  // 한컴타자연습 스타일 채점 로직 (줄 단위 비교):
  // 1. 사용자 입력의 N번째 줄 → 정답의 N번째 줄과 비교
  // 2. 조합 중인 글자도 정답의 일부이면 검은색
  // 3. 종성 예약: 다음 글자의 초성과 일치하면 정답
  // 4. 언더바는 글자가 완성된 후에만 이동
  const completionInfo = useMemo(() => {
    // 줄 단위로 분리
    const userLines = userInput.split('\n');
    const targetLines = targetText.split('\n');
    
    // 각 줄별 채점 정보
    const lineResults: Array<{
      userChars: string[];
      targetChars: string[];
      completedCount: number;
      isLastCharPartial: boolean;
      lastCharMatchResult: string | null;
    }> = [];
    
    for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
      const userLine = userLines[lineIdx] || '';
      const targetLine = targetLines[lineIdx] || '';
      
      // 각 줄의 글자를 분리 (띄어쓰기 제거)
      let userChars = splitGraphemes(userLine.replace(/\s+/g, ''));
      const targetChars = splitGraphemes(targetLine.replace(/\s+/g, ''));
      
      // 조합 중인 마지막 글자는 제외하지 않음
      // (isComposing 상태가 정확하지 않을 수 있으므로)
      const isLastLine = lineIdx === targetLines.length - 1;
      
      let completedCount = 0;
      
      for (let i = 0; i < userChars.length && i < targetChars.length; i++) {
        const userChar = userChars[i];
        const targetChar = targetChars[i];
        const nextTargetChar = targetChars[i + 1];
        
        const matchResult = isPartialMatch(userChar, targetChar, nextTargetChar);
        
        if (matchResult === 'complete' || matchResult === 'partial_complete') {
          completedCount = i + 1;
        } else if (matchResult === 'partial') {
          completedCount = i;
          break;
        } else {
          completedCount = i + 1;
        }
      }
      
      if (userChars.length > targetChars.length) {
        completedCount = targetChars.length;
      }
      
      const lastUserChar = userChars[userChars.length - 1];
      const lastTargetChar = targetChars[userChars.length - 1];
      const nextTargetChar = targetChars[userChars.length];
      const lastMatchResult = lastUserChar && lastTargetChar 
        ? isPartialMatch(lastUserChar, lastTargetChar, nextTargetChar)
        : null;
      const isLastCharPartial = lastMatchResult === 'partial' || lastMatchResult === 'partial_complete';
      
      lineResults.push({
        userChars,
        targetChars,
        completedCount,
        isLastCharPartial,
        lastCharMatchResult: lastMatchResult
      });
    }
    
    // 현재 입력 중인 줄 인덱스 (커서 위치 기반)
    const currentLineIndex = currentCursorLineIndex;
    
    return { lineResults, currentLineIndex, userLines, targetLines };
  }, [userInput, targetText, renderTrigger, currentCursorLineIndex]);

  // 실시간 단어 뷰: 줄 단위 opacity 계산
  const calculateLineOpacity = useMemo(() => {
    const lines = targetText.split('\n');
    
    // 각 줄의 opacity 계산
    return lines.map((_, lineIndex) => {
      // 현재 커서 위치의 줄만 opacity 1 (진한 회색)
      if (lineIndex === currentCursorLineIndex) {
        return 1; // 현재 커서 위치의 줄: opacity 1 (진한 회색)
      } else {
        return 0.4; // 다른 줄: opacity 0.4 (연한 회색)
      }
    });
  }, [currentCursorLineIndex, targetText]);

  // 한컴타자연습 스타일 렌더링 (줄 단위 비교)
  const renderTextWithFeedback = useMemo(() => {
    const { lineResults, currentLineIndex: activeLineIdx } = completionInfo;
    const targetLines = targetText.split('\n');
    
    return targetLines.map((line, lineIdx) => {
      const lineResult = lineResults[lineIdx];
      const lineOpacity = calculateLineOpacity[lineIdx] || 1;
      const isActiveLine = lineIdx === activeLineIdx;
      
      const chars = line.split('');
      let charIdx = 0; // 띄어쓰기 제외한 글자 인덱스
      
      const renderedChars = chars.map((char, charIndex) => {
        // 띄어쓰기는 그대로 표시
        if (char === ' ') {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-muted-foreground" style={{ opacity: lineOpacity }}>
              {' '}
            </span>
          );
        }
        
        const currentCharIdx = charIdx;
        charIdx++;
        
        if (!lineResult) {
          // 이 줄에 대한 입력이 없음
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-400 relative font-semibold text-xl" style={{ opacity: lineOpacity }}>
              {char}
            </span>
          );
        }
        
        const { userChars, targetChars, completedCount, lastCharMatchResult } = lineResult;
        
        // 아직 입력하지 않은 글자
        if (currentCharIdx >= userChars.length) {
          // 현재 입력 위치 (다음에 입력할 글자) - 언더바 표시
          // 단, 현재 커서 위치의 줄에만 언더바 표시
          if (lineIdx === activeLineIdx && completedCount > 0 && currentCharIdx === completedCount) {
            return (
              <span key={`${lineIdx}-${charIndex}`} className="border-b-4 border-gray-600 text-gray-600 relative font-semibold text-xl animate-pulse" style={{ opacity: 1 }}>
                {char}
              </span>
            );
          }
          // 미입력 글자
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-400 relative font-semibold text-xl" style={{ opacity: lineOpacity }}>
              {char}
            </span>
          );
        }
        
        // 입력한 글자 채점
        const userChar = userChars[currentCharIdx];
        const targetChar = targetChars[currentCharIdx];
        const nextTargetChar = targetChars[currentCharIdx + 1];
        
        // 마지막 글자는 lastCharMatchResult 사용
        const isLastChar = currentCharIdx === userChars.length - 1;
        const matchResult = isLastChar && lastCharMatchResult ? lastCharMatchResult : isPartialMatch(userChar, targetChar, nextTargetChar);
        
        if (matchResult === 'complete') {
          return (
            <span key={`${lineIdx}-${charIndex}`} className={isFadingOut ? "text-gray-400 relative font-semibold text-xl transition-colors duration-1500" : "text-foreground relative font-semibold text-xl"} style={{ opacity: 1 }}>
              {char}
            </span>
          );
        } else if (matchResult === 'partial' || matchResult === 'partial_complete') {
          if (matchResult === 'partial_complete') {
            return (
              <span key={`${lineIdx}-${charIndex}`} className={isFadingOut ? "text-gray-400 relative font-semibold text-xl transition-colors duration-1500" : "text-foreground relative font-semibold text-xl"} style={{ opacity: 1 }}>
                {char}
              </span>
            );
          }
          return (
            <span key={`${lineIdx}-${charIndex}`} className="border-b-4 border-gray-600 text-gray-600 relative font-semibold text-xl" style={{ opacity: 1 }}>
              {char}
            </span>
          );
        } else {
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-red-500 relative font-semibold text-xl" style={{ opacity: 1 }}>
              {char}
            </span>
          );
        }
      });
      
      // 줄 끝에 줄바꿈 추가 (마지막 줄 제외)
      if (lineIdx < targetLines.length - 1) {
        return (
          <span key={`line-${lineIdx}`}>
            {renderedChars}
            <span className="text-muted-foreground">{'\n'}</span>
          </span>
        );
      }
      
      return <span key={`line-${lineIdx}`}>{renderedChars}</span>;
    });
  }, [userInput, targetText, completionInfo, isFadingOut, calculateLineOpacity]);

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
    <div className="space-y-6 relative">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={handleGoBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          돌아가기
        </Button>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold">{practiceCountDisplay}</p>
            <p className="text-xs text-muted-foreground">현재 연습</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{practiceCountData?.count || 0}</p>
            <p className="text-xs text-muted-foreground">누적 연습</p>
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
            {isTableQuestion ? "표의 빈칸을 채우세요 (Tab/Enter로 다음 칸으로 이동)" : isImageQuestion ? "이미지의 표시된 영역에 정답을 입력하세요" : "정답을 따라 입력하세요 (띄어쓰기 무시)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isTableQuestion && tableData ? (
            /* Table question */
            <div className="space-y-4">
              <TableView
                tableData={tableData}
                answers={tableAnswers}
                onAnswerChange={(key, value) => {
                  setTableAnswers((prev) => ({ ...prev, [key]: value }));
                  setTableResults(null); // 입력 시 결과 초기화
                  // 시간 추적
                  if (!startTime) setStartTime(Date.now());
                  setLastInputTime(Date.now());
                  setIsActive(true);
                }}
                results={tableResults || undefined}
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const { results, score, total } = gradeTable(tableData, tableAnswers);
                    setTableResults(results);
                    if (score === total) {
                      toast.success(`🎉 모두 정답! (${score}/${total})`);
                      setTablePracticeCount((prev) => prev + 1);
                      setPracticeCount((prev) => prev + 1);
                      // 자동 초기화
                      setTimeout(() => {
                        setTableAnswers({});
                        setTableResults(null);
                      }, 1500);
                    } else {
                      toast.error(`${score}/${total} 정답 - 다시 시도하세요`);
                    }
                  }}
                  variant="secondary"
                >
                  채점하기
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTableAnswers({});
                    setTableResults(null);
                  }}
                >
                  초기화
                </Button>
              </div>
              {tableResults && (
                <div className="text-sm text-muted-foreground">
                  표 연습 횟수: {tablePracticeCount}회
                </div>
              )}
            </div>
          ) : isImageQuestion ? (
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
                  className="w-full h-[400px] p-4 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="여기에 답안을 연습해보세요... (저장되지 않습니다)"
                />
              </div>
            </div>
          ) : (
            /* Text question with visual feedback */
            <>
              <div 
                ref={answerDisplayRef}
                className="p-6 bg-muted/30 rounded-lg border-2 border-border max-h-[400px] overflow-y-auto"
              >
                <div className="leading-relaxed whitespace-pre-wrap">
                  {renderTextWithFeedback}
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={userInput}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}

                className="w-full min-h-[120px] p-4 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground"
                placeholder="여기에 입력하세요..."
                autoFocus
              />
            </>
          )}

          <div className="flex flex-col gap-2">
            {showShortcutHelp && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Z</kbd> 실행 취소</span>
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
      
      {showInactiveAlert && (
        <div className="fixed bottom-6 right-6 bg-slate-100 border border-slate-300 rounded-lg p-4 shadow-lg max-w-sm animate-in fade-in duration-300">
          <p className="text-sm text-slate-700 leading-relaxed">
            입력이 없어 연습 시간 기록이 일시 정지되었습니다.
            <br />
            입력을 시작하면 자동으로 다시 기록됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
