import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Plus, ArrowLeft, Dumbbell, ClipboardCheck, Edit, Trash2, Upload, Image as ImageIcon, GripVertical, Copy, MoveRight } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from "sonner";
import { ImageLabelEditor, ImageLabel } from "@/components/ImageLabelEditor";
import imageCompression from "browser-image-compression";

interface QuestionsProps {
  subjectId: number;
}

interface SortableQuestionCardProps {
  question: any;
  difficultyLabel: Record<string, string>;
  difficultyColor: Record<string, string>;
  onEdit: (question: any) => void;
  onDelete: (id: number) => void;
  onPractice: (id: number) => void;
  onTest: (id: number) => void;
  onCopy: (question: any) => void;
  onMove: (question: any) => void;
}

function SortableQuestionCard({
  question,
  difficultyLabel,
  difficultyColor,
  onEdit,
  onDelete,
  onPractice,
  onTest,
  onCopy,
  onMove,
}: SortableQuestionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasImage = !!question.imageUrl;
  const hasLabels = question.imageLabels && JSON.parse(question.imageLabels).length > 0;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="shadow-elegant hover:shadow-elegant-lg transition-shadow"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none mt-1"
          >
            <GripVertical className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {hasImage && (
                <span className="text-xs font-medium text-blue-600 flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  이미지
                </span>
              )}
              <span className={`text-xs font-medium ${difficultyColor[question.difficulty || "medium"]}`}>
                {difficultyLabel[question.difficulty || "medium"]}
              </span>
            </div>
            <CardTitle className="text-lg mb-2">{question.question}</CardTitle>
            {hasImage && question.imageUrl && (
              <img
                src={question.imageUrl!}
                alt="Question"
                className="max-w-xs rounded-lg border mt-2 mb-2"
              />
            )}
            {!hasImage && (
              <CardDescription className="whitespace-pre-wrap">
                {question.answer.length > 150
                  ? question.answer.substring(0, 150) + "..."
                  : question.answer}
              </CardDescription>
            )}
            {hasLabels && question.imageLabels && (
              <p className="text-xs text-muted-foreground mt-2">
                {JSON.parse(question.imageLabels).length}개의 정답 영역
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCopy(question)}
              title="복사"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMove(question)}
              title="이동"
            >
              <MoveRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(question)}
              title="수정"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(question.id)}
              title="삭제"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => onPractice(question.id)}
        >
          <Dumbbell className="h-4 w-4" />
          연습 모드
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => onTest(question.id)}
        >
          <ClipboardCheck className="h-4 w-4" />
          시험 모드
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Questions({ subjectId }: QuestionsProps) {
  const [, setLocation] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCopyMoveOpen, setIsCopyMoveOpen] = useState(false);
  const [copyMoveMode, setCopyMoveMode] = useState<"copy" | "move">("copy");
  const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "image">("text");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    difficulty: "medium" as "easy" | "medium" | "hard",
    imageUrl: "",
    imageLabels: [] as ImageLabel[],
  });

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions, isLoading } = trpc.questions.listBySubject.useQuery({ subjectId });
  const utils = trpc.useUtils();

  const createMutation = trpc.questions.create.useMutation({
    onSuccess: () => {
      utils.questions.listBySubject.invalidate({ subjectId });
      setIsCreateOpen(false);
      resetForm();
      toast.success("문제가 생성되었습니다");
    },
    onError: (error) => {
      toast.error("문제 생성 실패: " + error.message);
    },
  });

  const updateMutation = trpc.questions.update.useMutation({
    onSuccess: () => {
      utils.questions.listBySubject.invalidate({ subjectId });
      setIsEditOpen(false);
      setEditingQuestion(null);
      resetForm();
      toast.success("문제가 수정되었습니다");
    },
    onError: (error) => {
      toast.error("문제 수정 실패: " + error.message);
    },
  });

  const deleteMutation = trpc.questions.delete.useMutation({
    onSuccess: () => {
      utils.questions.listBySubject.invalidate({ subjectId });
      toast.success("문제가 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("문제 삭제 실패: " + error.message);
    },
  });

  const updateOrderMutation = trpc.questions.updateOrder.useMutation({
    onError: (error) => {
      toast.error("순서 변경 실패: " + error.message);
      utils.questions.listBySubject.invalidate({ subjectId });
    },
  });

  const copyMutation = trpc.questions.copy.useMutation({
    onSuccess: (_, variables) => {
      utils.questions.listBySubject.invalidate({ subjectId });
      utils.questions.listBySubject.invalidate({ subjectId: variables.targetSubjectId });
      setIsCopyMoveOpen(false);
      setSelectedQuestion(null);
      toast.success("문제가 복사되었습니다");
    },
    onError: (error) => {
      toast.error("문제 복사 실패: " + error.message);
    },
  });

  const moveMutation = trpc.questions.move.useMutation({
    onSuccess: (_, variables) => {
      utils.questions.listBySubject.invalidate({ subjectId });
      utils.questions.listBySubject.invalidate({ subjectId: variables.targetSubjectId });
      setIsCopyMoveOpen(false);
      setSelectedQuestion(null);
      toast.success("문제가 이동되었습니다");
    },
    onError: (error) => {
      toast.error("문제 이동 실패: " + error.message);
    },
  });

  const { data: allSubjects } = trpc.subjects.list.useQuery();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !questions) {
      return;
    }

    const oldIndex = questions.findIndex((q) => q.id === active.id);
    const newIndex = questions.findIndex((q) => q.id === over.id);

    const reorderedQuestions = arrayMove(questions, oldIndex, newIndex);
    const questionOrders = reorderedQuestions.map((question, index) => ({
      id: question.id,
      displayOrder: index,
    }));

    // Optimistic update
    utils.questions.listBySubject.setData({ subjectId }, reorderedQuestions.map((q, idx) => ({
      ...q,
      displayOrder: idx,
    })));

    updateOrderMutation.mutate({ questionOrders });
  };

  const resetForm = () => {
    setFormData({
      question: "",
      answer: "",
      difficulty: "medium",
      imageUrl: "",
      imageLabels: [],
    });
    setActiveTab("text");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다");
      return;
    }

    // 파일 크기 체크 (16MB 제한)
    if (file.size > 16 * 1024 * 1024) {
      toast.error("파일 크기는 16MB 이하여야 합니다");
      return;
    }

    setIsUploading(true);
    
    try {
      // 이미지 압축 (2MB 이하로)
      const options = {
        maxSizeMB: 2,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      };
      
      const compressedFile = await imageCompression(file, options);
      
      const uploadFormData = new FormData();
      uploadFormData.append("file", compressedFile);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: uploadFormData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      setFormData((prev) => ({ ...prev, imageUrl: data.url }));
      toast.success("이미지가 업로드되었습니다");
    } catch (error) {
      toast.error("이미지 업로드 실패");
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleQuestionChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, question: value }));
  }, []);

  const handleAnswerChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, answer: value }));
  }, []);

  const handleDifficultyChange = useCallback((value: "easy" | "medium" | "hard") => {
    setFormData((prev) => ({ ...prev, difficulty: value }));
  }, []);

  const handleCreate = useCallback(() => {
    const question = formData.question;
    const answer = formData.answer;

    if (!question.trim()) {
      toast.error("질문을 입력하세요");
      return;
    }

    // Text-based or image-based validation
    if (formData.imageUrl && formData.imageLabels.length > 0) {
      // Image-based question
      const hasEmptyAnswer = formData.imageLabels.some((label) => !label.answer.trim());
      if (hasEmptyAnswer) {
        toast.error("모든 영역의 정답을 입력하세요");
        return;
      }
    } else if (!answer.trim()) {
      // Text-based question
      toast.error("답안을 입력하세요");
      return;
    }

    createMutation.mutate({
      subjectId,
      question,
      answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : answer,
      difficulty: formData.difficulty,
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
    } as any);
  }, [activeTab, formData.imageUrl, formData.imageLabels, formData.difficulty, subjectId, createMutation]);

  const handleEdit = (question: any) => {
    setEditingQuestion(question);
    setFormData({
      question: question.question,
      answer: question.answer || "",
      difficulty: question.difficulty || "medium",
      imageUrl: question.imageUrl || "",
      imageLabels: question.imageLabels ? JSON.parse(question.imageLabels) : [],
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!formData.question.trim()) {
      toast.error("질문을 입력하세요");
      return;
    }

    if (formData.imageUrl && formData.imageLabels.length > 0) {
      const hasEmptyAnswer = formData.imageLabels.some((label) => !label.answer.trim());
      if (hasEmptyAnswer) {
        toast.error("모든 영역의 정답을 입력하세요");
        return;
      }
    } else if (!formData.answer.trim()) {
      toast.error("답안을 입력하세요");
      return;
    }

    updateMutation.mutate({
      id: editingQuestion.id,
      question: formData.question,
      answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : formData.answer,
      difficulty: formData.difficulty,
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
    } as any);
  };

  const handleDelete = (id: number) => {
    if (confirm("이 문제를 삭제하시겠습니까?")) {
      deleteMutation.mutate({ id });
    }
  };

  const handleCopy = (question: any) => {
    setSelectedQuestion(question);
    setCopyMoveMode("copy");
    setIsCopyMoveOpen(true);
  };

  const handleMove = (question: any) => {
    setSelectedQuestion(question);
    setCopyMoveMode("move");
    setIsCopyMoveOpen(true);
  };

  const handleCopyMoveSubmit = (targetSubjectId: number) => {
    if (!selectedQuestion) return;
    
    if (copyMoveMode === "copy") {
      copyMutation.mutate({
        questionId: selectedQuestion.id,
        targetSubjectId,
      });
    } else {
      moveMutation.mutate({
        questionId: selectedQuestion.id,
        targetSubjectId,
      });
    }
  };

  const difficultyLabel = {
    easy: "쉬움",
    medium: "보통",
    hard: "어려움",
  };

  const difficultyColor = {
    easy: "text-green-600",
    medium: "text-yellow-600",
    hard: "text-red-600",
  };

  // QuestionForm을 useMemo로 감싸서 불필요한 리렌더링 방지
  const questionFormContent = (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "text" | "image")} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="text">텍스트 문제</TabsTrigger>
        <TabsTrigger value="image">이미지 문제</TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label htmlFor="question">질문 *</Label>
          <Textarea
            id="question"
            value={formData.question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            placeholder="예: 조선시대의 주요 사건을 시대순으로 나열하시오"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="answer">답안 *</Label>
          <Textarea
            id="answer"
            value={formData.answer}
            onChange={(e) => handleAnswerChange(e.target.value)}
            placeholder="모범 답안을 입력하세요"
            rows={6}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="difficulty">난이도</Label>
          <Select
            value={formData.difficulty}
            onValueChange={handleDifficultyChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">쉬움</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="hard">어려움</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TabsContent>

      <TabsContent value="image" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label htmlFor="question-image">질문 *</Label>
          <Textarea
            id="question-image"
            value={formData.question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            placeholder="예: 다음 해부도에서 표시된 부위의 명칭을 쓰시오"
            rows={2}
          />
        </div>

        {!formData.imageUrl ? (
          <div className="space-y-2">
            <Label>이미지 업로드</Label>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {isUploading ? "업로드 중..." : "이미지 선택"}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                PNG, JPG, GIF (최대 16MB)
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>정답 영역 지정</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormData({ ...formData, imageUrl: "", imageLabels: [] })}
              >
                이미지 제거
              </Button>
            </div>
            <ImageLabelEditor
              imageUrl={formData.imageUrl}
              initialLabels={formData.imageLabels}
              onChange={(labels: ImageLabel[]) => {
                setFormData(prev => ({ ...prev, imageLabels: labels }));
              }}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="difficulty-image">난이도</Label>
          <Select
            value={formData.difficulty}
            onValueChange={handleDifficultyChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">쉬움</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="hard">어려움</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/subjects")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {subject && (
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: subject.color || "#3B82F6" }}
              />
            )}
            <h1 className="text-3xl font-semibold tracking-tight">{subject?.name || "문제 관리"}</h1>
          </div>
          <p className="text-muted-foreground mt-1">문제를 추가하고 학습하세요</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              새 문제 추가
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>새 문제 추가</DialogTitle>
              <DialogDescription>텍스트 또는 이미지 문제를 생성하세요</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {questionFormContent}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>
                취소
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "생성 중..." : "생성"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      ) : questions && questions.length === 0 ? (
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle>문제가 없습니다</CardTitle>
            <CardDescription>첫 문제를 추가하여 학습을 시작하세요</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              첫 문제 만들기
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={questions?.map(q => q.id) || []}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {questions?.map((question) => (
                <SortableQuestionCard
                  key={question.id}
                  question={question}
                  difficultyLabel={difficultyLabel}
                  difficultyColor={difficultyColor}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onPractice={(id) => setLocation(`/practice/${id}`)}
                  onTest={(id) => setLocation(`/test/${id}`)}
                  onCopy={handleCopy}
                  onMove={handleMove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문제 수정</DialogTitle>
            <DialogDescription>문제 내용을 수정하세요</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {questionFormContent}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditOpen(false); resetForm(); }}>
              취소
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "수정 중..." : "수정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy/Move Dialog */}
      <Dialog open={isCopyMoveOpen} onOpenChange={setIsCopyMoveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {copyMoveMode === "copy" ? "문제 복사" : "문제 이동"}
            </DialogTitle>
            <DialogDescription>
              {copyMoveMode === "copy"
                ? "복사할 대상 과목을 선택하세요"
                : "이동할 대상 과목을 선택하세요"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              {allSubjects?.filter(s => copyMoveMode === "copy" || s.id !== subjectId).map((subject) => (
                <Button
                  key={subject.id}
                  variant={subject.id === subjectId ? "secondary" : "outline"}
                  className="w-full justify-start gap-2"
                  onClick={() => handleCopyMoveSubmit(subject.id)}
                  disabled={copyMutation.isPending || moveMutation.isPending}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: subject.color || "#3B82F6" }}
                  />
                  {subject.name}
                  {subject.id === subjectId && " (현재 과목)"}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCopyMoveOpen(false)}>
              취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
