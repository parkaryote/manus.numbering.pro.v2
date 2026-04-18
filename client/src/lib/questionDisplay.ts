import { stripMnemonicHintsFromAnswer } from "@shared/answerMnemonics";

const BLANK_TOKEN_REGEX = /\[([^\]\n\r]*)\]/g;
const EXPLICIT_BLANK_TOKEN_REGEX = /\[\]/g;
const EXPLICIT_BLANK_TOKEN_TEST_REGEX = /\[\]/;
const NBSP = "\u00A0";

function extractBlankAnswerLines(answerText?: string | null): string[] {
  return stripMnemonicHintsFromAnswer(answerText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function computeBlankWidth(answer: string): number {
  const visible = answer
    .replace(/\s+/g, "")
    .replace(/[.,!?;:'"~`()[\]{}<>]/g, "");
  const graphemeCount = Array.from(visible).length;
  // Keep blanks readable and stable in list/detail views.
  return Math.max(2, Math.min(18, graphemeCount || 2));
}

function buildBlankPlaceholder(answer: string): string {
  const width = computeBlankWidth(answer);
  return `(${NBSP.repeat(width)})`;
}

export function isBlankQuestionText(questionText?: string | null): boolean {
  return EXPLICIT_BLANK_TOKEN_TEST_REGEX.test(questionText ?? "");
}

export function formatQuestionTextForDisplay(
  questionText?: string | null,
  answerText?: string | null
): string {
  const source = typeof questionText === "string" ? questionText : "";
  if (!source) return source;

  const answerLines = extractBlankAnswerLines(answerText);
  const explicitBlankCount = (source.match(EXPLICIT_BLANK_TOKEN_REGEX) ?? []).length;
  const allBracketTokens = source.match(BLANK_TOKEN_REGEX) ?? [];

  const shouldRenderAsBlank =
    explicitBlankCount > 0 ||
    (allBracketTokens.length > 0 && answerLines.length > 0 && answerLines.length === allBracketTokens.length);
  if (!shouldRenderAsBlank) return source;

  let answerIndex = 0;

  return source.replace(BLANK_TOKEN_REGEX, (_token, inlineAnswer: string) => {
    const fallback = String(inlineAnswer ?? "").trim();
    const currentAnswer = answerLines[answerIndex] ?? fallback;
    answerIndex += 1;
    return buildBlankPlaceholder(currentAnswer);
  });
}
