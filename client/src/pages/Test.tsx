import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Play, Send, RotateCcw, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

interface TestProps {
  questionId: number;
}

export default function Test({ questionId }: TestProps) {
  const [, setLocation] = useLocation();
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;
  const updateReviewMutation = trpc.review.updateAfterReview.useMutation();
  
  const evaluateMutation = trpc.test.evaluate.useMutation({
    onSuccess: async (data: any) => {
      setResult(data);
      setIsSubmitted(true);
      toast.success("답안이 제출되었습니다");
      
      // Update review schedule based on performance
      if (question) {
        const quality = data.isCorrect ? 5 : Math.max(0, Math.floor(data.similarityScore / 20));
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
    setIsStarted(true);
    setStartTime(Date.now());
    setUserAnswer("");
    setRecallTime(0);
    setIsSubmitted(false);
    setResult(null);
    textareaRef.current?.focus();
  };

  const handleReset = () => {
    setIsStarted(false);
    setStartTime(null);
    setUserAnswer("");
    setRecallTime(0);
    setIsSubmitted(false);
    setResult(null);
    setAudioBlob(null);
  };

  const handleSubmit = async () => {
    if (!question) return;

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
      await evaluateMutation.mutateAsync({
        questionId: question.id,
        userAnswer: combinedAnswer,
        recallTime,
      });
    } else {
      // 텍스트 문제인 경우
      if (!userAnswer.trim()) {
        toast.error("답안을 입력하세요");
        return;
      }
      await evaluateMutation.mutateAsync({
        questionId: question.id,
        userAnswer: userAnswer.trim(),
        recallTime,
      });
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

  // Render mistake highlights
  const renderMistakes = () => {
    if (!result?.mistakeHighlights) return null;

    try {
      const mistakes = JSON.parse(result.mistakeHighlights);
      return (
        <div className="space-y-2">
          {mistakes.map((mistake: any, index: number) => (
            <div key={index} className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-900">
                위치: {mistake.position} | 유형: {mistake.type}
              </p>
              <p className="text-sm text-red-700 mt-1">{mistake.description}</p>
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
            {isImageQuestion && (
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

              {isImageQuestion ? (
                <div className="space-y-4">
                  {/* 이미지 표시 (라벨 영역 없이) */}
                  <div className="relative inline-block">
                    <img
                      src={question.imageUrl || ""}
                      alt="Question image"
                      className="max-w-full h-auto rounded-lg border-2 border-border"
                      loading="lazy"
                    />
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
                <Textarea
                  ref={textareaRef}
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="답안을 입력하세요..."
                  rows={12}
                  className="text-base"
                />
              )}

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

              <div className="flex gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={evaluateMutation.isPending || (isImageQuestion ? 
                    !imageLabels.every((_: any, index: number) => imageLabelAnswers[index]?.trim()) : 
                    !userAnswer.trim())}
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">
                    {result?.isCorrect ? "✓" : "✗"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">정답 여부</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{result?.similarityScore || 0}%</p>
                  <p className="text-sm text-muted-foreground mt-1">유사도</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{formatTime(recallTime)}</p>
                  <p className="text-sm text-muted-foreground mt-1">회상 시간</p>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <p className="text-3xl font-bold">{result?.accuracyRate || 0}%</p>
                  <p className="text-sm text-muted-foreground mt-1">정확도</p>
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

              <div className="space-y-2">
                <h3 className="font-semibold">내 답안</h3>
                <div className="p-4 bg-muted/30 rounded-lg whitespace-pre-wrap">
                  {isImageQuestion ? (
                    <div className="space-y-2">
                      {imageLabels.map((label: any, index: number) => (
                        <div key={index} className="flex items-start gap-3">
                          <span className="text-sm font-semibold text-primary min-w-[24px]">{index + 1}.</span>
                          <span className="text-sm flex-1">{imageLabelAnswers[index] || "(입력 없음)"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    userAnswer
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">모범 답안</h3>
                <div className="p-4 bg-muted/50 rounded-lg border-2 border-green-500/30 whitespace-pre-wrap">
                  {isImageQuestion ? (
                    <div className="space-y-2">
                      {imageLabels.map((label: any, index: number) => (
                        <div key={index} className="flex items-start gap-3">
                          <span className="text-sm font-semibold text-primary min-w-[24px]">{index + 1}.</span>
                          <span className="text-sm flex-1 font-medium">{label.answer}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    question.answer
                  )}
                </div>
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
