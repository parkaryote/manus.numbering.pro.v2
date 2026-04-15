import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, RotateCcw, Merge, Split } from "lucide-react";
import { toast } from "sonner";
import { isPartialMatch, splitGraphemes, isHangul, isJamo, decomposeHangul } from "@/lib/hangul";

// 표 데이터 타입 정의
export interface TableCell {
  content: string;
  isBlank: boolean; // 연습 셀로 지정할지 여부 (연습 모드에서 타이핑 대상)
  rowSpan?: number;
  colSpan?: number;
  isMerged?: boolean; // 병합된 셀에 의해 가려진 셀
  mergeParent?: { row: number; col: number }; // 병합 부모 셀 위치
}

export interface TableData {
  rows: number;
  cols: number;
  cells: TableCell[][];
  headerRow: boolean; // 첫 번째 행을 헤더로 사용
  headerCol: boolean; // 첫 번째 열을 헤더로 사용
}

interface TableEditorProps {
  initialData?: TableData;
  onChange: (data: TableData) => void;
}

const createEmptyCell = (): TableCell => ({
  content: "",
  isBlank: false,
  rowSpan: 1,
  colSpan: 1,
  isMerged: false,
});

const createDefaultTable = (): TableData => ({
  rows: 3,
  cols: 3,
  cells: Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => createEmptyCell())
  ),
  headerRow: true,
  headerCol: false,
});

const JAMO_TO_KEYSTROKE: Record<string, string> = {
  "ㄱ": "r",
  "ㄲ": "r",
  "ㄴ": "s",
  "ㄷ": "e",
  "ㄸ": "e",
  "ㄹ": "f",
  "ㅁ": "a",
  "ㅂ": "q",
  "ㅃ": "q",
  "ㅅ": "t",
  "ㅆ": "t",
  "ㅇ": "d",
  "ㅈ": "w",
  "ㅉ": "w",
  "ㅊ": "c",
  "ㅋ": "z",
  "ㅌ": "x",
  "ㅍ": "v",
  "ㅎ": "g",
  "ㅏ": "k",
  "ㅐ": "o",
  "ㅑ": "i",
  "ㅒ": "o",
  "ㅓ": "j",
  "ㅔ": "p",
  "ㅕ": "u",
  "ㅖ": "p",
  "ㅗ": "h",
  "ㅘ": "hk",
  "ㅙ": "ho",
  "ㅚ": "hl",
  "ㅛ": "y",
  "ㅜ": "n",
  "ㅝ": "nj",
  "ㅞ": "np",
  "ㅟ": "nl",
  "ㅠ": "b",
  "ㅡ": "m",
  "ㅢ": "ml",
  "ㅣ": "l",
  "ㄳ": "rt",
  "ㄵ": "sw",
  "ㄶ": "sg",
  "ㄺ": "fr",
  "ㄻ": "fa",
  "ㄼ": "fq",
  "ㄽ": "ft",
  "ㄾ": "fx",
  "ㄿ": "fv",
  "ㅀ": "fg",
  "ㅄ": "qt",
};

const ALNUM_REGEX = /^[a-z0-9]$/i;

function normalizeTableCellText(text: string): string {
  return text.trim().replace(/\s+/g, "");
}

function toTypingKeyUnit(char: string): string {
  if (!char) return "";
  if (ALNUM_REGEX.test(char)) return char.toLowerCase();

  if (isHangul(char)) {
    const d = decomposeHangul(char);
    if (!d) return char.toLowerCase();
    return `${JAMO_TO_KEYSTROKE[d.cho] ?? d.cho}${JAMO_TO_KEYSTROKE[d.jung] ?? d.jung}${
      d.jong ? JAMO_TO_KEYSTROKE[d.jong] ?? d.jong : ""
    }`.toLowerCase();
  }

  if (isJamo(char)) {
    return (JAMO_TO_KEYSTROKE[char] ?? char).toLowerCase();
  }

  return char.toLowerCase();
}

function toTypingKeySequence(text: string): string {
  return splitGraphemes(text)
    .map((char) => toTypingKeyUnit(char))
    .join("");
}

function isEquivalentTableCellAnswer(input: string, target: string): boolean {
  const normalizedInput = normalizeTableCellText(input);
  const normalizedTarget = normalizeTableCellText(target);
  if (!normalizedInput || !normalizedTarget) return false;
  if (normalizedInput.toLowerCase() === normalizedTarget.toLowerCase()) return true;
  return toTypingKeySequence(normalizedInput) === toTypingKeySequence(normalizedTarget);
}

interface ContextMenu {
  x: number;
  y: number;
  row: number;
  col: number;
}

export function TableEditor({ initialData, onChange }: TableEditorProps) {
  const [tableData, setTableData] = useState<TableData>(
    initialData || createDefaultTable()
  );
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ row: number; col: number } | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const composingCellKeyRef = useRef<string | null>(null);
  const lastCompositionEndAtRef = useRef(0);
  const lastCellMoveAtRef = useRef(0);

  const updateTable = useCallback(
    (newData: TableData) => {
      setTableData(newData);
      onChange(newData);
    },
    [onChange]
  );

  // 활성 셀 포커스
  useEffect(() => {
    if (activeCell) {
      const key = `${activeCell.row}-${activeCell.col}`;
      const ta = textareaRefs.current[key];
      if (ta) {
        ta.focus();
      }
    }
  }, [activeCell]);

  // 컨텍스트 메뉴 외부 클릭 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  // 행 추가 (특정 위치)
  const addRow = useCallback(
    (afterIndex: number) => {
      const newCells = [...tableData.cells];
      const newRow = Array.from({ length: tableData.cols }, () => createEmptyCell());
      newCells.splice(afterIndex + 1, 0, newRow);
      updateTable({ ...tableData, rows: tableData.rows + 1, cells: newCells });
    },
    [tableData, updateTable]
  );

  const addRowBefore = useCallback(
    (beforeIndex: number) => {
      const newCells = [...tableData.cells];
      const newRow = Array.from({ length: tableData.cols }, () => createEmptyCell());
      newCells.splice(beforeIndex, 0, newRow);
      updateTable({ ...tableData, rows: tableData.rows + 1, cells: newCells });
    },
    [tableData, updateTable]
  );

  // 열 추가 (특정 위치)
  const addCol = useCallback(
    (afterIndex: number) => {
      const newCells = tableData.cells.map((row) => {
        const newRow = [...row];
        newRow.splice(afterIndex + 1, 0, createEmptyCell());
        return newRow;
      });
      updateTable({ ...tableData, cols: tableData.cols + 1, cells: newCells });
    },
    [tableData, updateTable]
  );

  const addColBefore = useCallback(
    (beforeIndex: number) => {
      const newCells = tableData.cells.map((row) => {
        const newRow = [...row];
        newRow.splice(beforeIndex, 0, createEmptyCell());
        return newRow;
      });
      updateTable({ ...tableData, cols: tableData.cols + 1, cells: newCells });
    },
    [tableData, updateTable]
  );

  // 행 삭제
  const removeRow = useCallback(
    (index: number) => {
      if (tableData.rows <= 1) { toast.error("최소 1행이 필요합니다"); return; }
      const newCells = tableData.cells.filter((_, i) => i !== index);
      updateTable({ ...tableData, rows: tableData.rows - 1, cells: newCells });
      setSelectedCells(new Set());
    },
    [tableData, updateTable]
  );

  // 열 삭제
  const removeCol = useCallback(
    (index: number) => {
      if (tableData.cols <= 1) { toast.error("최소 1열이 필요합니다"); return; }
      const newCells = tableData.cells.map((row) => row.filter((_, i) => i !== index));
      updateTable({ ...tableData, cols: tableData.cols - 1, cells: newCells });
      setSelectedCells(new Set());
    },
    [tableData, updateTable]
  );

  // 셀 내용 수정
  const updateCellContent = useCallback(
    (row: number, col: number, content: string) => {
      const newCells = tableData.cells.map((r, ri) =>
        r.map((c, ci) => (ri === row && ci === col ? { ...c, content } : c))
      );
      updateTable({ ...tableData, cells: newCells });
    },
    [tableData, updateTable]
  );

  // 선택된 셀 연습 셀 토글
  const toggleSelectedBlanks = useCallback(() => {
    if (selectedCells.size === 0) return;
    const firstKey = Array.from(selectedCells)[0];
    const [fr, fc] = firstKey.split("-").map(Number);
    const firstIsBlank = tableData.cells[fr]?.[fc]?.isBlank;
    const newBlankState = !firstIsBlank;
    const newCells = tableData.cells.map((r, ri) =>
      r.map((c, ci) =>
        selectedCells.has(`${ri}-${ci}`) ? { ...c, isBlank: newBlankState } : c
      )
    );
    updateTable({ ...tableData, cells: newCells });
    setSelectedCells(new Set());
  }, [selectedCells, tableData, updateTable]);

  // 셀 병합
  const mergeCells = useCallback(() => {
    if (selectedCells.size < 2) { toast.error("2개 이상의 셀을 선택하세요"); return; }
    const positions = Array.from(selectedCells).map((key) => {
      const [r, c] = key.split("-").map(Number);
      return { row: r, col: c };
    });
    const minRow = Math.min(...positions.map((p) => p.row));
    const maxRow = Math.max(...positions.map((p) => p.row));
    const minCol = Math.min(...positions.map((p) => p.col));
    const maxCol = Math.max(...positions.map((p) => p.col));
    const expectedCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    if (selectedCells.size !== expectedCount) { toast.error("직사각형 영역만 병합할 수 있습니다"); return; }
    for (const pos of positions) {
      const cell = tableData.cells[pos.row][pos.col];
      if (cell.isMerged || (cell.rowSpan && cell.rowSpan > 1) || (cell.colSpan && cell.colSpan > 1)) {
        toast.error("이미 병합된 셀은 다시 병합할 수 없습니다"); return;
      }
    }
    const newCells = tableData.cells.map((r, ri) =>
      r.map((c, ci) => {
        if (ri === minRow && ci === minCol) {
          const mergedContent = positions.map((p) => tableData.cells[p.row][p.col].content).filter(Boolean).join(" ");
          return { ...c, content: mergedContent || c.content, rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1 };
        }
        if (ri >= minRow && ri <= maxRow && ci >= minCol && ci <= maxCol) {
          return { ...c, isMerged: true, mergeParent: { row: minRow, col: minCol }, content: "" };
        }
        return c;
      })
    );
    updateTable({ ...tableData, cells: newCells });
    setSelectedCells(new Set());
    toast.success("셀이 병합되었습니다");
  }, [selectedCells, tableData, updateTable]);

  // 셀 병합 해제 (버그 수정: isMerged 셀을 createEmptyCell로 복원)
  const splitCells = useCallback(() => {
    if (selectedCells.size !== 1) { toast.error("병합 해제할 셀 1개를 선택하세요"); return; }
    const [key] = Array.from(selectedCells);
    const [row, col] = key.split("-").map(Number);
    const cell = tableData.cells[row][col];
    const isParent = (cell.rowSpan && cell.rowSpan > 1) || (cell.colSpan && cell.colSpan > 1);
    if (!isParent) { toast.error("병합된 셀이 아닙니다"); return; }

    const newCells = tableData.cells.map((r, ri) =>
      r.map((c, ci) => {
        if (ri === row && ci === col) {
          return { ...c, rowSpan: 1, colSpan: 1 };
        }
        if (c.isMerged && c.mergeParent?.row === row && c.mergeParent?.col === col) {
          // 병합 해제 시 빈 셀로 복원 (날아가는 버그 수정)
          return createEmptyCell();
        }
        return c;
      })
    );
    updateTable({ ...tableData, cells: newCells });
    setSelectedCells(new Set());
    toast.success("병합이 해제되었습니다");
  }, [selectedCells, tableData, updateTable]);

  // 셀 클릭 → 즉시 활성화 + 선택
  const handleCellClick = (row: number, col: number, e: React.MouseEvent) => {
    if (previewMode) return;
    setContextMenu(null);

    if (e.shiftKey && selectedCells.size > 0) {
      const existing = Array.from(selectedCells).map((k) => {
        const [r, c] = k.split("-").map(Number);
        return { row: r, col: c };
      });
      const allPositions = [...existing, { row, col }];
      const minR = Math.min(...allPositions.map((p) => p.row));
      const maxR = Math.max(...allPositions.map((p) => p.row));
      const minC = Math.min(...allPositions.map((p) => p.col));
      const maxC = Math.max(...allPositions.map((p) => p.col));
      const newSelection = new Set<string>();
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (!tableData.cells[r]?.[c]?.isMerged) newSelection.add(`${r}-${c}`);
        }
      }
      setSelectedCells(newSelection);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const k = `${row}-${col}`;
      const newSel = new Set(selectedCells);
      if (newSel.has(k)) newSel.delete(k); else newSel.add(k);
      setSelectedCells(newSel);
      return;
    }

    setSelectedCells(new Set([`${row}-${col}`]));
    setActiveCell({ row, col });
  };

  // 드래그 선택
  const handleCellMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (previewMode) return;
    setIsSelecting(true);
    setSelectionStart({ row, col });
  };

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!isSelecting || !selectionStart) return;
    const minR = Math.min(selectionStart.row, row);
    const maxR = Math.max(selectionStart.row, row);
    const minC = Math.min(selectionStart.col, col);
    const maxC = Math.max(selectionStart.col, col);
    const newSelection = new Set<string>();
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!tableData.cells[r]?.[c]?.isMerged) newSelection.add(`${r}-${c}`);
      }
    }
    setSelectedCells(newSelection);
  };

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // 우클릭 컨텍스트 메뉴
  const handleContextMenu = (row: number, col: number, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, row, col });
    if (!selectedCells.has(`${row}-${col}`)) {
      setSelectedCells(new Set([`${row}-${col}`]));
    }
  };

  // 키보드 네비게이션
  const handleKeyDown = (row: number, col: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const cell = tableData.cells[row][col];
    const colSpan = cell.colSpan || 1;
    const rowSpan = cell.rowSpan || 1;
    const cellKey = `${row}-${col}`;
    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    const isNavigationKey =
      e.key === "Tab" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      (e.key === "Enter" && (e.ctrlKey || e.metaKey));
    const isComposing =
      Boolean(nativeEvent.isComposing) ||
      nativeEvent.keyCode === 229 ||
      composingCellKeyRef.current === cellKey;
    const compositionJustEnded = Date.now() - lastCompositionEndAtRef.current < 120;

    if (isNavigationKey && (isComposing || compositionJustEnded)) {
      // IME 조합 중/직후에는 셀 이동을 막아 마지막 글자 유실·이동 셀 오입력을 방지
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (isNavigationKey) {
      const now = Date.now();
      if (e.repeat || now - lastCellMoveAtRef.current < 45) {
        // 키 반복/중복 이벤트로 한 번에 두 칸 이동하는 현상 방지
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastCellMoveAtRef.current = now;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        // 이전 셀
        if (col > 0) setActiveCell({ row, col: col - 1 });
        else if (row > 0) setActiveCell({ row: row - 1, col: tableData.cols - 1 });
      } else {
        // 다음 셀
        const nextCol = col + colSpan;
        if (nextCol < tableData.cols) setActiveCell({ row, col: nextCol });
        else if (row + rowSpan < tableData.rows) setActiveCell({ row: row + rowSpan, col: 0 });
      }
      return;
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Enter: 아래 셀로 이동
      e.preventDefault();
      e.stopPropagation();
      const nextRow = row + rowSpan;
      if (nextRow < tableData.rows) setActiveCell({ row: nextRow, col });
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setActiveCell(null);
      const ta = textareaRefs.current[`${row}-${col}`];
      ta?.blur();
      return;
    }

    // 화살표 키: 텍스트 커서가 끝/시작에 있을 때만 셀 이동
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      const ta = textareaRefs.current[`${row}-${col}`];
      if (!ta) return;
      const { selectionStart: ss, selectionEnd: se, value } = ta;
      const atEnd = ss === value.length && se === value.length;
      const atStart = ss === 0 && se === 0;

      if (e.key === "ArrowRight" && atEnd) {
        e.preventDefault();
        e.stopPropagation();
        const nextCol = col + colSpan;
        if (nextCol < tableData.cols) setActiveCell({ row, col: nextCol });
      } else if (e.key === "ArrowLeft" && atStart) {
        e.preventDefault();
        e.stopPropagation();
        if (col > 0) setActiveCell({ row, col: col - 1 });
      } else if (e.key === "ArrowDown") {
        // 마지막 줄에 있을 때만 아래 셀로
        const lines = value.split("\n");
        const lineIdx = value.substring(0, ss ?? 0).split("\n").length - 1;
        if (lineIdx === lines.length - 1) {
          e.preventDefault();
          e.stopPropagation();
          const nextRow = row + rowSpan;
          if (nextRow < tableData.rows) setActiveCell({ row: nextRow, col });
        }
      } else if (e.key === "ArrowUp") {
        // 첫 줄에 있을 때만 위 셀로
        const lineIdx = value.substring(0, ss ?? 0).split("\n").length - 1;
        if (lineIdx === 0) {
          e.preventDefault();
          e.stopPropagation();
          if (row > 0) setActiveCell({ row: row - 1, col });
        }
      }
    }
  };

  const toggleHeaderRow = () => updateTable({ ...tableData, headerRow: !tableData.headerRow });
  const toggleHeaderCol = () => updateTable({ ...tableData, headerCol: !tableData.headerCol });
  const resetTable = () => {
    const t = createDefaultTable();
    setTableData(t);
    onChange(t);
    setSelectedCells(new Set());
    setActiveCell(null);
  };

  const blankCount = tableData.cells.flat().filter((c) => c.isBlank && !c.isMerged).length;

  return (
    <div className="space-y-3" onClick={() => setContextMenu(null)}>
      {/* 도구 모음 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button type="button" variant="ghost" size="sm" onClick={toggleSelectedBlanks} disabled={selectedCells.size === 0} title="선택 셀 연습 셀 토글">
            <EyeOff className="h-3 w-3 mr-1" />연습
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={mergeCells} disabled={selectedCells.size < 2} title="셀 병합">
            <Merge className="h-3 w-3 mr-1" />병합
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={splitCells} disabled={selectedCells.size !== 1} title="병합 해제">
            <Split className="h-3 w-3 mr-1" />해제
          </Button>
        </div>

        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button type="button" variant={tableData.headerRow ? "secondary" : "ghost"} size="sm" onClick={toggleHeaderRow}>헤더행</Button>
          <Button type="button" variant={tableData.headerCol ? "secondary" : "ghost"} size="sm" onClick={toggleHeaderCol}>헤더열</Button>
        </div>

        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button type="button" variant={previewMode ? "secondary" : "ghost"} size="sm" onClick={() => setPreviewMode(!previewMode)}>
            <Eye className="h-3 w-3 mr-1" />미리보기
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={resetTable} className="text-red-500 hover:text-red-700">
            <RotateCcw className="h-3 w-3 mr-1" />초기화
          </Button>
        </div>
      </div>

      {/* 안내 텍스트 */}
      <div className="text-xs text-muted-foreground">
        클릭: 셀 편집 | Tab: 다음 셀 | Ctrl+Enter: 아래 셀 | 우클릭: 행/열 추가·삭제 | Shift+클릭/드래그: 범위 선택
        {blankCount > 0 && <span className="ml-2 text-amber-600 font-medium">연습 셀: {blankCount}개</span>}
      </div>

      {/* 표 편집 영역 */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full border-collapse">
          <tbody>
            {tableData.cells.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  if (cell.isMerged) return null;

                  const isHeader = (tableData.headerRow && ri === 0) || (tableData.headerCol && ci === 0);
                  const CellTag = isHeader ? "th" : "td";
                  const cellKey = `${ri}-${ci}`;
                  const isSelected = selectedCells.has(cellKey);
                  const isActive = activeCell?.row === ri && activeCell?.col === ci;

                  let bg = "bg-white";
                  if (isHeader) bg = "bg-slate-100";
                  if (cell.isBlank) bg = "bg-amber-50";
                  if (isSelected) bg = "bg-blue-100";
                  if (previewMode && cell.isBlank) bg = "bg-yellow-100";

                  const borderCls = isActive
                    ? "border-2 border-blue-500"
                    : isSelected
                    ? "border-2 border-blue-400"
                    : "border border-slate-300";

                  return (
                    <CellTag
                      key={ci}
                      rowSpan={cell.rowSpan || 1}
                      colSpan={cell.colSpan || 1}
                      className={`${bg} ${borderCls} px-0 py-0 text-sm relative min-w-[60px] min-h-[36px] align-top`}
                      onMouseDown={(e) => handleCellMouseDown(ri, ci, e)}
                      onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                      onClick={(e) => handleCellClick(ri, ci, e)}
                      onContextMenu={(e) => handleContextMenu(ri, ci, e)}
                    >
                      {previewMode ? (
                        <div className={`px-2 py-1.5 min-h-[36px] ${isHeader ? "font-semibold text-slate-700" : "text-slate-600"} ${cell.isBlank ? "text-yellow-600 italic text-xs" : ""}`}>
                          {cell.isBlank ? "연습" : (cell.content || <span className="text-slate-300 italic text-xs">{isHeader ? "헤더" : "내용"}</span>)}
                        </div>
                      ) : (
                        <div className="relative">
                          <textarea
                            ref={(el) => { textareaRefs.current[cellKey] = el; }}
                            value={cell.content}
                            onChange={(e) => updateCellContent(ri, ci, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(ri, ci, e)}
                            onCompositionStart={() => {
                              composingCellKeyRef.current = cellKey;
                            }}
                            onCompositionEnd={() => {
                              if (composingCellKeyRef.current === cellKey) {
                                composingCellKeyRef.current = null;
                              }
                              lastCompositionEndAtRef.current = Date.now();
                            }}
                            onBlur={() => {
                              if (composingCellKeyRef.current === cellKey) {
                                composingCellKeyRef.current = null;
                              }
                            }}
                            onFocus={() => {
                              setActiveCell({ row: ri, col: ci });
                              setSelectedCells(new Set([cellKey]));
                            }}
                            rows={Math.max(1, cell.content.split("\n").length)}
                            className={`w-full resize-none bg-transparent outline-none text-sm px-2 py-1.5 min-h-[36px] ${isHeader ? "font-semibold text-slate-700" : "text-slate-700"} ${cell.isBlank ? "underline decoration-amber-400 decoration-2" : ""}`}
                            placeholder={isHeader ? "헤더" : "내용"}
                            style={{ height: "auto", overflow: "hidden" }}
                            onInput={(e) => {
                              const ta = e.currentTarget;
                              ta.style.height = "auto";
                              ta.style.height = ta.scrollHeight + "px";
                            }}
                          />
                          {cell.isBlank && (
                            <div className="absolute top-0 right-0 w-2 h-2 bg-amber-400 rounded-bl" title="연습 셀" />
                          )}
                        </div>
                      )}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 표 크기 정보 */}
      <div className="text-xs text-muted-foreground text-right">{tableData.rows}행 × {tableData.cols}열</div>

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-xs text-muted-foreground font-medium border-b mb-1">
            행 {contextMenu.row + 1}, 열 {contextMenu.col + 1}
          </div>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => { addRowBefore(contextMenu.row); setContextMenu(null); }}>
            ↑ 위에 행 추가
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => { addRow(contextMenu.row); setContextMenu(null); }}>
            ↓ 아래에 행 추가
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => { addColBefore(contextMenu.col); setContextMenu(null); }}>
            ← 왼쪽에 열 추가
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => { addCol(contextMenu.col); setContextMenu(null); }}>
            → 오른쪽에 열 추가
          </button>
          <div className="border-t my-1" />
          <button className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" onClick={() => { removeRow(contextMenu.row); setContextMenu(null); }}>
            행 삭제
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" onClick={() => { removeCol(contextMenu.col); setContextMenu(null); }}>
            열 삭제
          </button>
          {selectedCells.size > 0 && (
            <>
              <div className="border-t my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => { toggleSelectedBlanks(); setContextMenu(null); }}>
                연습 셀 토글
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 표 렌더링 컴포넌트 (연습/시험 모드용)
interface TableViewProps {
  tableData: TableData;
  answers?: Record<string, string>; // "row-col" -> 사용자 입력
  onAnswerChange?: (key: string, value: string) => void;
  showAnswers?: boolean; // 정답 표시 여부 (시험 모드에서 오답 시 정답 표시)
  hideAnswer?: boolean; // 연습 모드 답 가리기
  results?: Record<string, boolean>; // "row-col" -> 정답 여부
  readOnly?: boolean;
  practiceMode?: boolean; // 연습 모드 (정답 표시 + 실시간 타이핑 피드백)
  onCellFocus?: (key: string) => void;
  onCorrectAnswer?: (key: string) => void; // 정답 완성 시 콜백
  // 하단 입력창 연습 모드 전용
  activeCellKey?: string | null; // 현재 입력 중인 셀 키
  completedCells?: Set<string>; // 완성된 셀 키 목록
  checkedCells?: Set<string>; // 체크박스 선택된 셀 키 목록
  onCellActivate?: (key: string) => void; // 셀 클릭 시 활성화
  onCellCheck?: (key: string) => void; // 셀 체크박스 토글
  partialInput?: string; // 현재 입력 중인 텍스트 (채점 시각화용)
  cellSubmittedResult?: 'correct' | 'wrong' | 'typing' | null; // 실시간 채점 결과 (null: 미입력, typing: 입력중, correct: 정답, wrong: 오답)
  wrongCells?: Set<string>; // 오답 제출 이력이 있는 셀
}

export function TableView({
  tableData,
  answers = {},
  onAnswerChange,
  showAnswers = false,
  hideAnswer = false,
  results,
  readOnly = false,
  practiceMode = false,
  onCellFocus,
  onCorrectAnswer,
  activeCellKey = null,
  completedCells = new Set(),
  checkedCells = new Set(),
  onCellCheck,
  onCellActivate,
  partialInput = '',
  cellSubmittedResult = null,
  wrongCells = new Set(),
}: TableViewProps) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const composingCellsRef = useRef<Set<string>>(new Set());
  const lastCompositionEndAtRef = useRef(0);
  const lastNavigationRef = useRef<{ signature: string; at: number } | null>(null);
  const blankCells = getBlankCells(tableData);
  const parseCellKey = (cellKey: string) => {
    const [rowRaw, colRaw] = cellKey.split("-");
    return { row: Number(rowRaw), col: Number(colRaw) };
  };

  const findVerticalNeighborKey = (fromKey: string, direction: "up" | "down"): string | null => {
    const from = parseCellKey(fromKey);
    const candidates = blankCells
      .map((k) => ({ key: k, ...parseCellKey(k) }))
      .filter((pos) => (direction === "up" ? pos.row < from.row : pos.row > from.row))
      .sort((a, b) => {
        const da = Math.abs(a.row - from.row);
        const db = Math.abs(b.row - from.row);
        if (da !== db) return da - db;
        return Math.abs(a.col - from.col) - Math.abs(b.col - from.col);
      });
    return candidates.length > 0 ? candidates[0].key : null;
  };

  const renderMaskedCellContent = (content: string) => (
    <span className="relative block whitespace-pre-wrap" style={{ wordBreak: "keep-all", overflowWrap: "break-word" }}>
      <span className="invisible select-none">{content || " "}</span>
      <span className="absolute inset-0 text-slate-300 select-none pointer-events-none">•••</span>
    </span>
  );

  // Tab/Enter/Arrow 키로 셀 이동
  const handleKeyDown = (key: string, e: React.KeyboardEvent) => {
    if (e.key !== "Tab" && e.key !== "Enter" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (blankCells.length === 0) return;

    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    const isComposing = composingCellsRef.current.has(key) || !!nativeEvent.isComposing;
    if (isComposing) return;

    // 한글 조합 확정 직후 Enter/Tab이 즉시 이동으로 이어지며 마지막 글자가 다음 셀에 새는 현상 방지
    if (Date.now() - lastCompositionEndAtRef.current < 45) return;

    e.preventDefault();
    e.stopPropagation();

    const signature = `${key}:${e.key}:${e.shiftKey ? "1" : "0"}`;
    const now = Date.now();
    if (lastNavigationRef.current && lastNavigationRef.current.signature === signature) {
      if (now - lastNavigationRef.current.at < 80) return;
    }
    lastNavigationRef.current = { signature, at: now };

    const currentIdx = blankCells.findIndex((k) => k === key);
    if (currentIdx < 0) return;

    let nextKey: string | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      nextKey = findVerticalNeighborKey(key, e.key === "ArrowUp" ? "up" : "down");
    } else {
      const step = e.key === "Tab" ? (e.shiftKey ? -1 : 1) : 1;
      const nextIdx = (currentIdx + step + blankCells.length) % blankCells.length;
      nextKey = blankCells[nextIdx];
    }
    if (!nextKey || nextKey === key) return;

    // 현재 키 이벤트가 완전히 끝난 뒤 이동해 입력 꼬임 방지
    setTimeout(() => {
      const nextInput = inputRefs.current[nextKey];
      if (!nextInput) return;
      nextInput.focus();
      const cursor = nextInput.value.length;
      nextInput.setSelectionRange(cursor, cursor);
    }, 0);
  };

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full border-collapse">
        <tbody>
          {tableData.cells.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                if (cell.isMerged) return null;

                const isHeader =
                  (tableData.headerRow && ri === 0) ||
                  (tableData.headerCol && ci === 0);
                const CellTag = isHeader ? "th" : "td";
                const cellKey = `${ri}-${ci}`;
                const isBlank = cell.isBlank;
                const userAnswer = answers[cellKey] || "";
                const isCorrect = results?.[cellKey];
                const shouldMaskBlank =
                  hideAnswer && isBlank && !showAnswers;

                const isTypingCorrect = practiceMode && isBlank
                  ? normalizeTableCellText(userAnswer).toLowerCase() ===
                    normalizeTableCellText(cell.content.slice(0, userAnswer.length)).toLowerCase()
                  : undefined;

                // 하단 입력창 연습 모드 셀 상태
                const isActiveCell = activeCellKey === cellKey;
                const isCompleted = completedCells.has(cellKey);
                const isCellChecked = checkedCells.has(cellKey);
                const isWrongCell = wrongCells.has(cellKey);

                let bgColor = "bg-white";
                if (isHeader) bgColor = "bg-slate-100";
                if (practiceMode && isBlank) bgColor = "bg-slate-50";
                if (!practiceMode && isBlank && !showAnswers) bgColor = "bg-yellow-50";
                if (isCorrect === true) bgColor = "bg-green-50";
                if (isCorrect === false) bgColor = "bg-red-50";
                // 하단 입력창 모드: 집중 연습 선택된 셀은 연한 보라 배경 tint (인라인 스타일로 적용)
                const isFocusCell = activeCellKey !== null && isBlank && isCellChecked && !isActiveCell;

                // 하단 입력창 모드에서 활성 셀 테두리 강조 (active: 두꺼운 보라 + glow)
                const cellBorderClass = isActiveCell
                  ? 'border-2 border-purple-500 shadow-[0_0_0_2px_oklch(0.55_0.2_290_/_0.2)]'
                  : 'border border-slate-300';

                return (
                  <CellTag
                    key={ci}
                    rowSpan={cell.rowSpan || 1}
                    colSpan={cell.colSpan || 1}
                    className={`${bgColor} ${cellBorderClass} px-2 py-1.5 text-sm min-w-[60px] align-top relative`}
                    style={{
                      wordBreak: 'keep-all',
                      overflowWrap: 'break-word',
                      whiteSpace: 'pre-wrap',
                      verticalAlign: 'top',
                    }}
                  >
                    {/* 하단 입력창 모드: 빈칸 셀에 코너 플래그 + 채점 시각화 */}
                    {activeCellKey !== null && isBlank && (
                      <>
                        {/* 코너 플래그: 셀 클릭으로 집중 연습 선택/해제 */}
                        {onCellCheck && isCellChecked && (
                          <div
                            className="absolute top-0 right-0 w-0 h-0 z-10 pointer-events-none"
                            style={{
                              borderStyle: 'solid',
                              borderWidth: '0 10px 10px 0',
                              borderColor: 'transparent oklch(0.55 0.2 290) transparent transparent',
                            }}
                            title="집중 연습 선택됨"
                          />
                        )}
                        {/* 채점 시각화: 활성 셀 - 실시간 글자별 색상 표시 (isPartialMatch 기반) */}
                        {isActiveCell && !isCompleted && (
                          <div className="text-sm font-semibold cursor-text">
                            {shouldMaskBlank ? (
                              renderMaskedCellContent(cell.content)
                            ) : cellSubmittedResult === 'correct' ? (
                              // 정답: 전체 검정 (텍스트 모드와 동일)
                              <span className="text-foreground">{cell.content}</span>
                            ) : partialInput.length > 0 ? (
                              // 입력 중: isPartialMatch 기반 글자별 실시간 색상 (텍스트 모드와 동일 로직)
                              (() => {
                                const targetChars = splitGraphemes(cell.content.replace(/\s+/g, ''));
                                const userChars = splitGraphemes(partialInput.replace(/\s+/g, ''));
                                let charIdx = 0; // 띄어쓰기 제외 인덱스
                                return cell.content.split('').map((ch, i) => {
                                  if (ch === ' ' || ch === '\n') {
                                    return <span key={i}>{ch}</span>;
                                  }
                                  const currentCharIdx = charIdx;
                                  charIdx++;
                                  // 아직 입력하지 않은 글자
                                  if (currentCharIdx >= userChars.length) {
                                    return <span key={i} className="text-slate-300">{ch}</span>;
                                  }
                                  // 입력한 글자 채점 (isPartialMatch 사용)
                                  const userChar = userChars[currentCharIdx];
                                  const targetChar = targetChars[currentCharIdx];
                                  const nextTargetChar = targetChars[currentCharIdx + 1];
                                  const matchResult = isPartialMatch(userChar, targetChar, nextTargetChar);
                                  if (matchResult === 'complete' || matchResult === 'partial_complete') {
                                    return <span key={i} className="text-foreground">{ch}</span>;
                                  } else if (matchResult === 'partial') {
                                    // 조합 중 (초성/중성만 입력) - 회색 유지
                                    return <span key={i} className="text-slate-400">{ch}</span>;
                                  } else {
                                    // 오답 - 빨간색
                                    return <span key={i} className="text-red-500">{ch}</span>;
                                  }
                                });
                              })()
                            ) : (
                              // 미입력: 회색
                              <span className="text-slate-300">{cell.content}</span>
                            )}
                          </div>
                        )}
                        {/* 완성 셀 - 텍스트 문제처럼 검정색 */}
                        {isCompleted && (
                          <div className="text-sm font-semibold text-foreground">{cell.content}</div>
                        )}
                        {/* 미입력 셀 - 단일 클릭으로 셀 이동, 더블 클릭으로 집중 연습 토글 */}
                        {!isActiveCell && !isCompleted && (
                          <div
                            className={`text-sm cursor-pointer transition-colors ${
                              isWrongCell
                                ? 'text-red-500 hover:text-red-600'
                                : 'text-slate-300 hover:text-slate-400'
                            }`}
                            onClick={(e) => {
                              if (e.detail === 2) {
                                // 더블 클릭: 집중 연습 토글
                                onCellCheck?.(cellKey);
                              } else {
                                // 단일 클릭: 해당 셀로 이동
                                onCellActivate?.(cellKey);
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              onCellCheck?.(cellKey);
                            }}
                            title="클릭: 이 셀 연습 / 더블클릭: 집중 연습 토글"
                          >
                            {shouldMaskBlank ? renderMaskedCellContent(cell.content) : cell.content}
                          </div>
                        )}
                      </>
                    )}
                    {activeCellKey !== null && isBlank ? null : practiceMode && isBlank ? (
                      <div className="relative min-h-[28px]">
                        {!userAnswer && (
                          <div className="absolute inset-0 text-slate-400 text-sm whitespace-pre-wrap px-2 py-1.5 pointer-events-none">
                            {cell.content}
                          </div>
                        )}
                        <input
                          ref={(el) => { inputRefs.current[cellKey] = el; }}
                          type="text"
                          value={userAnswer}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            onAnswerChange?.(cellKey, newValue);
                            if (isEquivalentTableCellAnswer(newValue, cell.content)) {
                              onCorrectAnswer?.(cellKey);
                              const currentIdx = blankCells.findIndex((k) => k === cellKey);
                              if (currentIdx < blankCells.length - 1) {
                                const nextKey = blankCells[currentIdx + 1];
                                setTimeout(() => { inputRefs.current[nextKey]?.focus(); }, 100);
                              }
                            }
                          }}
                          onFocus={() => onCellFocus?.(cellKey)}
                          onCompositionStart={() => {
                            composingCellsRef.current.add(cellKey);
                          }}
                          onCompositionEnd={() => {
                            composingCellsRef.current.delete(cellKey);
                            lastCompositionEndAtRef.current = Date.now();
                          }}
                          onBlur={() => {
                            composingCellsRef.current.delete(cellKey);
                          }}
                          onKeyDown={(e) => handleKeyDown(cellKey, e)}
                          readOnly={readOnly}
                          className={`relative z-10 w-full bg-transparent outline-none text-sm px-2 py-1.5 ${
                            isEquivalentTableCellAnswer(userAnswer, cell.content)
                              ? "text-green-600 font-semibold"
                              : "text-black"
                          }`}
                        />
                      </div>
                    ) : isBlank && !showAnswers ? (
                      <div className="relative">
                        <input
                          ref={(el) => { inputRefs.current[cellKey] = el; }}
                          type="text"
                          value={userAnswer}
                          onChange={(e) => onAnswerChange?.(cellKey, e.target.value)}
                          onFocus={() => onCellFocus?.(cellKey)}
                          onCompositionStart={() => {
                            composingCellsRef.current.add(cellKey);
                          }}
                          onCompositionEnd={() => {
                            composingCellsRef.current.delete(cellKey);
                            lastCompositionEndAtRef.current = Date.now();
                          }}
                          onBlur={() => {
                            composingCellsRef.current.delete(cellKey);
                          }}
                          onKeyDown={(e) => handleKeyDown(cellKey, e)}
                          readOnly={readOnly}
                          placeholder="?"
                          className={`w-full bg-transparent border-b-2 ${
                            isCorrect === true
                              ? "border-green-500 text-green-700"
                              : isCorrect === false
                              ? "border-red-500 text-red-700"
                              : "border-amber-300 text-slate-700"
                          } outline-none text-sm px-0 py-0.5 text-center placeholder:text-amber-300`}
                        />
                        {showAnswers && isCorrect === false && (
                          <div className="text-xs text-green-600 mt-0.5 text-center">{cell.content}</div>
                        )}
                      </div>
                    ) : (
                      <span className={`block ${isHeader ? "font-semibold text-slate-700 text-center" : "text-slate-600"}`}
                        style={{ whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'break-word' }}
                      >
                        {showAnswers && isBlank ? (
                          <span className="text-foreground font-medium">{cell.content}</span>
                        ) : (
                          cell.content
                        )}
                      </span>
                    )}
                  </CellTag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 연습 셀 키 목록 반환 (순서대로)
export function getBlankCells(tableData: TableData): string[] {
  const blanks: string[] = [];
  for (let ri = 0; ri < tableData.cells.length; ri++) {
    for (let ci = 0; ci < tableData.cells[ri].length; ci++) {
      const cell = tableData.cells[ri][ci];
      if (cell.isBlank && !cell.isMerged) blanks.push(`${ri}-${ci}`);
    }
  }
  return blanks;
}

// 표 채점 함수
export function gradeTable(
  tableData: TableData,
  answers: Record<string, string>
): { results: Record<string, boolean>; score: number; total: number } {
  const results: Record<string, boolean> = {};
  let correct = 0;
  let total = 0;

  for (let ri = 0; ri < tableData.cells.length; ri++) {
    for (let ci = 0; ci < tableData.cells[ri].length; ci++) {
      const cell = tableData.cells[ri][ci];
      if (cell.isBlank && !cell.isMerged) {
        const key = `${ri}-${ci}`;
        const userAnswer = answers[key] || "";
        const correctAnswer = cell.content;
        const isCorrect = isEquivalentTableCellAnswer(userAnswer, correctAnswer);
        results[key] = isCorrect;
        if (isCorrect) correct++;
        total++;
      }
    }
  }

  return { results, score: correct, total };
}
