import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Play, RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";

interface PracticeProps {
  questionId: number;
}

export default function Practice({ questionId }: PracticeProps) {
  const [, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const createSession = trpc.practice.create.useMutation({
    onSuccess: () => {
      toast.success("연습 기록이 저장되었습니다");
    },
  });

  const targetText = question?.answer || "";
  const progress = targetText.length > 0 ? (userInput.length / targetText.length) * 100 : 0;

  // Calculate typing metrics
  const calculateMetrics = () => {
    if (!targetText || !userInput) return { accuracy: 0, errorCount: 0, speed: 0 };

    let correctChars = 0;
    let errorCount = 0;

    for (let i = 0; i < userInput.length; i++) {
      if (userInput[i] === targetText[i]) {
        correctChars++;
      } else {
        errorCount++;
      }
    }

    const accuracy = userInput.length > 0 ? Math.round((correctChars / userInput.length) * 100) : 0;
    const timeInMinutes = elapsedTime / 60;
    const speed = timeInMinutes > 0 ? Math.round(userInput.length / timeInMinutes) : 0;

    return { accuracy, errorCount, speed };
  };

  const metrics = calculateMetrics();

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStarted && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isStarted, startTime]);

  const handleStart = () => {
    setIsStarted(true);
    setStartTime(Date.now());
    setUserInput("");
    setElapsedTime(0);
    textareaRef.current?.focus();
  };

  const handleReset = () => {
    setIsStarted(false);
    setStartTime(null);
    setUserInput("");
    setElapsedTime(0);
  };

  const handleComplete = async () => {
    if (!question || elapsedTime === 0) return;

    const { accuracy, errorCount, speed } = calculateMetrics();

    await createSession.mutateAsync({
      questionId: question.id,
      duration: elapsedTime,
      typingSpeed: speed,
      accuracy,
      errorCount,
    });

    handleReset();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Render character comparison
  const renderComparison = () => {
    if (!targetText) return null;

    return (
      <div className="font-mono text-lg leading-relaxed whitespace-pre-wrap break-words">
        {targetText.split("").map((char, index) => {
          let className = "text-muted-foreground";
          
          if (index < userInput.length) {
            if (userInput[index] === char) {
              className = "text-green-600 bg-green-50";
            } else {
              className = "text-red-600 bg-red-50 font-bold";
            }
          } else if (index === userInput.length) {
            className = "text-foreground bg-primary/20";
          }

          return (
            <span key={index} className={className}>
              {char}
            </span>
          );
        })}
      </div>
    );
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
          <Button onClick={() => setLocation("/subjects")}>과목 목록으로</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/questions/${question.subjectId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">연습 모드</h1>
          <p className="text-muted-foreground mt-1">답안을 따라 타이핑하세요</p>
        </div>
      </div>

      {/* Question */}
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>문제</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg whitespace-pre-wrap">{question.question}</p>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle>연습 진행</CardTitle>
          <CardDescription>
            {isStarted ? "타이핑을 시작하세요" : "시작 버튼을 눌러 연습을 시작하세요"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {!isStarted ? (
                <Button onClick={handleStart} className="gap-2">
                  <Play className="h-4 w-4" />
                  시작
                </Button>
              ) : (
                <>
                  <Button onClick={handleReset} variant="outline" className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    다시 시작
                  </Button>
                  {userInput.length >= targetText.length && (
                    <Button onClick={handleComplete} className="gap-2">
                      <Check className="h-4 w-4" />
                      완료
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{formatTime(elapsedTime)}</p>
              <p className="text-sm text-muted-foreground">경과 시간</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>진행률</span>
              <span>{Math.min(100, Math.round(progress))}%</span>
            </div>
            <Progress value={Math.min(100, progress)} />
          </div>

          {isStarted && (
            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.speed}</p>
                <p className="text-sm text-muted-foreground">CPM</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.accuracy}%</p>
                <p className="text-sm text-muted-foreground">정확도</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.errorCount}</p>
                <p className="text-sm text-muted-foreground">오타</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Target Text Display */}
      {isStarted && (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>모범 답안</CardTitle>
            <CardDescription>초록색: 정확, 빨간색: 오타, 회색: 아직 입력 안 함</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-muted/30 rounded-lg">
            {renderComparison()}
          </CardContent>
        </Card>
      )}

      {/* Input Area */}
      {isStarted && (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>입력 영역</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              ref={textareaRef}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="여기에 타이핑하세요..."
              rows={10}
              className="font-mono text-lg"
              disabled={!isStarted}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
