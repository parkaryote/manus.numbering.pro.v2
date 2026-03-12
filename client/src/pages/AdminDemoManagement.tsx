import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Edit2, Trash2, Plus, Image as ImageIcon, Table2, Upload, BookOpen, Settings2 } from "lucide-react";
import { ImageLabelEditor, ImageLabel } from "@/components/ImageLabelEditor";
import { TableEditor, TableData } from "@/components/TableEditor";
import { toast } from "sonner";
import imageCompression from "browser-image-compression";

type ScreenMode =
  | "list"
  | "editQuestion"
  | "createQuestion"
  | "createSubject"
  | "editSubject";

export default function AdminDemoManagement() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [editingSubject, setEditingSubject] = useState<any>(null);
  const [screenMode, setScreenMode] = useState<ScreenMode>("list");
  const [activeTab, setActiveTab] = useState<"text" | "image" | "table">("text");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    difficulty: "medium" as "easy" | "medium" | "hard",
    imageUrl: "",
    imageLabels: [] as ImageLabel[],
    autoNumbering: true,
    tableData: null as TableData | null,
  });

  const [subjectForm, setSubjectForm] = useState({
    name: "",
    description: "",
    color: "#3B82F6",
  });

  useEffect(() => {
    if (user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  const utils = trpc.useUtils();

  const { data: subjects = [], isLoading: subjectsLoading, refetch: refetchSubjects } = trpc.admin.demo.subjects.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const { data: allQuestions = [], isLoading: allQuestionsLoading, refetch: refetchAllQuestions } = trpc.admin.demo.allQuestions.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const selectedQuestions = selectedSubject
    ? allQuestions.filter((q) => q.subjectId === selectedSubject)
    : [];

  const selectedSubjectData = subjects.find((s) => s.id === selectedSubject);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateMutation = trpc.admin.demo.updateQuestion.useMutation({
    onSuccess: () => {
      refetchAllQuestions();
      setScreenMode("list");
      setEditingQuestion(null);
      resetForm();
      toast.success("문제가 수정되었습니다");
    },
    onError: (error) => toast.error("수정 실패: " + error.message),
  });

  const deleteMutation = trpc.admin.demo.deleteQuestion.useMutation({
    onSuccess: () => {
      refetchAllQuestions();
      toast.success("문제가 삭제되었습니다");
    },
    onError: (error) => toast.error("삭제 실패: " + error.message),
  });

  const createQuestionMutation = trpc.admin.demo.createQuestion.useMutation({
    onSuccess: () => {
      refetchAllQuestions();
      setScreenMode("list");
      resetForm();
      toast.success("문제가 추가되었습니다");
    },
    onError: (error) => toast.error("추가 실패: " + error.message),
  });

  const createSubjectMutation = trpc.admin.demo.createSubject.useMutation({
    onSuccess: () => {
      refetchSubjects();
      setScreenMode("list");
      setSubjectForm({ name: "", description: "", color: "#3B82F6" });
      toast.success("과목이 추가되었습니다");
    },
    onError: (error) => toast.error("추가 실패: " + error.message),
  });

  const updateSubjectMutation = trpc.admin.demo.updateSubject.useMutation({
    onSuccess: () => {
      refetchSubjects();
      setScreenMode("list");
      setEditingSubject(null);
      toast.success("과목이 수정되었습니다");
    },
    onError: (error) => toast.error("수정 실패: " + error.message),
  });

  const deleteSubjectMutation = trpc.admin.demo.deleteSubject.useMutation({
    onSuccess: () => {
      refetchSubjects();
      refetchAllQuestions();
      setSelectedSubject(null);
      toast.success("과목이 삭제되었습니다");
    },
    onError: (error) => toast.error("삭제 실패: " + error.message),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setFormData({ question: "", answer: "", difficulty: "medium", imageUrl: "", imageLabels: [], autoNumbering: true, tableData: null });
    setActiveTab("text");
  };

  const openEditQuestion = (question: any) => {
    setEditingQuestion(question);
    const parsedTableData = question.tableData ? JSON.parse(question.tableData) : null;
    setFormData({
      question: question.question,
      answer: question.answer || "",
      difficulty: question.difficulty || "medium",
      imageUrl: question.imageUrl || "",
      imageLabels: question.imageLabels ? JSON.parse(question.imageLabels) : [],
      autoNumbering: question.autoNumbering !== 0,
      tableData: parsedTableData,
    });
    if (parsedTableData) setActiveTab("table");
    else if (question.imageUrl) setActiveTab("image");
    else setActiveTab("text");
    setScreenMode("editQuestion");
  };

  const openCreateQuestion = () => {
    resetForm();
    setScreenMode("createQuestion");
  };

  const openCreateSubject = () => {
    setSubjectForm({ name: "", description: "", color: "#3B82F6" });
    setScreenMode("createSubject");
  };

  const openEditSubject = (subject: any) => {
    setEditingSubject(subject);
    setSubjectForm({ name: subject.name, description: subject.description || "", color: subject.color || "#3B82F6" });
    setScreenMode("editSubject");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("이미지 파일만 업로드할 수 있습니다"); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("파일 크기는 16MB 이하여야 합니다"); return; }
    setIsUploading(true);
    try {
      const options = { maxSizeMB: 2, maxWidthOrHeight: 1920, useWebWorker: true };
      const compressedFile = await imageCompression(file, options);
      const uploadFormData = new FormData();
      uploadFormData.append("file", compressedFile);
      const response = await fetch("/api/upload/image", { method: "POST", body: uploadFormData });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      setFormData((prev) => ({ ...prev, imageUrl: data.url }));
      toast.success("이미지가 업로드되었습니다");
    } catch {
      toast.error("이미지 업로드 실패");
    } finally {
      setIsUploading(false);
    }
  };

  const buildQuestionPayload = () => {
    if (activeTab === "table") {
      if (!formData.tableData) { toast.error("표를 작성하세요"); return null; }
      const blankCount = formData.tableData.cells.flat().filter((c: any) => c.isBlank && !c.isMerged).length;
      if (blankCount === 0) { toast.error("최소 1개의 빈칸을 지정하세요"); return null; }
      return { question: formData.question, answer: "", difficulty: formData.difficulty, tableData: JSON.stringify(formData.tableData), imageUrl: undefined, imageLabels: undefined, autoNumbering: 0 };
    }
    if (activeTab === "image") {
      if (formData.imageUrl && formData.imageLabels.length > 0) {
        const hasEmpty = formData.imageLabels.some((l) => !l.answer.trim());
        if (hasEmpty) { toast.error("모든 영역의 정답을 입력하세요"); return null; }
      }
      return { question: formData.question, answer: "", difficulty: formData.difficulty, imageUrl: formData.imageUrl || undefined, imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined, tableData: undefined, autoNumbering: formData.autoNumbering ? 1 : 0 };
    }
    if (!formData.answer.trim()) { toast.error("답안을 입력하세요"); return null; }
    return { question: formData.question, answer: formData.answer, difficulty: formData.difficulty, imageUrl: undefined, imageLabels: undefined, tableData: undefined, autoNumbering: formData.autoNumbering ? 1 : 0 };
  };

  const handleSaveQuestion = () => {
    if (!formData.question.trim()) { toast.error("질문을 입력하세요"); return; }
    const payload = buildQuestionPayload();
    if (!payload) return;

    if (screenMode === "editQuestion") {
      updateMutation.mutate({ questionId: editingQuestion.id, ...payload } as any);
    } else {
      if (!selectedSubject) { toast.error("과목을 먼저 선택하세요"); return; }
      createQuestionMutation.mutate({ subjectId: selectedSubject, ...payload } as any);
    }
  };

  const handleSaveSubject = () => {
    if (!subjectForm.name.trim()) { toast.error("과목명을 입력하세요"); return; }
    if (screenMode === "editSubject") {
      updateSubjectMutation.mutate({ subjectId: editingSubject.id, ...subjectForm });
    } else {
      createSubjectMutation.mutate(subjectForm);
    }
  };

  const handleDeleteQuestion = (questionId: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    deleteMutation.mutate({ questionId });
  };

  const handleDeleteSubject = (subjectId: number) => {
    if (!confirm("과목과 해당 과목의 모든 문제가 삭제됩니다. 계속하시겠습니까?")) return;
    deleteSubjectMutation.mutate({ subjectId });
  };

  // ── Answer preview ─────────────────────────────────────────────────────────

  const renderAnswerPreview = (question: any) => {
    if (question.imageUrl) {
      let labels: any[] = [];
      try { labels = JSON.parse(question.imageLabels || "[]"); } catch {}
      return (
        <div className="space-y-2">
          <div className="border rounded overflow-hidden bg-gray-50">
            <img src={question.imageUrl} alt="문제 이미지" className="w-full max-h-48 object-contain" />
          </div>
          {labels.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded p-3 space-y-1">
              <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> 이미지 라벨 정답 ({labels.length}개)</p>
              <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                {labels.map((label: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-sm text-green-900">
                    <span className="font-bold shrink-0 text-green-600">[{idx + 1}]</span>
                    <span>{label.answer || "(빈칸)"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (question.tableData) {
      let tableData: any = null;
      try { tableData = JSON.parse(question.tableData); } catch {}
      const cells: any[][] = tableData?.cells;
      if (!cells || !Array.isArray(cells)) return <p className="text-sm text-muted-foreground italic">(표 데이터 없음)</p>;
      return (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-blue-700 flex items-center gap-1"><Table2 className="w-3 h-3" /> 표 데이터 미리보기</p>
          <div className="overflow-x-auto border rounded">
            <table className="text-xs w-full border-collapse">
              <tbody>
                {cells.slice(0, 6).map((row: any[], rowIdx: number) => (
                  <tr key={rowIdx} className={rowIdx === 0 ? "bg-blue-50 font-semibold" : "even:bg-gray-50"}>
                    {row.map((cell: any, colIdx: number) => {
                      const content = typeof cell === "object" ? cell?.content ?? "" : String(cell ?? "");
                      const isBlank = typeof cell === "object" ? cell?.isBlank : false;
                      return (
                        <td key={colIdx} className={`border border-gray-200 px-2 py-1 max-w-24 truncate ${colIdx === 0 ? "bg-blue-50 font-semibold" : ""} ${isBlank ? "bg-yellow-50 text-yellow-700 font-bold" : ""}`} title={content}>
                          {isBlank ? "▢" : content || "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {cells.length > 6 && (
                  <tr><td colSpan={cells[0]?.length || 1} className="text-center text-xs text-muted-foreground py-1 border border-gray-200">... 외 {cells.length - 6}행 더 있음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (question.answer?.trim()) {
      return <div className="bg-green-50 p-3 rounded text-green-900 border border-green-200 whitespace-pre-wrap text-sm leading-relaxed">{question.answer}</div>;
    }
    return <p className="text-sm text-muted-foreground italic">(정답 없음)</p>;
  };

  // ── Question form (shared for create & edit) ───────────────────────────────

  const questionFormContent = (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "text" | "image" | "table")} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="text">텍스트 문제</TabsTrigger>
        <TabsTrigger value="image">이미지 문제</TabsTrigger>
        <TabsTrigger value="table" className="gap-1"><Table2 className="h-3.5 w-3.5" />표 문제</TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>질문 *</Label>
          <Textarea value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })} placeholder="질문을 입력하세요" rows={3} />
        </div>
        <div className="space-y-2">
          <Label>답안 *</Label>
          <Textarea value={formData.answer} onChange={(e) => setFormData({ ...formData, answer: e.target.value })} placeholder="모범 답안을 입력하세요" rows={6} />
        </div>
        <div className="space-y-2">
          <Label>난이도</Label>
          <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">쉬움</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="hard">어려움</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="autoNumbering" checked={formData.autoNumbering} onChange={(e) => setFormData({ ...formData, autoNumbering: e.target.checked })} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
          <Label htmlFor="autoNumbering" className="cursor-pointer text-sm font-normal">엔터 기준으로 답안 번호 자동 생성</Label>
        </div>
      </TabsContent>

      <TabsContent value="image" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>질문 *</Label>
          <Textarea value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })} placeholder="예: 다음 해부도에서 표시된 부위의 명칭을 쓰시오" rows={2} />
        </div>
        {!formData.imageUrl ? (
          <div className="space-y-2">
            <Label>이미지 업로드</Label>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="gap-2">
                <Upload className="h-4 w-4" />
                {isUploading ? "업로드 중..." : "이미지 선택"}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">PNG, JPG, GIF (최대 16MB)</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>정답 영역 지정</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFormData({ ...formData, imageUrl: "", imageLabels: [] })}>이미지 제거</Button>
            </div>
            <ImageLabelEditor
              imageUrl={formData.imageUrl}
              initialLabels={formData.imageLabels}
              onChange={(labels: ImageLabel[]) => setFormData((prev) => ({ ...prev, imageLabels: labels }))}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>난이도</Label>
          <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">쉬움</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="hard">어려움</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TabsContent>

      <TabsContent value="table" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>질문 *</Label>
          <Textarea value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })} placeholder="예: 다음 표의 빈칸을 채우시오" rows={2} />
        </div>
        <div className="space-y-2">
          <Label>표 작성</Label>
          <TableEditor
            initialData={formData.tableData || undefined}
            onChange={(data) => setFormData((prev) => ({ ...prev, tableData: data }))}
          />
        </div>
        <div className="space-y-2">
          <Label>난이도</Label>
          <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
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

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (!user) return <div className="p-8 text-center">로딩 중...</div>;
  if (user.role !== "admin") return <div className="p-8 text-center">관리자만 접근할 수 있습니다.</div>;

  // ── Full-screen overlays ───────────────────────────────────────────────────

  const isMutating = updateMutation.isPending || createQuestionMutation.isPending;

  if (screenMode === "editQuestion" || screenMode === "createQuestion") {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <div className="min-h-full flex flex-col">
          <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between shadow-sm">
            <div>
              <h2 className="text-xl font-bold">{screenMode === "editQuestion" ? "문제 수정" : "새 문제 추가"}</h2>
              <p className="text-sm text-muted-foreground">
                {screenMode === "editQuestion" ? "수정하면 모든 사용자에게 즉시 반영됩니다" : `과목: ${selectedSubjectData?.name ?? ""}`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setScreenMode("list"); setEditingQuestion(null); resetForm(); }}>취소</Button>
              <Button onClick={handleSaveQuestion} disabled={isMutating || !formData.question}>
                {isMutating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장 중...</> : "저장"}
              </Button>
            </div>
          </div>
          <div className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">
            {questionFormContent}
          </div>
        </div>
      </div>
    );
  }

  if (screenMode === "createSubject" || screenMode === "editSubject") {
    const isSubjectMutating = createSubjectMutation.isPending || updateSubjectMutation.isPending;
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <div className="min-h-full flex flex-col">
          <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between shadow-sm">
            <div>
              <h2 className="text-xl font-bold">{screenMode === "editSubject" ? "과목 수정" : "새 데모 과목 추가"}</h2>
              <p className="text-sm text-muted-foreground">모든 사용자의 데모 화면에 표시됩니다</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setScreenMode("list"); setEditingSubject(null); }}>취소</Button>
              <Button onClick={handleSaveSubject} disabled={isSubjectMutating || !subjectForm.name.trim()}>
                {isSubjectMutating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장 중...</> : "저장"}
              </Button>
            </div>
          </div>
          <div className="flex-1 px-6 py-6 max-w-2xl mx-auto w-full space-y-6">
            <div className="space-y-2">
              <Label>과목명 *</Label>
              <Input value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="예: 해부학" />
            </div>
            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea value={subjectForm.description} onChange={(e) => setSubjectForm({ ...subjectForm, description: e.target.value })} placeholder="과목에 대한 간단한 설명을 입력하세요" rows={3} />
            </div>
            <div className="space-y-2">
              <Label>색상</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={subjectForm.color} onChange={(e) => setSubjectForm({ ...subjectForm, color: e.target.value })} className="w-12 h-10 rounded border cursor-pointer" />
                <span className="text-sm text-muted-foreground">{subjectForm.color}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main list view ─────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">데모 과목 관리</h1>
          <p className="text-muted-foreground mt-2">모든 사용자가 보는 데모 과목의 문제를 관리합니다</p>
        </div>
        <Button onClick={openCreateSubject} className="gap-2 shrink-0">
          <BookOpen className="w-4 h-4" />
          새 과목 추가
        </Button>
      </div>

      {/* 과목 목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjectsLoading || allQuestionsLoading ? (
          <div className="col-span-full flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : subjects.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>데모 과목이 없습니다. 새 과목을 추가해보세요.</p>
          </div>
        ) : (
          subjects.map((subject) => {
            const questionCount = allQuestions.filter((q) => q.subjectId === subject.id).length;
            return (
              <Card
                key={subject.id}
                className={`cursor-pointer transition-all ${selectedSubject === subject.id ? "ring-2 ring-primary bg-primary/5" : "hover:shadow-lg"}`}
                onClick={() => setSelectedSubject(subject.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: subject.color || "#3B82F6" }} />
                      <CardTitle className="text-lg">{subject.name}</CardTitle>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditSubject(subject)}>
                        <Settings2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteSubject(subject.id)} disabled={deleteSubjectMutation.isPending}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  {subject.description && <CardDescription className="mt-1">{subject.description}</CardDescription>}
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
            <h2 className="text-2xl font-bold">
              {selectedSubjectData?.name} — 문제 목록
            </h2>
            <Button onClick={openCreateQuestion} className="gap-2">
              <Plus className="w-4 h-4" />
              새 문제 추가
            </Button>
          </div>

          {allQuestionsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : selectedQuestions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p className="mb-4">이 과목에 문제가 없습니다</p>
                <Button onClick={openCreateQuestion} variant="outline" className="gap-2">
                  <Plus className="w-4 h-4" />첫 문제 추가하기
                </Button>
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
                        {renderAnswerPreview(question)}
                      </div>
                      <div className="flex gap-2 justify-end pt-2 border-t">
                        <Button variant="outline" size="sm" onClick={() => openEditQuestion(question)}>
                          <Edit2 className="w-4 h-4 mr-1" />수정
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteQuestion(question.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="w-4 h-4 mr-1" />삭제
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
    </div>
  );
}
