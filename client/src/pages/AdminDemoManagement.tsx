import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Edit2, Trash2, Plus, Image, Table2 } from "lucide-react";

export default function AdminDemoManagement() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ question: "", answer: "" });

  useEffect(() => {
    if (user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  const { data: subjects = [], isLoading: subjectsLoading } = trpc.admin.demo.subjects.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const { data: allQuestions = [], isLoading: allQuestionsLoading, refetch: refetchAllQuestions } = trpc.admin.demo.allQuestions.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const selectedQuestions = selectedSubject
    ? allQuestions.filter((q) => q.subjectId === selectedSubject)
    : [];

  const updateMutation = trpc.admin.demo.updateQuestion.useMutation({
    onSuccess: () => {
      refetchAllQuestions();
      setIsDialogOpen(false);
      setEditingQuestion(null);
      setFormData({ question: "", answer: "" });
    },
  });

  const deleteMutation = trpc.admin.demo.deleteQuestion.useMutation({
    onSuccess: () => {
      refetchAllQuestions();
    },
  });

  const handleEditQuestion = (question: any) => {
    setEditingQuestion(question);
    setFormData({
      question: question.question,
      answer: question.answer || "",
    });
    setIsDialogOpen(true);
  };

  const handleSaveQuestion = async () => {
    if (!editingQuestion || !formData.question) return;
    await updateMutation.mutateAsync({
      questionId: editingQuestion.id,
      question: formData.question,
      answer: formData.answer,
    });
  };

  const handleDeleteQuestion = async (questionId: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await deleteMutation.mutateAsync({ questionId });
  };

  // 이미지 문제 정답 렌더링
  const renderImageAnswer = (question: any) => {
    let labels: any[] = [];
    try {
      if (question.imageLabels) {
        labels = typeof question.imageLabels === "string"
          ? JSON.parse(question.imageLabels)
          : question.imageLabels;
      }
    } catch {}

    return (
      <div className="space-y-2">
        {/* 이미지 미리보기 */}
        {question.imageUrl && (
          <div className="border rounded overflow-hidden bg-gray-50">
            <img
              src={question.imageUrl}
              alt="문제 이미지"
              className="w-full max-h-48 object-contain"
            />
          </div>
        )}
        {/* 라벨 정답 목록 */}
        {labels.length > 0 ? (
          <div className="bg-green-50 border border-green-200 rounded p-3 space-y-1">
            <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
              <Image className="w-3 h-3" /> 이미지 라벨 정답 ({labels.length}개)
            </p>
            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
              {labels.map((label: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 text-sm text-green-900">
                  <span className="font-bold shrink-0 text-green-600">[{idx + 1}]</span>
                  <span>{label.answer || "(빈칸)"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">(라벨 정답 없음)</p>
        )}
      </div>
    );
  };

  // 표 문제 정답 렌더링
  const renderTableAnswer = (question: any) => {
    let tableData: any = null;
    try {
      if (question.tableData) {
        tableData = typeof question.tableData === "string"
          ? JSON.parse(question.tableData)
          : question.tableData;
      }
    } catch {}

    // tableData 구조: { rows: number, cols: number, cells: any[][], headerRow: bool, headerCol: bool }
    const rows: any[][] = tableData?.cells || tableData?.data || (Array.isArray(tableData) ? tableData : null);

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return <p className="text-sm text-muted-foreground italic">(표 데이터 없음)</p>;
    }

    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-blue-700 flex items-center gap-1">
          <Table2 className="w-3 h-3" /> 표 데이터 미리보기
        </p>
        <div className="overflow-x-auto border rounded">
          <table className="text-xs w-full border-collapse">
            <tbody>
              {rows.slice(0, 6).map((row: any[], rowIdx: number) => (
                <tr key={rowIdx} className={rowIdx === 0 ? "bg-blue-50 font-semibold" : "even:bg-gray-50"}>
                  {row.map((cell: any, colIdx: number) => {
                    const content = typeof cell === "object" ? cell?.content ?? "" : String(cell ?? "");
                    const isBlank = typeof cell === "object" ? cell?.isBlank : false;
                    return (
                      <td
                        key={colIdx}
                        className={`border border-gray-200 px-2 py-1 max-w-24 truncate ${
                          colIdx === 0 ? "bg-blue-50 font-semibold" : ""
                        } ${isBlank ? "bg-yellow-50 text-yellow-700 font-bold" : ""}`}
                        title={content}
                      >
                        {isBlank ? "▢" : content || "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length > 6 && (
                <tr>
                  <td colSpan={rows[0]?.length || 1} className="text-center text-xs text-muted-foreground py-1 border border-gray-200">
                    ... 외 {rows.length - 6}행 더 있음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 정답 표시 헬퍼
  const renderAnswer = (question: any) => {
    const hasImage = question.imageUrl;
    const hasTable = question.tableData;
    const hasTextAnswer = question.answer && question.answer.trim().length > 0;

    if (hasImage) return renderImageAnswer(question);
    if (hasTable) return renderTableAnswer(question);
    if (hasTextAnswer) {
      return (
        <div className="bg-green-50 p-3 rounded text-green-900 border border-green-200 whitespace-pre-wrap text-sm leading-relaxed">
          {question.answer}
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground italic">(정답 없음)</p>;
  };

  if (!user) return <div className="p-8 text-center">로딩 중...</div>;
  if (user.role !== "admin") return <div className="p-8 text-center">관리자만 접근할 수 있습니다.</div>;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">데모 과목 관리</h1>
        <p className="text-muted-foreground mt-2">모든 사용자가 보는 데모 과목의 문제를 관리합니다</p>
      </div>

      {/* 과목 목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjectsLoading || allQuestionsLoading ? (
          <div className="col-span-full flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          subjects.map((subject) => {
            const questionCount = allQuestions.filter((q) => q.subjectId === subject.id).length;
            return (
              <Card
                key={subject.id}
                className={`cursor-pointer transition-all ${
                  selectedSubject === subject.id
                    ? "ring-2 ring-primary bg-primary/5"
                    : "hover:shadow-lg"
                }`}
                onClick={() => setSelectedSubject(subject.id)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{subject.name}</CardTitle>
                  <CardDescription>{subject.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-semibold text-primary">문제 수: {questionCount}</p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* 문제 목록 */}
      {selectedSubject && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">문제 목록</h2>
            <Button variant="outline" size="sm" disabled>
              <Plus className="w-4 h-4 mr-2" />
              새 문제 추가 (준비 중)
            </Button>
          </div>

          {allQuestionsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : selectedQuestions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                이 과목에 문제가 없습니다
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {selectedQuestions.map((question) => (
                <Card key={question.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground mb-2">문제</p>
                        <p className="text-base whitespace-pre-wrap leading-relaxed">{question.question}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground mb-2">정답</p>
                        {renderAnswer(question)}
                      </div>
                      <div className="flex gap-2 justify-end pt-2 border-t">
                        <Button variant="outline" size="sm" onClick={() => handleEditQuestion(question)}>
                          <Edit2 className="w-4 h-4 mr-1" />
                          수정
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteQuestion(question.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 편집 다이얼로그 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>문제 수정</DialogTitle>
            <DialogDescription>
              문제와 정답을 수정하면 모든 사용자에게 즉시 반영됩니다
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold">문제</label>
              <Textarea
                value={formData.question}
                onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                placeholder="문제를 입력하세요"
                className="mt-2 min-h-24"
              />
            </div>
            <div>
              <label className="text-sm font-semibold">텍스트 정답</label>
              {editingQuestion?.imageUrl && (
                <p className="text-xs text-muted-foreground mt-1">이미지 라벨 정답은 이 화면에서 수정할 수 없습니다</p>
              )}
              {editingQuestion?.tableData && (
                <p className="text-xs text-muted-foreground mt-1">표 데이터는 이 화면에서 수정할 수 없습니다</p>
              )}
              <Textarea
                value={formData.answer}
                onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                placeholder="텍스트 정답을 입력하세요"
                className="mt-2 min-h-24"
              />
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>취소</Button>
              <Button
                onClick={handleSaveQuestion}
                disabled={updateMutation.isPending || !formData.question}
              >
                {updateMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장 중...</>
                ) : "저장"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
