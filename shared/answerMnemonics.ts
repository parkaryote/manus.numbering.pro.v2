export type ParsedMnemonicAnswerLine = {
  rawLine: string;
  cleanLine: string;
  hint: string | null;
  hintDisplay: string | null;
  highlightedIndexes: number[];
};

export type ParsedMnemonicAnswer = {
  cleanAnswer: string;
  lines: ParsedMnemonicAnswerLine[];
  summaryHints: string[];
};

const TRAILING_MNEMONIC_BRACE_REGEX = /\s*\{\s*([^{}\n\r]+?)\s*\}\s*$/;
const TRAILING_MNEMONIC_LEGACY_REGEX = /\s*[（(]\s*(?:암기|힌트)\s*[:：]\s*([^()（）\n\r]+?)\s*[)）]\s*$/;
const LINE_PREFIX_REGEX = /^(\s*(?:\d+[.)]\s*|[-*•·●○◦▪▫▸▹►▶‣⁃※]\s*))/;

function normalizeComparableChar(value: string): string {
  return value.toLocaleLowerCase();
}

function getHighlightedIndexes(cleanLine: string, hint: string | null): number[] {
  if (!hint) return [];

  const compactHint = hint.replace(/\s+/g, "");
  if (!compactHint) return [];

  const chars = Array.from(cleanLine);
  const prefixMatch = cleanLine.match(LINE_PREFIX_REGEX);
  const prefixLength = Array.from(prefixMatch?.[1] ?? "").length;
  const contentChars = chars.slice(prefixLength);

  const highlighted: number[] = [];
  let searchFrom = 0;

  for (const rawHintChar of Array.from(compactHint)) {
    const hintChar = normalizeComparableChar(rawHintChar);
    let matchedIndex = -1;
    for (let index = searchFrom; index < contentChars.length; index += 1) {
      const currentChar = contentChars[index];
      if (!currentChar || /\s/.test(currentChar)) continue;
      if (normalizeComparableChar(currentChar) !== hintChar) continue;
      matchedIndex = index;
      break;
    }
    if (matchedIndex < 0) continue;
    highlighted.push(prefixLength + matchedIndex);
    searchFrom = matchedIndex + 1;
  }

  return highlighted;
}

export function parseMnemonicAnswerLine(rawLine: string): ParsedMnemonicAnswerLine {
  const normalizedLine = typeof rawLine === "string" ? rawLine : "";
  const braceMatch = normalizedLine.match(TRAILING_MNEMONIC_BRACE_REGEX);
  const legacyMatch = braceMatch ? null : normalizedLine.match(TRAILING_MNEMONIC_LEGACY_REGEX);
  const hint = braceMatch?.[1]?.trim() || legacyMatch?.[1]?.trim() || null;
  const cleanLine = hint
    ? normalizedLine
        .replace(TRAILING_MNEMONIC_BRACE_REGEX, "")
        .replace(TRAILING_MNEMONIC_LEGACY_REGEX, "")
        .trimEnd()
    : normalizedLine;

  return {
    rawLine: normalizedLine,
    cleanLine,
    hint,
    hintDisplay: hint ? hint.replace(/\s+/g, "") : null,
    highlightedIndexes: getHighlightedIndexes(cleanLine, hint),
  };
}

export function parseMnemonicAnswer(answer: string | null | undefined): ParsedMnemonicAnswer {
  const normalizedAnswer = typeof answer === "string" ? answer.replace(/\r\n/g, "\n") : "";
  const lines = normalizedAnswer.split("\n").map(parseMnemonicAnswerLine);

  return {
    cleanAnswer: lines.map((line) => line.cleanLine).join("\n"),
    lines,
    summaryHints: lines
      .map((line, index) => (line.hintDisplay ? `${index + 1}.${line.hintDisplay}` : null))
      .filter((value): value is string => Boolean(value)),
  };
}

export function stripMnemonicHintsFromAnswer(answer: string | null | undefined): string {
  return parseMnemonicAnswer(answer).cleanAnswer;
}
