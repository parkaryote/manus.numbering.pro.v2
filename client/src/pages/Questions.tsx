import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, ArrowLeft, Dumbbell, ClipboardCheck, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface QuestionsProps {
  subjectId: number;
}

export default function Questions({ subjectId }: QuestionsProps) {
  const [, setLocation] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    difficulty: "medium" as "easy" | "medium" | "hard",
  });

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions, isLoading } = trpc.questions.listBySubject.useQuery({ subjectId });
  const utils = trpc.useUtils();

  const createMutation = trpc.questions.create.useMutation({
    onSuccess: () => {
      utils.questions.listBySubject.invalidate({ subjectId });
      setIsCreateOpen(false);
      setFormData({ question: "", answer: "", difficulty: "medium" });
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

  const handleCreate = () => {
    if (!formData.question.trim() || !formData.answer.trim()) {
      toast.error("질문과 답안을 모두 입력하세요");
      return;
    }
    createMutation.mutate({
      subjectId,
      ...formData,
    });
  };

  const handleEdit = (question: any) => {
    setEditingQuestion(question);
    setFormData({
      question: question.question,
      answer: question.answer,
      difficulty: question.difficulty || "medium",
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!formData.question.trim() || !formData.answer.trim()) {
      toast.error("질문과 답안을 모두 입력하세요");
      return;
    }
    updateMutation.mutate({
      id: editingQuestion.id,
      ...formData,
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("이 문제를 삭제하시겠습니까?")) {
      deleteMutation.mutate({ id });
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>새 문제 추가</DialogTitle>
              <DialogDescription>질문과 답안을 입력하세요</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="question">질문 *</Label>
                <Textarea
                  id="question"
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  placeholder="예: 조선시대의 주요 사건을 시대순으로 나열하시오"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="answer">답안 *</Label>
                <Textarea
                  id="answer"
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  placeholder="모범 답안을 입력하세요"
                  rows={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="difficulty">난이도</Label>
                <Select
                  value={formData.difficulty}
                  onValueChange={(value: "easy" | "medium" | "hard") =>
                    setFormData({ ...formData, difficulty: value })
                  }
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
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
        <div className="space-y-4">
          {questions?.map((question) => (
            <Card key={question.id} className="shadow-elegant hover:shadow-elegant-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-medium ${difficultyColor[question.difficulty || "medium"]}`}>
                        {difficultyLabel[question.difficulty || "medium"]}
                      </span>
                    </div>
                    <CardTitle className="text-lg mb-2">{question.question}</CardTitle>
                    <CardDescription className="whitespace-pre-wrap">
                      {question.answer.length > 150
                        ? question.answer.substring(0, 150) + "..."
                        : question.answer}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(question)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(question.id)}
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
                  onClick={() => setLocation(`/practice/${question.id}`)}
                >
                  <Dumbbell className="h-4 w-4" />
                  연습 모드
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setLocation(`/test/${question.id}`)}
                >
                  <ClipboardCheck className="h-4 w-4" />
                  시험 모드
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>문제 수정</DialogTitle>
            <DialogDescription>문제 내용을 수정하세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-question">질문 *</Label>
              <Textarea
                id="edit-question"
                value={formData.question}
                onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-answer">답안 *</Label>
              <Textarea
                id="edit-answer"
                value={formData.answer}
                onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-difficulty">난이도</Label>
              <Select
                value={formData.difficulty}
                onValueChange={(value: "easy" | "medium" | "hard") =>
                  setFormData({ ...formData, difficulty: value })
                }
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              취소
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "수정 중..." : "수정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
