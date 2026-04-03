import { trpc } from "@/lib/trpc";
import { ConfidenceHistoryModal } from "@/components/ConfidenceHistoryModal";
import { SubjectConfidenceHistoryModal } from "@/components/SubjectConfidenceHistoryModal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Plus, ArrowLeft, Dumbbell, ClipboardCheck, Edit, Trash2, Upload, Image as ImageIcon, GripVertical, Copy, MoveRight, Star, ScrollText } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
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
import { TableEditor, TableData } from "@/components/TableEditor";
import { OCRUploader } from "@/components/OCRUploader";
import { QuestionGridView } from "@/components/QuestionGridView";
import { Table2 } from "lucide-react";
import imageCompression from "browser-image-compression";
import { trackQuestionCreate, trackQuestionUpdate, trackQuestionDelete } from "@/lib/ga4Events";
import { CONFIDENCE_THRESHOLDS } from "@shared/examConfidence";

interface QuestionsProps {
  subjectId: number;
  isDemo?: boolean;
}

interface ConfidenceData {
  displayScore: number;
  state: "green" | "yellow" | "red";
  label: string;
  isColdStart: boolean;
  badges?: {
    lastTestWrong: boolean;
    frequentlyWrong: boolean;
    hasWarnZone: boolean;
  };
}

interface SortableQuestionCardProps {
  question: any;
  confidence?: ConfidenceData;
  onEdit: (question: any) => void;
  onDelete: (id: number) => void;
  onPractice: (id: number) => void;
  onTest: (id: number) => void;
  onCopy: (question: any) => void;
  onMove: (question: any) => void;
  onToggleStar: (id: number) => void;
  onConfidenceClick: (id: number, title: string) => void;
}

function SortableQuestionCard({
  question,
  confidence,
  onEdit,
  onDelete,
  onPractice,
  onTest,
  onCopy,
  onMove,
  onToggleStar,
  onConfidenceClick,
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
  const hasTable = !!question.tableData;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative border rounded-lg bg-card hover:shadow-md transition-all overflow-hidden"
    >
      {/* 컴팩트 카드 - 가로 레이아웃 */}
      <div className="flex items-stretch">
        {/* 드래그 핸들 */}
        <div
          {...attributes}
          {...listeners}
          className="flex items-center px-1.5 cursor-grab active:cursor-grabbing touch-none border-r bg-muted/30 hover:bg-muted/60"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* 이미지 썸네일 (있을 경우) */}
        {hasImage && question.imageUrl && (
          <div className="w-16 h-16 flex-shrink-0 border-r overflow-hidden bg-muted/20">
            <img
              src={question.imageUrl!}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

          {/* 문제 정보 */}
        <div className="flex-1 px-3 py-2 min-w-0">
          <div className="flex items-center gap-1.5">
            {hasImage && (
              <ImageIcon className="h-3 w-3 text-blue-500 flex-shrink-0" />
            )}
            {hasTable && (
              <Table2 className="h-3 w-3 text-purple-500 flex-shrink-0" />
            )}
            {question.isDemo === 1 && (
              <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">데모</span>
            )}
            <p className="text-sm font-medium truncate leading-tight flex-1">{question.question}</p>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStar(question.id); }}
              className="flex-shrink-0 ml-1 p-0.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
              title={question.isStarred ? '별표 제거' : '별표 추가'}
            >
              <Star
                className={`w-3.5 h-3.5 transition-colors ${
                  question.isStarred
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-muted-foreground/40 hover:text-amber-400'
                }`}
              />
            </button>
          </div>
          {!hasImage && !hasTable && question.answer && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {question.answer.substring(0, 80).replace(/\n/g, ' / ')}
            </p>
          )}
          {/* 학습 계획 추천 배지 */}
          {confidence?.badges && (confidence.badges.lastTestWrong || confidence.badges.frequentlyWrong || confidence.badges.hasWarnZone) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {confidence.badges.lastTestWrong && (
                <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 leading-none">
                  이번 시험 오답
                </span>
              )}
              {confidence.badges.frequentlyWrong && (
                <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 leading-none">
                  자주 틀림
                </span>
              )}
              {confidence.badges.hasWarnZone && (
                <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 leading-none">
                  주의 구간 있음
                </span>
              )}
            </div>
          )}
          {hasTable && (
            <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
              {(() => {
                const td = JSON.parse(question.tableData);
                const blankCount = td.cells.flat().filter((c: any) => c.isBlank && !c.isMerged).length;
                
                // 헤더 행 내용 추출 (첫 행 + 병합으로 인한 두번째 헤더 행)
                const headerRowParts: string[] = [];
                if (td.headerRow && td.cells[0]) {
                  const row0 = td.cells[0]
                    .filter((c: any) => !c.isMerged && c.content?.trim())
                    .map((c: any) => c.content.trim());
                  if (row0.length > 0) headerRowParts.push(...row0);
                  // 첫 행에 rowSpan > 1인 셀이 있으면 두번째 행도 헤더의 일부
                  const hasMultiRowHeader = td.cells[0].some((c: any) => c.rowSpan > 1);
                  if (hasMultiRowHeader && td.cells[1]) {
                    const row1 = td.cells[1]
                      .filter((c: any) => !c.isMerged && c.content?.trim())
                      .map((c: any) => c.content.trim());
                    // 숫자 시퀀스인 경우 범위로 표시
                    if (row1.length > 3 && row1.every((v: string) => /^\d+(\.\d+)?$/.test(v))) {
                      headerRowParts.push(`${row1[0]}~${row1[row1.length - 1]}`);
                    } else if (row1.length > 0 && row1.length <= 5) {
                      headerRowParts.push(row1.join(', '));
                    } else if (row1.length > 5) {
                      headerRowParts.push(row1.slice(0, 3).join(', ') + ` 외 ${row1.length - 3}개`);
                    }
                  }
                }
                
                // 헤더 열 내용 추출 (첫 열의 비어있지 않은 셀, 헤더 행 제외)
                const headerColParts: string[] = [];
                if (td.headerCol) {
                  const startRow = td.headerRow ? (td.cells[1]?.[0]?.content?.trim() ? 1 : 2) : 0;
                  for (let i = startRow; i < td.cells.length; i++) {
                    const cell = td.cells[i]?.[0];
                    if (cell && !cell.isMerged && cell.content?.trim()) {
                      headerColParts.push(cell.content.trim());
                    }
                  }
                } else if (td.headerRow) {
                  // headerCol이 아니지만 첫 열에 카테고리가 있는 경우 (병합 셀)
                  for (let i = 1; i < td.cells.length; i++) {
                    const cell = td.cells[i]?.[0];
                    if (cell && !cell.isMerged && cell.content?.trim() && (cell.rowSpan > 1 || cell.colSpan > 1)) {
                      headerColParts.push(cell.content.trim());
                    }
                  }
                }
                
                const headerRowText = headerRowParts.length > 0 ? headerRowParts.join(' · ') : '';
                const headerColText = headerColParts.length > 0 
                  ? (headerColParts.length > 4 
                    ? headerColParts.slice(0, 3).join(', ') + ` 외 ${headerColParts.length - 3}개`
                    : headerColParts.join(', '))
                  : '';
                const sizeInfo = `${td.rows}×${td.cols} | 빈칸 ${blankCount}`;
                
                return (
                  <>
                    {headerRowText && (
                      <p className="truncate font-medium text-foreground/70">{headerRowText}</p>
                    )}
                    <p className="truncate">
                      {headerColText ? `${headerColText} | ${sizeInfo}` : sizeInfo}
                    </p>
                  </>
                );
              })()}
            </div>
          )}
          {hasLabels && question.imageLabels && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              라벨 {JSON.parse(question.imageLabels).length}개
            </p>
          )}
        </div>

        {/* 시험 안정도 (클릭 시 그래프 모달) */}
        {confidence && (
          <button
            className="flex items-center px-2 border-l hover:bg-muted/50 transition-colors cursor-pointer"
            title="클릭하여 변화 그래프 보기"
            onClick={() => onConfidenceClick(question.id, question.question)}
          >
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  confidence.state === 'green' ? 'bg-emerald-500' :
                  confidence.state === 'yellow' ? 'bg-amber-400' :
                  'bg-red-400'
                } ${confidence.isColdStart ? 'opacity-40' : ''}`}
              />
              <span className={`text-[9px] font-mono leading-none ${
                confidence.isColdStart ? 'text-muted-foreground/50' : 'text-muted-foreground'
              }`}>{Math.round(confidence.displayScore)}</span>
            </div>
          </button>
        )}

        {/* 액션 버튼 */}
        <div className="flex items-center gap-0.5 px-1.5 border-l bg-muted/10">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onPractice(question.id)}
            title="연습 모드"
          >
            <Dumbbell className="h-3.5 w-3.5 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onTest(question.id)}
            title="시험 모드"
          >
            <ClipboardCheck className="h-3.5 w-3.5 text-green-600" />
          </Button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onCopy(question)}
            title="복사"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onMove(question)}
            title="이동"
          >
            <MoveRight className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onEdit(question)}
            title="수정"
          >
            <Edit className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(question.id)}
            title="삭제"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Questions({ subjectId, isDemo = false }: QuestionsProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [confidenceHistoryId, setConfidenceHistoryId] = useState<number | null>(null);
  const [confidenceHistoryTitle, setConfidenceHistoryTitle] = useState("");
  const [subjectConfidenceOpen, setSubjectConfidenceOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCopyMoveOpen, setIsCopyMoveOpen] = useState(false);
  const [copyMoveMode, setCopyMoveMode] = useState<"copy" | "move">("copy");
  const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "image" | "table" | "ocr">("text");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const questionTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  const [formData, setFormData] = useState({
    question: "",
    answer: "",

    imageUrl: "",
    imageLabels: [] as ImageLabel[],
    autoNumbering: true, // 엔터 기준 자동 번호 생성
    tableData: null as TableData | null,
    isDemo: false,
    isStarred: false,
  });

  const { data: subject } = trpc.subjects.getById.useQuery({ id: subjectId });
  const { data: questions, isLoading } = trpc.questions.listBySubject.useQuery({ subjectId });
  const { data: confidenceData } = trpc.confidence.getBySubject.useQuery(
    { subjectId },
    { enabled: !!user }
  );
  const utils = trpc.useUtils();

  // Build confidence lookup map
  const confidenceMap = useMemo(() => {
    if (!confidenceData?.questions) return new Map<number, ConfidenceData>();
    const map = new Map<number, ConfidenceData>();
    for (const q of confidenceData.questions) {
      map.set(q.questionId, q);
    }
    return map;
  }, [confidenceData]);

  const createMutation = trpc.questions.create.useMutation({
    onSuccess: (data: any) => {
      const questionType = data.imageUrl && data.imageLabels ? 'image' : (data.tableData ? 'table' : 'text');
      trackQuestionCreate(data.id, subjectId, questionType as 'text' | 'image' | 'table');
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
    onSuccess: (data: any) => {
      const questionType = data.imageUrl && data.imageLabels ? 'image' : (data.tableData ? 'table' : 'text');
      trackQuestionUpdate(data.id, subjectId, questionType as 'text' | 'image' | 'table');
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
      if (editingQuestion) {
        trackQuestionDelete(editingQuestion.id, subjectId);
      }
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

  const toggleStarMutation = trpc.questions.toggleStar.useMutation({
    onSuccess: () => {
      utils.questions.listBySubject.invalidate({ subjectId });
    },
    onError: (error) => {
      toast.error("별표 업데이트 실패: " + error.message);
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

      imageUrl: "",
      imageLabels: [],
      autoNumbering: true,
      tableData: null,
      isDemo: false,
      isStarred: false,
    });
    setActiveTab("text");
    // 포커스를 질문 입력 필드의 첫 줄로 리셋
    setTimeout(() => {
      if (questionTextareaRef.current) {
        questionTextareaRef.current.focus();
        questionTextareaRef.current.setSelectionRange(0, 0);
      }
    }, 0);
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



  const handleCreate = useCallback(() => {
    const question = formData.question;
    const answer = formData.answer;

    if (!question.trim()) {
      toast.error("질문을 입력하세요");
      return;
    }

    // Table question validation
    if (activeTab === "table") {
      if (!formData.tableData) {
        toast.error("표를 작성하세요");
        return;
      }
      const blankCount = formData.tableData.cells.flat().filter((c) => c.isBlank && !c.isMerged).length;
      if (blankCount === 0) {
        toast.error("최소 1개의 빈칸을 지정하세요");
        return;
      }
      createMutation.mutate({
        subjectId,
        question,
        answer: "",
          tableData: JSON.stringify(formData.tableData),
        autoNumbering: 0,
        isDemo: isAdmin && formData.isDemo ? 1 : 0,
        isStarred: formData.isStarred ? 1 : 0,
      } as any);
      return;
    }

    // Image-based or text-based validation
    if (formData.imageUrl && formData.imageLabels.length > 0) {
      const hasEmptyAnswer = formData.imageLabels.some((label) => !label.answer.trim());
      if (hasEmptyAnswer) {
        toast.error("모든 영역의 정답을 입력하세요");
        return;
      }
    } else if (!answer.trim()) {
      toast.error("답안을 입력하세요");
      return;
    }

    createMutation.mutate({
      subjectId,
      question,
      answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : answer,
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
      autoNumbering: formData.autoNumbering ? 1 : 0,
      isDemo: isAdmin && formData.isDemo ? 1 : 0,
      isStarred: formData.isStarred ? 1 : 0,
    } as any);
  }, [activeTab, formData, subjectId, createMutation, isAdmin]);

  const handleEdit = (question: any) => {
    setEditingQuestion(question);
    const parsedTableData = question.tableData ? JSON.parse(question.tableData) : null;
    setFormData({
      question: question.question,
      answer: question.answer || "",
      imageUrl: question.imageUrl || "",
      imageLabels: question.imageLabels ? JSON.parse(question.imageLabels) : [],
      autoNumbering: question.autoNumbering !== 0,
      tableData: parsedTableData,
      isDemo: question.isDemo === 1,
      isStarred: question.isStarred === 1,
    });
    // 탭 자동 선택
    if (parsedTableData) {
      setActiveTab("table");
    } else if (question.imageUrl) {
      setActiveTab("image");
    } else {
      setActiveTab("text");
    }
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!formData.question.trim()) {
      toast.error("질문을 입력하세요");
      return;
    }

    // Table question
    if (activeTab === "table") {
      if (!formData.tableData) {
        toast.error("표를 작성하세요");
        return;
      }
      const blankCount = formData.tableData.cells.flat().filter((c) => c.isBlank && !c.isMerged).length;
      if (blankCount === 0) {
        toast.error("최소 1개의 빈칸을 지정하세요");
        return;
      }
      updateMutation.mutate({
        id: editingQuestion.id,
        question: formData.question,
        answer: "",
        tableData: JSON.stringify(formData.tableData),
        imageUrl: undefined,
        imageLabels: undefined,
        autoNumbering: 0,
        isDemo: isAdmin && formData.isDemo ? 1 : 0,
        isStarred: formData.isStarred ? 1 : 0,
      } as any);
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
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
      tableData: undefined,
      autoNumbering: formData.autoNumbering ? 1 : 0,
      isDemo: isAdmin && formData.isDemo ? 1 : 0,
      isStarred: formData.isStarred ? 1 : 0,
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



  // QuestionForm을 useMemo로 감싸서 불필요한 리렌더링 방지
  const questionFormContent = (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "text" | "image" | "table" | "ocr")} className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="text">텍스트 문제</TabsTrigger>
        <TabsTrigger value="image">이미지 문제</TabsTrigger>
        <TabsTrigger value="table" className="gap-1">
          <Table2 className="h-3.5 w-3.5" />표 문제
        </TabsTrigger>
        <TabsTrigger value="ocr" className="gap-1">
          <Upload className="h-3.5 w-3.5" />OCR
        </TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label htmlFor="question">질문 *</Label>
          <Textarea
            id="question"
            ref={questionTextareaRef}
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
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoNumbering"
            checked={formData.autoNumbering}
            onChange={(e) => setFormData({ ...formData, autoNumbering: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
          />
          <Label htmlFor="autoNumbering" className="cursor-pointer text-sm font-normal">
            엔터 기준으로 답안 번호 자동 생성
          </Label>
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

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoNumbering-image"
            checked={formData.autoNumbering}
            onChange={(e) => setFormData({ ...formData, autoNumbering: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
          />
          <Label htmlFor="autoNumbering-image" className="cursor-pointer text-sm font-normal">
            엔터 기준으로 답안 번호 자동 생성
          </Label>
        </div>
      </TabsContent>

      <TabsContent value="table" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label htmlFor="question-table">질문 *</Label>
          <Textarea
            id="question-table"
            value={formData.question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            placeholder="예: 다음 표의 빈칸을 채우시오"
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>표 작성</Label>
          <TableEditor
            initialData={formData.tableData || undefined}
            onChange={(data) => setFormData((prev) => ({ ...prev, tableData: data }))}
          />
        </div>
      </TabsContent>

      <TabsContent value="ocr" className="space-y-4 mt-4">
        <OCRUploader
          onExtractedText={(text) => {
            setFormData((prev) => ({
              ...prev,
              question: text,
              answer: "",
            }));
            setActiveTab("text");
            toast.success("OCR 결과가 질문에 입력되었습니다. 답안을 입력하세요.");
          }}
        />
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/subjects")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {subject && (
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: subject.color || "#3B82F6" }}
              />
            )}
            <h1 className="text-xl font-semibold tracking-tight truncate">{subject?.name || "문제 관리"}</h1>
            <span className="text-sm text-muted-foreground flex-shrink-0">
              {questions?.length || 0}문제
            </span>
            {confidenceData?.aggregate && confidenceData.aggregate.totalQuestions > 0 && (
              <button
                onClick={() => setSubjectConfidenceOpen(true)}
                className={`text-xs font-medium px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                  confidenceData.aggregate.state === 'green' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  confidenceData.aggregate.state === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}
                title="클릭하여 과목 안정도 추이 보기"
              >
                과목 안정도 {confidenceData.aggregate.averageScore}%
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {questions && questions.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setLocation(`/subject-practice/${subjectId}`)}
              >
                <ScrollText className="h-3.5 w-3.5" />
                전체 연습
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setLocation(`/practice/${questions[0].id}`)}
              >
                <Dumbbell className="h-3.5 w-3.5" />
                개별 연습
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setLocation(`/test/${questions[0].id}`)}
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                시험
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            추가
          </Button>
        </div>
      </div>

      {/* 문제 순서별 안정도 그리드 */}
      {questions && questions.length > 0 && (
        <QuestionGridView
          questions={questions.map(q => ({
            id: q.id,
            displayOrder: q.displayOrder,
            isStarred: q.isStarred || 0,
          }))}
          onSelectQuestion={(id) => setLocation(`/practice/${id}`)}
          confidenceData={Object.fromEntries(
            Array.from(confidenceMap.entries()).map(([qId, conf]) => [
              qId,
              { state: conf.state, displayScore: conf.displayScore }
            ])
          )}
        />
      )}



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
        (() => {
          const filteredQuestions = questions;
          if (!filteredQuestions || filteredQuestions.length === 0) return null;
          return (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredQuestions?.map(q => q.id) || []}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {filteredQuestions?.map((question) => (
                    <SortableQuestionCard
                      key={question.id}
                      question={question}
                      confidence={confidenceMap.get(question.id)}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onPractice={(id) => setLocation(`/practice/${id}`)}
                      onTest={(id) => setLocation(`/test/${id}`)}
                      onCopy={handleCopy}
                      onMove={handleMove}
                      onToggleStar={(id) => toggleStarMutation.mutate({ id })}
                      onConfidenceClick={(id, title) => { setConfidenceHistoryId(id); setConfidenceHistoryTitle(title); }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          );
        })()
      )}

      {/* 등록 전체 화면 */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
          <div className="min-h-full flex flex-col">
            <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between shadow-sm">
              <div>
                <h2 className="text-xl font-bold">새 문제 추가</h2>
                <p className="text-sm text-muted-foreground">텍스트, 이미지 또는 표 문제를 생성하세요</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>취소</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "생성 중..." : "생성"}
                </Button>
              </div>
            </div>
            <div className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">
              {questionFormContent}
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
                  <Star className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  <div className="flex-1">
                    <label htmlFor="create-isStarred-q" className="text-sm font-medium cursor-pointer">별표 문제로 지정</label>
                    <p className="text-xs text-muted-foreground">중요하거나 자주 틀리는 문제를 표시합니다</p>
                  </div>
                  <input
                    id="create-isStarred-q"
                    type="checkbox"
                    checked={formData.isStarred}
                    onChange={(e) => setFormData({ ...formData, isStarred: e.target.checked })}
                    className="h-4 w-4 accent-amber-500"
                  />
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
                    <span className="text-xs text-muted-foreground flex-shrink-0">데모</span>
                    <div className="flex-1">
                      <label htmlFor="create-isDemo-q" className="text-sm font-medium cursor-pointer">데모 문제로 지정</label>
                      <p className="text-xs text-muted-foreground">로그인 없이도 모든 사용자에게 표시됩니다</p>
                    </div>
                    <input
                      id="create-isDemo-q"
                      type="checkbox"
                      checked={formData.isDemo}
                      onChange={(e) => setFormData({ ...formData, isDemo: e.target.checked })}
                      className="h-4 w-4 accent-amber-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 수정 전체 화면 */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
          <div className="min-h-full flex flex-col">
            <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between shadow-sm">
              <div>
                <h2 className="text-xl font-bold">문제 수정</h2>
                <p className="text-sm text-muted-foreground">문제 내용을 수정하세요</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setIsEditOpen(false); resetForm(); }}>취소</Button>
                <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "수정 중..." : "저장"}
                </Button>
              </div>
            </div>
            <div className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">
              {questionFormContent}
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
                  <Star className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  <div className="flex-1">
                    <label htmlFor="edit-isStarred-q" className="text-sm font-medium cursor-pointer">별표 문제로 지정</label>
                    <p className="text-xs text-muted-foreground">중요하거나 자주 틀리는 문제를 표시합니다</p>
                  </div>
                  <input
                    id="edit-isStarred-q"
                    type="checkbox"
                    checked={formData.isStarred}
                    onChange={(e) => setFormData({ ...formData, isStarred: e.target.checked })}
                    className="h-4 w-4 accent-amber-500"
                  />
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
                    <span className="text-xs text-muted-foreground flex-shrink-0">데모</span>
                    <div className="flex-1">
                      <label htmlFor="edit-isDemo-q" className="text-sm font-medium cursor-pointer">데모 문제로 지정</label>
                      <p className="text-xs text-muted-foreground">로그인 없이도 모든 사용자에게 표시됩니다</p>
                    </div>
                    <input
                      id="edit-isDemo-q"
                      type="checkbox"
                      checked={formData.isDemo}
                      onChange={(e) => setFormData({ ...formData, isDemo: e.target.checked })}
                      className="h-4 w-4 accent-amber-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* 안정도 변화 그래프 모달 */}
      <ConfidenceHistoryModal
        questionId={confidenceHistoryId}
        questionTitle={confidenceHistoryTitle}
        open={confidenceHistoryId !== null}
        onClose={() => setConfidenceHistoryId(null)}
      />

      {/* 과목 안정도 추이 그래프 모달 */}
      <SubjectConfidenceHistoryModal
        subjectId={subjectId}
        subjectName={subject?.name}
        open={subjectConfidenceOpen}
        onClose={() => setSubjectConfidenceOpen(false)}
      />
    </div>
  );
}
