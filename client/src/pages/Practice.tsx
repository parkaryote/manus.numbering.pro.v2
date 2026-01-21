import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Circle } from "lucide-react";
import { toast } from "sonner";

interface PracticeProps {
  questionId: number;
}

export default function Practice({ questionId }: PracticeProps) {
  const [, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isActive, setIsActive] = useState(true); // 측정 중 여부
  const [lastInputTime, setLastInputTime] = useState<number>(Date.now());
  const [isComposing, setIsComposing] = useState(false); // 한글 조합 중
  const [lastCompletedLength, setLastCompletedLength] = useState(0); // 마지막으로 완성된 글자 길이
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const createSession = trpc.practice.create.useMutation({
    onSuccess: () => {
      toast.success("연습 기록이 저장되었습니다");
      setLocation("/practice");
    },
  });

  const targetText = question?.answer || "";

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

    // Resume if was inactive
    if (!isActive) {
      setIsActive(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    }

    // Auto-complete when normalized text matches
    if (normalizeText(newInput) === normalizeText(targetText)) {
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
      setLocation("/practice");
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    // 조합 종료 시 현재 길이 저장
    const target = e.target as HTMLTextAreaElement;
    const normalized = normalizeText(target.value);
    const normalizedTarget = normalizeText(targetText);
    
    // 정답 글자가 완성되면 즉시 다음으로 이동
    if (normalized.length > lastCompletedLength && 
        normalized[normalized.length - 1] === normalizedTarget[normalized.length - 1]) {
      setLastCompletedLength(normalized.length);
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
      const isCorrect = isTyped && currentChar === normalizedTarget[inputIndex];
      const isError = isTyped && currentChar !== normalizedTarget[inputIndex];
      // 언더바는 조합이 완료된 다음 글자에만 표시
      const isNext = inputIndex === lastCompletedLength;

      inputIndex++;

      let className = "text-gray-400 relative"; // Default: not typed yet
      if (isNext) {
        className = "border-b-4 border-gray-600 text-gray-400 relative animate-pulse"; // Next: thick underline with cursor
      } else if (isComposing && inputIndex > lastCompletedLength) {
        // 조합 중이고 아직 완성되지 않은 부분만 회색
        className = "text-gray-400 relative";
      } else if (isCorrect) {
        className = "text-foreground relative"; // Correct: black text
      } else if (isError) {
        className = "text-red-500 relative"; // Error: red text
      }

      return (
        <span key={targetIndex} className={`${className}`}>
          {char}
        </span>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/practice")} className="gap-2">
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
        <Button variant="ghost" onClick={() => setLocation("/practice")} className="gap-2">
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
        <Button variant="ghost" onClick={() => setLocation("/practice")} className="gap-2">
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
          <CardDescription>아래 답안을 보고 따라 입력하세요 (띄어쓰기는 자유롭게)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Target text with visual feedback */}
          <div className="p-6 bg-muted/30 rounded-lg">
            <div className="text-xl leading-relaxed font-semibold whitespace-pre-wrap">
              {renderTextWithFeedback()}
            </div>
          </div>

          {/* Hidden textarea for input */}
          <textarea
            ref={textareaRef}
            value={userInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            className="w-full min-h-[200px] p-4 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary opacity-0 h-0 absolute"
            placeholder="여기에 입력하세요..."
            autoFocus
          />

          {/* Visible input area (for cursor) */}
          <div
            className="w-full min-h-[200px] p-4 border rounded-lg cursor-text bg-background"
            onClick={() => textareaRef.current?.focus()}
          >
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {userInput || "입력을 시작하세요..."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
