import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Clock, Plus, BookOpen, Trash2, Edit, GripVertical, Star } from "lucide-react";
import { toast } from "sonner";
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

const colorOptions = [
  "#3B82F6", // Blue
  "#2563EB", // Blue Deep
  "#1D4ED8", // Blue Strong
  "#6366F1", // Indigo
  "#4F46E5", // Indigo Deep
  "#8B5CF6", // Purple
  "#7C3AED", // Purple Deep
  "#A855F7", // Violet
  "#C026D3", // Fuchsia
  "#EC4899", // Pink
  "#DB2777", // Pink Deep
  "#E11D48", // Rose
  "#EF4444", // Red
  "#DC2626", // Red Deep
  "#F97316", // Orange
  "#EA580C", // Orange Deep
  "#F59E0B", // Amber
  "#D97706", // Amber Deep
  "#EAB308", // Yellow
  "#84CC16", // Lime
  "#22C55E", // Green
  "#10B981", // Emerald
  "#059669", // Emerald Deep
  "#14B8A6", // Teal
  "#0D9488", // Teal Deep
  "#06B6D4", // Cyan
  "#0891B2", // Cyan Deep
  "#0EA5E9", // Sky
  "#6B7280", // Gray
  "#475569", // Slate
];
const HEX_COLOR_RE = /^#[0-9A-F]{6}$/;

function sanitizeColorInput(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const hexOnly = withHash.replace(/[^#0-9A-F]/g, "");
  return hexOnly.slice(0, 7);
}
const DEMO_PUBLISHING_ENABLED = import.meta.env.VITE_ALLOW_DEMO_PUBLISHING === "true";
const PARTIAL_DENTURE_SUBJECT_NAME = "국소의치학";

function toDateTimeLocalValue(value?: string | Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type SubjectMiniGridItem = {
  questionId: number;
  displayOrder: number;
  displayScore: number;
  state: string;
  isStarred: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSubjectNameForFallback(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function buildDemoWorkspaceFallbackScore(
  question: any,
  index: number,
  subjectName?: string | null
): { displayScore: number; state: "green" | "yellow" | "red" } {
  const normalizedSubjectName = normalizeSubjectNameForFallback(subjectName);
  if (normalizedSubjectName === normalizeSubjectNameForFallback("그림빵")) {
    const displayOrder = Math.max(1, Number(question?.displayOrder ?? index + 1));
    const drawingScores = [52, 58, 62];
    return {
      displayScore: drawingScores[(displayOrder - 1) % drawingScores.length] ?? drawingScores[0],
      state: "yellow",
    };
  }

  const difficulty = question?.difficulty ?? "medium";
  const answerText = typeof question?.answer === "string" ? question.answer : "";
  const answerLength = answerText.replace(/\s+/g, "").length;
  const lineCount = Math.max(
    1,
    answerText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length
  );
  const hasTable = Boolean(question?.tableData);
  const difficultyBase = difficulty === "easy" ? 50 : difficulty === "hard" ? 24 : 37;
  const lengthPenalty = Math.min(14, Math.round(Math.log1p(Math.max(1, answerLength)) * 2.1));
  const linePenalty = Math.min(8, Math.max(0, lineCount - 1));
  const tablePenalty = hasTable ? 6 : 0;
  const orderOffset = ((index % 5) - 2) * 1.5;
  const displayScore = clampScore(difficultyBase - lengthPenalty * 0.6 - linePenalty * 0.45 - tablePenalty + orderOffset);
  const state: "green" | "yellow" | "red" = displayScore >= 80 ? "green" : displayScore >= 40 ? "yellow" : "red";
  return { displayScore, state };
}

// 과목별 미니 그리드: 색상 점 + 별표만 표시
function SubjectMiniGrid({ items }: { items?: SubjectMiniGridItem[] }) {
  if (!items || items.length === 0) return null;

  const sorted = [...items].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  const getFillColor = (state: string) => {
    switch (state) {
      case 'green': return 'bg-emerald-500';
      case 'yellow': return 'bg-amber-400';
      case 'red': return 'bg-red-500';
      default: return 'bg-neutral-200 dark:bg-neutral-700';
    }
  };

  const getBorderColor = (isStarred: boolean) => {
    if (!isStarred) return 'border border-neutral-200 dark:border-neutral-700';
    return 'border-2 border-neutral-900 dark:border-neutral-200';
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sorted.map((q) => {
        const starred = q.isStarred === 1;
        const fillColor = getFillColor(q.state);
        const borderColor = getBorderColor(starred);
        return (
          <div
            key={q.questionId}
            className={`rounded-full w-2.5 h-2.5 ${fillColor} ${borderColor}`}
            title={`문제 ${q.displayOrder} — ${Math.round(q.displayScore)}점${starred ? " (중요)" : ""}`}
          />
        );
      })}
    </div>
  );
}

function SubjectSignalCountsInline({
  greenCount,
  yellowCount,
  redCount,
  coldCount,
  className = "",
}: {
  greenCount: number;
  yellowCount: number;
  redCount: number;
  coldCount: number;
  className?: string;
}) {
  if (greenCount + yellowCount + redCount + coldCount <= 0) return null;

  return (
    <div className={`inline-flex items-center gap-2 text-[11px] text-muted-foreground ${className}`}>
      {greenCount > 0 && (
        <span className="inline-flex items-center gap-1" title="안정">
          <span className="w-2.5 h-[3px] rounded-[2px] bg-emerald-500 inline-block" />
          {greenCount}
        </span>
      )}
      {yellowCount > 0 && (
        <span className="inline-flex items-center gap-1" title="학습중">
          <span className="w-2.5 h-[3px] rounded-[2px] bg-amber-400 inline-block" />
          {yellowCount}
        </span>
      )}
      {redCount > 0 && (
        <span className="inline-flex items-center gap-1" title="취약">
          <span className="w-2.5 h-[3px] rounded-[2px] bg-red-500 inline-block" />
          {redCount}
        </span>
      )}
      {coldCount > 0 && (
        <span className="inline-flex items-center gap-1" title="미학습">
          <span className="w-2.5 h-[3px] rounded-[2px] bg-neutral-300 dark:bg-neutral-600 inline-block" />
          {coldCount}
        </span>
      )}
    </div>
  );
}

interface SubjectCardProps {
  subject: any;
  isAdmin: boolean;
  canPublishDemo: boolean;
  isTogglePending?: boolean;
  onToggleDemo: (subject: any) => void;
  onEdit: (subject: any) => void;
  onDelete: (id: number, name: string) => void;
}

function SortableSubjectCard({
  subject,
  isAdmin,
  canPublishDemo,
  isTogglePending = false,
  onToggleDemo,
  onEdit,
  onDelete,
}: SubjectCardProps) {
  const { data: subjectConfidence } = trpc.confidence.getBySubject.useQuery(
    { subjectId: subject.id },
    {
      enabled: !!subject.id,
      staleTime: 60_000,
      refetchOnMount: false,
    }
  );
  const [, setLocation] = useLocation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subject.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const aggregate = subjectConfidence?.aggregate;
  const totalQuestions = aggregate?.totalQuestions ?? subjectConfidence?.questions?.length ?? 0;
  const greenCount = aggregate?.greenCount ?? 0;
  const yellowCount = aggregate?.yellowCount ?? 0;
  const redCount = aggregate?.redCount ?? 0;
  const coldCount = Math.max(0, totalQuestions - greenCount - yellowCount - redCount);
  const state = aggregate?.state;
  const stateColor =
    state === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "yellow"
      ? "text-amber-600 dark:text-amber-400"
      : state === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const stateBg =
    state === "green"
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : state === "yellow"
      ? "bg-amber-50 dark:bg-amber-950/30"
      : state === "red"
      ? "bg-red-50 dark:bg-red-950/30"
      : "bg-muted";
  const subjectGrade = state === "green" ? "A" : state === "yellow" ? "B" : state === "red" ? "C" : null;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="shadow-sm hover:shadow-md transition-all cursor-pointer"
    >
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none mt-1"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <div
          className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: subject.color }}
        />
        <div className="flex-1 min-w-0" onClick={() => setLocation(`/questions/${subject.id}`)}>
          <div className="flex items-center gap-2 mb-0.5">
            <CardTitle className="text-lg">{subject.name}</CardTitle>
            {totalQuestions > 0 && (
              <span className="text-xs text-muted-foreground">{totalQuestions}문제</span>
            )}
            {subjectGrade && (
              <span className={`inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded text-[11px] font-bold ${stateBg} ${stateColor}`}>
                {subjectGrade}
              </span>
            )}
            <SubjectSignalCountsInline
              greenCount={greenCount}
              yellowCount={yellowCount}
              redCount={redCount}
              coldCount={coldCount}
              className="ml-0.5"
            />
            {subject.isDemo === 1 && (
              <Badge variant="secondary" className="gap-1 text-xs py-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                <Star className="w-2.5 h-2.5" />
                데모
              </Badge>
            )}
          </div>
          {subject.description && (
            <CardDescription className="line-clamp-1 mb-1">{subject.description}</CardDescription>
          )}
          <div className="mb-1">
            <SubjectMiniGrid items={subjectConfidence?.questions as SubjectMiniGridItem[] | undefined} />
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {isAdmin && canPublishDemo && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isTogglePending}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDemo(subject);
              }}
              title={subject.isDemo === 1 ? "데모 게시 해제" : "데모 게시"}
            >
              <Star className={`h-4 w-4 ${subject.isDemo === 1 ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(subject);
            }}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(subject.id, subject.name);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

function DemoWorkspaceSubjectCard({
  subject,
  onEdit,
  onDelete,
}: {
  subject: any;
  onEdit: (subject: any) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const [, setLocation] = useLocation();
  const demoQuestionsQuery = trpc.admin.demo.questions.useQuery(
    { subjectId: subject.id },
    { placeholderData: (previous) => previous }
  );
  const demoShowcaseQuestionsQuery = trpc.demo.questions.useQuery(
    { subjectId: subject.id },
    { placeholderData: (previous) => previous }
  );
  const confidencePreviewQuery = trpc.demo.confidenceBySubject.useQuery(
    { subjectId: subject.id },
    { placeholderData: (previous) => previous }
  );
  const demoQuestions = demoQuestionsQuery.data ?? [];
  const demoShowcaseQuestions = demoShowcaseQuestionsQuery.data ?? [];
  const confidencePreview = confidencePreviewQuery.data;

  const miniItems = useMemo<SubjectMiniGridItem[]>(() => {
    const sorted = [...demoShowcaseQuestions].sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    const demoQuestionMap = new Map(demoQuestions.map((row) => [row.id, row] as const));
    const previewMap = new Map(
      (confidencePreview?.questions ?? []).map((row) => [row.questionId, row] as const)
    );
    return sorted.map((question, index) => {
      const order = index + 1;
      const previewRow = previewMap.get(question.id);
      const sourceQuestion = demoQuestionMap.get(question.id);
      if (previewRow) {
        return {
          questionId: question.id,
          displayOrder: order,
          displayScore: clampScore(previewRow.displayScore),
          state: previewRow.state,
          isStarred: sourceQuestion?.isStarred ?? question.isStarred ?? previewRow.isStarred ?? 0,
        };
      }
      const fallback = buildDemoWorkspaceFallbackScore(question, index, subject?.name);
      return {
        questionId: question.id,
        displayOrder: order,
        displayScore: fallback.displayScore,
        state: fallback.state,
        isStarred: sourceQuestion?.isStarred ?? question.isStarred ?? 0,
      };
    });
  }, [confidencePreview?.questions, demoQuestions, demoShowcaseQuestions]);

  const questionCount = miniItems.length;
  const isQuestionCountLoading =
    demoQuestionsQuery.isLoading || demoShowcaseQuestionsQuery.isLoading || confidencePreviewQuery.isLoading;
  const questionCountLabel = isQuestionCountLoading && questionCount === 0 ? "불러오는 중..." : `${questionCount}문제`;
  const averageScore = questionCount > 0
    ? Math.round(miniItems.reduce((sum, row) => sum + row.displayScore, 0) / questionCount)
    : 0;
  const greenCount = miniItems.filter((row) => row.state === "green").length;
  const yellowCount = miniItems.filter((row) => row.state === "yellow").length;
  const redCount = miniItems.filter((row) => row.state === "red").length;
  const coldCount = Math.max(0, questionCount - greenCount - yellowCount - redCount);
  const aggregateState = averageScore >= 80 ? "green" : averageScore >= 40 ? "yellow" : "red";
  const subjectGrade = aggregateState === "green" ? "A" : aggregateState === "yellow" ? "B" : "C";
  const stateColor =
    aggregateState === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : aggregateState === "yellow"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  const stateBg =
    aggregateState === "green"
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : aggregateState === "yellow"
      ? "bg-amber-50 dark:bg-amber-950/30"
      : "bg-red-50 dark:bg-red-950/30";

  return (
    <Card className="shadow-sm hover:shadow-md transition-all cursor-pointer">
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div
          className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: subject.color }}
        />
        <div className="flex-1 min-w-0" onClick={() => setLocation(`/demo/questions/${subject.id}?workspace=1`)}>
          <div className="flex items-center gap-2 mb-0.5">
            <CardTitle className="text-lg">{subject.name}</CardTitle>
            <span className="text-xs text-muted-foreground">{questionCountLabel}</span>
            {questionCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded text-[11px] font-bold ${stateBg} ${stateColor}`}>
                {subjectGrade}
              </span>
            )}
            <SubjectSignalCountsInline
              greenCount={greenCount}
              yellowCount={yellowCount}
              redCount={redCount}
              coldCount={coldCount}
              className="ml-0.5"
            />
            <Badge variant="secondary" className="gap-1 text-xs py-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <Star className="w-2.5 h-2.5" />
              데모
            </Badge>
          </div>
          {subject.description && (
            <CardDescription className="line-clamp-1 mb-1">{subject.description}</CardDescription>
          )}
          <div className="mb-1">
            <SubjectMiniGrid items={miniItems} />
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(subject);
            }}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(subject.id, subject.name);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

function GuestDemoSubjectCard({ subject }: { subject: any }) {
  const [, setLocation] = useLocation();
  const demoQuestionsQuery = trpc.demo.questions.useQuery(
    { subjectId: subject.id },
    { placeholderData: (previous) => previous }
  );
  const confidencePreviewQuery = trpc.demo.confidenceBySubject.useQuery(
    { subjectId: subject.id },
    { placeholderData: (previous) => previous }
  );
  const demoQuestions = demoQuestionsQuery.data ?? [];
  const confidencePreview = confidencePreviewQuery.data;

  const miniItems = useMemo<SubjectMiniGridItem[]>(() => {
    const sorted = [...demoQuestions].sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    const previewMap = new Map(
      (confidencePreview?.questions ?? []).map((row) => [row.questionId, row] as const)
    );
    return sorted.map((question, index) => {
      const order = index + 1;
      const previewRow = previewMap.get(question.id);
      if (previewRow) {
        return {
          questionId: question.id,
          displayOrder: order,
          displayScore: clampScore(previewRow.displayScore),
          state: previewRow.state,
          isStarred: question.isStarred ?? previewRow.isStarred ?? 0,
        };
      }
      const fallback = buildDemoWorkspaceFallbackScore(question, index, subject?.name);
      return {
        questionId: question.id,
        displayOrder: order,
        displayScore: fallback.displayScore,
        state: fallback.state,
        isStarred: question.isStarred ?? 0,
      };
    });
  }, [confidencePreview?.questions, demoQuestions, subject?.name]);

  const questionCount = miniItems.length;
  const isQuestionCountLoading = demoQuestionsQuery.isLoading || confidencePreviewQuery.isLoading;
  const questionCountLabel = isQuestionCountLoading && questionCount === 0 ? "불러오는 중..." : `${questionCount}문제`;
  const averageScore = questionCount > 0
    ? Math.round(miniItems.reduce((sum, row) => sum + row.displayScore, 0) / questionCount)
    : 0;
  const greenCount = miniItems.filter((row) => row.state === "green").length;
  const yellowCount = miniItems.filter((row) => row.state === "yellow").length;
  const redCount = miniItems.filter((row) => row.state === "red").length;
  const coldCount = Math.max(0, questionCount - greenCount - yellowCount - redCount);
  const aggregateState = averageScore >= 80 ? "green" : averageScore >= 40 ? "yellow" : "red";
  const subjectGrade = aggregateState === "green" ? "A" : aggregateState === "yellow" ? "B" : "C";
  const stateColor =
    aggregateState === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : aggregateState === "yellow"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  const stateBg =
    aggregateState === "green"
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : aggregateState === "yellow"
      ? "bg-amber-50 dark:bg-amber-950/30"
      : "bg-red-50 dark:bg-red-950/30";

  return (
    <Card
      className="shadow-sm hover:shadow-md transition-all cursor-pointer"
      onClick={() => setLocation(`/demo/questions/${subject.id}`)}
    >
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div
          className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: subject.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CardTitle className="text-lg">{subject.name}</CardTitle>
            <span className="text-xs text-muted-foreground">{questionCountLabel}</span>
            {questionCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded text-[11px] font-bold ${stateBg} ${stateColor}`}>
                {subjectGrade}
              </span>
            )}
            <SubjectSignalCountsInline
              greenCount={greenCount}
              yellowCount={yellowCount}
              redCount={redCount}
              coldCount={coldCount}
              className="ml-0.5"
            />
            <Badge variant="secondary" className="gap-1 text-xs py-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <Star className="w-2.5 h-2.5" />
              데모
            </Badge>
          </div>
          {subject.description && (
            <CardDescription className="line-clamp-1 mb-1">{subject.description}</CardDescription>
          )}
          <div className="mb-1">
            <SubjectMiniGrid items={miniItems} />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

export default function Subjects({ demoWorkspace = false }: { demoWorkspace?: boolean }) {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const isGuest = !user || user.loginMethod === "guest";
  const isDemoWorkspace = demoWorkspace && isAdmin;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: colorOptions[0],
    examEndDate: "",
    isDemo: false,
  });

  const userSubjectsQuery = trpc.subjects.list.useQuery(undefined, {
    enabled: !isDemoWorkspace && !authLoading,
  });
  const demoSubjectsQuery = trpc.admin.demo.subjects.useQuery(undefined, { enabled: isDemoWorkspace });
  const guestDemoSubjectsQuery = trpc.demo.subjects.useQuery(undefined, {
    enabled: !isDemoWorkspace && isGuest && !authLoading,
    refetchOnWindowFocus: false,
  });
  const subjects = (isDemoWorkspace ? demoSubjectsQuery.data : userSubjectsQuery.data) ?? [];
  const guestDemoSubjects = guestDemoSubjectsQuery.data ?? [];
  const shouldUseGuestDemoFallback =
    !isDemoWorkspace &&
    isGuest &&
    !userSubjectsQuery.isLoading &&
    subjects.length === 0 &&
    guestDemoSubjects.length > 0;
  const renderedSubjects = shouldUseGuestDemoFallback ? guestDemoSubjects : subjects;
  const isLoading = authLoading
    || (isDemoWorkspace
      ? demoSubjectsQuery.isLoading
      : (userSubjectsQuery.isLoading || (isGuest && subjects.length === 0 && guestDemoSubjectsQuery.isLoading)));
  const utils = trpc.useUtils();
  const urgentDemoSubject = useMemo(
    () => renderedSubjects.find((subject: any) => String(subject?.name ?? "").includes(PARTIAL_DENTURE_SUBJECT_NAME)),
    [renderedSubjects]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const createMutation = trpc.subjects.create.useMutation({
    onSuccess: (created) => {
      utils.subjects.list.setData(undefined, (prev) => {
        const next = [...(prev ?? []), created];
        return next.sort((a, b) => {
          const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
          if (orderDiff !== 0) return orderDiff;
          return (a.id ?? 0) - (b.id ?? 0);
        });
      });
      void utils.subjects.list.invalidate();
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", color: colorOptions[0], examEndDate: "", isDemo: false });
      toast.success("과목이 생성되었습니다");
    },
    onError: (error) => {
      toast.error("과목 생성 실패: " + error.message);
    },
  });
  const createDemoMutation = trpc.admin.demo.createSubject.useMutation({
    onSuccess: (created) => {
      utils.admin.demo.subjects.setData(undefined, (prev) => {
        const next = [...(prev ?? []), created.data];
        return next.sort((a, b) => {
          const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
          if (orderDiff !== 0) return orderDiff;
          return (a.id ?? 0) - (b.id ?? 0);
        });
      });
      void utils.admin.demo.subjects.invalidate();
      void utils.demo.subjects.invalidate();
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", color: colorOptions[0], examEndDate: "", isDemo: false });
      toast.success("데모 과목이 생성되었습니다");
    },
    onError: (error) => {
      toast.error("데모 과목 생성 실패: " + error.message);
    },
  });

  const updateMutation = trpc.subjects.update.useMutation({
    onSuccess: () => {
      utils.subjects.list.invalidate();
      setIsEditOpen(false);
      setEditingSubject(null);
      toast.success("과목이 수정되었습니다");
    },
    onError: (error) => {
      toast.error("과목 수정 실패: " + error.message);
    },
  });
  const toggleDemoMutation = trpc.subjects.update.useMutation({
    onSuccess: () => {
      void utils.subjects.list.invalidate();
      void utils.admin.demo.subjects.invalidate();
      void utils.demo.subjects.invalidate();
      toast.success("데모 게시 설정이 반영되었습니다");
    },
    onError: (error) => {
      toast.error("데모 게시 설정 실패: " + error.message);
    },
  });
  const updateDemoMutation = trpc.admin.demo.updateSubject.useMutation({
    onSuccess: () => {
      utils.admin.demo.subjects.invalidate();
      utils.demo.subjects.invalidate();
      setIsEditOpen(false);
      setEditingSubject(null);
      toast.success("데모 과목이 수정되었습니다");
    },
    onError: (error) => {
      toast.error("데모 과목 수정 실패: " + error.message);
    },
  });

  const deleteMutation = trpc.subjects.delete.useMutation({
    onSuccess: () => {
      utils.subjects.list.invalidate();
      toast.success("과목이 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("과목 삭제 실패: " + error.message);
    },
  });
  const deleteDemoMutation = trpc.admin.demo.deleteSubject.useMutation({
    onSuccess: () => {
      utils.admin.demo.subjects.invalidate();
      utils.demo.subjects.invalidate();
      toast.success("데모 과목이 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("데모 과목 삭제 실패: " + error.message);
    },
  });

  const updateOrderMutation = trpc.subjects.updateOrder.useMutation({
    onError: (error) => {
      toast.error("순서 변경 실패: " + error.message);
      utils.subjects.list.invalidate();
    },
  });

  const handleCreate = () => {
    if (!formData.name.trim()) {
      toast.error("과목명을 입력하세요");
      return;
    }
    if (!HEX_COLOR_RE.test(formData.color.toUpperCase())) {
      toast.error("색상은 #RRGGBB 형식으로 입력하세요");
      return;
    }
    if (isDemoWorkspace) {
      createDemoMutation.mutate({
        name: formData.name,
        description: formData.description,
        color: formData.color.toUpperCase(),
      });
      return;
    }

    const maxOrder = subjects.reduce((max, s) => Math.max(max, s.displayOrder || 0), 0) || 0;
    const requestedDemoValue =
      isAdmin && DEMO_PUBLISHING_ENABLED ? (formData.isDemo ? 1 : 0) : undefined;
    createMutation.mutate({
      name: formData.name,
      description: formData.description,
      color: formData.color.toUpperCase(),
      examEndDate: formData.examEndDate || undefined,
      displayOrder: maxOrder + 1,
      isDemo: requestedDemoValue,
    } as any);
  };

  const handleEdit = (subject: any) => {
    setEditingSubject(subject);
    setFormData({
      name: subject.name,
      description: subject.description || "",
      color: subject.color || colorOptions[0],
      examEndDate: toDateTimeLocalValue(subject.examEndDate),
      isDemo: subject.isDemo === 1,
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!formData.name.trim()) {
      toast.error("과목명을 입력하세요");
      return;
    }
    if (!HEX_COLOR_RE.test(formData.color.toUpperCase())) {
      toast.error("색상은 #RRGGBB 형식으로 입력하세요");
      return;
    }
    if (isDemoWorkspace) {
      updateDemoMutation.mutate({
        subjectId: editingSubject.id,
        name: formData.name,
        description: formData.description,
        color: formData.color.toUpperCase(),
      });
      return;
    }

    const requestedDemoValue =
      isAdmin && DEMO_PUBLISHING_ENABLED ? (formData.isDemo ? 1 : 0) : undefined;
    updateMutation.mutate({
      id: editingSubject.id,
      name: formData.name,
      description: formData.description,
      color: formData.color.toUpperCase(),
      examEndDate: formData.examEndDate || null,
      isDemo: requestedDemoValue,
    } as any);
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`"${name}" 과목을 삭제하시겠습니까?`)) {
      if (isDemoWorkspace) {
        deleteDemoMutation.mutate({ subjectId: id });
        return;
      }
      deleteMutation.mutate({ id });
    }
  };

  const handleToggleDemo = (subject: any) => {
    if (!isAdmin || !DEMO_PUBLISHING_ENABLED) return;
    const next = subject.isDemo === 1 ? 0 : 1;
    toggleDemoMutation.mutate({
      id: subject.id,
      isDemo: next,
    } as any);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (isDemoWorkspace) return;
    const { active, over } = event;
    if (!over || active.id === over.id || !subjects) return;

    const oldIndex = subjects.findIndex((s) => s.id === active.id);
    const newIndex = subjects.findIndex((s) => s.id === over.id);
    const reorderedSubjects = arrayMove(subjects, oldIndex, newIndex);
    const subjectOrders = reorderedSubjects.map((subject, index) => ({
      id: subject.id,
      displayOrder: index + 1,
    }));

    utils.subjects.list.setData(undefined, reorderedSubjects.map((s, idx) => ({
      ...s,
      displayOrder: idx + 1,
    })));

    updateOrderMutation.mutate({ subjectOrders });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isDemoWorkspace ? "데모 대시보드" : "과목 관리"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isDemoWorkspace
              ? "여기서 수정하면 게스트 데모 화면에 즉시 반영됩니다"
              : "과목을 생성하고 관리하세요"}
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              새 과목 추가
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 과목 추가</DialogTitle>
              <DialogDescription>과목 정보를 입력하세요</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">과목명 *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="예: 한국사"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">설명</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="과목에 대한 간단한 설명"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>색상</Label>
                <div className="grid grid-cols-10 gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        formData.color === color ? "border-primary scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormData({ ...formData, color })}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={HEX_COLOR_RE.test(formData.color.toUpperCase()) ? formData.color : colorOptions[0]}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value.toUpperCase() })}
                    className="h-9 w-14 cursor-pointer p-1"
                    aria-label="커스텀 색상 선택"
                  />
                  <Input
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: sanitizeColorInput(e.target.value) })}
                    placeholder="#3B82F6"
                    maxLength={7}
                    className="w-32 font-mono uppercase"
                  />
                  <span className="text-xs text-muted-foreground">직접 입력 가능</span>
                </div>
              </div>
              {!isDemoWorkspace && (
                <div className="space-y-2">
                  <Label htmlFor="examEndDate">시험 일시</Label>
                  <Input
                    id="examEndDate"
                    type="datetime-local"
                    step={600}
                    value={formData.examEndDate}
                    onChange={(e) => setFormData({ ...formData, examEndDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    시험 일시를 기준으로 예측을 계산합니다. 시험 후 1달이 지나고 미사용이면 자동 삭제됩니다.
                  </p>
                </div>
              )}
              {!isDemoWorkspace && isAdmin && DEMO_PUBLISHING_ENABLED && (
                <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
                  <Star className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  <div className="flex-1">
                    <Label htmlFor="create-isDemo" className="text-sm font-medium cursor-pointer">데모 과목으로 지정</Label>
                    <p className="text-xs text-muted-foreground">로그인 없이도 모든 사용자에게 표시됩니다</p>
                  </div>
                  <input
                    id="create-isDemo"
                    type="checkbox"
                    checked={formData.isDemo}
                    onChange={(e) => setFormData({ ...formData, isDemo: e.target.checked })}
                    className="h-4 w-4 accent-amber-500"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                취소
              </Button>
              <Button onClick={handleCreate} disabled={isDemoWorkspace ? createDemoMutation.isPending : createMutation.isPending}>
                {isDemoWorkspace
                  ? (createDemoMutation.isPending ? "생성 중..." : "생성")
                  : (createMutation.isPending ? "생성 중..." : "생성")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isDemoWorkspace && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="border-red-200/70 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <p className="text-xs font-medium text-red-700 dark:text-red-300">시험 임박</p>
              </div>
              <p className="text-base font-semibold">{urgentDemoSubject?.name ?? PARTIAL_DENTURE_SUBJECT_NAME}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200/70 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">오늘 복습할 문제</p>
              </div>
              <p className="text-base font-semibold">8개</p>
            </CardContent>
          </Card>
          <Card className="border-neutral-300/70 bg-neutral-50/70 dark:border-neutral-700/70 dark:bg-neutral-900/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Star className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
                <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">별표 문제</p>
              </div>
              <p className="text-base font-semibold">2개</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      ) : renderedSubjects.length === 0 ? (
        <Card className="shadow-elegant">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {isDemoWorkspace ? "아직 데모 과목이 없습니다" : "아직 등록된 과목이 없습니다"}
            </p>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              첫 과목 만들기
            </Button>
          </CardContent>
        </Card>
      ) : isDemoWorkspace ? (
        <div className="grid gap-4">
          {renderedSubjects.map((subject) => (
            <DemoWorkspaceSubjectCard
              key={subject.id}
              subject={subject}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : shouldUseGuestDemoFallback ? (
        <div className="grid gap-4">
          {renderedSubjects.map((subject) => (
            <GuestDemoSubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={renderedSubjects.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-4">
              {renderedSubjects.map((subject) => (
                <SortableSubjectCard
                  key={subject.id}
                  subject={subject}
                  isAdmin={isAdmin}
                  canPublishDemo={DEMO_PUBLISHING_ENABLED}
                  isTogglePending={toggleDemoMutation.isPending}
                  onToggleDemo={handleToggleDemo}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>과목 수정</DialogTitle>
            <DialogDescription>과목 정보를 수정하세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">과목명 *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="예: 한국사"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">설명</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="과목에 대한 간단한 설명"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>색상</Label>
              <div className="grid grid-cols-10 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.color === color ? "border-primary scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={HEX_COLOR_RE.test(formData.color.toUpperCase()) ? formData.color : colorOptions[0]}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value.toUpperCase() })}
                  className="h-9 w-14 cursor-pointer p-1"
                  aria-label="커스텀 색상 선택"
                />
                <Input
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: sanitizeColorInput(e.target.value) })}
                  placeholder="#3B82F6"
                  maxLength={7}
                  className="w-32 font-mono uppercase"
                />
                <span className="text-xs text-muted-foreground">직접 입력 가능</span>
              </div>
            </div>
            {!isDemoWorkspace && (
              <div className="space-y-2">
                <Label htmlFor="edit-examEndDate">시험 일시</Label>
                <Input
                  id="edit-examEndDate"
                  type="datetime-local"
                  step={600}
                  value={formData.examEndDate}
                  onChange={(e) => setFormData({ ...formData, examEndDate: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  시험 일시를 기준으로 예측을 계산합니다. 시험 후 1달이 지나고 미사용이면 자동 삭제됩니다.
                </p>
              </div>
            )}
            {!isDemoWorkspace && isAdmin && DEMO_PUBLISHING_ENABLED && (
              <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
                <Star className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <div className="flex-1">
                  <Label htmlFor="edit-isDemo" className="text-sm font-medium cursor-pointer">데모 과목으로 지정</Label>
                  <p className="text-xs text-muted-foreground">로그인 없이도 모든 사용자에게 표시됩니다</p>
                </div>
                <input
                  id="edit-isDemo"
                  type="checkbox"
                  checked={formData.isDemo}
                  onChange={(e) => setFormData({ ...formData, isDemo: e.target.checked })}
                  className="h-4 w-4 accent-amber-500"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              취소
            </Button>
            <Button onClick={handleUpdate} disabled={isDemoWorkspace ? updateDemoMutation.isPending : updateMutation.isPending}>
              {isDemoWorkspace
                ? (updateDemoMutation.isPending ? "수정 중..." : "수정")
                : (updateMutation.isPending ? "수정 중..." : "수정")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
