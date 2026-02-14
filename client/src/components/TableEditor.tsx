import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Minus, Eye, EyeOff, RotateCcw, Merge, Split } from "lucide-react";
import { toast } from "sonner";

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

export function TableEditor({ initialData, onChange }: TableEditorProps) {
  const [tableData, setTableData] = useState<TableData>(
    initialData || createDefaultTable()
  );
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

  const updateTable = useCallback(
    (newData: TableData) => {
      setTableData(newData);
      onChange(newData);
    },
    [onChange]
  );

  // 행 추가
  const addRow = useCallback(
    (position: "top" | "bottom") => {
      const newCells = [...tableData.cells];
      const newRow = Array.from({ length: tableData.cols }, () => createEmptyCell());
      if (position === "top") {
        newCells.unshift(newRow);
      } else {
        newCells.push(newRow);
      }
      updateTable({
        ...tableData,
        rows: tableData.rows + 1,
        cells: newCells,
      });
    },
    [tableData, updateTable]
  );

  // 열 추가
  const addCol = useCallback(
    (position: "left" | "right") => {
      const newCells = tableData.cells.map((row) => {
        const newRow = [...row];
        if (position === "left") {
          newRow.unshift(createEmptyCell());
        } else {
          newRow.push(createEmptyCell());
        }
        return newRow;
      });
      updateTable({
        ...tableData,
        cols: tableData.cols + 1,
        cells: newCells,
      });
    },
    [tableData, updateTable]
  );

  // 행 삭제
  const removeRow = useCallback(
    (index: number) => {
      if (tableData.rows <= 1) {
        toast.error("최소 1행이 필요합니다");
        return;
      }
      const newCells = tableData.cells.filter((_, i) => i !== index);
      updateTable({
        ...tableData,
        rows: tableData.rows - 1,
        cells: newCells,
      });
      setSelectedCells(new Set());
    },
    [tableData, updateTable]
  );

  // 열 삭제
  const removeCol = useCallback(
    (index: number) => {
      if (tableData.cols <= 1) {
        toast.error("최소 1열이 필요합니다");
        return;
      }
      const newCells = tableData.cells.map((row) =>
        row.filter((_, i) => i !== index)
      );
      updateTable({
        ...tableData,
        cols: tableData.cols - 1,
        cells: newCells,
      });
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

  // 연습 셀 토글
  const toggleBlank = useCallback(
    (row: number, col: number) => {
      const newCells = tableData.cells.map((r, ri) =>
        r.map((c, ci) =>
          ri === row && ci === col ? { ...c, isBlank: !c.isBlank } : c
        )
      );
      updateTable({ ...tableData, cells: newCells });
    },
    [tableData, updateTable]
  );

  // 선택된 셀 모두 연습 셀 토글
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
    if (selectedCells.size < 2) {
      toast.error("2개 이상의 셀을 선택하세요");
      return;
    }

    const positions = Array.from(selectedCells).map((key) => {
      const [r, c] = key.split("-").map(Number);
      return { row: r, col: c };
    });

    // 직사각형 영역인지 확인
    const minRow = Math.min(...positions.map((p) => p.row));
    const maxRow = Math.max(...positions.map((p) => p.row));
    const minCol = Math.min(...positions.map((p) => p.col));
    const maxCol = Math.max(...positions.map((p) => p.col));

    const expectedCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    if (selectedCells.size !== expectedCount) {
      toast.error("직사각형 영역만 병합할 수 있습니다");
      return;
    }

    // 이미 병합된 셀이 포함되어 있는지 확인
    for (const pos of positions) {
      const cell = tableData.cells[pos.row][pos.col];
      if (cell.isMerged || (cell.rowSpan && cell.rowSpan > 1) || (cell.colSpan && cell.colSpan > 1)) {
        toast.error("이미 병합된 셀은 다시 병합할 수 없습니다");
        return;
      }
    }

    const newCells = tableData.cells.map((r, ri) =>
      r.map((c, ci) => {
        if (ri === minRow && ci === minCol) {
          // 병합 부모 셀
          const mergedContent = positions
            .map((p) => tableData.cells[p.row][p.col].content)
            .filter(Boolean)
            .join(" ");
          return {
            ...c,
            content: mergedContent || c.content,
            rowSpan: maxRow - minRow + 1,
            colSpan: maxCol - minCol + 1,
          };
        }
        if (ri >= minRow && ri <= maxRow && ci >= minCol && ci <= maxCol) {
          // 병합에 의해 가려진 셀
          return {
            ...c,
            isMerged: true,
            mergeParent: { row: minRow, col: minCol },
            content: "",
          };
        }
        return c;
      })
    );

    updateTable({ ...tableData, cells: newCells });
    setSelectedCells(new Set());
    toast.success("셀이 병합되었습니다");
  }, [selectedCells, tableData, updateTable]);

  // 셀 병합 해제
  const splitCells = useCallback(() => {
    if (selectedCells.size !== 1) {
      toast.error("병합 해제할 셀 1개를 선택하세요");
      return;
    }

    const [key] = Array.from(selectedCells);
    const [row, col] = key.split("-").map(Number);
    const cell = tableData.cells[row][col];

    if (!cell.rowSpan || cell.rowSpan <= 1) {
      if (!cell.colSpan || cell.colSpan <= 1) {
        toast.error("병합된 셀이 아닙니다");
        return;
      }
    }

    const newCells = tableData.cells.map((r, ri) =>
      r.map((c, ci) => {
        if (ri === row && ci === col) {
          return { ...c, rowSpan: 1, colSpan: 1 };
        }
        if (
          c.isMerged &&
          c.mergeParent?.row === row &&
          c.mergeParent?.col === col
        ) {
          return createEmptyCell();
        }
        return c;
      })
    );

    updateTable({ ...tableData, cells: newCells });
    setSelectedCells(new Set());
    toast.success("병합이 해제되었습니다");
  }, [selectedCells, tableData, updateTable]);

  // 마우스 드래그로 셀 선택
  const handleCellMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0) return; // 좌클릭만
    e.preventDefault();
    e.stopPropagation();
    
    if (editingCell) {
      setEditingCell(null);
    }

    setIsSelecting(true);
    setSelectionStart({ row, col });

    if (e.shiftKey && selectedCells.size > 0) {
      // Shift 클릭: 범위 선택
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
          if (!tableData.cells[r][c].isMerged) {
            newSelection.add(`${r}-${c}`);
          }
        }
      }
      setSelectedCells(newSelection);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl 클릭: 토글 선택
      const key = `${row}-${col}`;
      const newSelection = new Set(selectedCells);
      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }
      setSelectedCells(newSelection);
    } else {
      // 일반 클릭: 단일 선택
      setSelectedCells(new Set([`${row}-${col}`]));
    }
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
        if (!tableData.cells[r][c].isMerged) {
          newSelection.add(`${r}-${c}`);
        }
      }
    }
    setSelectedCells(newSelection);
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
  };

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // 셀 더블클릭으로 편집 모드
  const handleCellDoubleClick = (row: number, col: number) => {
    if (previewMode) return;
    setEditingCell({ row, col });
  };

  // 헤더 토글
  const toggleHeaderRow = () => {
    updateTable({ ...tableData, headerRow: !tableData.headerRow });
  };

  const toggleHeaderCol = () => {
    updateTable({ ...tableData, headerCol: !tableData.headerCol });
  };

  // 테이블 초기화
  const resetTable = () => {
    const newTable = createDefaultTable();
    setTableData(newTable);
    onChange(newTable);
    setSelectedCells(new Set());
    setEditingCell(null);
  };

  // 셀 스타일 계산
  const getCellStyle = (row: number, col: number) => {
    const cell = tableData.cells[row][col];
    const isSelected = selectedCells.has(`${row}-${col}`);
    const isHeader =
      (tableData.headerRow && row === 0) ||
      (tableData.headerCol && col === 0);

    let bg = "bg-white";
    if (isHeader) bg = "bg-slate-100";
    if (cell.isBlank) bg = "bg-amber-50";
    if (isSelected) bg = "bg-blue-100";
    if (previewMode && cell.isBlank) bg = "bg-yellow-100";

    let border = "border border-slate-300";
    if (isSelected) border = "border-2 border-blue-500";

    return `${bg} ${border} px-2 py-1.5 text-sm relative select-none min-w-[60px] min-h-[36px]`;
  };

  const blankCount = tableData.cells.flat().filter((c) => c.isBlank && !c.isMerged).length;

  return (
    <div className="space-y-3">
      {/* 도구 모음 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => addRow("bottom")}
            title="행 추가 (아래)"
          >
            <Plus className="h-3 w-3 mr-1" />행
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => addCol("right")}
            title="열 추가 (오른쪽)"
          >
            <Plus className="h-3 w-3 mr-1" />열
          </Button>
          {selectedCells.size > 0 && (
            <>
              <div className="w-px h-5 bg-slate-300" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const positions = Array.from(selectedCells).map((k) => k.split("-").map(Number));
                  const rows = Array.from(new Set(positions.map((p) => p[0]))).sort((a, b) => b - a);
                  rows.forEach((r) => removeRow(r));
                }}
                title="선택 행 삭제"
                className="text-red-500 hover:text-red-700"
              >
                <Minus className="h-3 w-3 mr-1" />행
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const positions = Array.from(selectedCells).map((k) => k.split("-").map(Number));
                  const cols = Array.from(new Set(positions.map((p) => p[1]))).sort((a, b) => b - a);
                  cols.forEach((c) => removeCol(c));
                }}
                title="선택 열 삭제"
                className="text-red-500 hover:text-red-700"
              >
                <Minus className="h-3 w-3 mr-1" />열
              </Button>
            </>
          )}
        </div>

        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleSelectedBlanks}
            disabled={selectedCells.size === 0}
            title="선택 셀 연습 셀 토글"
          >
            <EyeOff className="h-3 w-3 mr-1" />연습
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={mergeCells}
            disabled={selectedCells.size < 2}
            title="셀 병합"
          >
            <Merge className="h-3 w-3 mr-1" />병합
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={splitCells}
            disabled={selectedCells.size !== 1}
            title="병합 해제"
          >
            <Split className="h-3 w-3 mr-1" />해제
          </Button>
        </div>

        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button
            type="button"
            variant={tableData.headerRow ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleHeaderRow}
            title="첫 행 헤더"
          >
            헤더행
          </Button>
          <Button
            type="button"
            variant={tableData.headerCol ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleHeaderCol}
            title="첫 열 헤더"
          >
            헤더열
          </Button>
        </div>

        <div className="flex gap-1 items-center border rounded-md p-1">
          <Button
            type="button"
            variant={previewMode ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPreviewMode(!previewMode)}
            title="미리보기"
          >
            <Eye className="h-3 w-3 mr-1" />미리보기
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetTable}
            title="초기화"
            className="text-red-500 hover:text-red-700"
          >
            <RotateCcw className="h-3 w-3 mr-1" />초기화
          </Button>
        </div>
      </div>

      {/* 안내 텍스트 */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>더블클릭: 셀 편집 | 드래그: 범위 선택 | Ctrl+클릭: 다중 선택 | Shift+클릭: 범위 확장</p>
        <p>연습 셀로 설정된 셀은 연습 모드에서 타이핑 대상이 됩니다. <span className="text-amber-600 font-medium">연습 셀: {blankCount}개</span></p>
      </div>

      {/* 표 편집 영역 */}
      <div className="overflow-x-auto border rounded-lg">
        <table ref={tableRef} className="w-full border-collapse">
          <tbody>
            {tableData.cells.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  if (cell.isMerged) return null;

                  const isHeader =
                    (tableData.headerRow && ri === 0) ||
                    (tableData.headerCol && ci === 0);
                  const CellTag = isHeader ? "th" : "td";

                  return (
                    <CellTag
                      key={ci}
                      rowSpan={cell.rowSpan || 1}
                      colSpan={cell.colSpan || 1}
                      className={getCellStyle(ri, ci)}
                      onMouseDown={(e) => handleCellMouseDown(ri, ci, e)}
                      onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                      onDoubleClick={(e) => { e.stopPropagation(); handleCellDoubleClick(ri, ci); }}
                    >
                      {editingCell?.row === ri && editingCell?.col === ci ? (
                        <Input
                          ref={inputRef}
                          value={cell.content}
                          onChange={(e) => updateCellContent(ri, ci, e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              setEditingCell(null);
                            }
                            if (e.key === "Tab") {
                              e.preventDefault();
                              setEditingCell(null);
                              // 다음 셀로 이동
                              const nextCol = ci + (cell.colSpan || 1);
                              if (nextCol < tableData.cols) {
                                setEditingCell({ row: ri, col: nextCol });
                              } else if (ri + 1 < tableData.rows) {
                                setEditingCell({ row: ri + 1, col: 0 });
                              }
                            }
                            if (e.key === "Escape") {
                              setEditingCell(null);
                            }
                          }}
                          className="h-6 px-1 py-0 text-sm border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        />
                      ) : previewMode && cell.isBlank ? (
                        <span className="text-yellow-600 italic text-xs">연습</span>
                      ) : (
                        <span
                          className={`block truncate ${
                            isHeader ? "font-semibold text-slate-700" : "text-slate-600"
                          } ${cell.isBlank ? "underline decoration-amber-400 decoration-2" : ""}`}
                        >
                          {cell.content || (
                            <span className="text-slate-300 italic text-xs">
                              {isHeader ? "헤더" : "내용"}
                            </span>
                          )}
                        </span>
                      )}
                      {/* 연습 셀 표시 아이콘 */}
                      {cell.isBlank && !previewMode && (
                        <div className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-t-amber-400 border-l-[8px] border-l-transparent" />
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
      <div className="text-xs text-muted-foreground text-right">
        {tableData.rows}행 × {tableData.cols}열
      </div>
    </div>
  );
}

// 표 렌더링 컴포넌트 (연습/시험 모드용)
interface TableViewProps {
  tableData: TableData;
  answers?: Record<string, string>; // "row-col" -> 사용자 입력
  onAnswerChange?: (key: string, value: string) => void;
  showAnswers?: boolean; // 정답 표시 여부 (시험 모드에서 오답 시 정답 표시)
  results?: Record<string, boolean>; // "row-col" -> 정답 여부
  readOnly?: boolean;
  practiceMode?: boolean; // 연습 모드 (정답 표시 + 실시간 타이핑 피드백)
  onCellFocus?: (key: string) => void;
  onCorrectAnswer?: (key: string) => void; // 정답 완성 시 콜백
}

export function TableView({
  tableData,
  answers = {},
  onAnswerChange,
  showAnswers = false,
  results,
  readOnly = false,
  practiceMode = false,
  onCellFocus,
  onCorrectAnswer,
}: TableViewProps) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const blankCells = getBlankCells(tableData);

  // Tab 키로 다음 연습 셀으로 이동
  const handleKeyDown = (key: string, e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const currentIdx = blankCells.findIndex((k) => k === key);
      const nextIdx = e.shiftKey
        ? (currentIdx - 1 + blankCells.length) % blankCells.length
        : (currentIdx + 1) % blankCells.length;
      const nextKey = blankCells[nextIdx];
      inputRefs.current[nextKey]?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const currentIdx = blankCells.findIndex((k) => k === key);
      const nextIdx = (currentIdx + 1) % blankCells.length;
      const nextKey = blankCells[nextIdx];
      inputRefs.current[nextKey]?.focus();
    }
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

                // 연습 모드: 정답과 비교하여 실시간 피드백
                const normalizeText = (text: string) => text.replace(/\s+/g, "");
                const isTypingCorrect = practiceMode && isBlank
                  ? normalizeText(userAnswer) === normalizeText(cell.content.slice(0, userAnswer.length))
                  : undefined;

                let bgColor = "bg-white";
                if (isHeader) bgColor = "bg-slate-100";
                if (practiceMode && isBlank) bgColor = "bg-slate-50"; // 연습 모드: 연습 셀만 회색
                if (!practiceMode && isBlank && !showAnswers) bgColor = "bg-yellow-50";
                if (isCorrect === true) bgColor = "bg-green-50";
                if (isCorrect === false) bgColor = "bg-red-50";

                return (
                  <CellTag
                    key={ci}
                    rowSpan={cell.rowSpan || 1}
                    colSpan={cell.colSpan || 1}
                    className={`${bgColor} border border-slate-300 px-2 py-1.5 text-sm min-w-[60px]`}
                  >
                    {practiceMode && isBlank ? (
                      /* 연습 모드: 정답 표시 + 실시간 타이핑 피드백 */
                      <div className="relative min-h-[28px]">
                        {/* 정답 표시 (회색 배경) - 입력이 없을 때만 표시 */}
                        {!userAnswer && (
                          <div className="absolute inset-0 text-slate-400 text-sm whitespace-pre-wrap px-2 py-1.5 pointer-events-none">
                            {cell.content}
                          </div>
                        )}
                        {/* 입력 필드 */}
                        <input
                          ref={(el) => {
                            inputRefs.current[cellKey] = el;
                          }}
                          type="text"
                          value={userAnswer}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            onAnswerChange?.(cellKey, newValue);
                            // 정답 완성 시 다음 셀로 이동
                            if (normalizeText(newValue) === normalizeText(cell.content)) {
                              onCorrectAnswer?.(cellKey);
                              // 다음 셀로 포커스 이동
                              const currentIdx = blankCells.findIndex((k) => k === cellKey);
                              if (currentIdx < blankCells.length - 1) {
                                const nextKey = blankCells[currentIdx + 1];
                                setTimeout(() => {
                                  inputRefs.current[nextKey]?.focus();
                                }, 100);
                              }
                            }
                          }}
                          onFocus={() => onCellFocus?.(cellKey)}
                          onKeyDown={(e) => handleKeyDown(cellKey, e)}
                          readOnly={readOnly}
                          className={`relative z-10 w-full bg-transparent outline-none text-sm px-2 py-1.5 ${
                            normalizeText(userAnswer) === normalizeText(cell.content)
                              ? "text-green-600 font-semibold"
                              : "text-black"
                          }`}
                        />
                      </div>
                    ) : isBlank && !showAnswers ? (
                      /* 시험 모드: 입력 필드 */
                      <div className="relative">
                        <input
                          ref={(el) => {
                            inputRefs.current[cellKey] = el;
                          }}
                          type="text"
                          value={userAnswer}
                          onChange={(e) => onAnswerChange?.(cellKey, e.target.value)}
                          onFocus={() => onCellFocus?.(cellKey)}
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
                          <div className="text-xs text-green-600 mt-0.5 text-center">
                            {cell.content}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 일반 셀 또는 정답 표시 */
                      <span
                        className={`block ${
                          isHeader
                            ? "font-semibold text-slate-700 text-center"
                            : practiceMode
                            ? "text-slate-600"
                            : "text-slate-600"
                        }`}
                      >
                        {showAnswers && isBlank ? (
                          <span className="text-green-600 font-medium">{cell.content}</span>
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
      if (cell.isBlank && !cell.isMerged) {
        blanks.push(`${ri}-${ci}`);
      }
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
        const userAnswer = (answers[key] || "").trim().replace(/\s+/g, "");
        const correctAnswer = cell.content.trim().replace(/\s+/g, "");
        const isCorrect =
          userAnswer.toLowerCase() === correctAnswer.toLowerCase();
        results[key] = isCorrect;
        if (isCorrect) correct++;
        total++;
      }
    }
  }

  return { results, score: correct, total };
}
