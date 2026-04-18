import { useCallback, useEffect, useRef, useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GripHorizontal, Move, MoveDiagonal2, X } from "lucide-react";
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

function normalizeLabels(input: ImageLabel[]) {
  const used = new Set<string>();
  let changed = false;
  const labels = (input ?? []).map((label, index) => {
    const rawId = typeof (label as any)?.id === "string" ? (label as any).id.trim() : "";
    const base = rawId || `label-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix++}`;
    }
    used.add(id);
    if (id !== rawId) changed = true;
    return { ...label, id };
  });
  return { labels, changed };
}

function ImageLabelEditorComponent({ imageUrl, initialLabels = [], onChange }: ImageLabelEditorProps) {
  const [labels, setLabels] = useState<ImageLabel[]>(() => normalizeLabels(initialLabels).labels);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string>("");
  const imageRef = useRef<HTMLDivElement>(null);
  const labelListRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<ImageLabel[]>(normalizeLabels(initialLabels).labels);
  const quickAnswerInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFocusLabelIdRef = useRef<string | null>(null);
  const inlineNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const normalized = normalizeLabels(initialLabels);
    labelsRef.current = normalized.labels;
    setLabels(normalized.labels);
    setSelectedLabelId((prev) =>
      prev && normalized.labels.some((label) => label.id === prev) ? prev : null
    );
    setInteraction(null);
    if (normalized.changed) {
      onChange(normalized.labels);
    }
  }, [initialLabels, imageUrl, onChange]);

  useEffect(() => {
    return () => {
      if (inlineNoticeTimerRef.current) {
        clearTimeout(inlineNoticeTimerRef.current);
      }
    };
  }, []);

  const showInlineNotice = useCallback((message: string) => {
    if (inlineNoticeTimerRef.current) {
      clearTimeout(inlineNoticeTimerRef.current);
    }
    setInlineNotice(message);
    inlineNoticeTimerRef.current = setTimeout(() => {
      setInlineNotice("");
      inlineNoticeTimerRef.current = null;
    }, 1800);
  }, []);

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

  const startMove = (e: React.PointerEvent<HTMLElement>, label: ImageLabel) => {
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
      pendingFocusLabelIdRef.current = newLabel.id;
      showInlineNotice("새 영역이 추가되었습니다. 아래 입력칸에서 바로 답안을 입력하세요.");
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
    if (pendingFocusLabelIdRef.current === id) {
      pendingFocusLabelIdRef.current = null;
    }
  };

  const focusAnswerInput = useCallback((labelId: string) => {
    const targetCard = labelListRef.current?.querySelector(
      `[data-label-card-id="${labelId}"]`
    ) as HTMLElement | null;
    targetCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(() => {
      const input = quickAnswerInputRef.current;
      if (!input) return;
      input.focus();
      const cursor = input.value.length;
      input.setSelectionRange(cursor, cursor);
    });
  }, []);

  useEffect(() => {
    const pendingId = pendingFocusLabelIdRef.current;
    if (!pendingId) return;
    if (!labels.some((label) => label.id === pendingId)) return;
    pendingFocusLabelIdRef.current = null;
    requestAnimationFrame(() => focusAnswerInput(pendingId));
  }, [focusAnswerInput, labels, selectedLabelId]);

  const dragPreview =
    interaction?.mode === "draw"
      ? {
          x: Math.min(interaction.start.x, interaction.current.x),
          y: Math.min(interaction.start.y, interaction.current.y),
          width: Math.abs(interaction.current.x - interaction.start.x),
          height: Math.abs(interaction.current.y - interaction.start.y),
        }
      : null;

  const selectedLabelIndex =
    selectedLabelId == null ? -1 : labels.findIndex((label) => label.id === selectedLabelId);
  const selectedLabel = selectedLabelIndex >= 0 ? labels[selectedLabelIndex] : null;

  const resizeHandleConfigs: Array<{ key: ResizeHandle; className: string }> = [
    { key: "nw", className: "-left-2 -top-2 cursor-nwse-resize" },
    { key: "ne", className: "-right-2 -top-2 cursor-nesw-resize" },
    { key: "sw", className: "-left-2 -bottom-2 cursor-nesw-resize" },
    { key: "se", className: "-right-2 -bottom-2 cursor-nwse-resize" },
  ];

  const getResizeHandleIconClass = (key: ResizeHandle) => {
    if (key === "nw") return "rotate-180";
    if (key === "ne") return "-rotate-90";
    if (key === "sw") return "rotate-90";
    return "";
  };

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
              className={`group/label absolute rounded-lg border backdrop-blur-[1px] transition-all duration-150 ${
                selectedLabelId === label.id
                  ? "bg-primary/25 border-primary/90 ring-1 ring-white/30 shadow-[0_8px_24px_-12px_rgba(59,130,246,0.95)]"
                  : "bg-black/20 border-white/75 shadow-[0_8px_16px_-12px_rgba(0,0,0,0.85)] hover:bg-primary/18 hover:border-primary/70"
              }`}
              style={{
                left: `${label.x}%`,
                top: `${label.y}%`,
                width: `${label.width}%`,
                height: `${label.height}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                pendingFocusLabelIdRef.current = label.id;
                setSelectedLabelId(label.id);
              }}
            >
              <span className="absolute left-1.5 top-1.5 text-[10px] font-semibold bg-black/65 text-white px-1.5 py-0.5 rounded-md shadow">
                {index + 1}
              </span>
              <button
                type="button"
                data-label-interactive="true"
                aria-label={`영역 ${index + 1} 드래그 바 이동`}
                className={`absolute left-1.5 right-1.5 top-1.5 h-6 rounded-md border border-white/50 bg-black/45 text-white shadow-sm flex items-center justify-center transition-opacity ${
                  selectedLabelId === label.id
                    ? "opacity-100 cursor-grab active:cursor-grabbing"
                    : "opacity-0 group-hover/label:opacity-100 cursor-grab active:cursor-grabbing"
                }`}
                onPointerDown={(e) => startMove(e, label)}
                onClick={(e) => e.stopPropagation()}
              >
                <GripHorizontal className="h-3 w-3" />
              </button>
              <button
                type="button"
                data-label-interactive="true"
                aria-label={`영역 ${index + 1} 이동`}
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full border border-white/60 bg-black/50 text-white shadow-sm flex items-center justify-center transition-opacity ${
                  selectedLabelId === label.id
                    ? "opacity-100 cursor-grab active:cursor-grabbing"
                    : "opacity-0 group-hover/label:opacity-100 cursor-grab active:cursor-grabbing"
                }`}
                onPointerDown={(e) => startMove(e, label)}
                onClick={(e) => e.stopPropagation()}
              >
                <Move className="h-2.5 w-2.5" />
              </button>
              {resizeHandleConfigs.map((handle) => (
                <button
                  key={handle.key}
                  type="button"
                  data-label-interactive="true"
                  aria-label={`영역 ${index + 1} 크기 조절 ${handle.key}`}
                  className={`absolute h-4 w-4 rounded-full border border-white/65 bg-black/55 text-white shadow flex items-center justify-center transition-opacity ${
                    selectedLabelId === label.id
                      ? "opacity-100 pointer-events-auto"
                      : "opacity-0 group-hover/label:opacity-100 pointer-events-none group-hover/label:pointer-events-auto"
                  } ${handle.className}`}
                  onPointerDown={(e) => startResize(e, label, handle.key)}
                >
                  <MoveDiagonal2 className={`h-2.5 w-2.5 ${getResizeHandleIconClass(handle.key)}`} />
                </button>
              ))}
            </div>
          ))}

          {/* Drag preview */}
          {dragPreview && (
            <div
              className="absolute rounded-lg border-2 border-dashed border-primary/90 bg-primary/15 shadow-inner"
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
        <div className="rounded-xl border bg-card/95 p-3 shadow-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm">새 영역 답안 입력</Label>
            {selectedLabel ? (
              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                영역 {selectedLabelIndex + 1}
              </span>
            ) : null}
          </div>
          <Input
            ref={quickAnswerInputRef}
            value={selectedLabel?.answer ?? ""}
            onChange={(e) => {
              if (!selectedLabel) return;
              handleLabelUpdate(selectedLabel.id, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Tab" || !selectedLabel) return;
              e.preventDefault();
              const nextIndex = e.shiftKey ? selectedLabelIndex - 1 : selectedLabelIndex + 1;
              if (nextIndex >= 0 && nextIndex < labels.length) {
                const nextLabel = labels[nextIndex];
                pendingFocusLabelIdRef.current = nextLabel.id;
                setSelectedLabelId(nextLabel.id);
                requestAnimationFrame(() => focusAnswerInput(nextLabel.id));
              }
            }}
            placeholder={selectedLabel ? "예: Cerebral cortex" : "영역을 먼저 추가하세요"}
            disabled={!selectedLabel}
          />
          <p className="text-xs text-muted-foreground min-h-[1rem]">
            {inlineNotice || "새 영역을 만들면 입력 포커스가 자동으로 여기로 이동합니다."}
          </p>
        </div>
      </div>

      {/* Label list and editor */}
      <div className="space-y-4">
        <Label>정답 영역 목록 ({labels.length}개)</Label>
        {labels.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg">
            이미지를 드래그하여 정답 영역을 추가하세요
          </div>
        ) : (
          <div ref={labelListRef} className="space-y-3 max-h-[500px] overflow-y-auto">
            {labels.map((label, index) => (
              <div
                key={label.id}
                data-label-card-id={label.id}
                className={`p-4 border rounded-lg space-y-3 cursor-pointer transition-all ${
                  selectedLabelId === label.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => {
                  pendingFocusLabelIdRef.current = label.id;
                  setSelectedLabelId(label.id);
                }}
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
                    <Label className="text-xs">정답 미리보기</Label>
                    <div className="mt-1 min-h-9 rounded-md border bg-muted/40 px-2 py-1.5 text-sm break-words">
                      {label.answer?.trim() || "아직 입력 전"}
                    </div>
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
