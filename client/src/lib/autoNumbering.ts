const NUMBERING_PATTERN = /(?:^|\n)\s*(\d+)\.\s*/g;

export function findNextLineNumber(textBeforeCursor: string): number {
  const matches = Array.from(textBeforeCursor.matchAll(NUMBERING_PATTERN));
  if (matches.length > 0) {
    const last = parseInt(matches[matches.length - 1][1], 10);
    if (Number.isFinite(last)) return last + 1;
  }
  const nonEmptyLineCount = textBeforeCursor
    .split("\n")
    .filter(line => line.trim().length > 0).length;
  return Math.max(1, nonEmptyLineCount + 1);
}

export function buildNextAutoNumberingValue(
  rawValue: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; nextCursor: number } {
  if (rawValue.trim().length === 0) {
    const seeded = "1. ";
    return { nextValue: seeded, nextCursor: seeded.length };
  }

  let workingValue = rawValue;
  let start = selectionStart;
  let end = selectionEnd;
  const hasAnyNumbering = /(^|\n)\s*\d+\.\s/.test(workingValue);

  if (!hasAnyNumbering && workingValue.trim().length > 0) {
    // 첫 Enter에서도 1번 라인을 자동으로 붙인다.
    workingValue = `1. ${workingValue}`;
    start += 3;
    end += 3;
  }

  const before = workingValue.slice(0, start);
  const after = workingValue.slice(end);
  const nextNumber = findNextLineNumber(before);
  const insertText = `\n${nextNumber}. `;
  const nextValue = `${before}${insertText}${after}`;
  const nextCursor = before.length + insertText.length;

  return { nextValue, nextCursor };
}
