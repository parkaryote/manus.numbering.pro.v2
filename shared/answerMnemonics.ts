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
const INLINE_MNEMONIC_BRACE_REGEX = /\{\s*([^{}\n\r]+?)\s*\}/g;
const LINE_PREFIX_REGEX = /^(\s*(?:\d+[.)]\s*|[-*•·●○◦▪▫▸▹►▶‣⁃※]\s*))/;
const MNEMONIC_TOKEN_REGEX = /[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g;

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

function extractLeadMnemonic(cleanLine: string): string | null {
  const withoutPrefix = cleanLine.replace(LINE_PREFIX_REGEX, "").trim();
  if (!withoutPrefix) return null;

  const tokens: string[] = withoutPrefix.match(MNEMONIC_TOKEN_REGEX) ?? [];
  if (tokens.length === 0) return null;

  const initials = tokens
    .map((token) => Array.from(token)[0] ?? "")
    .filter((char) => char.length > 0)
    .join("");

  return initials || null;
}

export function parseMnemonicAnswerLine(rawLine: string): ParsedMnemonicAnswerLine {
  const normalizedLine = typeof rawLine === "string" ? rawLine : "";
  const braceMatch = normalizedLine.match(TRAILING_MNEMONIC_BRACE_REGEX);
  const legacyMatch = braceMatch ? null : normalizedLine.match(TRAILING_MNEMONIC_LEGACY_REGEX);
  const explicitHint = braceMatch?.[1]?.trim() || legacyMatch?.[1]?.trim() || null;
  const lineWithoutTrailingHint = explicitHint
    ? normalizedLine
        .replace(TRAILING_MNEMONIC_BRACE_REGEX, "")
        .replace(TRAILING_MNEMONIC_LEGACY_REGEX, "")
        .trimEnd()
    : normalizedLine;
  let hasInlineBrace = false;
  const cleanLine = lineWithoutTrailingHint.replace(INLINE_MNEMONIC_BRACE_REGEX, (_, inner: string) => {
    hasInlineBrace = true;
    return String(inner ?? "").trim();
  }).trimEnd();
  const generatedHint = explicitHint ? null : hasInlineBrace ? extractLeadMnemonic(cleanLine) : null;
  const hint = explicitHint || generatedHint;

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
