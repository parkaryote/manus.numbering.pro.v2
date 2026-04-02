import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle, Image as ImageIcon, Table2, Eye, EyeOff, Zap, StickyNote, Pencil, Repeat, Save, X, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { splitGraphemes, isPartialMatch, isHangul, decomposeHangul } from "@/lib/hangul";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";
import { trackQuestionAttempt, trackPracticeComplete } from "@/lib/ga4Events";
import { DamageNumber } from "@/components/DamageNumber";

interface PracticeProps {
  questionId: number;
  isDemo?: boolean;
}

export default function Practice({ questionId, isDemo = false }: PracticeProps) {
  const [, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [imageLabelAnswers, setImageLabelAnswers] = useState<Record<number, string>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [revealedLabels, setRevealedLabels] = useState<Set<number>>(new Set()); // 클릭하여 공개된 라벨
  const lastLabelActionRef = useRef<'reveal' | 'hide' | null>(null);
  const revealedLabelsRef = useRef<Set<number>>(new Set()); // 마지막 라벨 클릭 행동
  const setRevealedLabelsRef = useRef<React.Dispatch<React.SetStateAction<Set<number>>> | null>(null);
  const imageLabelsLengthRef = useRef<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isActive, setIsActive] = useState(true); // 측정 중 여부
  const [lastInputTime, setLastInputTime] = useState<number>(Date.now());
  const [isComposing, setIsComposing] = useState(false); // 한글 조합 중
  const [practiceNote, setPracticeNote] = useState(""); // 연습용 메모장
  const [notepadLines, setNotepadLines] = useState(50); // 메모장 줄 수
  const [imageScale, setImageScaleRaw] = useState(() => {
    const saved = localStorage.getItem('imageScale');
    return saved ? Math.max(30, Math.min(100, parseInt(saved, 10))) : 60;
  }); // 이미지 크기 비율 (%)
  const setImageScale = (val: number) => {
    setImageScaleRaw(val);
    localStorage.setItem('imageScale', String(val));
  };
  const [imageContainerHeight, setImageContainerHeight] = useState(400); // 이미지 컨테이너 높이
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const notepadRef = useRef<HTMLTextAreaElement>(null);
  const [hasInteracted, setHasInteracted] = useState(false); // 이미지 문제: 클릭 또는 입력 여부
  const [isFadingOut, setIsFadingOut] = useState(false); // fade out 애니메이션 상태
  const isResettingRef = useRef(false); // 초기화 진행 중 플래그 (compositionend 잔류 방지)
  const [practiceCount, setPracticeCount] = useState(0); // 현재 연습 횟수 (세션 동안만 유지)
  const [showShortcutHelp, setShowShortcutHelp] = useState(() => {
    const saved = localStorage.getItem("showShortcutHelp");
    return saved !== null ? saved === "true" : true;
  });
  const [inputHistory, setInputHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showInactiveAlert, setShowInactiveAlert] = useState(false); // 입력 시간 알림
  const [currentCursorLineIndex, setCurrentCursorLineIndex] = useState(0); // 현재 커서 위치의 줄 인덱스
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showDamageNumber, setShowDamageNumber] = useState(false);
  const [damageValue, setDamageValue] = useState(0);
  // 답 가리기 상태: 'none' | 'all' | 'line' (문장별)
  const [hideMode, setHideMode] = useState<'none' | 'all' | 'line'>('none');
  const [hiddenLines, setHiddenLines] = useState<Set<number>>(new Set());
  // 학습 제안 상태
  const [showStudySuggestion, setShowStudySuggestion] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  // 메모 (암기법/설명 - 영구 저장, 연습장과 구분)
  const [memo, setMemo] = useState('');
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoSaved, setMemoSaved] = useState(false);
  // 줄 반복 연습 (체크박스 다중 선택 방식)
  const [repeatCheckedLines, setRepeatCheckedLines] = useState<Set<number>>(new Set());
  const [repeatCurrentIdx, setRepeatCurrentIdx] = useState(0); // 체크된 줄 중 현재 순서 (0-based)
  const [repeatCount, setRepeatCount] = useState(0); // 현재 줄 완료 횟수
  const [repeatTotalCount, setRepeatTotalCount] = useState(0); // 전체 완료 횟수
  const isRepeatMode = repeatCheckedLines.size > 0;
  // 문제 수정 모드
  const [editMode, setEditMode] = useState(false);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  // 이미지 컨테이너 높이 추적 (메모장 높이 동기화)
  useEffect(() => {
    if (!imageContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        setImageContainerHeight(h);
        // 이미지 높이에 맞춰 메모장 줄 수 계산 (28px per line)
        const lines = Math.max(20, Math.ceil(h / 28));
        setNotepadLines(lines);
      }
    });
    observer.observe(imageContainerRef.current);
    return () => observer.disconnect();
  }, [imageLoaded, imageScale]);

  const answerDisplayRef = useRef<HTMLDivElement>(null); // 정답 표시 영역 ref
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactiveAlertTimerRef = useRef<NodeJS.Timeout | null>(null); // 입력 시간 알림 타이머
  const lastInputRef = useRef<string>(""); // 마지막 입력값 추적 (모바일용)

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const { data: practiceCountData } = trpc.practice.countByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const { data: confidenceData, refetch: refetchConfidence } = trpc.confidence.getByQuestion.useQuery(
    { questionId },
    { enabled: !!questionId && !isDemo }
  );
  const utils = trpc.useUtils();
  const createSession = trpc.practice.create.useMutation({
    onError: (error) => {
      // Silently ignore errors in demo mode
      if (!isDemo) {
        console.error('Failed to create practice session:', error);
      }
    },
  });
  const saveMemoMutation = trpc.questions.saveMemo.useMutation({
    onSuccess: () => {
      setMemoSaved(true);
      setMemoSaving(false);
      setTimeout(() => setMemoSaved(false), 2000);
      utils.questions.getById.invalidate({ id: questionId });
    },
    onError: (error) => {
      setMemoSaving(false);
      toast.error('메모 저장 실패: ' + error.message);
    },
  });
  const updateQuestionMutation = trpc.questions.update.useMutation({
    onSuccess: () => {
      toast.success('문제가 수정되었습니다');
      setEditMode(false);
      utils.questions.getById.invalidate({ id: questionId });
    },
    onError: (error) => {
      toast.error('수정 실패: ' + error.message);
    },
  });

  // 페이지 언마운트 또는 돌아가기 시 자동으로 연습 기록 저장 (1회만)
  const hasBeenSaved = useRef(false);
  
  // 매 정답 시 handleCorrectAnswer에서 즉시 DB 저장하므로 별도의 savePracticeSession 불필요
  const savePracticeSession = async () => {
    // 이제 매 정답 시 즉시 저장하므로 페이지 나갈 때 추가 저장 불필요
    return;
  };

  // 이미지 문제: 상호작용 시 practiceCount를 최소 1로 설정
  useEffect(() => {
    if (hasInteracted && practiceCount === 0) {
      setPracticeCount(1);
    }
  }, [hasInteracted]);

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
    setHasInteracted(false);
    // 반복 연습 상태도 초기화
    setRepeatCheckedLines(new Set());
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
    setRepeatTotalCount(0);
  }, [questionId]);

  const targetText = question?.answer || "";
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;

  // 메모 초기화: question 로드 시 DB에서 가져오기
  useEffect(() => {
    if (question?.memo) {
      setMemo(question.memo);
    } else {
      setMemo('');
    }
  }, [question?.id, question?.memo]);

  // 메모 저장 핸들러
  const handleSaveMemo = () => {
    if (!question || isDemo) return;
    setMemoSaving(true);
    saveMemoMutation.mutate({ id: question.id, memo: memo || null });
  };

  // 줄 체크박스 토글
  const toggleRepeatLine = (lineIdx: number) => {
    setRepeatCheckedLines(prev => {
      const next = new Set(prev);
      if (next.has(lineIdx)) {
        next.delete(lineIdx);
      } else {
        next.add(lineIdx);
      }
      return next;
    });
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
  };

  // 줄 반복 연습 종료
  const stopRepeatMode = () => {
    setRepeatCheckedLines(new Set());
    setRepeatCurrentIdx(0);
    setRepeatCount(0);
    setRepeatTotalCount(0);
    // 입력창 전체 정답으로 복원
    setUserInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  // 체크된 줄 목록
  const repeatLinesSorted = useMemo(() => {
    return Array.from(repeatCheckedLines).sort((a, b) => a - b);
  }, [repeatCheckedLines]);

  // 현재 반복 중인 줄의 대상 텍스트
  const currentRepeatTarget = useMemo(() => {
    if (!isRepeatMode || repeatLinesSorted.length === 0) return null;
    const lineIdx = repeatLinesSorted[repeatCurrentIdx % repeatLinesSorted.length];
    return { lineIdx, text: targetText.split('\n')[lineIdx] || '' };
  }, [isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText]);

  // stale closure 방지: 항상 최신 반복 연습 상태를 ref에 동기화
  const repeatStateRef = useRef({ isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText });
  useEffect(() => {
    repeatStateRef.current = { isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText };
  }, [isRepeatMode, repeatLinesSorted, repeatCurrentIdx, targetText]);

  // 문제 수정 모드 시작
  const startEditMode = () => {
    if (!question) return;
    setEditQuestion(question.question);
    setEditAnswer(question.answer || '');
    setEditMode(true);
  };

  // 문제 수정 저장
  const handleSaveEdit = () => {
    if (!question || isDemo) return;
    updateQuestionMutation.mutate({
      id: question.id,
      question: editQuestion,
      answer: editAnswer,
    });
  };

  // 메모장에 미리 줄바꿈 채워넣기 (줄이 그어진 연습장처럼 어디서나 클릭 시 바로 입력 가능)
  useEffect(() => {
    if (!isImageQuestion) return;
    // practiceNote가 비어있을 때만 초기화
    if (practiceNote === "") {
      setPracticeNote("\n".repeat(notepadLines));
    }
  }, [isImageQuestion, notepadLines]);
  const tableData: TableData | null = question?.tableData ? JSON.parse(question.tableData) : null;
  const isTableQuestion = !!tableData;
  const [tableAnswers, setTableAnswers] = useState<Record<string, string>>({});
  const [tableResults, setTableResults] = useState<Record<string, boolean> | null>(null);
  const [tablePracticeCount, setTablePracticeCount] = useState(0);
  // 표 문제 하단 입력창 연습 모드
  const [tableActiveCellIdx, setTableActiveCellIdx] = useState(0); // 현재 입력 중인 셀 인덱스
  const [tableCompletedCells, setTableCompletedCells] = useState<Set<string>>(new Set());
  const [tableCheckedCells, setTableCheckedCells] = useState<Set<string>>(new Set());
  const [tableCellInput, setTableCellInput] = useState(''); // 하단 입력창 현재 입력값
  const tableCellInputRef = useRef<HTMLTextAreaElement>(null);
  


  // Normalize text: remove spaces and newlines for completion check
  const normalizeText = (text: string) => text.replace(/\s+/g, "");

  // Auto-start on mount
  useEffect(() => {
    if (question && !startTime) {
      setStartTime(Date.now());
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(0, 0);
        textareaRef.current.focus();
      }
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

  // setRevealedLabels와 imageLabels.length를 항상 최신 ref에 저장
  useEffect(() => {
    setRevealedLabelsRef.current = setRevealedLabels;
  }, [setRevealedLabels]);
  
  useEffect(() => {
    imageLabelsLengthRef.current = imageLabels.length;
  }, [imageLabels]);

  // Tab 키: 가림막 전체 표시/제거 (마지막 클릭 행동 기반)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab 키이고, 이미지 문제인 경우에만 처리
      if (e.key === 'Tab' && isImageQuestion && imageLabels.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        
        // 마지막 클릭 행동과 동일하게 Tab 동작
        // reveal = 가림막 제거(숫자 보임), hide = 가림막 표시(숫자 가려짐)
        // 마지막 클릭이 제거(reveal)였으면 → Tab도 전체 제거
        // 마지막 클릭이 가리기(hide)였거나 초기 상태 → Tab도 전체 가리기
        if (lastLabelActionRef.current === 'reveal') {
          // 마지막 행동이 가림막 제거(reveal)였으면 → Tab도 전체 제거 (모두 보이기)
          const len = imageLabelsLengthRef.current;
          const indices = Array.from({length: len}, (_, i) => i);
          const allLabels = new Set<number>(indices);
          revealedLabelsRef.current = allLabels;
          if (setRevealedLabelsRef.current) {
            setRevealedLabelsRef.current(new Set<number>(indices));
          }
          // 다음 Tab은 반대 동작
          lastLabelActionRef.current = 'hide';
        } else {
          // 마지막 행동이 가리기(hide)였거나 초기 상태 → Tab도 전체 가리기
          const emptySet = new Set<number>();
          revealedLabelsRef.current = emptySet;
          if (setRevealedLabelsRef.current) {
            setRevealedLabelsRef.current(new Set<number>());
          }
          // 다음 Tab은 반대 동작
          lastLabelActionRef.current = 'reveal';
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [imageLabels, isImageQuestion]);


  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // Tab: 답 가리기 토글 (입력창 포커스 여부 관계없이 전역에서 작동)
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          // Shift+Tab: 문장별 가리기 모드 토글
          if (hideMode === 'line') {
            setHideMode('none');
            setHiddenLines(new Set());
          } else {
            setHideMode('line');
            const lines = targetText.split('\n');
            setHiddenLines(new Set(lines.map((_, i) => i)));
          }
        } else {
          // Tab: 전체 가리기/보이기 토글
          if (hideMode === 'all') {
            setHideMode('none');
            setHiddenLines(new Set());
          } else {
            setHideMode('all');
          }
        }
        return;
      }
      
      if (e.key === "Escape" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        await handleComplete();
        if (isDemo) {
          setLocation("/demo");
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [question, userInput, imageLabelAnswers, revealedLabels, elapsedTime, createSession, isDemo, setLocation, hideMode, targetText]);

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    // 초기화 진행 중이면 compositionend 무시 (잔류 글자 방지)
    if (isResettingRef.current) {
      e.currentTarget.value = '';
      return;
    }
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
    
    // 반복 연습 모드: ref를 통해 항상 최신 상태 사용 (stale closure 방지)
    const { isRepeatMode: rm, repeatLinesSorted: rls, repeatCurrentIdx: rci, targetText: tt } = repeatStateRef.current;
    if (rm && rls.length > 0) {
      const lineIdx = rls[rci % rls.length];
      const currentLineText = tt.split('\n')[lineIdx] || '';
      const normalizedRepeatTarget = normalizeText(currentLineText);
      if (normalizedRepeatTarget.length > 0 && normalized === normalizedRepeatTarget) {
        const nextIdx = rci + 1;
        const isLastLine = nextIdx >= rls.length;
        setRepeatCount(prev => prev + 1);
        setRepeatTotalCount(prev => prev + 1);
        const newIdx = isLastLine ? 0 : nextIdx;
        setRepeatCurrentIdx(newIdx);
        repeatStateRef.current = { ...repeatStateRef.current, repeatCurrentIdx: newIdx };
        // 입력창 즉시 초기화 (React state + DOM 직접)
        setUserInput('');
        lastInputRef.current = '';
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        return;
      }
      return;
    }
    
    const normalizedTarget = normalizeText(targetText);
    if (normalized === normalizedTarget) {
      handleCorrectAnswer(newValue.length);
      return;
    }
    
    // 듷포트 실시간 이동: 사용자 입력의 현재 줄 번호에 따라 스크롤
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
    
    // 반복 연습 모드: ref를 통해 항상 최신 상태 사용 (stale closure 방지)
    const { isRepeatMode: rm2, repeatLinesSorted: rls2, repeatCurrentIdx: rci2, targetText: tt2 } = repeatStateRef.current;
    if (rm2 && rls2.length > 0) {
      const lineIdx2 = rls2[rci2 % rls2.length];
      const currentLineText2 = tt2.split('\n')[lineIdx2] || '';
      const normalizedRepeatTarget = normalizeText(currentLineText2);
      if (normalizedRepeatTarget.length > 0 && normalized === normalizedRepeatTarget) {
        const nextIdx2 = rci2 + 1;
        const isLastLine2 = nextIdx2 >= rls2.length;
        setRepeatCount(prev => prev + 1);
        setRepeatTotalCount(prev => prev + 1);
        const newIdx2 = isLastLine2 ? 0 : nextIdx2;
        setRepeatCurrentIdx(newIdx2);
        repeatStateRef.current = { ...repeatStateRef.current, repeatCurrentIdx: newIdx2 };
        // 입력창 즉시 초기화 (React state + DOM 직접)
        setUserInput('');
        lastInputRef.current = '';
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        return;
      }
      return;
    }
    
    const normalizedTarget = normalizeText(targetText);
    if (normalized === normalizedTarget) {
      // 완료 처리 - fade out 후 입력 초기화는 handleCorrectAnswer 내부에서 처리
      handleCorrectAnswer(newValue.length);
      return; // 이후 코드 실행 중단
    }
    
    // 듷포트 실시간 이동: 사용자 입력의 현재 줄 번호에 따라 스크롤
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

  // 학습 제안 로직: 연습 횟수에 따라 시험 추천
  const totalPracticeCount = (practiceCountData?.count || 0) + practiceCount;
  const studySuggestion = useMemo(() => {
    const conf = confidenceData?.displayScore ?? 0;
    const total = totalPracticeCount;
    
    // 아직 연습 안 함
    if (total === 0) return null;
    
    // 안정도 80% 이상: 완벽 암기
    if (conf >= 80) return { type: 'mastered' as const, message: '완벽하게 암기했습니다! 테스트로 확인해보세요.' };
    
    // 연습 3회 이상 + 안정도 50% 이상: 시험 추천
    if (total >= 3 && conf >= 50) return { type: 'test_ready' as const, message: `${total}회 연습 완료! 백지복습 시험으로 확인해보세요.` };
    
    // 연습 5회 이상 + 안정도 낮음: 답 가리고 연습 추천
    if (total >= 5 && conf < 50) return { type: 'hide_practice' as const, message: '답을 가리고 연습해보세요! Tab을 누르면 답이 가려집니다.' };
    
    // 연습 2회: 답 가리기 안내
    if (total >= 2 && total < 5) return { type: 'hint' as const, message: `${5 - total}회 더 연습하면 시험을 추천해드립니다. Tab으로 답 가리기도 시도해보세요!` };
    
    return null;
  }, [totalPracticeCount, confidenceData?.displayScore]);

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
    
    // Tab 키는 이미 전역 이벤트에서 처리됨 - 입력창에서는 처리하지 않음
    
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
    
    // Shift+Backspace: 문장 삭제 (마지막 줄 삭제)
    // Windows/Linux: Shift+Backspace, Mac: Option+Shift+Backspace (자동 기능과 충돌 방지)
    const isShiftBackspace = (e.shiftKey && !e.altKey && !e.ctrlKey && e.key === "Backspace") ||
                            (e.shiftKey && e.altKey && !e.ctrlKey && e.key === "Backspace");
    if (isShiftBackspace) {
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

    if (isDemo) {
      setPracticeCount(prev => prev + 1);
      // 누적 연습도 동시 증가
      const storageKey = `demo_practice_count_${question.id}`;
      const currentCount = parseInt(localStorage.getItem(storageKey) || "0", 10);
      localStorage.setItem(storageKey, String(currentCount + 1));
    } else {
      await createSession.mutateAsync({
        questionId: question.id,
        duration: elapsedTime,
        typingSpeed: speed,
        accuracy: 100, // Not tracking accuracy anymore
        errorCount: 0, // Not tracking errors anymore
      });
    }
  };

  // 돌아가기 버튼 클릭 핸들러
  const handleGoBack = async () => {
    if (isDemo) {
      // 데모 모드: 현재 연습만 초기화하고 돌아가기 (누적 연습은 이미 실시간으로 저장됨)
      setLocation(`/questions/${question?.subjectId || 1}`);
      return;
    }
    
    if (practiceCount > 0 && elapsedTime > 0 && !hasBeenSaved.current) {
      try {
        await savePracticeSession();
      } catch (error) {
        console.error('연습 기록 저장 실패:', error);
      }
    }
    setLocation(`/questions/${question?.subjectId || 1}`);
  };

  // 정답 일치 시 글자 색상 fade out 및 입력 천천히 초기화
  const handleCorrectAnswer = (currentInputLength?: number) => {
    setPracticeCount(prev => prev + 1);
    
    // 페이드아웃 애니메이션을 즉시 시작 (네트워크 요청 기다리지 않음)
    // 0.15초 delay 후 글자 색상 fade out 시작
    setTimeout(() => {
      setIsFadingOut(true);
    }, 150);
    // 0.4초 후 입력창 초기화 및 fade out 해제 + 증감 애니메이션 즉시 표시
    setTimeout(() => {
      isResettingRef.current = true; // 초기화 시작 플래그
      setIsComposing(false); // 한글 조합 강제 종료
      setUserInput('');
      lastInputRef.current = '';
      setInputHistory(['']);
      setStartTime(null);
      if (textareaRef.current) {
        // blur → value 초기화 → focus: 조합 중인 IME 세션을 완전히 종료
        textareaRef.current.blur();
        textareaRef.current.value = '';
        textareaRef.current.setSelectionRange(0, 0);
      }
      // 초기화와 동시에 예상 증감값으로 애니메이션 즉시 표시 (네트워크 대기 X)
      if (!isDemo) {
        setShowDamageNumber(false);
        requestAnimationFrame(() => {
          // 예상 증감값: 연습 1회당 약 1~3% 상승 (실제 값은 나중에 네트워크 응답으로 업데이트)
          const estimatedDiff = confidenceData?.isColdStart ? 10 : Math.max(1, Math.round(10 / Math.max(1, practiceCount + 1)));
          setDamageValue(estimatedDiff);
          setShowDamageNumber(true);
        });
      }
      setTimeout(() => {
        setIsFadingOut(false);
        isResettingRef.current = false; // 초기화 완료
        textareaRef.current?.focus();
      }, 50);
    }, 400);
    
    // 네트워크 요청은 백그라운드로 실행 (애니메이션과 독립적, 실제 값은 나중에 캐시 업데이트)
    if (question && !isDemo) {
      (async () => {
        try {
          const timeInMinutes = elapsedTime / 60;
          const speed = timeInMinutes > 0 ? Math.round(userInput.length / timeInMinutes) : 0;
          await createSession.mutateAsync({
            questionId: question.id,
            duration: Math.max(elapsedTime, 1),
            typingSpeed: speed,
            accuracy: 100,
            errorCount: 0,
          });
          await refetchConfidence();
          const newCount = await utils.practice.countByQuestion.fetch({ questionId: question.id });
          if (newCount) {
            utils.practice.countByQuestion.setData({ questionId: question.id }, newCount);
          }
        } catch (error) {
          console.error('연습 기록 저장 실패:', error);
        }
      })();
    }
    
    // GA4 이벤트 추적
    if (question) {
      const questionType = question.imageUrl && question.imageLabels ? 'image' : 
                          (question.answer?.includes('|') ? 'table' : 'text');
      trackQuestionAttempt(
        question.id,
        question.subjectId,
        questionType as 'text' | 'image' | 'table',
        true,
        elapsedTime
      );
    }
    
    // 데모 모드: 누적 연습도 동시 증가
    if (isDemo && question) {
      const storageKey = `demo_practice_count_${question.id}`;
      const currentCount = parseInt(localStorage.getItem(storageKey) || "0", 10);
      localStorage.setItem(storageKey, String(currentCount + 1));
    }
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
    
    // 반복 모드: 사용자 입력을 현재 체크된 줄의 target과 비교
    const repeatState = repeatStateRef.current;
    const isInRepeatMode = repeatState.isRepeatMode && repeatState.repeatLinesSorted.length > 0;
    const currentRepeatLineIdx = isInRepeatMode
      ? repeatState.repeatLinesSorted[repeatState.repeatCurrentIdx % repeatState.repeatLinesSorted.length]
      : -1;
    
    // 각 줄별 채점 정보
    const lineResults: Array<{
      userChars: string[];
      targetChars: string[];
      completedCount: number;
      isLastCharPartial: boolean;
      lastCharMatchResult: string | null;
    }> = [];
    
    // 엔터 없이 입력 시 초과분을 다음 줄로 이월하기 위한 변수
    let carryOverChars: string[] = [];
    
    for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
      // 반복 모드: 현재 체크된 줄에만 사용자 입력을 매핑
      let userLine = '';
      if (isInRepeatMode) {
        if (lineIdx === currentRepeatLineIdx) {
          userLine = userLines[0] || ''; // 입력창의 첫 줄을 현재 체크된 줄에 매핑
        }
        // 다른 줄은 빈 문자열 (채점 안 함)
      } else {
        userLine = userLines[lineIdx] || '';
      }
      const targetLine = targetLines[lineIdx] || '';
      
      // 각 줄의 글자를 분리 (띄어쓰기 제거)
      let userChars = splitGraphemes(userLine.replace(/\s+/g, ''));
      const targetChars = splitGraphemes(targetLine.replace(/\s+/g, ''));
      
      // 이전 줄에서 이월된 초과 입력을 현재 줄 앞에 추가
      if (!isInRepeatMode && carryOverChars.length > 0) {
        userChars = [...carryOverChars, ...userChars];
        carryOverChars = [];
      }
      
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
        // 초과 입력을 다음 줄로 이월 (엔터 없이 계속 입력하는 경우)
        if (!isInRepeatMode && lineIdx < targetLines.length - 1) {
          carryOverChars = userChars.slice(targetChars.length);
          userChars = userChars.slice(0, targetChars.length);
        }
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
    
    // 현재 입력 중인 줄 인덱스
    // 반복 모드에서는 현재 체크된 줄 인덱스를 사용
    let currentLineIndex = isInRepeatMode ? currentRepeatLineIdx : currentCursorLineIndex;
    
    // 엔터 없이도 다음 줄 자동 인식:
    // 현재 줄의 모든 글자가 완성(completedCount === targetChars.length)이면
    // 다음 줄의 첫 글자에 언더바를 표시하기 위해 activeLineIdx를 다음 줄로 이동
    if (!isInRepeatMode && currentLineIndex < targetLines.length - 1) {
      const currentResult = lineResults[currentLineIndex];
      if (currentResult && currentResult.completedCount >= currentResult.targetChars.length && currentResult.targetChars.length > 0) {
        // 현재 줄 입력 완료 → 다음 줄로 이동
        currentLineIndex = currentLineIndex + 1;
      }
    }
    
    return { lineResults, currentLineIndex, userLines, targetLines };
  }, [userInput, targetText, renderTrigger, currentCursorLineIndex, repeatCheckedLines, repeatCurrentIdx]);

  // 실시간 단어 뷰: 줄 단위 opacity 계산
  const calculateLineOpacity = useMemo(() => {
    const lines = targetText.split('\n');
    const rs = repeatStateRef.current;
    const inRepeat = rs.isRepeatMode && rs.repeatLinesSorted.length > 0;
    const repeatLineIdx = inRepeat
      ? rs.repeatLinesSorted[rs.repeatCurrentIdx % rs.repeatLinesSorted.length]
      : -1;
    
    // completionInfo의 currentLineIndex를 사용 (다음 줄 자동 인식 반영)
    const activeIdx = completionInfo.currentLineIndex;
    
    // 각 줄의 opacity 계산
    return lines.map((_, lineIndex) => {
      if (inRepeat) {
        // 반복 모드: 현재 체크된 줄만 진하게
        return lineIndex === repeatLineIdx ? 1 : 0.4;
      }
      // 현재 활성 줄만 opacity 1 (진한 회색)
      if (lineIndex === activeIdx) {
        return 1;
      } else {
        return 0.4;
      }
    });
  }, [completionInfo, targetText, repeatCheckedLines, repeatCurrentIdx]);

  // 한컴타자연습 스타일 렌더링 (줄 단위 비교)
  const renderTextWithFeedback = useMemo(() => {
    const { lineResults, currentLineIndex: activeLineIdx } = completionInfo;
    // 전체 정답을 항상 표시 (반복 모드에서도 동일)
    const targetLines = targetText.split('\n');
    
    return targetLines.map((line, lineIdx) => {
      const actualLineIdx = lineIdx;
      const lineResult = lineResults[lineIdx];
      const lineOpacity = calculateLineOpacity[lineIdx] || 1;
      const isActiveLine = lineIdx === activeLineIdx;
      
      // 답 가리기 체크
      const isLineHidden = hideMode === 'all' || (hideMode === 'line' && hiddenLines.has(lineIdx));
      
      if (isLineHidden) {
        // 가려진 줄: 클릭하면 해당 줄만 보이기
        const revealLine = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (hideMode === 'all') {
            setHiddenLines(prev => {
              const next = new Set(prev);
              if (next.has(lineIdx)) next.delete(lineIdx);
              else next.add(lineIdx);
              return next;
            });
          } else if (hideMode === 'line') {
            setHiddenLines(prev => {
              const next = new Set(prev);
              if (next.has(lineIdx)) next.delete(lineIdx);
              else next.add(lineIdx);
              return next;
            });
          }
        };
        return (
          <div
            key={`line-${lineIdx}`}
            className="block cursor-pointer select-none group my-0.5"
            onClick={revealLine}
            onMouseDown={(e) => e.preventDefault()} // 포커스 이동 방지
          >
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted/60 rounded text-muted-foreground/50 text-sm hover:bg-muted hover:text-muted-foreground transition-colors">
              <EyeOff className="h-3 w-3" />
              {lineIdx + 1}번째 줄 (클릭하여 보기)
            </span>
          </div>
        );
      }
      
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
          // 현재 입력 위치 (다음에 입력할 글자) - 언더바 표시 (현재 비활성화)
          // 단, 현재 커서 위치의 줄에만 언더바 표시
          // if (lineIdx === activeLineIdx && currentCharIdx === completedCount) {
          //   return (
          //     <span key={`${lineIdx}-${charIndex}`} className="border-b-4 border-gray-600 text-gray-600 relative font-semibold text-xl animate-pulse" style={{ opacity: 1 }}>
          //       {char}
          //     </span>
          //   );
          // }
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
          const fadeClass = isFadingOut ? (lineIdx === 0 ? "text-gray-600" : "text-gray-300") : "text-foreground";
          return (
            <span key={`${lineIdx}-${charIndex}`} className={fadeClass + " relative font-semibold text-xl transition-colors duration-300"} style={{ opacity: 1 }}>
              {char}
            </span>
          );
        } else if (matchResult === 'partial' || matchResult === 'partial_complete') {
          if (matchResult === 'partial_complete') {
            const fadeClass = isFadingOut ? (lineIdx === 0 ? "text-gray-600" : "text-gray-300") : "text-foreground";
            return (
              <span key={`${lineIdx}-${charIndex}`} className={fadeClass + " relative font-semibold text-xl transition-colors duration-300"} style={{ opacity: 1 }}>
                {char}
              </span>
            );
          }
          // partial 상태 언더바 표시 (현재 비활성화)
          // return (
          //   <span key={`${lineIdx}-${charIndex}`} className="border-b-4 border-gray-600 text-gray-600 relative font-semibold text-xl" style={{ opacity: 1 }}>
          //     {char}
          //   </span>
          // );
          return (
            <span key={`${lineIdx}-${charIndex}`} className="text-gray-600 relative font-semibold text-xl" style={{ opacity: 1 }}>
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
      // 첫 줄은 진한 회색 글씨, 나머지는 연한 회색 줄로 fade out
      const lineClass = lineIdx === 0 
        ? (isFadingOut ? "text-gray-600 transition-colors duration-300" : "text-foreground")
        : (isFadingOut ? "text-gray-300 transition-colors duration-300" : "text-foreground");
      
      // 체크된 줄 하이라이트
      const isChecked = repeatCheckedLines.has(actualLineIdx);
      const isCurrentRepeat = isRepeatMode && currentRepeatTarget?.lineIdx === actualLineIdx;
      // 체크된 줄: 연한 노란 하이라이트 / 현재 반복 중인 줄: 진한 노란
      const lineHighlight = isCurrentRepeat
        ? 'bg-yellow-200/80 dark:bg-yellow-700/50 rounded px-1 -mx-1'
        : isChecked
        ? 'bg-yellow-100/60 dark:bg-yellow-900/30 rounded px-1 -mx-1'
        : '';
      // 체크박스는 전체 줄 수가 2줄 이상일 때만 표시
      const showCheckbox = targetLines.length > 1 && hideMode === 'none';

      // 체크박스 버튼 공통 컴포넌트
      const checkboxBtn = showCheckbox ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleRepeatLine(actualLineIdx); }}
          className={`inline-flex items-center justify-center flex-shrink-0 mr-1.5 transition-opacity select-none ${
            isChecked ? 'opacity-100 text-purple-600' : 'opacity-0 group-hover/line:opacity-60 text-muted-foreground'
          }`}
          style={{ width: '14px', height: '14px', verticalAlign: 'middle' }}
          title={isChecked ? '반복 연습에서 제외' : '반복 연습에 추가'}
          aria-hidden="true"
          tabIndex={-1}
        >
          <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center text-[8px] ${
            isChecked ? 'bg-purple-500 border-purple-500 text-white' : 'border-current'
          }`}>
            {isChecked && '✓'}
          </span>
        </button>
      ) : null;

      // 체크박스 공간 placeholder (체크박스 없을 때도 들여쓰기 유지 불필요, 체크박스 있을 때만 pl 적용)
      if (lineIdx < targetLines.length - 1) {
        return (
          <span key={`line-${lineIdx}`} className={`${lineClass} ${lineHighlight} group/line`}
            style={showCheckbox ? { display: 'block', paddingLeft: '20px', textIndent: '-20px' } : { display: 'block' }}
          >
            {checkboxBtn}
            {renderedChars}
            <span aria-hidden="true" className="text-muted-foreground select-none">{"\n"}</span>
          </span>
        );
      }
      
      return (
        <span key={`line-${lineIdx}`} className={`${lineClass} ${lineHighlight} group/line`}
          style={showCheckbox ? { display: 'block', paddingLeft: '20px', textIndent: '-20px' } : { display: 'block' }}
        >
          {checkboxBtn}
          {renderedChars}
        </span>
      );
    });
  }, [userInput, targetText, completionInfo, isFadingOut, calculateLineOpacity, hideMode, hiddenLines, repeatCheckedLines, currentRepeatTarget, isRepeatMode, toggleRepeatLine]);

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
    <div className={`relative ${isImageQuestion ? 'space-y-2' : 'space-y-6'}`}>
      <DamageNumber
        value={damageValue}
        show={showDamageNumber}
        onComplete={() => setShowDamageNumber(false)}
      />
      {isImageQuestion ? (
        /* 이미지 문제: 최소 상단 - 돌아가기 + 연습횟수를 한 줄에 작게 */
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleGoBack} className="gap-1 h-7 px-2 text-xs">
            <ArrowLeft className="h-3 w-3" />
            돌아가기
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{practiceCountDisplay} 현재</span>
            <span>{isDemo && question ? parseInt(localStorage.getItem(`demo_practice_count_${question.id}`) || "0", 10) : (practiceCountData?.count || 0)} 누적</span>
            <Circle className={`h-2 w-2 ${isActive ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"}`} />
          </div>
        </div>
      ) : (
        /* 텍스트/표 문제: 기존 상단 */
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
              <p className="text-2xl font-bold">{isDemo && question ? parseInt(localStorage.getItem(`demo_practice_count_${question.id}`) || "0", 10) : (practiceCountData?.count || 0)}</p>
              <p className="text-xs text-muted-foreground">누적 연습</p>
            </div>
            {!isDemo && confidenceData && (
              <div className="text-center">
                <p className="text-2xl font-bold" style={{
                  color: confidenceData.state === 'green' ? '#10b981' : confidenceData.state === 'yellow' ? '#f59e0b' : '#ef4444'
                }}>{Math.round(confidenceData.displayScore)}%</p>
                <p className="text-xs text-muted-foreground">안정도</p>
              </div>
            )}
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
      )}

      {/* 학습 제안 배너 */}
      {studySuggestion && !isImageQuestion && (
        <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm ${
          studySuggestion.type === 'mastered' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' :
          studySuggestion.type === 'test_ready' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20' :
          studySuggestion.type === 'hide_practice' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20' :
          'bg-muted/50 text-muted-foreground border border-border'
        }`}>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 flex-shrink-0" />
            <span>{studySuggestion.message}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(studySuggestion.type === 'test_ready' || studySuggestion.type === 'mastered') && question && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setLocation(`/test/${question.id}`)}
              >
                백지복습 시험
              </Button>
            )}
            {studySuggestion.type === 'hide_practice' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setHideMode('all');
                }}
              >
                <EyeOff className="h-3 w-3" />
                답 가리기
              </Button>
            )}
          </div>
        </div>
      )}

      <Card className={isImageQuestion ? 'shadow-none border-0' : 'shadow-elegant'}>
        {!isImageQuestion && (
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{question.question}</CardTitle>
                <CardDescription>
                  {isTableQuestion ? "표의 연습 셀을 타이핑하세요 (Tab/Enter로 다음 칸으로 이동)" : "정답을 따라 입력하세요 (띄어쓰기 무시)"}
                </CardDescription>
              </div>
              {!isTableQuestion && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 gap-1.5 text-xs ${hideMode !== 'none' ? 'bg-amber-500/10 text-amber-600' : ''}`}
                    onClick={() => {
                      if (hideMode === 'all') {
                        setHideMode('none');
                        setHiddenLines(new Set());
                      } else {
                        setHideMode('all');
                      }
                    }}
                    title="Tab으로도 토글 가능"
                  >
                    {hideMode !== 'none' ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {hideMode !== 'none' ? '답 보기' : '답 가리기'}
                  </Button>
                  {hideMode === 'none' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        setHideMode('line');
                        const lines = targetText.split('\n');
                        setHiddenLines(new Set(lines.map((_, i) => i)));
                      }}
                      title="Shift+Tab으로도 토글 가능"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      문장별
                    </Button>
                  )}
                  {question && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setLocation(`/test/${question.id}`)}
                    >
                      <Zap className="h-3.5 w-3.5" />
                      백지시험
                    </Button>
                  )}
                  {!isDemo && question && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 gap-1.5 text-xs ${memoOpen ? 'bg-blue-500/10 text-blue-600' : ''}`}
                      onClick={() => setMemoOpen(!memoOpen)}
                      title="암기법/설명 메모 (영구 저장)"
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                      메모
                    </Button>
                  )}
                  {!isDemo && question && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 gap-1.5 text-xs ${editMode ? 'bg-orange-500/10 text-orange-600' : ''}`}
                      onClick={() => editMode ? setEditMode(false) : startEditMode()}
                      title="문제/답안 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
        )}
        <CardContent className={isImageQuestion ? 'p-0 space-y-2' : 'space-y-6'}>
          {/* 메모 패널 - 정답 표시 영역과 2단 레이아웃으로 표시됨 (memoOpen 시) */}

          {/* 인라인 문제 편집 모드 */}
          {editMode && !isImageQuestion && (
            <div className="rounded-lg border-2 border-orange-300 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">문제 수정</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-100"
                    onClick={handleSaveEdit}
                    disabled={updateQuestionMutation.isPending}
                  >
                    <Check className="h-3 w-3" />
                    {updateQuestionMutation.isPending ? '저장 중...' : '저장'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setEditMode(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">문제</label>
                  <input
                    type="text"
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    className="w-full p-2 rounded-md border border-orange-200 dark:border-orange-700 bg-white dark:bg-orange-950/30 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1 block">답안</label>
                  <textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    className="w-full min-h-[120px] p-2 rounded-md border border-orange-200 dark:border-orange-700 bg-white dark:bg-orange-950/30 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 줄 반복 연습 상태 배지 */}
          {isRepeatMode && !isImageQuestion && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-100/60 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700">
              <Repeat className="h-3.5 w-3.5 text-purple-600 shrink-0" />
              <span className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                반복 연습 중
              </span>
              <span className="text-xs text-purple-600 dark:text-purple-400">
                {repeatCheckedLines.size}줄 선택
              </span>
              {currentRepeatTarget && (
                <span className="text-xs text-purple-500 dark:text-purple-400 truncate max-w-[200px]">
                  → {currentRepeatTarget.lineIdx + 1}번째 줄 ({repeatCount}회 / 전체 {repeatTotalCount}회)
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs ml-auto text-purple-600 hover:text-purple-800 hover:bg-purple-200"
                onClick={stopRepeatMode}
              >
                종료
              </Button>
            </div>
          )}

          {isTableQuestion && tableData ? (
            /* Table question - 하단 입력창 연습 모드 */
            (() => {
              const blankCells = getBlankCells(tableData);
              const activeCellKey = blankCells[tableActiveCellIdx] ?? null;
              // 체크된 셀만 연습 중이면 해당 셀만 순환
              const targetCells = tableCheckedCells.size > 0
                ? blankCells.filter(k => tableCheckedCells.has(k))
                : blankCells;

              const handleTableInput = (value: string) => {
                setTableCellInput(value);
                if (!startTime) setStartTime(Date.now());
                setLastInputTime(Date.now());
                setIsActive(true);
              };

              const handleTableKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // 현재 셀 정답 체크
                  if (!activeCellKey) return;
                  const ri = parseInt(activeCellKey.split('-')[0]);
                  const ci = parseInt(activeCellKey.split('-')[1]);
                  const cell = tableData.cells[ri]?.[ci];
                  if (!cell) return;
                  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
                  if (norm(tableCellInput) === norm(cell.content)) {
                    // 정답: 완성 셀에 추가
                    setTableCompletedCells(prev => new Set(Array.from(prev).concat(activeCellKey)));
                    setTableCellInput('');
                    // 다음 셀로 이동
                    const nextIdx = (tableActiveCellIdx + 1) % targetCells.length;
                    const nextKey = targetCells[nextIdx];
                    const nextBlankIdx = blankCells.indexOf(nextKey);
                    setTableActiveCellIdx(nextBlankIdx >= 0 ? nextBlankIdx : 0);
                    // 모든 셀 완성 체크
                    const newCompleted = new Set(Array.from(tableCompletedCells).concat(activeCellKey));
                    const allDone = targetCells.every(k => newCompleted.has(k));
                    if (allDone) {
                      // 연습 완료
                      handleCorrectAnswer(targetCells.length);
                      setTimeout(() => {
                        setTableCompletedCells(new Set());
                        setTableActiveCellIdx(0);
                        setTableCellInput('');
                      }, 400);
                    }
                  } else {
                    // 오답: 입력창 말담말담 애니메이션
                    if (tableCellInputRef.current) {
                      tableCellInputRef.current.style.animation = 'none';
                      setTimeout(() => {
                        if (tableCellInputRef.current) {
                          tableCellInputRef.current.style.animation = 'shake 0.3s ease-out';
                        }
                      }, 10);
                    }
                  }
                }
              };

              return (
                <div className="space-y-3">
                  <TableView
                    tableData={tableData}
                    activeCellKey={activeCellKey}
                    completedCells={tableCompletedCells}
                    checkedCells={tableCheckedCells}
                    onCellCheck={(key) => {
                      setTableCheckedCells(prev => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      });
                    }}
                    partialInput={tableCellInput}
                  />
                  {/* 하단 입력창 */}
                  <div className="space-y-1">
                    {activeCellKey && (() => {
                      const ri = parseInt(activeCellKey.split('-')[0]);
                      const ci = parseInt(activeCellKey.split('-')[1]);
                      const cell = tableData.cells[ri]?.[ci];
                      const targetCellIdx = targetCells.indexOf(activeCellKey) + 1;
                      return cell ? (
                        <div className="text-xs text-muted-foreground">
                          셀 {targetCellIdx}/{targetCells.length} • 정답 입력 후 Enter
                          {tableCheckedCells.size > 0 && <span className="ml-2 text-purple-600">(집중 연습 모드)</span>}
                        </div>
                      ) : null;
                    })()}
                    <textarea
                      ref={tableCellInputRef}
                      value={tableCellInput}
                      onChange={(e) => handleTableInput(e.target.value)}
                      onKeyDown={handleTableKeyDown}
                      rows={1}
                      className="w-full min-h-[44px] max-h-[120px] p-3 rounded-lg border-2 border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring caret-foreground overflow-y-auto"
                      style={{ fieldSizing: 'content' } as React.CSSProperties}
                      placeholder="여기에 입력 후 Enter..."
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div>연습 횟수: {practiceCount}회</div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTableCompletedCells(new Set());
                        setTableActiveCellIdx(0);
                        setTableCellInput('');
                      }}
                    >
                      초기화
                    </Button>
                  </div>
                  <style>{`
                    @keyframes shake {
                      0%, 100% { transform: translateX(0); }
                      20% { transform: translateX(-6px); }
                      40% { transform: translateX(6px); }
                      60% { transform: translateX(-4px); }
                      80% { transform: translateX(4px); }
                    }
                  `}</style>
                </div>
              );
            })()
          ) : isImageQuestion ? (
            /* Image question with label boxes - resizable 2 column layout */
            <div>
              <div className="flex flex-col lg:flex-row gap-2" style={{ alignItems: 'flex-start' }}>
                {/* Left: Image with labels */}
                <div className="flex-shrink-0 relative" style={{ width: `${imageScale}%`, minWidth: '200px' }}>
                  {/* Size control - floating overlay on top-right of image */}
                  <div className="absolute top-1 right-1 z-10 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded px-1.5 py-0.5 border border-border/50">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setImageScale(Math.max(30, imageScale - 10))}
                        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                        title="줄이기"
                      >−</button>
                      <span className="text-[10px] font-mono w-8 text-center">{imageScale}%</span>
                      <button
                        onClick={() => setImageScale(Math.min(100, imageScale + 10))}
                        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                        title="늘이기"
                      >+</button>
                    </div>
                    <button
                      onClick={() => {
                        if (imageContainerRef.current) {
                          const img = imageContainerRef.current.querySelector('img');
                          if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
                            const imgWidth = img.naturalWidth;
                            const imgHeight = img.naturalHeight;
                            const maxWidth = window.innerWidth * 0.4;
                            const maxHeight = window.innerHeight * 0.7;
                            const scaleByWidth = (maxWidth / imgWidth) * 100;
                            const scaleByHeight = (maxHeight / imgHeight) * 100;
                            const optimalScale = Math.min(scaleByWidth, scaleByHeight, 100);
                            setImageScale(Math.max(30, Math.round(optimalScale)));
                          }
                        }
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted transition-colors"
                    >맞춤</button>
                  </div>
                  <div className="relative w-full rounded-lg border-2 border-border overflow-hidden" ref={imageContainerRef}>
                    {!imageLoaded && (
                      <div className="flex items-center justify-center min-h-[300px] md:min-h-[400px] bg-muted/30 rounded-lg border-2 border-border">
                        <p className="text-muted-foreground">이미지 로딩 중...</p>
                      </div>
                    )}
                    <img
                      src={question.imageUrl || ""}
                      alt="Question image"
                      className={`w-full h-auto block ${!imageLoaded ? 'hidden' : ''}`}
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
                              ? "border-dashed border-primary bg-transparent"
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
                              lastLabelActionRef.current = 'hide';
                            } else {
                              newRevealed.add(index);
                              lastLabelActionRef.current = 'reveal';
                            }
                            revealedLabelsRef.current = newRevealed;
                            setRevealedLabels(newRevealed);
                            if (!hasInteracted) setHasInteracted(true);
                            if (!startTime) setStartTime(Date.now());
                            setLastInputTime(Date.now());
                            if (!isActive) setIsActive(true);
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
                  {/* License information */}
                  <div className="mt-2 text-xs text-muted-foreground space-y-0.5 border-t border-border/50 pt-1">
                    {question?.id === 570001 ? (
                      <>
                        <p>© Ksiom, Kwj2772 / Wikimedia Commons</p>
                        <p>Licensed under Public Domain</p>
                      </>
                    ) : question?.id === 570002 ? (
                      <>
                        <p>© Jonathan Richter</p>
                        <p>https://richterguitar.com</p>
                      </>
                    ) : question?.id === 600004 ? (
                      <>
                        <p>머리 및 목 해부학 2021 개정판</p>
                        <p>저자: 김명국, p.10</p>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Right: Lined notebook-style practice note */}
                <div className="flex-1 flex flex-col" style={{ minWidth: '200px' }}>
                  <div
                    className="relative rounded-lg border-2 border-border bg-background overflow-hidden cursor-text"
                    style={{ height: `${imageContainerHeight}px` }}
                    onMouseDown={(e) => {
                      // textarea 자체 클릭은 기본 동작으로 처리
                      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                      e.preventDefault();
                      const ta = notepadRef.current;
                      if (!ta) return;
                      ta.focus();
                      // 클릭한 Y 위치로 커서 이동
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickY = e.clientY - rect.top;
                      const lineHeight = 28;
                      const paddingTop = 8;
                      const targetLine = Math.floor((clickY - paddingTop) / lineHeight);
                      if (targetLine >= 0) {
                        const lines = ta.value.split('\n');
                        let pos = 0;
                        for (let i = 0; i < Math.min(targetLine, lines.length - 1); i++) {
                          pos += lines[i].length + 1;
                        }
                        pos += (lines[Math.min(targetLine, lines.length - 1)]?.length || 0);
                        ta.setSelectionRange(pos, pos);
                      }
                    }}
                  >
                    {/* Lined paper background */}
                    <div className="absolute inset-0 pointer-events-none" style={{ 
                      backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, oklch(0.7 0.01 260 / 0.25) 27px, oklch(0.7 0.01 260 / 0.25) 28px)',
                      backgroundPositionY: '7px'
                    }} />
                    {/* Left margin line */}
                    <div className="absolute top-0 bottom-0 left-[36px] w-[1px] pointer-events-none" style={{ backgroundColor: 'oklch(0.7 0.1 20 / 0.2)' }} />
                    <textarea
                      ref={notepadRef}
                      value={practiceNote}
                      onChange={(e) => {
                        setPracticeNote(e.target.value);
                        if (!hasInteracted && e.target.value.trim().length > 0) setHasInteracted(true);
                        if (!startTime) setStartTime(Date.now());
                        setLastInputTime(Date.now());
                        if (!isActive) setIsActive(true);
                      }}
                      className="absolute inset-0 bg-transparent resize-none focus:outline-none font-mono text-sm text-foreground"
                      style={{
                        lineHeight: '28px',
                        paddingTop: '8px',
                        paddingLeft: '44px',
                        caretColor: 'oklch(0.5 0.15 260)',
                        zIndex: 1,
                        overflow: 'hidden',
                      }}
                      placeholder=""
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Text question with visual feedback */
            <>
              {/* 메모 열린 경우: 정답 좌 / 메모 우 2단 레이아웃 */}
              <div className={memoOpen ? "flex gap-4 items-stretch" : ""}>
                <div
                  ref={answerDisplayRef}
                  className={`p-6 bg-muted/30 rounded-lg border-2 border-border overflow-y-auto ${memoOpen ? 'flex-1 max-h-[500px]' : 'max-h-[400px]'}`}
                >
                  <div className="leading-relaxed whitespace-pre-wrap">
                    {renderTextWithFeedback}
                  </div>
                </div>

                {/* 메모 패널 - 정답과 나란히 */}
                {memoOpen && (
                  <div className="flex-1 rounded-lg border-2 border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-700 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">암기법 / 설명 메모</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-200/60 dark:bg-blue-800/40 text-blue-600 dark:text-blue-400">영구 저장</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {memoSaved && <span className="text-xs text-emerald-600">✓ 저장됨</span>}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
                          onClick={handleSaveMemo}
                          disabled={memoSaving}
                        >
                          <Save className="h-3 w-3" />
                          {memoSaving ? '저장 중...' : '저장'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setMemoOpen(false)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <textarea
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="암기법, 연상 기억법, 설명 등을 적어두세요. 연습장과 달리 이 내용은 영구적으로 저장됩니다."
                      className="flex-1 w-full p-3 rounded-md border border-blue-200 dark:border-blue-700 bg-white dark:bg-blue-950/30 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      style={{ minHeight: '200px' }}
                    />
                  </div>
                )}
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
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Tab</kbd> 답 가리기/보기</span>
                <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Shift</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Tab</kbd> 문장별 가리기</span>
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
