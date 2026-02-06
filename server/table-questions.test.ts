import { describe, it, expect } from "vitest";

// Test the gradeTable logic (replicated from client-side for server-side validation)
function gradeTable(
  tableData: any,
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

function getBlankCells(tableData: any): string[] {
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

describe("Table Question - gradeTable", () => {
  const sampleTable = {
    rows: 3,
    cols: 3,
    cells: [
      [
        { content: "항목", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "값1", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "값2", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
      ],
      [
        { content: "A", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "10", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "20", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
      ],
      [
        { content: "B", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "30", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
        { content: "40", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
      ],
    ],
    headerRow: true,
    headerCol: false,
  };

  it("should correctly grade all correct answers", () => {
    const answers = {
      "1-1": "10",
      "1-2": "20",
      "2-1": "30",
    };
    const result = gradeTable(sampleTable, answers);
    expect(result.score).toBe(3);
    expect(result.total).toBe(3);
    expect(result.results["1-1"]).toBe(true);
    expect(result.results["1-2"]).toBe(true);
    expect(result.results["2-1"]).toBe(true);
  });

  it("should correctly grade partial answers", () => {
    const answers = {
      "1-1": "10",
      "1-2": "25", // wrong
      "2-1": "30",
    };
    const result = gradeTable(sampleTable, answers);
    expect(result.score).toBe(2);
    expect(result.total).toBe(3);
    expect(result.results["1-2"]).toBe(false);
  });

  it("should correctly grade empty answers", () => {
    const answers = {};
    const result = gradeTable(sampleTable, answers);
    expect(result.score).toBe(0);
    expect(result.total).toBe(3);
  });

  it("should be case-insensitive", () => {
    const tableWithText = {
      ...sampleTable,
      cells: [
        [
          { content: "Name", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "Value", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        ],
        [
          { content: "Hello", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "World", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        ],
        [
          { content: "", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        ],
      ],
    };
    const answers = {
      "1-0": "hello",
      "1-1": "WORLD",
    };
    const result = gradeTable(tableWithText, answers);
    expect(result.score).toBe(2);
    expect(result.total).toBe(2);
  });

  it("should ignore whitespace in answers", () => {
    const answers = {
      "1-1": " 10 ",
      "1-2": "  20  ",
      "2-1": "30",
    };
    const result = gradeTable(sampleTable, answers);
    expect(result.score).toBe(3);
    expect(result.total).toBe(3);
  });
});

describe("Table Question - getBlankCells", () => {
  it("should return blank cell keys in order", () => {
    const table = {
      rows: 2,
      cols: 2,
      cells: [
        [
          { content: "A", isBlank: false, isMerged: false },
          { content: "B", isBlank: true, isMerged: false },
        ],
        [
          { content: "C", isBlank: true, isMerged: false },
          { content: "D", isBlank: false, isMerged: false },
        ],
      ],
    };
    const blanks = getBlankCells(table);
    expect(blanks).toEqual(["0-1", "1-0"]);
  });

  it("should skip merged cells", () => {
    const table = {
      rows: 2,
      cols: 2,
      cells: [
        [
          { content: "A", isBlank: true, isMerged: false },
          { content: "", isBlank: true, isMerged: true },
        ],
        [
          { content: "C", isBlank: true, isMerged: false },
          { content: "D", isBlank: false, isMerged: false },
        ],
      ],
    };
    const blanks = getBlankCells(table);
    expect(blanks).toEqual(["0-0", "1-0"]);
  });

  it("should return empty array when no blanks", () => {
    const table = {
      rows: 2,
      cols: 2,
      cells: [
        [
          { content: "A", isBlank: false, isMerged: false },
          { content: "B", isBlank: false, isMerged: false },
        ],
        [
          { content: "C", isBlank: false, isMerged: false },
          { content: "D", isBlank: false, isMerged: false },
        ],
      ],
    };
    const blanks = getBlankCells(table);
    expect(blanks).toEqual([]);
  });
});

describe("Table Data JSON serialization", () => {
  it("should serialize and deserialize table data correctly", () => {
    const tableData = {
      rows: 2,
      cols: 2,
      cells: [
        [
          { content: "Header 1", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "Header 2", isBlank: false, rowSpan: 1, colSpan: 1, isMerged: false },
        ],
        [
          { content: "Value 1", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
          { content: "Value 2", isBlank: true, rowSpan: 1, colSpan: 1, isMerged: false },
        ],
      ],
      headerRow: true,
      headerCol: false,
    };

    const serialized = JSON.stringify(tableData);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.rows).toBe(2);
    expect(deserialized.cols).toBe(2);
    expect(deserialized.cells[0][0].content).toBe("Header 1");
    expect(deserialized.cells[1][0].isBlank).toBe(true);
    expect(deserialized.headerRow).toBe(true);
  });
});
