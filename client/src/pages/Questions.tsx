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
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, ArrowLeft, ClipboardCheck, Edit, Trash2, Upload, Image as ImageIcon, GripVertical, Copy, MoveRight, Star, ScrollText, Settings, Calendar, BookOpen, Share2, Link2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { buildNextAutoNumberingValue } from "@/lib/autoNumbering";
import { Table2 } from "lucide-react";
import imageCompression from "browser-image-compression";
import { trackQuestionCreate, trackQuestionUpdate, trackQuestionDelete } from "@/lib/ga4Events";
import { CONFIDENCE_THRESHOLDS } from "@shared/examConfidence";

interface QuestionsProps {
  subjectId: number;
  isDemo?: boolean;
  demoWorkspace?: boolean;
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
  readOnly?: boolean;
  hideDragHandle?: boolean;
  hideCopyMove?: boolean;
  disableStarToggle?: boolean;
  onEdit: (question: any) => void;
  onDelete: (id: number) => void;
  onPractice: (id: number) => void;
  onTest: (id: number) => void;
  onCopy: (question: any) => void;
  onMove: (question: any) => void;
  onToggleStar: (id: number) => void;
  onConfidenceClick: (id: number, title: string) => void;
}

function toDateTimeLocalValue(value?: string | Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRemainingToExam(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return "시험 시간이 지났습니다";

  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `D-${days} · ${hours}시간 ${minutes}분 남음`;
  if (hours > 0) return `D-Day · ${hours}시간 ${minutes}분 남음`;
  return `D-Day · ${minutes}분 남음`;
}

const NUMBERING_PREFIX_REGEX = /^\s*\d+\.\s*/;
const NUMBERED_LINE_REGEX = /^\s*(\d+)\.\s*(.*)$/;
const BULLET_LINE_REGEX = /^\s*[-*•]\s+.+$/;
const BLANK_MARKER_REGEX = /^\s*(?:\{\{([\s\S]*?)\}\}|\[\[([\s\S]*?)\]\]|\[([\s\S]*?)\])\s*$/;
const BULK_DELIMITER_REGEX = /(?:^|\n)\s*---+\s*(?:\n|$)/;
const DEMO_PUBLISHING_ENABLED = import.meta.env.VITE_ALLOW_DEMO_PUBLISHING === "true";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildUnlearnedConfidenceFallback(question: any, index: number): ConfidenceData {
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
  const displayOrder = Number(question?.displayOrder ?? index + 1);

  const difficultyBase = difficulty === "easy" ? 50 : difficulty === "hard" ? 24 : 37;
  const lengthPenalty = Math.min(14, Math.round(Math.log1p(Math.max(1, answerLength)) * 2.1));
  const linePenalty = Math.min(8, Math.max(0, lineCount - 1));
  const tablePenalty = hasTable ? 6 : 0;
  const orderOffset = ((displayOrder % 5) - 2) * 1.5;
  const displayScore = clampScore(difficultyBase - lengthPenalty * 0.6 - linePenalty * 0.45 - tablePenalty + orderOffset);
  const state: "green" | "yellow" | "red" =
    displayScore >= CONFIDENCE_THRESHOLDS.green
      ? "green"
      : displayScore >= CONFIDENCE_THRESHOLDS.yellow
        ? "yellow"
        : "red";

  return {
    displayScore,
    state,
    label: "미학습",
    isColdStart: true,
  };
}

type BulkTableDelimiter = "\t" | "|" | ",";

type ParsedBulkQuestion = {
  question: string;
  answer: string;
  autoNumbering: number;
  tableData?: TableData;
};

type BulkParseResult = {
  items: ParsedBulkQuestion[];
  errors: string[];
};

function stripNumberingPrefix(line: string): string {
  return line.replace(NUMBERING_PREFIX_REGEX, "").trim();
}

function normalizeAutoNumberedAnswer(answer: string): string {
  const normalized = answer.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let nextNumber = 1;
  return lines
    .map((line) => {
      if (BULLET_LINE_REGEX.test(line)) {
        return line;
      }

      const numberedMatch = line.match(NUMBERED_LINE_REGEX);
      if (numberedMatch) {
        const content = (numberedMatch[2] ?? "").trim();
        const normalizedLine = content.length > 0 ? `${nextNumber}. ${content}` : `${nextNumber}.`;
        nextNumber += 1;
        return normalizedLine;
      }

      return line;
    })
    .join("\n");
}

function splitBulkBlocks(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*---+\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function hasBulkDelimiter(raw: string): boolean {
  if (!raw) return false;
  return BULK_DELIMITER_REGEX.test(raw.replace(/\r\n/g, "\n"));
}

function splitTableRow(line: string, delimiter: BulkTableDelimiter): string[] {
  if (delimiter === "|") {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((part) => part.trim());
  }
  return line.split(delimiter).map((part) => part.trim());
}

function detectBulkTableDelimiter(lines: string[]): BulkTableDelimiter | null {
  const candidates: BulkTableDelimiter[] = ["\t", "|", ","];
  let best: { delimiter: BulkTableDelimiter; rows: number; cols: number } | null = null;

  for (const delimiter of candidates) {
    let rows = 0;
    let maxCols = 0;
    for (const line of lines) {
      if (!line.includes(delimiter)) continue;
      const cols = splitTableRow(line, delimiter).length;
      if (cols < 2) continue;
      rows += 1;
      maxCols = Math.max(maxCols, cols);
    }
    if (rows < 2 || maxCols < 2) continue;
    if (!best || rows > best.rows || (rows === best.rows && maxCols > best.cols)) {
      best = { delimiter, rows, cols: maxCols };
    }
  }

  return best?.delimiter ?? null;
}

function parseCellWithBlankMarker(value: string): { content: string; explicitBlank: boolean } {
  const match = value.match(BLANK_MARKER_REGEX);
  if (!match) return { content: value.trim(), explicitBlank: false };
  const content = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  return { content, explicitBlank: true };
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function parseBulkTableData(body: string): TableData | null {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isMarkdownTableSeparatorLine(line));

  if (lines.length < 2) return null;
  const delimiter = detectBulkTableDelimiter(lines);
  if (!delimiter) return null;

  const rows = lines.map((line) => splitTableRow(line, delimiter));
  if (rows.length < 2) return null;

  const maxCols = Math.max(...rows.map((row) => row.length));
  if (maxCols < 2) return null;

  const normalizedRows = rows.map((row) => {
    if (row.length === maxCols) return row;
    return [...row, ...Array.from({ length: maxCols - row.length }, () => "")];
  });

  let hasExplicitBlank = false;
  const cells = normalizedRows.map((row) =>
    row.map((rawCell) => {
      const parsed = parseCellWithBlankMarker(rawCell);
      if (parsed.explicitBlank) hasExplicitBlank = true;
      return {
        content: parsed.content,
        isBlank: parsed.explicitBlank,
        rowSpan: 1,
        colSpan: 1,
        isMerged: false,
      };
    })
  );

  if (!hasExplicitBlank) {
    for (let rowIndex = 1; rowIndex < cells.length; rowIndex++) {
      for (let colIndex = 0; colIndex < cells[rowIndex].length; colIndex++) {
        if (cells[rowIndex][colIndex].content.trim().length > 0) {
          cells[rowIndex][colIndex].isBlank = true;
        }
      }
    }
  }

  return {
    rows: cells.length,
    cols: maxCols,
    cells,
    headerRow: true,
    headerCol: false,
  };
}

function parseBulkImportInput(
  raw: string,
  options?: { autoNumberingEnabled?: boolean }
): BulkParseResult {
  const autoNumberingEnabled = options?.autoNumberingEnabled !== false;
  const blocks = splitBulkBlocks(raw);
  const items: ParsedBulkQuestion[] = [];
  const errors: string[] = [];

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const lines = block.split("\n");
    const firstLineIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstLineIndex < 0) continue;

    const question = lines[firstLineIndex].trim();
    const answerBody = lines.slice(firstLineIndex + 1).join("\n").trim();
    const blockOrder = index + 1;

    if (!question) {
      errors.push(`${blockOrder}번 블록: 첫 줄 문제 제목이 비어 있습니다.`);
      continue;
    }
    if (!answerBody) {
      errors.push(`${blockOrder}번 블록 (${question}): 답안/표 내용이 없습니다.`);
      continue;
    }

    const parsedTable = parseBulkTableData(answerBody);
    if (parsedTable) {
      const blankCount = parsedTable.cells.flat().filter((cell) => cell.isBlank && !cell.isMerged).length;
      if (blankCount === 0) {
        errors.push(`${blockOrder}번 블록 (${question}): 표 빈칸이 0개라 생성할 수 없습니다.`);
        continue;
      }
      items.push({
        question,
        answer: "",
        autoNumbering: 0,
        tableData: parsedTable,
      });
      continue;
    }

    items.push({
      question,
      answer: autoNumberingEnabled ? normalizeAutoNumberedAnswer(answerBody) : answerBody,
      autoNumbering: autoNumberingEnabled ? 1 : 0,
    });
  }

  return { items, errors };
}

function buildBulkRawFromForm(question: string, answer: string): string {
  const normalizedQuestion = question.replace(/\r\n/g, "\n").trim();
  const normalizedAnswer = answer.replace(/\r\n/g, "\n").trim();
  if (!normalizedQuestion && !normalizedAnswer) return "";
  if (!normalizedQuestion) return normalizedAnswer;
  if (!normalizedAnswer) return normalizedQuestion;
  return `${normalizedQuestion}\n${normalizedAnswer}`;
}

function SortableQuestionCard({
  question,
  confidence,
  readOnly = false,
  hideDragHandle = false,
  hideCopyMove = false,
  disableStarToggle = false,
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
  } = useSortable({ id: question.id, disabled: readOnly });

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
        {!readOnly && !hideDragHandle && (
          <div
            {...attributes}
            {...listeners}
            className="flex items-center px-1.5 cursor-grab active:cursor-grabbing touch-none border-r bg-muted/30 hover:bg-muted/60"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

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

          {/* 문제 정보 - 클릭 시 연습모드 진입 */}
        <div
          className="flex-1 px-3 py-2 min-w-0 cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => onPractice(question.id)}
          title="클릭하여 연습 시작"
        >
          <div className="flex items-start gap-1.5">
            {hasImage && (
              <ImageIcon className="h-3 w-3 text-blue-500 flex-shrink-0" />
            )}
            {hasTable && (
              <Table2 className="h-3 w-3 text-purple-500 flex-shrink-0" />
            )}
            {question.isDemo === 1 && (
              <span className="text-xs text-amber-600 font-medium flex-shrink-0">데모</span>
            )}
            <p
              className="text-base font-medium leading-tight flex-1 whitespace-pre-line break-words [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
              title={question.question}
            >
              {question.question}
            </p>
            {!readOnly && !disableStarToggle && (
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
            )}
          </div>
          {!hasImage && !hasTable && question.answer && (
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {question.answer.replace(/\n/g, ' / ')}
            </p>
          )}
          {/* 학습 계획 추천 배지 */}
          {confidence?.badges && (confidence.badges.lastTestWrong || confidence.badges.frequentlyWrong || confidence.badges.hasWarnZone) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {confidence.badges.lastTestWrong && (
                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 leading-none">
                  이번 시험 오답
                </span>
              )}
              {confidence.badges.frequentlyWrong && (
                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 leading-none">
                  자주 틀림
                </span>
              )}
              {confidence.badges.hasWarnZone && (
                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 leading-none">
                  주의 구간 있음
                </span>
              )}
            </div>
          )}
          {hasTable && (
            <div className="text-xs text-muted-foreground mt-0.5 space-y-0">
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
            <p className="text-xs text-muted-foreground mt-0.5">
              라벨 {JSON.parse(question.imageLabels).length}개
            </p>
          )}
        </div>

        {/* 시험 안정도 (클릭 시 그래프 모달) */}
        {confidence && (
          <button
            className="flex items-center px-2.5 border-l hover:bg-muted/50 transition-colors cursor-pointer"
            title="클릭하여 변화 그래프 보기"
            onClick={(e) => { e.stopPropagation(); onConfidenceClick(question.id, question.question); }}
          >
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-[18px] h-[18px] rounded-full ${
                  confidence.state === 'green' ? 'bg-emerald-500' :
                  confidence.state === 'yellow' ? 'bg-amber-400' :
                  'bg-red-400'
                } ${confidence.isColdStart ? 'opacity-40' : ''}`}
              />
              <span className={`inline-block w-12 text-center text-sm font-semibold font-mono tabular-nums leading-none ${
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
            onClick={(e) => { e.stopPropagation(); onTest(question.id); }}
            title="시험 모드"
          >
            <ClipboardCheck className="h-3.5 w-3.5 text-green-600" />
          </Button>
          {!readOnly && (
            <>
              <div className="w-px h-4 bg-border mx-0.5" />
              {!hideCopyMove && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-80 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onCopy(question); }}
                    title="복사"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-80 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onMove(question); }}
                    title="이동"
                  >
                    <MoveRight className="h-3 w-3" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-80 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onEdit(question); }}
                title="수정"
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-80 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onDelete(question.id); }}
                title="삭제"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Questions({ subjectId, isDemo = false, demoWorkspace = false }: QuestionsProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [confidenceHistoryId, setConfidenceHistoryId] = useState<number | null>(null);
  const [confidenceHistoryTitle, setConfidenceHistoryTitle] = useState("");
  const [subjectConfidenceOpen, setSubjectConfidenceOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubjectSettingOpen, setIsSubjectSettingOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [examDateInput, setExamDateInput] = useState("");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCopyMoveOpen, setIsCopyMoveOpen] = useState(false);
  const [copyMoveMode, setCopyMoveMode] = useState<"copy" | "move">("copy");
  const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "image" | "table" | "ocr">("text");
  const [isBulkCreating, setIsBulkCreating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const questionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAnswerCursorRef = useRef<number | null>(null);
  
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

  const { data: subject } = trpc.subjects.getById.useQuery(
    { id: subjectId },
    { enabled: Number.isFinite(subjectId) }
  );
  const isAdmin = user?.role === "admin";
  const subjectIsDemo = subject?.isDemo === 1;
  const isDemoWorkspace = isAdmin && (demoWorkspace || subjectIsDemo);
  const isReadOnlyDemo = (isDemo || subjectIsDemo) && !isDemoWorkspace;
  const { data: shareInfo } = trpc.share.getMineBySubject.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) && !isReadOnlyDemo && !isDemoWorkspace }
  );
  const demoReadOnlyQuestionsQuery = trpc.demo.questions.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) && isReadOnlyDemo }
  );
  const userQuestionsQuery = trpc.questions.listBySubject.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) && !isDemoWorkspace && !isReadOnlyDemo }
  );
  const demoWorkspaceQuestionsQuery = trpc.admin.demo.questions.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) && isDemoWorkspace }
  );
  const rawQuestions = (
    isDemoWorkspace
      ? demoWorkspaceQuestionsQuery.data
      : isReadOnlyDemo
        ? demoReadOnlyQuestionsQuery.data
        : userQuestionsQuery.data
  ) ?? [];
  const questions = useMemo(() => {
    const sorted = [...rawQuestions].sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    // 화면에서는 항상 1..N 순번으로 보여 숫자 누락/중복을 방지한다.
    return sorted.map((question, index) => ({
      ...question,
      displayOrder: index + 1,
    }));
  }, [rawQuestions]);
  const isLoading = isDemoWorkspace
    ? demoWorkspaceQuestionsQuery.isLoading
    : isReadOnlyDemo
      ? demoReadOnlyQuestionsQuery.isLoading
      : userQuestionsQuery.isLoading;
  const updateSubjectMutation = trpc.subjects.update.useMutation({
    onSuccess: () => {
      utils.subjects.getById.invalidate({ id: subjectId });
      utils.subjects.list.invalidate();
      setIsSubjectSettingOpen(false);
      toast.success("시험일이 저장되었습니다");
    },
    onError: (error) => {
      toast.error("저장 실패: " + error.message);
    },
  });
  const { data: userConfidenceData } = trpc.confidence.getBySubject.useQuery(
    { subjectId },
    { enabled: !!user && !isReadOnlyDemo && !isDemoWorkspace }
  );
  const { data: demoConfidenceData } = trpc.demo.confidenceBySubject.useQuery(
    { subjectId },
    { enabled: Number.isFinite(subjectId) && (isReadOnlyDemo || isDemoWorkspace) }
  );
  const confidenceData = (isReadOnlyDemo || isDemoWorkspace) ? demoConfidenceData : userConfidenceData;
  const utils = trpc.useUtils();
  const shareUpsertMutation = trpc.share.upsertBySubject.useMutation({
    onSuccess: () => {
      void utils.share.getMineBySubject.invalidate({ subjectId });
      setSharePassword("");
      toast.success("공유 링크가 생성되었습니다.");
    },
    onError: (error) => toast.error(error.message || "공유 링크 생성 실패"),
  });
  const shareDisableMutation = trpc.share.disableBySubject.useMutation({
    onSuccess: () => {
      void utils.share.getMineBySubject.invalidate({ subjectId });
      toast.success("공유 링크가 비활성화되었습니다.");
    },
    onError: (error) => toast.error(error.message || "공유 링크 비활성화 실패"),
  });
  const invalidateDemoQuestionCaches = () => {
    utils.admin.demo.questions.invalidate({ subjectId });
    utils.admin.demo.allQuestions.invalidate();
    utils.demo.questions.invalidate({ subjectId });
  };
  const invalidateUserQuestionAndConfidenceCaches = (targetSubjectId: number) => {
    utils.questions.listBySubject.invalidate({ subjectId: targetSubjectId });
    utils.confidence.getBySubject.invalidate({ subjectId: targetSubjectId });
    utils.confidence.getHistoryBySubject.invalidate({ subjectId: targetSubjectId });
  };

  // Build confidence lookup map
  const confidenceMap = useMemo(() => {
    if (!confidenceData?.questions) return new Map<number, ConfidenceData>();
    const map = new Map<number, ConfidenceData>();
    for (const q of confidenceData.questions) {
      map.set(q.questionId, q);
    }
    return map;
  }, [confidenceData]);

  // 데모 예시 데이터가 비어도 신호등/점수 칸이 사라지지 않도록 폴백
  const displayConfidenceMap = useMemo(() => {
    if (!isReadOnlyDemo) {
      if (confidenceMap.size === 0 && (!questions || questions.length === 0)) return confidenceMap;
      const merged = new Map<number, ConfidenceData>(confidenceMap);
      const sorted = [...(questions ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      sorted.forEach((q, index) => {
        if (merged.has(q.id)) return;
        merged.set(q.id, buildUnlearnedConfidenceFallback(q, index));
      });
      return merged;
    }
    if (confidenceMap.size > 0) return confidenceMap;
    if (!questions || questions.length === 0) return confidenceMap;

    const fallbackStates: Array<"green" | "yellow" | "red"> = ["green", "yellow", "red"];
    const fallbackScores = [86, 56, 34];
    const fallback = new Map<number, ConfidenceData>();
    const sorted = [...questions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    sorted.forEach((q, index) => {
      const state = fallbackStates[index % fallbackStates.length];
      const displayScore = fallbackScores[index % fallbackScores.length];
      fallback.set(q.id, {
        displayScore,
        state,
        label: state === "green" ? "안정" : state === "yellow" ? "학습중" : "취약",
        isColdStart: false,
      });
    });
    return fallback;
  }, [confidenceMap, isReadOnlyDemo, questions]);

  const displayAggregate = useMemo(() => {
    if (!isReadOnlyDemo && confidenceData?.aggregate && confidenceData.aggregate.totalQuestions === displayConfidenceMap.size) {
      return confidenceData.aggregate;
    }
    if (isReadOnlyDemo && confidenceData?.aggregate && confidenceData.aggregate.totalQuestions > 0) {
      return confidenceData.aggregate;
    }
    if (displayConfidenceMap.size === 0) return confidenceData?.aggregate ?? null;

    const rows = Array.from(displayConfidenceMap.values());
    const totalQuestions = rows.length;
    const averageScore = Math.round(
      rows.reduce((sum, row) => sum + Math.round(row.displayScore), 0) / Math.max(1, totalQuestions)
    );
    const greenCount = rows.filter((row) => row.state === "green").length;
    const yellowCount = rows.filter((row) => row.state === "yellow").length;
    const redCount = rows.filter((row) => row.state === "red").length;
    const state =
      averageScore >= CONFIDENCE_THRESHOLDS.green
        ? "green"
        : averageScore >= CONFIDENCE_THRESHOLDS.yellow
          ? "yellow"
          : "red";

    return {
      totalQuestions,
      averageScore,
      greenCount,
      yellowCount,
      redCount,
      state,
      label: state === "green" ? "안정" : state === "yellow" ? "학습중" : "취약",
    };
  }, [confidenceData?.aggregate, displayConfidenceMap, isReadOnlyDemo]);

  const createMutation = trpc.questions.create.useMutation({
    onSuccess: (data: any) => {
      const questionType = data.imageUrl && data.imageLabels ? 'image' : (data.tableData ? 'table' : 'text');
      trackQuestionCreate(data.id, subjectId, questionType as 'text' | 'image' | 'table');
      invalidateUserQuestionAndConfidenceCaches(subjectId);
      setIsCreateOpen(false);
      resetForm();
      toast.success("문제가 생성되었습니다");
    },
    onError: (error) => {
      toast.error("문제 생성 실패: " + error.message);
    },
  });
  const bulkCreateMutation = trpc.questions.create.useMutation();
  const createDemoMutation = trpc.admin.demo.createQuestion.useMutation({
    onSuccess: (data: any) => {
      const questionType = data?.data?.imageUrl && data?.data?.imageLabels ? 'image' : (data?.data?.tableData ? 'table' : 'text');
      trackQuestionCreate(data?.data?.id ?? 0, subjectId, questionType as 'text' | 'image' | 'table');
      invalidateDemoQuestionCaches();
      setIsCreateOpen(false);
      resetForm();
      toast.success("데모 문제가 생성되었습니다");
    },
    onError: (error) => {
      toast.error("데모 문제 생성 실패: " + error.message);
    },
  });
  const bulkCreateDemoMutation = trpc.admin.demo.createQuestion.useMutation();

  const updateMutation = trpc.questions.update.useMutation({
    onSuccess: (data: any) => {
      const questionType = data.imageUrl && data.imageLabels ? 'image' : (data.tableData ? 'table' : 'text');
      trackQuestionUpdate(data.id, subjectId, questionType as 'text' | 'image' | 'table');
      invalidateUserQuestionAndConfidenceCaches(subjectId);
      setIsEditOpen(false);
      setEditingQuestion(null);
      resetForm();
      toast.success("문제가 수정되었습니다");
    },
    onError: (error) => {
      toast.error("문제 수정 실패: " + error.message);
    },
  });
  const updateDemoMutation = trpc.admin.demo.updateQuestion.useMutation({
    onSuccess: (data: any) => {
      const updated = data?.data;
      const questionType = updated?.imageUrl && updated?.imageLabels ? 'image' : (updated?.tableData ? 'table' : 'text');
      trackQuestionUpdate(updated?.id ?? 0, subjectId, questionType as 'text' | 'image' | 'table');
      invalidateDemoQuestionCaches();
      setIsEditOpen(false);
      setEditingQuestion(null);
      resetForm();
      toast.success("데모 문제가 수정되었습니다");
    },
    onError: (error) => {
      toast.error("데모 문제 수정 실패: " + error.message);
    },
  });

  const deleteMutation = trpc.questions.delete.useMutation({
    onSuccess: () => {
      if (editingQuestion) {
        trackQuestionDelete(editingQuestion.id, subjectId);
      }
      invalidateUserQuestionAndConfidenceCaches(subjectId);
      toast.success("문제가 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("문제 삭제 실패: " + error.message);
    },
  });
  const deleteDemoMutation = trpc.admin.demo.deleteQuestion.useMutation({
    onSuccess: () => {
      if (editingQuestion) {
        trackQuestionDelete(editingQuestion.id, subjectId);
      }
      invalidateDemoQuestionCaches();
      toast.success("데모 문제가 삭제되었습니다");
    },
    onError: (error) => {
      toast.error("데모 문제 삭제 실패: " + error.message);
    },
  });

  const updateOrderMutation = trpc.questions.updateOrder.useMutation({
    onError: (error) => {
      toast.error("순서 변경 실패: " + error.message);
      invalidateUserQuestionAndConfidenceCaches(subjectId);
    },
  });

  const copyMutation = trpc.questions.copy.useMutation({
    onSuccess: (_, variables) => {
      invalidateUserQuestionAndConfidenceCaches(subjectId);
      invalidateUserQuestionAndConfidenceCaches(variables.targetSubjectId);
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
      invalidateUserQuestionAndConfidenceCaches(subjectId);
      invalidateUserQuestionAndConfidenceCaches(variables.targetSubjectId);
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
      invalidateUserQuestionAndConfidenceCaches(subjectId);
    },
    onError: (error) => {
      toast.error("별표 업데이트 실패: " + error.message);
    },
  });
  const toggleDemoStarMutation = trpc.admin.demo.toggleQuestionStar.useMutation({
    onSuccess: () => {
      invalidateDemoQuestionCaches();
    },
    onError: (error) => {
      toast.error("별표 업데이트 실패: " + error.message);
    },
  });

  const { data: allSubjects } = trpc.subjects.list.useQuery(undefined, {
    enabled: !isReadOnlyDemo && !isDemoWorkspace && isCopyMoveOpen,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReadOnlyDemo || isDemoWorkspace) return;
    const { active, over } = event;

    if (!over || active.id === over.id || !questions) {
      return;
    }

    const oldIndex = questions.findIndex((q) => q.id === active.id);
    const newIndex = questions.findIndex((q) => q.id === over.id);

    const reorderedQuestions = arrayMove(questions, oldIndex, newIndex);
    const questionOrders = reorderedQuestions.map((question, index) => ({
      id: question.id,
      displayOrder: index + 1,
    }));

    // Optimistic update
    utils.questions.listBySubject.setData({ subjectId }, reorderedQuestions.map((q, idx) => ({
      ...q,
      displayOrder: idx + 1,
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

  const bulkInputValue = useMemo(() => {
    if (hasBulkDelimiter(formData.question)) return formData.question;
    if (hasBulkDelimiter(formData.answer)) return formData.answer;
    return "";
  }, [formData.answer, formData.question]);
  const hasInlineBulkDelimiter = bulkInputValue.trim().length > 0;
  const inlineBulkRaw = useMemo(
    () => (hasInlineBulkDelimiter ? bulkInputValue : buildBulkRawFromForm(formData.question, formData.answer)),
    [bulkInputValue, formData.answer, formData.question, hasInlineBulkDelimiter]
  );
  const inlineBulkParseResult = useMemo(
    () =>
      hasInlineBulkDelimiter
        ? parseBulkImportInput(inlineBulkRaw, { autoNumberingEnabled: formData.autoNumbering })
        : { items: [], errors: [] },
    [formData.autoNumbering, hasInlineBulkDelimiter, inlineBulkRaw]
  );
  const inlineBulkSummary = useMemo(() => {
    const tableCount = inlineBulkParseResult.items.filter((item) => item.tableData).length;
    const textCount = inlineBulkParseResult.items.length - tableCount;
    return {
      total: inlineBulkParseResult.items.length,
      text: textCount,
      table: tableCount,
    };
  }, [inlineBulkParseResult.items]);

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

  const handleBulkInputChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, question: value, answer: "" }));
  }, []);

  useEffect(() => {
    const nextCursor = pendingAnswerCursorRef.current;
    if (nextCursor === null) return;
    pendingAnswerCursorRef.current = null;
    const textarea = answerTextareaRef.current;
    if (!textarea) return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [formData.answer]);

  const handleAnswerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!formData.autoNumbering) return;
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.shiftKey) return;

    e.preventDefault();
    const textarea = e.currentTarget;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const rawValue = textarea.value;
    const { nextValue, nextCursor } = buildNextAutoNumberingValue(
      rawValue,
      selectionStart,
      selectionEnd
    );

    pendingAnswerCursorRef.current = nextCursor;
    handleAnswerChange(nextValue);
  }, [formData.autoNumbering, handleAnswerChange]);

  const handleAutoNumberingToggle = useCallback((checked: boolean) => {
    setFormData((prev) => {
      if (!checked) return { ...prev, autoNumbering: false };
      if (activeTab !== "text") return { ...prev, autoNumbering: true };
      const nextAnswer = prev.answer.trim().length > 0
        ? normalizeAutoNumberedAnswer(prev.answer)
        : "1. ";
      return { ...prev, autoNumbering: true, answer: nextAnswer };
    });
  }, [activeTab]);

  async function runBulkCreateFromBlocks(items: ParsedBulkQuestion[]) {
    if (isBulkCreating) return;
    if (items.length === 0) {
      toast.error("생성 가능한 문제가 없습니다");
      return;
    }

    setIsBulkCreating(true);
    let successCount = 0;
    let failedCount = 0;
    const requestedDemoValue =
      isAdmin && DEMO_PUBLISHING_ENABLED ? (formData.isDemo ? 1 : 0) : undefined;
    try {
      for (const item of items) {
        try {
          if (isDemoWorkspace) {
            await bulkCreateDemoMutation.mutateAsync({
              subjectId,
              question: item.question,
              answer: item.answer,
              autoNumbering: item.autoNumbering,
              tableData: item.tableData ? JSON.stringify(item.tableData) : undefined,
              isStarred: formData.isStarred ? 1 : 0,
            } as any);
          } else {
            await bulkCreateMutation.mutateAsync({
              subjectId,
              question: item.question,
              answer: item.answer,
              autoNumbering: item.autoNumbering,
              tableData: item.tableData ? JSON.stringify(item.tableData) : undefined,
              isDemo: requestedDemoValue,
              isStarred: formData.isStarred ? 1 : 0,
            } as any);
          }
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (isDemoWorkspace) {
        await utils.admin.demo.questions.invalidate({ subjectId });
        await utils.admin.demo.allQuestions.invalidate();
        await utils.demo.questions.invalidate({ subjectId });
      } else {
        await Promise.all([
          utils.questions.listBySubject.invalidate({ subjectId }),
          utils.confidence.getBySubject.invalidate({ subjectId }),
          utils.confidence.getHistoryBySubject.invalidate({ subjectId }),
        ]);
      }
    } finally {
      setIsBulkCreating(false);
    }

    if (failedCount === 0) {
      toast.success(`${successCount}개 문제를 빠르게 생성했습니다`);
      setIsCreateOpen(false);
      resetForm();
      return;
    }

    toast.warning(`${successCount}개 생성, ${failedCount}개 실패`);
  }


  const handleCreate = useCallback(async () => {
    const question = formData.question;
    const answer = formData.autoNumbering
      ? normalizeAutoNumberedAnswer(formData.answer)
      : formData.answer.trim();
    const requestedDemoValue =
      isAdmin && DEMO_PUBLISHING_ENABLED ? (formData.isDemo ? 1 : 0) : undefined;

    if (activeTab === "text" && hasInlineBulkDelimiter) {
      if (inlineBulkParseResult.errors.length > 0) {
        toast.error(inlineBulkParseResult.errors[0]);
        return;
      }
      if (inlineBulkParseResult.items.length === 0) {
        toast.error("생성 가능한 문제가 없습니다");
        return;
      }
      await runBulkCreateFromBlocks(inlineBulkParseResult.items);
      return;
    }

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
      if (isDemoWorkspace) {
        createDemoMutation.mutate({
          subjectId,
          question,
          answer: "",
          tableData: JSON.stringify(formData.tableData),
          autoNumbering: 0,
          isStarred: formData.isStarred ? 1 : 0,
        } as any);
        return;
      }
      createMutation.mutate({
        subjectId,
        question,
        answer: "",
          tableData: JSON.stringify(formData.tableData),
        autoNumbering: 0,
        isDemo: requestedDemoValue,
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

    if (isDemoWorkspace) {
      createDemoMutation.mutate({
        subjectId,
        question,
        answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : answer,
        imageUrl: formData.imageUrl || undefined,
        imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
        autoNumbering: formData.autoNumbering ? 1 : 0,
        isStarred: formData.isStarred ? 1 : 0,
      } as any);
      return;
    }

    createMutation.mutate({
      subjectId,
      question,
      answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : answer,
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
      autoNumbering: formData.autoNumbering ? 1 : 0,
      isDemo: requestedDemoValue,
      isStarred: formData.isStarred ? 1 : 0,
    } as any);
  }, [
    activeTab,
    createDemoMutation,
    createMutation,
    formData,
    hasInlineBulkDelimiter,
    inlineBulkParseResult.errors,
    inlineBulkParseResult.items,
    isAdmin,
    isDemoWorkspace,
    runBulkCreateFromBlocks,
    subjectId,
  ]);

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
    const requestedDemoValue =
      isAdmin && DEMO_PUBLISHING_ENABLED ? (formData.isDemo ? 1 : 0) : undefined;

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
      if (isDemoWorkspace) {
        updateDemoMutation.mutate({
          questionId: editingQuestion.id,
          question: formData.question,
          answer: "",
          tableData: JSON.stringify(formData.tableData),
          imageUrl: undefined,
          imageLabels: undefined,
          autoNumbering: 0,
          isStarred: formData.isStarred ? 1 : 0,
        } as any);
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
        isDemo: requestedDemoValue,
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

    const updatedAnswer = formData.autoNumbering
      ? normalizeAutoNumberedAnswer(formData.answer)
      : formData.answer.trim();

    if (isDemoWorkspace) {
      updateDemoMutation.mutate({
        questionId: editingQuestion.id,
        question: formData.question,
        answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : updatedAnswer,
        imageUrl: formData.imageUrl || undefined,
        imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
        tableData: undefined,
        autoNumbering: formData.autoNumbering ? 1 : 0,
        isStarred: formData.isStarred ? 1 : 0,
      } as any);
      return;
    }

    updateMutation.mutate({
      id: editingQuestion.id,
      question: formData.question,
      answer: formData.imageUrl && formData.imageLabels.length > 0 ? undefined : updatedAnswer,
      imageUrl: formData.imageUrl || undefined,
      imageLabels: formData.imageLabels.length > 0 ? JSON.stringify(formData.imageLabels) : undefined,
      tableData: undefined,
      autoNumbering: formData.autoNumbering ? 1 : 0,
      isDemo: requestedDemoValue,
      isStarred: formData.isStarred ? 1 : 0,
    } as any);
  };

  const handleDelete = (id: number) => {
    if (confirm("이 문제를 삭제하시겠습니까?")) {
      if (isDemoWorkspace) {
        deleteDemoMutation.mutate({ questionId: id });
        return;
      }
      deleteMutation.mutate({ id });
    }
  };

  const handleCopy = (question: any) => {
    if (isDemoWorkspace) return;
    setSelectedQuestion(question);
    setCopyMoveMode("copy");
    setIsCopyMoveOpen(true);
  };

  const handleMove = (question: any) => {
    if (isDemoWorkspace) return;
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
        <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            블록 일괄 입력: 입력칸 1개로 처리하며 `---` 로 블록만 구분합니다.
          </p>
          {hasInlineBulkDelimiter ? (
            <p className="text-xs text-muted-foreground">
              감지 결과: 총 {inlineBulkSummary.total}개 (텍스트 {inlineBulkSummary.text} / 표 {inlineBulkSummary.table})
              {" "}· 생성 버튼을 누르면 일괄 생성됩니다.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              단일 문제는 기존처럼 질문/답안을 입력하고 생성하면 됩니다.
            </p>
          )}
          {hasInlineBulkDelimiter && inlineBulkParseResult.errors.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {inlineBulkParseResult.errors[0]}
            </p>
          )}
        </div>

        {hasInlineBulkDelimiter ? (
          <div className="space-y-2">
            <Label htmlFor="bulk-input">블록 일괄 입력 *</Label>
            <Textarea
              id="bulk-input"
              value={bulkInputValue}
              onChange={(e) => handleBulkInputChange(e.target.value)}
              placeholder={"문제제목\n답안/본문\n---\n다음문제제목\n답안/본문"}
              rows={12}
            />
          </div>
        ) : (
          <>
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
                ref={answerTextareaRef}
                value={formData.answer}
                onChange={(e) => handleAnswerChange(e.target.value)}
                onKeyDown={handleAnswerKeyDown}
                placeholder="모범 답안을 입력하세요"
                rows={6}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoNumbering"
                checked={formData.autoNumbering}
                onChange={(e) => handleAutoNumberingToggle(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 cursor-pointer"
              />
              <Label htmlFor="autoNumbering" className="cursor-pointer text-sm font-normal">
                엔터 기준으로 답안 번호 자동 생성
              </Label>
            </div>
          </>
        )}
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
            onChange={(e) => handleAutoNumberingToggle(e.target.checked)}
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
          onExtractedText={({ blockText, fullText }) => {
            const bulkRaw = blockText.trim() || fullText.trim();
            setFormData((prev) => ({
              ...prev,
              question: bulkRaw,
              answer: "",
            }));
            setActiveTab("text");
            toast.success("OCR 결과를 일괄입력으로 반영했습니다.");
          }}
        />
      </TabsContent>
    </Tabs>
  );

  const activeShareLink = useMemo(() => {
    if (!shareInfo?.token) return "";
    if (typeof window === "undefined") return `/shared/${shareInfo.token}`;
    return `${window.location.origin}/shared/${shareInfo.token}`;
  }, [shareInfo?.token]);

  const handleCreateShare = () => {
    if (!sharePassword.trim() || sharePassword.trim().length < 4) {
      toast.error("공유 비밀번호를 4자 이상 입력하세요.");
      return;
    }
    shareUpsertMutation.mutate({
      subjectId,
      password: sharePassword.trim(),
    });
  };

  const handleCopyShareLink = async () => {
    if (!activeShareLink) return;
    try {
      await navigator.clipboard.writeText(activeShareLink);
      toast.success("공유 링크를 복사했습니다.");
    } catch {
      toast.error("링크 복사에 실패했습니다.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setLocation(isReadOnlyDemo || isDemoWorkspace ? "/demo" : "/")}
        >
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
            <h1 className="text-2xl font-semibold tracking-tight truncate">{subject?.name || "문제 관리"}</h1>
            <span className="text-base text-muted-foreground flex-shrink-0">
              {questions?.length || 0}문제
            </span>
            {displayAggregate && displayAggregate.totalQuestions > 0 && (
              <button
                onClick={() => setSubjectConfidenceOpen(true)}
                className={`text-sm font-medium px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                  displayAggregate.state === 'green' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  displayAggregate.state === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}
                title="클릭하여 과목 안정도 추이 보기"
              >
                과목 안정도 {displayAggregate.averageScore}점
              </button>
            )}
            {isReadOnlyDemo && (confidenceData as any)?.isExample && (
              <span className="text-xs text-amber-600 dark:text-amber-400">예시 화면</span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 items-center">
          {/* 과목 설정 버튼 (시험일 설정) */}
          {!isReadOnlyDemo && !isDemoWorkspace && (
            <Popover open={isSubjectSettingOpen} onOpenChange={(open) => {
              setIsSubjectSettingOpen(open);
              if (open) {
                setExamDateInput(toDateTimeLocalValue(subject?.examEndDate));
              }
            }}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="과목 설정">
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-medium text-sm">시험일 설정</h4>
                  </div>
                  {subject?.examEndDate && (
                    <p className="text-xs text-muted-foreground">
                      현재: {new Date(subject.examEndDate).toLocaleString('ko-KR')}
                      {' '}({formatRemainingToExam(new Date(subject.examEndDate))})
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      type="datetime-local"
                      step={600}
                      value={examDateInput}
                      onChange={(e) => setExamDateInput(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-8 px-3"
                      disabled={updateSubjectMutation.isPending}
                      onClick={() => {
                        updateSubjectMutation.mutate({
                          id: subjectId,
                          examEndDate: examDateInput || null,
                        });
                      }}
                    >
                      저장
                    </Button>
                  </div>
                  {examDateInput && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground w-full"
                      onClick={() => {
                        setExamDateInput("");
                        updateSubjectMutation.mutate({ id: subjectId, examEndDate: null });
                      }}
                    >
                      시험일 삭제
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {!isReadOnlyDemo && !isDemoWorkspace && (
            <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8">
                  <Share2 className="h-3.5 w-3.5" />
                  공유
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>과목 공유</DialogTitle>
                  <DialogDescription>
                    비밀번호로 보호된 공유 링크를 만들 수 있습니다.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    저작권이 있는 자료의 유출에는 본인 책임입니다.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="share-password">공유 비밀번호 (4자 이상)</Label>
                    <Input
                      id="share-password"
                      type="password"
                      value={sharePassword}
                      onChange={(e) => setSharePassword(e.target.value)}
                      placeholder="비밀번호 입력"
                    />
                  </div>
                  <Button
                    className="w-full"
                    disabled={shareUpsertMutation.isPending}
                    onClick={handleCreateShare}
                  >
                    {shareUpsertMutation.isPending ? "생성 중..." : "공유 링크 생성/갱신"}
                  </Button>
                  {shareInfo?.token && shareInfo.isActive && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        현재 링크 · 조회 {shareInfo.viewCount}회
                      </p>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={activeShareLink} className="h-8 text-xs" />
                        <Button variant="outline" size="sm" className="h-8" onClick={handleCopyShareLink}>
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={shareDisableMutation.isPending}
                        onClick={() => shareDisableMutation.mutate({ subjectId })}
                      >
                        공유 비활성화
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
          {questions && questions.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => {
                  if (isReadOnlyDemo || isDemoWorkspace) {
                    if (!questions || questions.length === 0) return;
                    const sorted = [...questions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
                    const target = sorted[Math.floor(Math.random() * sorted.length)];
                    if (target?.id) setLocation(`/demo/practice/${target.id}`);
                    return;
                  }
                  setLocation(`/subject-practice/${subjectId}?scrollNav=1&random=1`);
                }}
              >
                <ScrollText className="h-3.5 w-3.5" />
                랜덤 연습
              </Button>
              {!isReadOnlyDemo && !isDemoWorkspace && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setLocation(`/subject-exam/${subjectId}`)}
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                모의고사
              </Button>
              )}
            </>
          )}
          {!isReadOnlyDemo && (
            <Button size="sm" className="gap-1.5 h-8" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              추가
            </Button>
          )}
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
          onSelectQuestion={(id) => setLocation(isReadOnlyDemo || isDemoWorkspace ? `/demo/practice/${id}` : `/practice/${id}?scrollNav=1`)}
          confidenceData={Object.fromEntries(
            Array.from(displayConfidenceMap.entries()).map(([qId, conf]) => [
              qId,
              { state: conf.state, displayScore: conf.displayScore, label: conf.label, isColdStart: conf.isColdStart }
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
            <CardDescription>
              {isReadOnlyDemo
                ? "데모 문제가 아직 설정되지 않았습니다"
                : isDemoWorkspace
                  ? "데모 문제를 추가해 게스트 화면에 반영하세요"
                  : "첫 문제를 추가하여 학습을 시작하세요"}
            </CardDescription>
          </CardHeader>
          {!isReadOnlyDemo && (
            <CardContent>
              <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                첫 문제 만들기
              </Button>
            </CardContent>
          )}
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
                      readOnly={isReadOnlyDemo}
                      hideDragHandle={isDemoWorkspace}
                      hideCopyMove={isDemoWorkspace}
                      confidence={displayConfidenceMap.get(question.id)}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onPractice={(id) => setLocation(isReadOnlyDemo || isDemoWorkspace ? `/demo/practice/${id}` : `/practice/${id}?scrollNav=1`)}
                      onTest={(id) => setLocation(isReadOnlyDemo || isDemoWorkspace ? `/demo/test/${id}` : `/test/${id}`)}
                      onCopy={handleCopy}
                      onMove={handleMove}
                      onToggleStar={(id) => {
                        if (isDemoWorkspace) {
                          toggleDemoStarMutation.mutate({ questionId: id });
                          return;
                        }
                        toggleStarMutation.mutate({ id });
                      }}
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
                <Button
                  onClick={handleCreate}
                  disabled={isBulkCreating || (isDemoWorkspace ? createDemoMutation.isPending : createMutation.isPending)}
                >
                  {isDemoWorkspace
                    ? (createDemoMutation.isPending ? "생성 중..." : isBulkCreating ? "일괄 생성 중..." : "생성")
                    : (createMutation.isPending ? "생성 중..." : isBulkCreating ? "일괄 생성 중..." : "생성")}
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
                {!isDemoWorkspace && isAdmin && DEMO_PUBLISHING_ENABLED && (
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
                <Button onClick={handleUpdate} disabled={isDemoWorkspace ? updateDemoMutation.isPending : updateMutation.isPending}>
                  {isDemoWorkspace
                    ? (updateDemoMutation.isPending ? "수정 중..." : "저장")
                    : (updateMutation.isPending ? "수정 중..." : "저장")}
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
                {!isDemoWorkspace && isAdmin && DEMO_PUBLISHING_ENABLED && (
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
      {!isReadOnlyDemo && !isDemoWorkspace && (
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
      )}

      {/* 안정도 변화 그래프 모달 */}
      <ConfidenceHistoryModal
        questionId={confidenceHistoryId}
        questionTitle={confidenceHistoryTitle}
        open={confidenceHistoryId !== null}
        onClose={() => setConfidenceHistoryId(null)}
        isDemo={isReadOnlyDemo || isDemoWorkspace}
        previewLabel={(confidenceData as any)?.previewLabel}
      />

      {/* 과목 안정도 추이 그래프 모달 */}
      <SubjectConfidenceHistoryModal
        subjectId={subjectId}
        subjectName={subject?.name}
        open={subjectConfidenceOpen}
        onClose={() => setSubjectConfidenceOpen(false)}
        isDemo={isReadOnlyDemo || isDemoWorkspace}
        previewLabel={(confidenceData as any)?.previewLabel}
      />
    </div>
  );
}
