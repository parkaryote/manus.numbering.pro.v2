import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Play, Send, RotateCcw, Mic, MicOff, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { TableView, TableData, getBlankCells, gradeTable } from "@/components/TableEditor";

interface TestProps {
  questionId: number;
  isDemo?: boolean;
}

export default function Test({ questionId, isDemo = false }: TestProps) {
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
  const [answerHistory, setAnswerHistory] = useState<string[]>([""]);
  const [answerHistoryIndex, setAnswerHistoryIndex] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: question, isLoading } = trpc.questions.getById.useQuery({ id: questionId });
  const imageLabels = question?.imageLabels ? JSON.parse(question.imageLabels) : [];
  const isImageQuestion = !!question?.imageUrl && imageLabels.length > 0;
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
    setTableAnswers({});
    setTableResults(null);
    setTableScore(null);
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
    setTableAnswers({});
    setTableResults(null);
    setTableScore(null);
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

      // Update review schedule
      const quality = score === total ? 5 : Math.max(0, Math.floor((score / total) * 5));
      await updateReviewMutation.mutateAsync({
        questionId: question.id,
        quality,
      });

      if (score === total) {
        toast.success(`🎉 모두 정답! (${score}/${total})`);
      } else {
        toast.error(`${score}/${total} 정답`);
      }
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
      if (!isDemo) {
        await evaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: combinedAnswer,
          recallTime,
        });
      } else {
        // Demo mode: show result without saving
        setResult({ score: 0, total: 100, isCorrect: false });
        setIsSubmitted(true);
      }
    } else {
      // 텍스트 문제인 경우
      if (!userAnswer.trim()) {
        toast.error("답안을 입력하세요");
        return;
      }
      if (!isDemo) {
        await evaluateMutation.mutateAsync({
          questionId: question.id,
          userAnswer: userAnswer.trim(),
          recallTime,
        });
      } else {
        // Demo mode: show result without saving
        setResult({ score: 0, total: 100, isCorrect: false });
        setIsSubmitted(true);
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

  // 단축키 안내 표시 설정 (localStorage)
  const [showShortcutHelp, setShowShortcutHelp] = useState(() => {
    const saved = localStorage.getItem("showShortcutHelp");
    return saved !== null ? saved === "true" : true;
  });

  const toggleShortcutHelp = () => {
    const newValue = !showShortcutHelp;
    setShowShortcutHelp(newValue);
    localStorage.setItem("showShortcutHelp", String(newValue));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter: 줄바꿈 추가 (autoNumbering=1인 경우, 답안 줄 수만큼 허용)
    if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.altKey && question?.autoNumbering === 1) {
      const targetText = question?.answer || '';
      const lines = targetText.split('\n');
      const maxLines = lines.length;
      const currentLines = userAnswer.split('\n').length;
      
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
    
    // Ctrl+Z: Undo
    if (e.ctrlKey && e.key === "z") {
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
    
    // Ctrl+Shift+Z: Redo
    if (e.ctrlKey && e.shiftKey && e.key === "z") {
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
    
    // Shift+Backspace: 문장 삭제 (마지막 줄 삭제) - Alt+Backspace처럼 즉시 작동
    if (e.shiftKey && !e.altKey && !e.ctrlKey && e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      const composing = e.nativeEvent.isComposing;
      
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
          setUserAnswer(newValue);
          
          // 히스토리에 기록
          const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
          if (newHistory[newHistory.length - 1] !== newValue) {
            newHistory.push(newValue);
            if (newHistory.length > 50) {
              newHistory.shift();
            }
          }
          setAnswerHistory(newHistory);
          setAnswerHistoryIndex(newHistory.length - 1);
          
          textarea.focus();
        }, 10);
      } else {
        // 조합 중이 아닐 때: 즉시 삭제
        const currentValue = textarea.value;
        const newValue = deleteLine(currentValue);
        setUserAnswer(newValue);
        
        // 히스토리에 기록
        const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
        if (newHistory[newHistory.length - 1] !== newValue) {
          newHistory.push(newValue);
          if (newHistory.length > 50) {
            newHistory.shift();
          }
        }
        setAnswerHistory(newHistory);
        setAnswerHistoryIndex(newHistory.length - 1);
      }
      return;
    }
    
    // Alt+Backspace: 띄어쓰기 단위 단어 삭제
    if (e.altKey && !e.shiftKey && !e.ctrlKey && e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      
      const textarea = e.currentTarget;
      
      // 한글 조합 중인지 확인
      const composing = e.nativeEvent.isComposing;
      
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
          
          setUserAnswer(newValue);
          
          // 히스토리에 기록
          const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
          if (newHistory[newHistory.length - 1] !== newValue) {
            newHistory.push(newValue);
            if (newHistory.length > 50) {
              newHistory.shift();
            }
          }
          setAnswerHistory(newHistory);
          setAnswerHistoryIndex(newHistory.length - 1);
          
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
        
        setUserAnswer(newValue);
        
        // 히스토리에 기록
        const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
        if (newHistory[newHistory.length - 1] !== newValue) {
          newHistory.push(newValue);
          if (newHistory.length > 50) {
            newHistory.shift();
          }
        }
        setAnswerHistory(newHistory);
        setAnswerHistoryIndex(newHistory.length - 1);
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
                    value={userAnswer}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setUserAnswer(newValue);
                      
                      // 히스토리에 추가
                      const newHistory = answerHistory.slice(0, answerHistoryIndex + 1);
                      newHistory.push(newValue);
                      if (newHistory.length > 50) {
                        newHistory.shift();
                      }
                      setAnswerHistory(newHistory);
                      setAnswerHistoryIndex(newHistory.length - 1);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="답안을 입력하세요..."
                    rows={12}
                    className="text-base"
                  />
                  {showShortcutHelp && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                      <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Z</kbd> 실행 취소</span>
                      <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Alt</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 단어 삭제</span>
                      <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Shift</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 문장 삭제</span>
                      <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">A</kbd>+<kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Backspace</kbd> 전체 삭제</span>
                      <button onClick={toggleShortcutHelp} className="text-muted-foreground/50 hover:text-muted-foreground underline">숨기기</button>
                    </div>
                  )}
                  {!showShortcutHelp && (
                    <button onClick={toggleShortcutHelp} className="text-xs text-muted-foreground/50 hover:text-muted-foreground underline mt-2">단축키 안내 보기</button>
                  )}
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
                  disabled={evaluateMutation.isPending || (isTableQuestion && tableData ?
                    !getBlankCells(tableData).every((key) => tableAnswers[key]?.trim()) :
                    isImageQuestion ? 
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
              <div className="grid grid-cols-3 gap-4">
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
                      <div key={mistake.labelIndex} className={`p-3 rounded-lg border ${mistake.isCorrect ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold">라벨 {mistake.labelIndex}</span>
                          <span className={`text-lg ${mistake.isCorrect ? 'text-green-600' : 'text-red-600'}`}>{mistake.isCorrect ? '✓' : '✗'}</span>
                        </div>
                        <div className="text-xs space-y-1">
                          <div><span className="font-semibold">정답:</span> {mistake.correctAnswer}</div>
                          <div className={mistake.isCorrect ? 'text-green-700' : 'text-red-700'}><span className="font-semibold">내 답:</span> {mistake.userAnswer || '(입력 없음)'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 bg-green-50 rounded-lg border border-green-300">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">정답</p>
                      <p className="text-sm font-medium whitespace-pre-wrap">{question?.answer}</p>
                    </div>
                    <div className={`p-3 rounded-lg border ${result?.isCorrect ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">내 답</p>
                      <p className={`text-sm font-medium whitespace-pre-wrap ${result?.isCorrect ? 'text-green-700' : 'text-red-700'}`}>{userAnswer}</p>
                    </div>
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
