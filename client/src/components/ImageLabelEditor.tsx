import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { toast } from "sonner";

export interface ImageLabel {
  id: string;
  x: number; // percentage 0-100 (left)
  y: number; // percentage 0-100 (top)
  width: number; // percentage
  height: number; // percentage
  answer: string;
}

interface ImageLabelEditorProps {
  imageUrl: string;
  initialLabels?: ImageLabel[];
  onChange: (labels: ImageLabel[]) => void;
}

export function ImageLabelEditor({ imageUrl, initialLabels = [], onChange }: ImageLabelEditorProps) {
  const [labels, setLabels] = useState<ImageLabel[]>(initialLabels);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChange(labels);
  }, [labels]);

  const getRelativePosition = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const pos = getRelativePosition(e);
    setIsDragging(true);
    setDragStart(pos);
    setDragCurrent(pos);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
    const pos = getRelativePosition(e);
    setDragCurrent(pos);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !dragCurrent) return;

    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);

    // Minimum size check
    if (width < 2 || height < 2) {
      toast.error("영역이 너무 작습니다. 더 크게 드래그하세요.");
      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const newLabel: ImageLabel = {
      id: `label-${Date.now()}`,
      x,
      y,
      width,
      height,
      answer: "",
    };

    setLabels([...labels, newLabel]);
    setSelectedLabelId(newLabel.id);
    setIsDragging(false);
    setDragStart(null);
    setDragCurrent(null);
    toast.success("영역이 추가되었습니다. 오른쪽에서 정답을 입력하세요.");
  };

  const handleLabelUpdate = (id: string, answer: string) => {
    setLabels(labels.map((l) => (l.id === id ? { ...l, answer } : l)));
  };

  const handleLabelDelete = (id: string) => {
    setLabels(labels.filter((l) => l.id !== id));
    if (selectedLabelId === id) {
      setSelectedLabelId(null);
    }
  };

  // Calculate drag preview rectangle
  const getDragPreview = () => {
    if (!isDragging || !dragStart || !dragCurrent) return null;
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    return { x, y, width, height };
  };

  const dragPreview = getDragPreview();

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Image with labels */}
      <div className="space-y-2">
        <Label>이미지 드래그하여 영역 선택</Label>
        <div
          ref={imageRef}
          className="relative border rounded-lg overflow-hidden cursor-crosshair bg-muted select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging) {
              setIsDragging(false);
              setDragStart(null);
              setDragCurrent(null);
            }
          }}
        >
          <img src={imageUrl} alt="Question" className="w-full h-auto pointer-events-none" draggable={false} />
          
          {/* Existing labels */}
          {labels.map((label, index) => (
            <div
              key={label.id}
              className={`absolute border-2 flex items-center justify-center cursor-pointer transition-all ${
                selectedLabelId === label.id
                  ? "bg-primary/20 border-primary"
                  : "bg-background/80 border-primary/50"
              }`}
              style={{
                left: `${label.x}%`,
                top: `${label.y}%`,
                width: `${label.width}%`,
                height: `${label.height}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLabelId(label.id);
              }}
            >
              <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-1 rounded">
                {index + 1}
              </span>
            </div>
          ))}

          {/* Drag preview */}
          {dragPreview && (
            <div
              className="absolute border-2 border-dashed border-primary bg-primary/10"
              style={{
                left: `${dragPreview.x}%`,
                top: `${dragPreview.y}%`,
                width: `${dragPreview.width}%`,
                height: `${dragPreview.height}%`,
              }}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          드래그하여 텍스트가 있는 영역을 선택하세요
        </p>
      </div>

      {/* Label list and editor */}
      <div className="space-y-4">
        <Label>정답 영역 목록 ({labels.length}개)</Label>
        {labels.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg">
            이미지를 드래그하여 정답 영역을 추가하세요
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {labels.map((label, index) => (
              <div
                key={label.id}
                className={`p-4 border rounded-lg space-y-3 cursor-pointer transition-all ${
                  selectedLabelId === label.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => setSelectedLabelId(label.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">영역 {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLabelDelete(label.id);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">정답 (이 영역에 가려진 텍스트)</Label>
                    <Input
                      value={label.answer}
                      onChange={(e) => handleLabelUpdate(label.id, e.target.value)}
                      placeholder="예: Cerebral cortex"
                      className="mt-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    위치: ({Math.round(label.x)}%, {Math.round(label.y)}%) | 크기: {Math.round(label.width)}% × {Math.round(label.height)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
