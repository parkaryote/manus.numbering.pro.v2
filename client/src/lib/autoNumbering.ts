const NUMBERING_PATTERN = /(?:^|\n)\s*(\d+)\.\s*/g;
const NUMBERED_LINE_PATTERN = /^(\s*)(\d+)\.\s*(.*)$/;
const BULLET_LINE_PATTERN = /^(\s*)([-*•·●○◦▪▫▸▹►▶‣⁃※])\s*(.*)$/;
const NUMBERED_PREFIX_PATTERN = /^(\s*)(\d+)([.)])\s*/;
const BULLET_PREFIX_PATTERN = /^(\s*)([-*•·●○◦▪▫▸▹►▶‣⁃※])\s*/;

export type LinePrefixHint = {
  kind: "number" | "bullet";
  prefix: string;
};

function normalizeLineForProgressMapping(line: string): string {
  const withoutNumber = line.replace(NUMBERED_PREFIX_PATTERN, "");
  const withoutBullet = withoutNumber.replace(BULLET_PREFIX_PATTERN, "");
  return withoutBullet.toLowerCase().replace(/\s+/g, "");
}

function getCurrentLineRange(rawValue: string, cursor: number): {
  lineStart: number;
  lineEnd: number;
  lineEndIndex: number;
  line: string;
} {
  const safeCursor = Math.max(0, Math.min(cursor, rawValue.length));
  const lineStart = rawValue.lastIndexOf("\n", safeCursor - 1) + 1;
  const lineEndIndex = rawValue.indexOf("\n", safeCursor);
  const lineEnd = lineEndIndex === -1 ? rawValue.length : lineEndIndex;
  const line = rawValue.slice(lineStart, lineEnd);
  return { lineStart, lineEnd, lineEndIndex, line };
}

function removeCurrentListLine(rawValue: string, cursor: number): {
  nextValue: string;
  nextCursor: number;
} {
  const { lineStart, lineEnd, lineEndIndex } = getCurrentLineRange(rawValue, cursor);
  const beforeLine = rawValue.slice(0, lineStart);
  const nextLineStart = lineEndIndex === -1 ? lineEnd : lineEnd + 1;
  const afterLine = rawValue.slice(nextLineStart);
  const nextValue = `${beforeLine}${afterLine}`;
  const nextCursor = Math.min(beforeLine.length, nextValue.length);
  return { nextValue, nextCursor };
}

export function getLinePrefixHint(line: string): LinePrefixHint | null {
  const numberedMatch = line.match(NUMBERED_PREFIX_PATTERN);
  if (numberedMatch) {
    const indent = numberedMatch[1] ?? "";
    const num = numberedMatch[2] ?? "1";
    const delimiter = numberedMatch[3] ?? ".";
    return {
      kind: "number",
      prefix: `${indent}${num}${delimiter} `,
    };
  }

  const bulletMatch = line.match(BULLET_PREFIX_PATTERN);
  if (bulletMatch) {
    const indent = bulletMatch[1] ?? "";
    const bullet = bulletMatch[2] ?? "-";
    return {
      kind: "bullet",
      prefix: `${indent}${bullet} `,
    };
  }

  return null;
}

export function findNextLineNumber(textBeforeCursor: string): number {
  const matches = Array.from(textBeforeCursor.matchAll(NUMBERING_PATTERN));
  if (matches.length > 0) {
    const last = parseInt(matches[matches.length - 1][1], 10);
    if (Number.isFinite(last)) return last + 1;
  }
  const nonEmptyLineCount = textBeforeCursor
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  return Math.max(1, nonEmptyLineCount + 1);
}

export function buildNextAutoNumberingValue(
  rawValue: string,
  selectionStart: number,
  selectionEnd: number,
  options?: {
    forcedPrefix?: string;
  }
): { nextValue: string; nextCursor: number } {
  const normalizedValue = rawValue.replace(/\r\n/g, "\n");
  const before = normalizedValue.slice(0, selectionStart);
  const after = normalizedValue.slice(selectionEnd);
  const { line } = getCurrentLineRange(normalizedValue, selectionStart);
  const lineBreak = before.endsWith("\n") ? "" : "\n";

  const numberedLineMatch = line.match(NUMBERED_LINE_PATTERN);
  if (numberedLineMatch) {
    const content = (numberedLineMatch[3] ?? "").trim();
    if (content.length === 0) {
      // 메모앱/에디터 동작과 동일하게: 빈 번호 줄에서 Enter를 누르면 목록 종료
      return removeCurrentListLine(normalizedValue, selectionStart);
    }
  }

  const bulletLineMatch = line.match(BULLET_LINE_PATTERN);
  if (bulletLineMatch) {
    const content = (bulletLineMatch[3] ?? "").trim();
    if (content.length === 0) {
      // 메모앱/에디터 동작과 동일하게: 빈 불릿 줄에서 Enter를 누르면 목록 종료
      return removeCurrentListLine(normalizedValue, selectionStart);
    }
  }

  if (typeof options?.forcedPrefix === "string") {
    const insertText = `${lineBreak}${options.forcedPrefix}`;
    const nextValue = `${before}${insertText}${after}`;
    const nextCursor = before.length + insertText.length;
    return { nextValue, nextCursor };
  }

  if (numberedLineMatch) {
    const indent = numberedLineMatch[1] ?? "";
    const currentNumber = parseInt(numberedLineMatch[2] ?? "1", 10);
    const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
    const insertText = `${lineBreak}${indent}${nextNumber}. `;
    const nextValue = `${before}${insertText}${after}`;
    const nextCursor = before.length + insertText.length;
    return { nextValue, nextCursor };
  }

  if (bulletLineMatch) {
    const indent = bulletLineMatch[1] ?? "";
    const bullet = bulletLineMatch[2] ?? "-";
    const insertText = `${lineBreak}${indent}${bullet} `;
    const nextValue = `${before}${insertText}${after}`;
    const nextCursor = before.length + insertText.length;
    return { nextValue, nextCursor };
  }

  const insertText = "\n";
  const nextValue = `${before}${insertText}${after}`;
  const nextCursor = before.length + insertText.length;

  return { nextValue, nextCursor };
}

export function getForcedPrefixByTemplateProgress(
  rawValue: string,
  selectionStart: number,
  templateText: string
): string | undefined {
  if (!templateText) return undefined;

  const normalizedValue = rawValue.replace(/\r\n/g, "\n");
  const safeCursor = Math.max(0, Math.min(selectionStart, normalizedValue.length));
  const beforeCursor = normalizedValue.slice(0, safeCursor);

  const typedMeaningfulCount = beforeCursor
    .split("\n")
    .map((line) => normalizeLineForProgressMapping(line))
    .filter((line) => line.length > 0).length;

  const templateCandidates = templateText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => ({ line, normalized: normalizeLineForProgressMapping(line) }))
    .filter((entry) => entry.normalized.length > 0);

  if (templateCandidates.length === 0) return undefined;
  if (typedMeaningfulCount >= templateCandidates.length) return undefined;

  const nextLine = templateCandidates[typedMeaningfulCount]?.line ?? "";
  return getLinePrefixHint(nextLine)?.prefix;
}
