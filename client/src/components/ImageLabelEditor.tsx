import { useEffect, useRef, useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { toast } from "sonner";
import { resolveRenderableImageUrl } from "@/lib/renderableImageUrl";

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

type Point = { x: number; y: number };
type ResizeHandle = "nw" | "ne" | "sw" | "se";
type InteractionState =
  | { mode: "draw"; pointerId: number; start: Point; current: Point }
  | {
      mode: "move";
      pointerId: number;
      labelId: string;
      pointerStart: Point;
      labelStart: ImageLabel;
    }
  | {
      mode: "resize";
      pointerId: number;
      labelId: string;
      handle: ResizeHandle;
      pointerStart: Point;
      labelStart: ImageLabel;
    };

const MIN_LABEL_SIZE = 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ImageLabelEditorComponent({ imageUrl, initialLabels = [], onChange }: ImageLabelEditorProps) {
  const [labels, setLabels] = useState<ImageLabel[]>(initialLabels);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<ImageLabel[]>(initialLabels);

  useEffect(() => {
    labelsRef.current = initialLabels;
    setLabels(initialLabels);
    setSelectedLabelId((prev) =>
      prev && initialLabels.some((label) => label.id === prev) ? prev : null
    );
    setInteraction(null);
  }, [initialLabels, imageUrl]);

  const getRelativePosition = (clientX: number, clientY: number): Point => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  };

  const applyLabels = (next: ImageLabel[], notifyParent = false) => {
    labelsRef.current = next;
    setLabels(next);
    if (notifyParent) onChange(next);
  };

  const updateSingleLabel = (
    labelId: string,
    updater: (label: ImageLabel) => ImageLabel,
    notifyParent = false
  ) => {
    const next = labelsRef.current.map((label) =>
      label.id === labelId ? updater(label) : label
    );
    applyLabels(next, notifyParent);
  };

  const releasePointerCapture = (pointerId: number) => {
    if (!imageRef.current) return;
    try {
      if (imageRef.current.hasPointerCapture(pointerId)) {
        imageRef.current.releasePointerCapture(pointerId);
      }
    } catch {
      // no-op
    }
  };

  const startDraw = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-label-interactive='true']")) return;
    const pos = getRelativePosition(e.clientX, e.clientY);
    imageRef.current?.setPointerCapture(e.pointerId);
    setInteraction({
      mode: "draw",
      pointerId: e.pointerId,
      start: pos,
      current: pos,
    });
  };

  const startMove = (e: React.PointerEvent<HTMLDivElement>, label: ImageLabel) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getRelativePosition(e.clientX, e.clientY);
    imageRef.current?.setPointerCapture(e.pointerId);
    setSelectedLabelId(label.id);
    setInteraction({
      mode: "move",
      pointerId: e.pointerId,
      labelId: label.id,
      pointerStart: pos,
      labelStart: { ...label },
    });
  };

  const startResize = (
    e: React.PointerEvent<HTMLButtonElement>,
    label: ImageLabel,
    handle: ResizeHandle
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getRelativePosition(e.clientX, e.clientY);
    imageRef.current?.setPointerCapture(e.pointerId);
    setSelectedLabelId(label.id);
    setInteraction({
      mode: "resize",
      pointerId: e.pointerId,
      labelId: label.id,
      handle,
      pointerStart: pos,
      labelStart: { ...label },
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interaction || interaction.pointerId !== e.pointerId) return;
    const pos = getRelativePosition(e.clientX, e.clientY);

    if (interaction.mode === "draw") {
      setInteraction({ ...interaction, current: pos });
      return;
    }

    if (interaction.mode === "move") {
      const dx = pos.x - interaction.pointerStart.x;
      const dy = pos.y - interaction.pointerStart.y;
      const nextX = clamp(interaction.labelStart.x + dx, 0, 100 - interaction.labelStart.width);
      const nextY = clamp(interaction.labelStart.y + dy, 0, 100 - interaction.labelStart.height);

      updateSingleLabel(
        interaction.labelId,
        (label) => ({ ...label, x: nextX, y: nextY }),
        false
      );
      return;
    }

    if (interaction.mode === "resize") {
      const startLeft = interaction.labelStart.x;
      const startTop = interaction.labelStart.y;
      const startRight = interaction.labelStart.x + interaction.labelStart.width;
      const startBottom = interaction.labelStart.y + interaction.labelStart.height;

      let left = startLeft;
      let top = startTop;
      let right = startRight;
      let bottom = startBottom;

      if (interaction.handle.includes("w")) {
        left = clamp(pos.x, 0, startRight - MIN_LABEL_SIZE);
      }
      if (interaction.handle.includes("e")) {
        right = clamp(pos.x, startLeft + MIN_LABEL_SIZE, 100);
      }
      if (interaction.handle.includes("n")) {
        top = clamp(pos.y, 0, startBottom - MIN_LABEL_SIZE);
      }
      if (interaction.handle.includes("s")) {
        bottom = clamp(pos.y, startTop + MIN_LABEL_SIZE, 100);
      }

      const width = clamp(right - left, MIN_LABEL_SIZE, 100);
      const height = clamp(bottom - top, MIN_LABEL_SIZE, 100);

      updateSingleLabel(
        interaction.labelId,
        (label) => ({ ...label, x: left, y: top, width, height }),
        false
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interaction || interaction.pointerId !== e.pointerId) return;

    if (interaction.mode === "draw") {
      const x = Math.min(interaction.start.x, interaction.current.x);
      const y = Math.min(interaction.start.y, interaction.current.y);
      const width = Math.abs(interaction.current.x - interaction.start.x);
      const height = Math.abs(interaction.current.y - interaction.start.y);

      if (width < MIN_LABEL_SIZE || height < MIN_LABEL_SIZE) {
        toast.error("영역이 너무 작습니다. 더 크게 드래그하세요.");
        releasePointerCapture(e.pointerId);
        setInteraction(null);
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

      const next = [...labelsRef.current, newLabel];
      applyLabels(next, true);
      setSelectedLabelId(newLabel.id);
      toast.success("영역이 추가되었습니다. 위치/크기는 드래그로 수정할 수 있습니다.");
    } else {
      onChange(labelsRef.current);
    }

    releasePointerCapture(e.pointerId);
    setInteraction(null);
  };

  const cancelInteraction = () => {
    if (!interaction) return;
    releasePointerCapture(interaction.pointerId);
    setInteraction(null);
  };

  const handleLabelUpdate = (id: string, answer: string) => {
    updateSingleLabel(id, (label) => ({ ...label, answer }), true);
  };

  const handleLabelDelete = (id: string) => {
    const next = labelsRef.current.filter((label) => label.id !== id);
    applyLabels(next, true);
    if (selectedLabelId === id) {
      setSelectedLabelId(null);
    }
  };

  const dragPreview =
    interaction?.mode === "draw"
      ? {
          x: Math.min(interaction.start.x, interaction.current.x),
          y: Math.min(interaction.start.y, interaction.current.y),
          width: Math.abs(interaction.current.x - interaction.start.x),
          height: Math.abs(interaction.current.y - interaction.start.y),
        }
      : null;

  const resizeHandleConfigs: Array<{ key: ResizeHandle; className: string }> = [
    { key: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
    { key: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
    { key: "sw", className: "-left-1.5 -bottom-1.5 cursor-nesw-resize" },
    { key: "se", className: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
  ];

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Image with labels */}
      <div className="space-y-2">
        <Label>이미지 영역 편집</Label>
        <div
          ref={imageRef}
          className="relative border rounded-lg overflow-hidden cursor-crosshair bg-muted select-none touch-none"
          onPointerDown={startDraw}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelInteraction}
          onPointerLeave={(e) => {
            if (interaction?.mode === "draw" && interaction.pointerId === e.pointerId) {
              cancelInteraction();
            }
          }}
        >
          <img src={resolveRenderableImageUrl(imageUrl)} alt="Question" className="w-full h-auto pointer-events-none" draggable={false} />
          
          {/* Existing labels */}
          {labels.map((label, index) => (
            <div
              key={label.id}
              data-label-interactive="true"
              className={`absolute border-2 flex items-center justify-center transition-all ${
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
              onPointerDown={(e) => startMove(e, label)}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLabelId(label.id);
              }}
            >
              <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-1 rounded">
                {index + 1}
              </span>
              {selectedLabelId === label.id &&
                resizeHandleConfigs.map((handle) => (
                  <button
                    key={handle.key}
                    type="button"
                    data-label-interactive="true"
                    aria-label={`영역 ${index + 1} 크기 조절 ${handle.key}`}
                    className={`absolute h-3 w-3 rounded-sm border border-primary bg-background shadow ${handle.className}`}
                    onPointerDown={(e) => startResize(e, label, handle.key)}
                  />
                ))}
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
          새 영역은 드래그로 추가, 기존 영역은 드래그 이동, 모서리 핸들로 확대/축소
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
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const currentIndex = labels.findIndex((l) => l.id === label.id);
                          const nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
                          if (nextIndex >= 0 && nextIndex < labels.length) {
                            const nextLabel = labels[nextIndex];
                            setSelectedLabelId(nextLabel.id);
                            setTimeout(() => {
                              const nextInput = document.querySelector(
                                `input[data-label-id="${nextLabel.id}"]`
                              ) as HTMLInputElement | null;
                              nextInput?.focus();
                            }, 0);
                          }
                        }
                      }}
                      data-label-id={label.id}
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

export const ImageLabelEditor = memo(ImageLabelEditorComponent);
