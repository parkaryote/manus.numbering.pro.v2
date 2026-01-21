import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, BookOpen, Trash2, Edit, GripVertical } from "lucide-react";
import { toast } from "sonner";
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
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F59E0B", // Amber
  "#10B981", // Green
  "#EF4444", // Red
  "#6366F1", // Indigo
  "#14B8A6", // Teal
];

function SortableSubjectCard({ subject, onEdit, onDelete }: any) {
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

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="shadow-elegant hover:shadow-lg transition-all cursor-pointer"
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <div
          className="w-4 h-4 rounded-full flex-shrink-0"
          style={{ backgroundColor: subject.color }}
        />
        <div className="flex-1 min-w-0" onClick={() => setLocation(`/questions?subject=${subject.id}`)}>
          <CardTitle className="text-lg">{subject.name}</CardTitle>
          {subject.description && (
            <CardDescription className="line-clamp-1">{subject.description}</CardDescription>
          )}
        </div>
        <div className="flex gap-2">
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

export default function Subjects() {
  const [, setLocation] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: colorOptions[0],
  });

  const { data: subjects, isLoading } = trpc.subjects.list.useQuery();
  const utils = trpc.useUtils();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const createMutation = trpc.subjects.create.useMutation({
    onSuccess: () => {
      utils.subjects.list.invalidate();
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", color: colorOptions[0] });
      toast.success("과목이 생성되었습니다");
    },
    onError: (error) => {
      toast.error("과목 생성 실패: " + error.message);
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

  const deleteMutation = trpc.subjects.delete.useMutation({
    onSuccess: () => {
      utils.subjects.list.invalidate();
      toast.success("과목이 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("과목 삭제 실패: " + error.message);
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
    const maxOrder = subjects?.reduce((max, s) => Math.max(max, s.displayOrder || 0), 0) || 0;
    createMutation.mutate({ ...formData, displayOrder: maxOrder + 1 } as any);
  };

  const handleEdit = (subject: any) => {
    setEditingSubject(subject);
    setFormData({
      name: subject.name,
      description: subject.description || "",
      color: subject.color || colorOptions[0],
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!formData.name.trim()) {
      toast.error("과목명을 입력하세요");
      return;
    }
    updateMutation.mutate({
      id: editingSubject.id,
      ...formData,
    });
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`"${name}" 과목을 삭제하시겠습니까?`)) {
      deleteMutation.mutate({ id });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !subjects) {
      return;
    }

    const oldIndex = subjects.findIndex((s) => s.id === active.id);
    const newIndex = subjects.findIndex((s) => s.id === over.id);

    const reorderedSubjects = arrayMove(subjects, oldIndex, newIndex);
    const subjectOrders = reorderedSubjects.map((subject, index) => ({
      id: subject.id,
      displayOrder: index,
    }));

    // Optimistic update
    utils.subjects.list.setData(undefined, reorderedSubjects.map((s, idx) => ({
      ...s,
      displayOrder: idx,
    })));

    updateOrderMutation.mutate({ subjectOrders });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">과목 관리</h1>
          <p className="text-muted-foreground mt-1">과목을 생성하고 관리하세요</p>
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
                <div className="flex gap-2 flex-wrap">
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
      ) : !subjects || subjects.length === 0 ? (
        <Card className="shadow-elegant">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">아직 등록된 과목이 없습니다</p>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              첫 과목 만들기
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
            items={subjects.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-4">
              {subjects.map((subject) => (
                <SortableSubjectCard
                  key={subject.id}
                  subject={subject}
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
              <div className="flex gap-2 flex-wrap">
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
