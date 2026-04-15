import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { sdk } from "./_core/sdk.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { adminRouter } from "./adminRouter.js";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db.js";
import { ENV } from "./_core/env.js";
import type { User } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm.js";
import { transcribeAudio } from "./_core/voiceTranscription.js";
import { storagePut } from "./storage.js";
import { nanoid } from "nanoid";
import * as ocrModule from "./ocr.js";
import { PDFDocument } from "pdf-lib";
import {
  computeExamConfidence,
  aggregateConfidence,
  predictExamDayConfidence,
  TRAFFIC_LIGHT_LABELS,
  type PracticeSignal,
  type TestSignal,
  type ConfidenceResult,
} from "../shared/examConfidence.js";
import {
  calculateEffectiveSpeed,
  calculateSpeedBonus,
  computeBlendedBaseline,
  computeExpectedSpeed,
  computeP60,
  shouldUpdateBaseline,
  speedToInt,
  intToSpeed,
  getLengthBucket,
  type TypingAttemptInput,
} from "./typingSpeed.js";

// 글자 단위 유사도 계산 (대소문자 무시, 띄어쓰기 무시)
function calcCharSimilarity(userText: string, correctText: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const a = normalize(userText);
  const b = normalize(correctText);
  if (b.length === 0) return a.length === 0 ? 100 : 0;
  if (a.length === 0) return 0;
  // LCS 기반 유사도
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const lcsLen = dp[m][n];
  return Math.round((lcsLen / Math.max(m, n)) * 100);
}

const AUTO_NUMBER_PREFIX_REGEX = /^\s*\d{1,3}\s*[.)]\s*/;
const BULLET_PREFIX_REGEX = /^\s*(?:[-–—−*•·●○◦▪▫▸▹►▶‣⁃※])\s*/;
const WORD_TOKEN_PATTERN = "[a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+(?:['’\\-][a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+)*";

function stripAutoNumberPrefix(line: string): string {
  return line.replace(AUTO_NUMBER_PREFIX_REGEX, "").trim();
}

function stripBulletPrefix(line: string): string {
  return line.replace(BULLET_PREFIX_REGEX, "").trim();
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim().length === 0) {
    end--;
  }
  return lines.slice(0, end);
}

function normalizeLineForTextComparison(line: string, ignoreAutoNumbering: boolean): string {
  const lineWithoutNumber = ignoreAutoNumbering ? stripAutoNumberPrefix(line) : line.trim();
  const base = stripBulletPrefix(lineWithoutNumber);
  return base.toLowerCase().replace(/\s+/g, "");
}

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const JUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];
const JONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const JAMO_TO_KEYSTROKE: Record<string, string> = {
  "ㄱ": "r", "ㄲ": "r", "ㄴ": "s", "ㄷ": "e", "ㄸ": "e", "ㄹ": "f", "ㅁ": "a", "ㅂ": "q", "ㅃ": "q",
  "ㅅ": "t", "ㅆ": "t", "ㅇ": "d", "ㅈ": "w", "ㅉ": "w", "ㅊ": "c", "ㅋ": "z", "ㅌ": "x", "ㅍ": "v", "ㅎ": "g",
  "ㅏ": "k", "ㅐ": "o", "ㅑ": "i", "ㅒ": "o", "ㅓ": "j", "ㅔ": "p", "ㅕ": "u", "ㅖ": "p", "ㅗ": "h",
  "ㅘ": "hk", "ㅙ": "ho", "ㅚ": "hl", "ㅛ": "y", "ㅜ": "n", "ㅝ": "nj", "ㅞ": "np", "ㅟ": "nl", "ㅠ": "b",
  "ㅡ": "m", "ㅢ": "ml", "ㅣ": "l",
  "ㄳ": "rt", "ㄵ": "sw", "ㄶ": "sg", "ㄺ": "fr", "ㄻ": "fa", "ㄼ": "fq", "ㄽ": "ft", "ㄾ": "fx", "ㄿ": "fv", "ㅀ": "fg", "ㅄ": "qt",
};

function isHangulSyllable(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= HANGUL_START && code <= HANGUL_END;
}

function isJamoChar(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= 0x3131 && code <= 0x3163;
}

function decomposeHangulSyllable(char: string): { cho: string; jung: string; jong: string } | null {
  if (!isHangulSyllable(char)) return null;
  const code = char.charCodeAt(0) - HANGUL_START;
  const choIndex = Math.floor(code / 588);
  const jungIndex = Math.floor((code % 588) / 28);
  const jongIndex = code % 28;
  return {
    cho: CHO[choIndex] ?? "",
    jung: JUNG[jungIndex] ?? "",
    jong: JONG[jongIndex] ?? "",
  };
}

function toTypingKeyUnit(char: string): string {
  if (!char) return "";
  if (/^[a-z0-9]$/i.test(char)) return char.toLowerCase();

  if (isHangulSyllable(char)) {
    const d = decomposeHangulSyllable(char);
    if (!d) return char.toLowerCase();
    return `${JAMO_TO_KEYSTROKE[d.cho] ?? d.cho}${JAMO_TO_KEYSTROKE[d.jung] ?? d.jung}${
      d.jong ? JAMO_TO_KEYSTROKE[d.jong] ?? d.jong : ""
    }`.toLowerCase();
  }

  if (isJamoChar(char)) {
    return (JAMO_TO_KEYSTROKE[char] ?? char).toLowerCase();
  }

  return char.toLowerCase();
}

function toTypingKeySequence(text: string): string {
  return Array.from(text).map((char) => toTypingKeyUnit(char)).join("");
}

function normalizeLineForTypingComparison(line: string, ignoreAutoNumbering: boolean): string {
  return toTypingKeySequence(normalizeLineForTextComparison(line, ignoreAutoNumbering));
}

function normalizeTextForSimilarity(text: string, ignoreAutoNumbering: boolean): string {
  return trimTrailingEmptyLines(
    text
      .split("\n")
      .map((line) => {
        const lineWithoutNumber = ignoreAutoNumbering ? stripAutoNumberPrefix(line) : line.trim();
        return stripBulletPrefix(lineWithoutNumber);
      })
  ).join("\n");
}

function normalizeTextForTypingSimilarity(text: string, ignoreAutoNumbering: boolean): string {
  return trimTrailingEmptyLines(
    text
      .split("\n")
      .map((line) => {
        const lineWithoutNumber = ignoreAutoNumbering ? stripAutoNumberPrefix(line) : line.trim();
        const base = stripBulletPrefix(lineWithoutNumber).toLowerCase().replace(/\s+/g, "");
        return toTypingKeySequence(base);
      })
  ).join("\n");
}

function normalizeLineForWordComparison(line: string, ignoreAutoNumbering: boolean): string {
  const lineWithoutNumber = ignoreAutoNumbering ? stripAutoNumberPrefix(line) : line.trim();
  return stripBulletPrefix(lineWithoutNumber).toLowerCase().replace(/\s+/g, " ").trim();
}

function isLikelyEnglishLine(text: string): boolean {
  const latinCount = (text.match(/[a-z]/gi) ?? []).length;
  const hangulCount = (text.match(/[가-힣]/g) ?? []).length;
  if (latinCount === 0) return false;
  return hangulCount === 0 || latinCount >= hangulCount * 2;
}

function tokenizeWordTokens(text: string): string[] {
  return text.match(new RegExp(WORD_TOKEN_PATTERN, "gi"))?.map((w) => w.toLowerCase()) ?? [];
}

function calcWordSimilarity(userText: string, correctText: string): number {
  const a = tokenizeWordTokens(userText);
  const b = tokenizeWordTokens(correctText);
  if (b.length === 0) return a.length === 0 ? 100 : 0;
  if (a.length === 0) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return Math.round((dp[m][n] / Math.max(m, n)) * 100);
}

type TextLineCompareMode = "word" | "typing";

function compareTextLine(
  userLineRaw: string,
  correctLineRaw: string,
  ignoreAutoNumbering: boolean
): {
  isCorrect: boolean;
  score: number;
  compareMode: TextLineCompareMode;
} {
  const wordCorrect = normalizeLineForWordComparison(correctLineRaw, ignoreAutoNumbering);
  const wordUser = normalizeLineForWordComparison(userLineRaw, ignoreAutoNumbering);
  const shouldUseWordMode = isLikelyEnglishLine(`${correctLineRaw} ${userLineRaw}`);

  if (shouldUseWordMode) {
    const correctWords = tokenizeWordTokens(wordCorrect);
    const userWords = tokenizeWordTokens(wordUser);
    const isCorrect =
      correctWords.length === userWords.length &&
      correctWords.every((w, i) => w === userWords[i]);
    const score = calcWordSimilarity(wordUser, wordCorrect);
    return { isCorrect, score, compareMode: "word" };
  }

  const typingCorrect = normalizeLineForTypingComparison(correctLineRaw, ignoreAutoNumbering);
  const typingUser = normalizeLineForTypingComparison(userLineRaw, ignoreAutoNumbering);
  const isCorrect = typingUser === typingCorrect;
  const score = calcCharSimilarity(typingUser, typingCorrect);
  return { isCorrect, score, compareMode: "typing" };
}

function evaluateTextAnswerByBestLineMatch(
  userAnswer: string,
  correctAnswer: string,
  ignoreAutoNumbering: boolean
) {
  const userLines = trimTrailingEmptyLines(userAnswer.split("\n").map((line) => line.trim()));
  const correctLines = trimTrailingEmptyLines(correctAnswer.split("\n").map((line) => line.trim()));
  const totalLines = correctLines.length;
  const LINE_CROSS_MATCH_MIN_SCORE = 80;
  const LINE_CROSS_MATCH_MARGIN = 12;

  const userLinePool = userLines.map((raw, index) => ({
    raw,
    index,
    consumed: false,
    normalized: normalizeLineForTextComparison(raw, ignoreAutoNumbering),
  }));

  const lineComparisons: Array<{
    lineIndex: number;
    correctAnswer: string;
    userAnswer: string;
    isCorrect: boolean;
    lineScore: number;
    compareMode: TextLineCompareMode;
    matchedUserLineIndex: number | null;
  }> = [];

  let correctLineCount = 0;
  let scoreSum = 0;

  for (let i = 0; i < totalLines; i++) {
    const correctLineRaw = correctLines[i] ?? "";
    const defaultMode: TextLineCompareMode = isLikelyEnglishLine(correctLineRaw) ? "word" : "typing";
    const directCandidate = userLinePool.find((candidate) => !candidate.consumed && candidate.index === i) ?? null;
    const directCompared = directCandidate
      ? compareTextLine(directCandidate.raw, correctLineRaw, ignoreAutoNumbering)
      : null;

    let bestCrossCandidate: (typeof userLinePool)[number] | null = null;
    let bestCrossScore = -1;
    let bestCrossIsCorrect = false;
    let bestCrossMode: TextLineCompareMode = defaultMode;

    for (const candidate of userLinePool) {
      if (candidate.consumed) continue;
      if (directCandidate && candidate.index === directCandidate.index) continue;

      const compared = compareTextLine(candidate.raw, correctLineRaw, ignoreAutoNumbering);
      if (
        compared.score > bestCrossScore ||
        (compared.score === bestCrossScore && compared.isCorrect && !bestCrossIsCorrect)
      ) {
        bestCrossCandidate = candidate;
        bestCrossScore = compared.score;
        bestCrossIsCorrect = compared.isCorrect;
        bestCrossMode = compared.compareMode;
      }
    }

    let chosenCandidate: (typeof userLinePool)[number] | null = null;
    let chosenScore = 0;
    let chosenIsCorrect = false;
    let chosenMode: TextLineCompareMode = defaultMode;

    if (directCandidate && directCompared) {
      const directHasMeaningfulInput = directCandidate.normalized.length > 0;
      chosenCandidate = directHasMeaningfulInput ? directCandidate : null;
      chosenScore = directHasMeaningfulInput ? directCompared.score : 0;
      chosenIsCorrect = directHasMeaningfulInput ? directCompared.isCorrect : false;
      chosenMode = directCompared.compareMode;

      if (bestCrossCandidate) {
        const crossStrongEnough = bestCrossIsCorrect || bestCrossScore >= LINE_CROSS_MATCH_MIN_SCORE;
        const crossClearlyBetter =
          !directHasMeaningfulInput ||
          bestCrossScore >= directCompared.score + LINE_CROSS_MATCH_MARGIN;
        if (!directCompared.isCorrect && crossStrongEnough && crossClearlyBetter) {
          chosenCandidate = bestCrossCandidate;
          chosenScore = bestCrossScore;
          chosenIsCorrect = bestCrossIsCorrect;
          chosenMode = bestCrossMode;
        }
      }
    } else if (bestCrossCandidate && (bestCrossIsCorrect || bestCrossScore >= LINE_CROSS_MATCH_MIN_SCORE)) {
      chosenCandidate = bestCrossCandidate;
      chosenScore = bestCrossScore;
      chosenIsCorrect = bestCrossIsCorrect;
      chosenMode = bestCrossMode;
    }

    let matchedUserRaw = "";
    let matchedUserLineIndex: number | null = null;
    let lineScore = 0;
    let lineIsCorrect = false;
    let lineMode = chosenMode;

    if (chosenCandidate) {
      chosenCandidate.consumed = true;
      matchedUserRaw = chosenCandidate.raw;
      matchedUserLineIndex = chosenCandidate.index + 1;
      lineScore = Math.max(0, chosenScore);
      lineIsCorrect = chosenIsCorrect;
      lineMode = chosenMode;
    }

    if (lineIsCorrect) correctLineCount++;
    scoreSum += lineScore;

    lineComparisons.push({
      lineIndex: i + 1,
      correctAnswer: correctLineRaw,
      userAnswer: matchedUserRaw,
      isCorrect: lineIsCorrect,
      lineScore,
      compareMode: lineMode,
      matchedUserLineIndex,
    });
  }

  const remainingMeaningfulUserLines = userLinePool.filter(
    (item) => !item.consumed && item.normalized.length > 0
  ).length;
  const isCorrect =
    totalLines > 0
      ? correctLineCount === totalLines && remainingMeaningfulUserLines === 0
      : remainingMeaningfulUserLines === 0;
  const accuracyRate = totalLines > 0 ? Math.round((correctLineCount / totalLines) * 100) : 0;
  const similarityScore = totalLines > 0 ? Math.round(scoreSum / totalLines) : 0;

  return {
    isCorrect,
    similarityScore,
    accuracyRate,
    correctLineCount,
    totalLines,
    mistakes: lineComparisons,
    feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctLineCount}/${Math.max(totalLines, 1)} 줄 정답`,
    missingKeywords: [],
  };
}

function parseExamEndDateInput(raw: string): Date {
  const value = raw.trim();

  // 날짜만 입력하면 해당 날짜의 마지막 시각으로 해석해 D-0에서 예측이 사라지지 않게 함
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "유효한 시험일시 형식이 아닙니다. (예: 2026-04-08T14:30)",
    });
  }
  return parsed;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveRequestOrigin(req: {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}): string {
  const forwardedProto = resolveHeaderValue(req.headers?.["x-forwarded-proto"]);
  const forwardedHost = resolveHeaderValue(req.headers?.["x-forwarded-host"]);
  const host = (forwardedHost ?? resolveHeaderValue(req.headers?.host) ?? "").split(",")[0]?.trim();
  const proto = (forwardedProto ?? req.protocol ?? "http").split(",")[0]?.trim() || "http";

  if (!host) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "요청 host를 확인할 수 없습니다.",
    });
  }
  return `${proto}://${host}`;
}

function resolveGoogleRedirectUri(req: {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}): string {
  const configured = ENV.googleOAuthRedirectUri.trim();
  if (configured) return configured;
  return `${resolveRequestOrigin(req).replace(/\/+$/, "")}/login`;
}

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
};

type GoogleTokenInfoResponse = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

async function exchangeGoogleCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    code: input.code,
    client_id: ENV.googleClientId,
    client_secret: ENV.googleClientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: `Google 토큰 교환 실패 (${response.status})${detail ? `: ${detail.slice(0, 140)}` : ""}`,
    });
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function getGoogleTokenInfo(idToken: string): Promise<GoogleTokenInfoResponse> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: `Google 토큰 검증 실패 (${response.status})${detail ? `: ${detail.slice(0, 140)}` : ""}`,
    });
  }
  return (await response.json()) as GoogleTokenInfoResponse;
}

function resolveRequestedDemoValue(
  requested: number | undefined,
  role: "admin" | "user"
): number | undefined {
  if (requested === undefined) return undefined;
  const normalized = requested === 1 ? 1 : 0;
  if (normalized === 0) return 0;
  if (role !== "admin") return 0;
  if (!ENV.allowDemoPublishing) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "데모 공개는 잠금 상태입니다. 환경변수 ALLOW_DEMO_PUBLISHING=true 설정 후 시도하세요.",
    });
  }
  return 1;
}

function makeQuestionSignature(q: {
  displayOrder?: number | null;
  question?: string | null;
  answer?: string | null;
  imageUrl?: string | null;
  imageLabels?: string | null;
  tableData?: string | null;
}) {
  return [
    q.displayOrder ?? 0,
    q.question ?? "",
    q.answer ?? "",
    q.imageUrl ?? "",
    q.imageLabels ?? "",
    q.tableData ?? "",
  ].join("||");
}

function getNormalizedCharLength(text: string | null | undefined): number {
  if (!text) return 0;
  return Array.from(text.replace(/\s+/g, "")).length;
}

function buildInitialConfidenceEstimate(question: {
  answer?: string | null;
  difficulty?: "easy" | "medium" | "hard" | null;
  tableData?: string | null;
}) {
  const answer = question.answer ?? "";
  const answerLength = getNormalizedCharLength(answer);
  const lineCount = Math.max(
    1,
    answer.split("\n").filter((line) => line.trim().length > 0).length || (answer.trim().length > 0 ? 1 : 0)
  );

  let hasTable = false;
  let blankCount = 0;
  let tableBlankChars = 0;

  if (question.tableData) {
    hasTable = true;
    try {
      const parsed = JSON.parse(question.tableData) as { cells?: Array<Array<{ isBlank?: boolean; isMerged?: boolean; content?: string }>> };
      const rows = Array.isArray(parsed?.cells) ? parsed.cells : [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (!cell?.isBlank || cell?.isMerged) continue;
          blankCount += 1;
          tableBlankChars += getNormalizedCharLength(cell.content ?? "");
        }
      }
    } catch {
      // ignore malformed table data
    }
  }

  return {
    answerLength: Math.max(1, Math.max(answerLength, tableBlankChars)),
    lineCount,
    blankCount,
    difficulty: question.difficulty ?? "medium",
    hasTable,
  };
}

function extractWarnZoneLinesFromTests(
  tests: Array<{ mistakeHighlights?: string | null }>
): Array<{ lineIndex: number; wrongCount: number }> {
  const lineWrongCount: Record<number, number> = {};

  for (const t of tests) {
    if (!t.mistakeHighlights) continue;
    try {
      const highlights = JSON.parse(t.mistakeHighlights as string);
      if (!Array.isArray(highlights)) continue;
      for (const h of highlights) {
        if (h?.isCorrect !== false) continue;
        const rawIdx = h.lineIndex ?? h.labelIndex ?? 1;
        const idx = Number(rawIdx);
        if (!Number.isFinite(idx) || idx < 1) continue;
        lineWrongCount[idx] = (lineWrongCount[idx] || 0) + 1;
      }
    } catch {
      // ignore malformed highlights
    }
  }

  return Object.entries(lineWrongCount)
    .filter(([, cnt]) => cnt >= 2)
    .map(([idx, cnt]) => ({ lineIndex: Number(idx), wrongCount: cnt }))
    .sort((a, b) => b.wrongCount - a.wrongCount);
}

const TOOTH_MORPHOLOGY_SUBJECT_NAME = "치아형태학";
const NUMBERING_SUBJECT_NAME = "넘버링";
const DRAWING_BBANG_SUBJECT_NAME = "그림빵";
const TOOTH_MORPHOLOGY_FIXED_EXAM_DATE = new Date("2026-04-08T07:30:00+09:00");
const CRITICAL_TOOTH_DEMO_QUESTION_TEXT = "표 I-3 하악 치아 크기";

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStarterExamDateForSubject(demoSubject: { name: string; examEndDate?: Date | string | null }): Date | null {
  if (demoSubject.name === TOOTH_MORPHOLOGY_SUBJECT_NAME) {
    return new Date(TOOTH_MORPHOLOGY_FIXED_EXAM_DATE);
  }
  return toDateOrNull(demoSubject.examEndDate ?? null);
}

function normalizeQuestionTextValue(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveStateFromScore(score: number): "green" | "yellow" | "red" {
  if (score >= 80) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function applyDisplayScoreValue(
  base: ConfidenceResult,
  score: number,
  options?: { isColdStart?: boolean }
): ConfidenceResult {
  const displayScore = clampNumber(Math.round(score), 0, 100);
  const state = resolveStateFromScore(displayScore);
  return {
    ...base,
    rawScore: displayScore,
    displayScore,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
    isColdStart: options?.isColdStart ?? base.isColdStart,
  };
}

function applyDisplayScoreOverride(base: ConfidenceResult, score: number): ConfidenceResult {
  return applyDisplayScoreValue(base, score, { isColdStart: true });
}

function getStarterBaseScoreOverride(input: {
  subjectName: string | null | undefined;
  question?: { displayOrder?: number | null; difficulty?: "easy" | "medium" | "hard" | null };
  userRole?: "admin" | "user";
}): number | null {
  if (input.userRole === "admin") return null;

  const subjectName = (input.subjectName ?? "").trim();
  const difficulty = input.question?.difficulty ?? "medium";
  const displayOrder = Math.max(0, Math.round(input.question?.displayOrder ?? 0));

  if (subjectName === TOOTH_MORPHOLOGY_SUBJECT_NAME) {
    const difficultyBase =
      difficulty === "easy"
        ? 56
        : difficulty === "hard"
          ? 18
          : 36;
    const orderOffsets = [-7, -3, 1, 5, -1, 3, -5, 6];
    const offset = orderOffsets[displayOrder % orderOffsets.length] ?? 0;
    return clampNumber(difficultyBase + offset, 8, 72);
  }

  if (subjectName === NUMBERING_SUBJECT_NAME) {
    const numberingScores = [84, 57, 29, 72, 46, 23];
    return numberingScores[displayOrder % numberingScores.length] ?? numberingScores[0];
  }

  if (subjectName === DRAWING_BBANG_SUBJECT_NAME) {
    const drawingScores = [82, 48, 26, 69, 43, 21];
    return drawingScores[displayOrder % drawingScores.length] ?? drawingScores[0];
  }

  return null;
}

function getStarterInitialScoreOverride(input: {
  subjectName: string | null | undefined;
  question?: { displayOrder?: number | null; difficulty?: "easy" | "medium" | "hard" | null };
  practiceCount: number;
  testCount: number;
  userRole?: "admin" | "user";
}): number | null {
  if (input.practiceCount > 0 || input.testCount > 0) return null;
  return getStarterBaseScoreOverride(input);
}

function applyStarterPracticeFloor(
  base: ConfidenceResult,
  starterBaseScore: number,
  practiceCount: number
): ConfidenceResult {
  if (practiceCount <= 0) return base;

  // 연습 구간에서는 스타터 초기값 대비 하락 체감을 막고, 최소한의 상승 흐름을 보장한다.
  const progressiveGain = Math.max(1, Math.floor(Math.log2(practiceCount + 1)));
  const floorScore = clampNumber(starterBaseScore + progressiveGain, 0, 100);
  if (base.displayScore >= floorScore) return base;
  return applyDisplayScoreValue(base, floorScore, { isColdStart: false });
}

function applyUnlearnedLabel(base: ConfidenceResult): ConfidenceResult {
  if (!base.isColdStart) return base;
  return {
    ...base,
    label: "미학습",
  };
}

function buildUnlearnedScenarioEvents(
  question: {
    difficulty?: "easy" | "medium" | "hard" | null;
    displayOrder?: number | null;
  },
  initialEstimate: { answerLength: number },
  targetCurrentScore: number
): DemoPreviewEvent[] {
  const fallbackEvents = buildFallbackDemoScenarioEvents(question, initialEstimate);
  const difficulty = question.difficulty ?? "medium";
  const difficultyPenalty = difficulty === "hard" ? 9 : difficulty === "easy" ? 1 : 5;
  const answerLength = Math.max(1, initialEstimate.answerLength);
  const lengthBoost = Math.round(Math.log(answerLength + 6) * 1.6);

  const baseP1 = fallbackEvents.find((event) => event.eventType === "practice")?.score ?? 18;
  const baseP2 = fallbackEvents.filter((event) => event.eventType === "practice")[1]?.score ?? 27;
  const baseP3 = fallbackEvents.filter((event) => event.eventType === "practice")[2]?.score ?? 36;
  const baseT1 = fallbackEvents.find((event) => event.eventType === "test")?.score ?? 48;
  const baseNow = fallbackEvents.find((event) => event.eventType === "now")?.score
    ?? fallbackEvents[fallbackEvents.length - 1]?.score
    ?? targetCurrentScore;

  const earlyDip = clampNumber(Math.round((baseP2 + baseP3) / 2) - (6 + Math.floor(difficultyPenalty / 3)), 4, 90);
  const midRecovery = clampNumber(baseP3 + 4 + lengthBoost, 8, 96);
  const lateTest = clampNumber(baseT1 + 4 + Math.max(0, lengthBoost - 1), 10, 98);
  const latePractice = clampNumber(lateTest - (difficulty === "hard" ? 2 : 1), 8, 97);

  const earlyTestAcc = clampNumber(72 + lengthBoost - difficultyPenalty, 45, 84);
  const lateTestAcc = clampNumber(earlyTestAcc + 17 + (difficulty === "easy" ? 3 : 0), 66, 97);

  const shapedBase: DemoPreviewEvent[] = [
    { minutesAgo: 42 * 60, eventType: "practice", score: baseP1, practiceSessionCount: 1, practiceDelta: 5 },
    { minutesAgo: 34 * 60, eventType: "practice", score: baseP2, practiceSessionCount: 2, practiceDelta: 7 },
    { minutesAgo: 28 * 60, eventType: "test", score: earlyDip, accuracyRate: earlyTestAcc, isCorrect: earlyTestAcc >= 80 },
    { minutesAgo: 21 * 60, eventType: "practice", score: baseP3, practiceSessionCount: 3, practiceDelta: 8 },
    { minutesAgo: 14 * 60, eventType: "practice", score: midRecovery, practiceSessionCount: 4, practiceDelta: 6 },
    { minutesAgo: 8 * 60, eventType: "test", score: lateTest, accuracyRate: lateTestAcc, isCorrect: lateTestAcc >= 80 },
    { minutesAgo: 3 * 60, eventType: "practice", score: latePractice, practiceSessionCount: 5, practiceDelta: 3 },
    { minutesAgo: 0, eventType: "now", score: baseNow },
  ];

  const targetNow = clampNumber(targetCurrentScore, 0, 100);
  const baseNowScore = shapedBase.find((event) => event.eventType === "now")?.score ?? targetNow;
  const relativeOffsets = shapedBase.map((event) => event.score - baseNowScore);
  const maxScaleFromUpper = Math.min(
    1,
    ...relativeOffsets
      .filter((offset) => offset > 0)
      .map((offset) => (100 - targetNow) / offset)
  );
  const maxScaleFromLower = Math.min(
    1,
    ...relativeOffsets
      .filter((offset) => offset < 0)
      .map((offset) => targetNow / Math.abs(offset))
  );
  const maxScale = Math.min(
    Number.isFinite(maxScaleFromUpper) ? maxScaleFromUpper : 1,
    Number.isFinite(maxScaleFromLower) ? maxScaleFromLower : 1
  );
  const scale = clampNumber(maxScale, 0.45, 1);

  return shapedBase.map((event) => {
    const offset = event.score - baseNowScore;
    const shiftedScore = clampNumber(Math.round(targetNow + offset * scale), 0, 100);
    if (event.accuracyRate === undefined) {
      return {
        ...event,
        score: shiftedScore,
      };
    }

    const adjustedAccuracy = clampNumber(
      Math.round(event.accuracyRate + (shiftedScore - event.score) * 0.9),
      35,
      99
    );
    return {
      ...event,
      score: shiftedScore,
      accuracyRate: adjustedAccuracy,
      isCorrect: adjustedAccuracy >= 80,
    };
  });
}

function mapScenarioEventsToHistoryPoints(
  scenario: DemoPreviewEvent[],
  nowMs: number
): Array<{
  at: string;
  score: number;
  state: "green" | "yellow" | "red";
  eventType: "practice" | "test" | "now";
  isCorrect?: boolean;
  accuracyRate?: number;
  practiceSessionCount?: number;
  practiceDelta?: number;
}> {
  return [...scenario]
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
    .map((event) => {
      const score = clampNumber(event.score, 0, 100);
      const state = resolveStateFromScore(score);
      return {
        at: new Date(nowMs - event.minutesAgo * 60_000).toISOString(),
        score,
        state,
        eventType: event.eventType,
        isCorrect: event.isCorrect,
        accuracyRate: event.accuracyRate,
        practiceSessionCount: event.practiceSessionCount,
        practiceDelta: event.practiceDelta,
      };
    });
}

type DemoPreviewEvent = {
  minutesAgo: number;
  eventType: "practice" | "test" | "now";
  score: number;
  isCorrect?: boolean;
  accuracyRate?: number;
  practiceSessionCount?: number;
  practiceDelta?: number;
};

type DemoQuestionPreview = {
  displayScore: number;
  state: "green" | "yellow" | "red";
  label: string;
  isColdStart: boolean;
  badges: {
    lastTestWrong: boolean;
    frequentlyWrong: boolean;
    hasWarnZone: boolean;
  };
  warnZoneLines: Array<{ lineIndex: number; wrongCount: number }>;
  lastTestWrongLines: number[];
  lastTestAccuracyRate: number | null;
  examDatePrediction: {
    predictedScore: number;
    predictedState: "green" | "yellow" | "red";
    predictedLabel: string;
    daysUntilExam: number;
    hoursUntilExam: number;
    minutesUntilExam: number;
    examAtISO: string;
    currentScore: number;
    scoreDelta: number;
    canReachGreen: boolean;
  };
  historyPoints: Array<{
    at: string;
    score: number;
    state: "green" | "yellow" | "red";
    eventType: "practice" | "test" | "now";
    isCorrect?: boolean;
    accuracyRate?: number;
    practiceSessionCount?: number;
    practiceDelta?: number;
  }>;
  isExample: true;
};

type DemoShowcaseKey = "box1" | "box9" | "table_i3";

const DEMO_SHOWCASE_KEYS_IN_ORDER: DemoShowcaseKey[] = ["box1", "box9", "table_i3"];
const DEMO_SHOWCASE_TITLE_CANDIDATES: Record<DemoShowcaseKey, string[]> = {
  box1: ["Box-1 절치들의 근원심구별"],
  box9: ["Box-9 하악 제1소구치와 제2소구치의 차이점"],
  table_i3: ["표 I-3 상악 치아 크기", "표 I-3 하악 치아 크기"],
};

function normalizeDemoShowcaseLookupValue(value: string | null | undefined): string {
  return normalizeQuestionTextValue(value).replace(/[^0-9a-z가-힣]/g, "");
}

const DEMO_SHOWCASE_TITLE_LOOKUP: Record<DemoShowcaseKey, string[]> = {
  box1: DEMO_SHOWCASE_TITLE_CANDIDATES.box1.map((title) => normalizeDemoShowcaseLookupValue(title)),
  box9: DEMO_SHOWCASE_TITLE_CANDIDATES.box9.map((title) => normalizeDemoShowcaseLookupValue(title)),
  table_i3: DEMO_SHOWCASE_TITLE_CANDIDATES.table_i3.map((title) => normalizeDemoShowcaseLookupValue(title)),
};

function resolveDemoShowcaseKeyByQuestionTitle(questionTitle: string | null | undefined): DemoShowcaseKey | null {
  const normalizedQuestionTitle = normalizeDemoShowcaseLookupValue(questionTitle);
  if (!normalizedQuestionTitle) return null;

  for (const key of DEMO_SHOWCASE_KEYS_IN_ORDER) {
    const candidates = DEMO_SHOWCASE_TITLE_LOOKUP[key];
    if (
      candidates.some(
        (candidate) =>
          normalizedQuestionTitle.includes(candidate) || candidate.includes(normalizedQuestionTitle)
      )
    ) {
      return key;
    }
  }

  return null;
}

function isPublicDemoShowcaseSubject(subject: { name?: string | null } | null | undefined): boolean {
  return (subject?.name ?? "").trim() === TOOTH_MORPHOLOGY_SUBJECT_NAME;
}

function isPublicDemoShowcaseQuestion(
  question: { question?: string | null } | null | undefined,
  subject: { name?: string | null } | null | undefined
): boolean {
  if (!isPublicDemoShowcaseSubject(subject)) return false;
  return resolveDemoShowcaseKeyByQuestionTitle(question?.question) !== null;
}

function selectPublicDemoShowcaseQuestions<T extends { question?: string | null; displayOrder?: number | null }>(
  subject: { name?: string | null } | null | undefined,
  questions: T[]
): T[] {
  if (!isPublicDemoShowcaseSubject(subject)) return [];
  if (!Array.isArray(questions) || questions.length === 0) return [];

  const sorted = [...questions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const pickedByKey = new Map<DemoShowcaseKey, T>();

  for (const question of sorted) {
    const key = resolveDemoShowcaseKeyByQuestionTitle(question.question);
    if (!key || pickedByKey.has(key)) continue;
    pickedByKey.set(key, question);
  }

  return DEMO_SHOWCASE_KEYS_IN_ORDER.flatMap((key) => {
    const row = pickedByKey.get(key);
    return row ? [row] : [];
  });
}

const DEMO_SCENARIO_OVERRIDES_BY_ID: Record<number, DemoPreviewEvent[]> = {
  431: [
    { minutesAgo: 30 * 60, eventType: "practice", score: 18, practiceSessionCount: 1, practiceDelta: 6 },
    { minutesAgo: 26 * 60, eventType: "practice", score: 26, practiceSessionCount: 2, practiceDelta: 8 },
    { minutesAgo: 20 * 60, eventType: "test", score: 41, accuracyRate: 84, isCorrect: true },
    { minutesAgo: 10 * 60, eventType: "practice", score: 47, practiceSessionCount: 3, practiceDelta: 6 },
    { minutesAgo: 4 * 60, eventType: "test", score: 58, accuracyRate: 91, isCorrect: true },
    { minutesAgo: 0, eventType: "now", score: 55 },
  ],
  437: [
    { minutesAgo: 28 * 60, eventType: "practice", score: 12, practiceSessionCount: 1, practiceDelta: 5 },
    { minutesAgo: 25 * 60, eventType: "practice", score: 19, practiceSessionCount: 2, practiceDelta: 7 },
    { minutesAgo: 24 * 60, eventType: "test", score: 15, accuracyRate: 46, isCorrect: false },
    { minutesAgo: 14 * 60, eventType: "practice", score: 24, practiceSessionCount: 3, practiceDelta: 5 },
    { minutesAgo: 6 * 60, eventType: "test", score: 39, accuracyRate: 82, isCorrect: true },
    { minutesAgo: 1 * 60, eventType: "practice", score: 44, practiceSessionCount: 4, practiceDelta: 5 },
    { minutesAgo: 0, eventType: "now", score: 42 },
  ],
  441: [
    { minutesAgo: 32 * 60, eventType: "practice", score: 28, practiceSessionCount: 1, practiceDelta: 8 },
    { minutesAgo: 30 * 60, eventType: "practice", score: 36, practiceSessionCount: 2, practiceDelta: 8 },
    { minutesAgo: 22 * 60, eventType: "test", score: 52, accuracyRate: 88, isCorrect: true },
    { minutesAgo: 15 * 60, eventType: "practice", score: 61, practiceSessionCount: 3, practiceDelta: 9 },
    { minutesAgo: 8 * 60, eventType: "practice", score: 70, practiceSessionCount: 4, practiceDelta: 9 },
    { minutesAgo: 3 * 60, eventType: "test", score: 84, accuracyRate: 96, isCorrect: true },
    { minutesAgo: 0, eventType: "now", score: 82 },
  ],
};

const DEMO_SCENARIO_OVERRIDES_BY_SHOWCASE_KEY: Partial<Record<DemoShowcaseKey, DemoPreviewEvent[]>> = {
  box1: [
    { minutesAgo: 32 * 60, eventType: "practice", score: 12, practiceSessionCount: 1, practiceDelta: 5 },
    { minutesAgo: 26 * 60, eventType: "practice", score: 18, practiceSessionCount: 2, practiceDelta: 6 },
    { minutesAgo: 23 * 60, eventType: "test", score: 14, accuracyRate: 44, isCorrect: false },
    { minutesAgo: 16 * 60, eventType: "practice", score: 23, practiceSessionCount: 3, practiceDelta: 5 },
    { minutesAgo: 8 * 60, eventType: "test", score: 31, accuracyRate: 62, isCorrect: false },
    { minutesAgo: 2 * 60, eventType: "practice", score: 36, practiceSessionCount: 4, practiceDelta: 5 },
    { minutesAgo: 0, eventType: "now", score: 34 },
  ],
  box9: [
    { minutesAgo: 34 * 60, eventType: "practice", score: 24, practiceSessionCount: 1, practiceDelta: 6 },
    { minutesAgo: 30 * 60, eventType: "practice", score: 33, practiceSessionCount: 2, practiceDelta: 9 },
    { minutesAgo: 22 * 60, eventType: "test", score: 46, accuracyRate: 78, isCorrect: false },
    { minutesAgo: 14 * 60, eventType: "practice", score: 54, practiceSessionCount: 3, practiceDelta: 8 },
    { minutesAgo: 6 * 60, eventType: "test", score: 60, accuracyRate: 84, isCorrect: true },
    { minutesAgo: 1 * 60, eventType: "practice", score: 58, practiceSessionCount: 4, practiceDelta: 4 },
    { minutesAgo: 0, eventType: "now", score: 56 },
  ],
  table_i3: [
    { minutesAgo: 40 * 60, eventType: "practice", score: 41, practiceSessionCount: 1, practiceDelta: 8 },
    { minutesAgo: 32 * 60, eventType: "practice", score: 53, practiceSessionCount: 2, practiceDelta: 12 },
    { minutesAgo: 24 * 60, eventType: "test", score: 66, accuracyRate: 86, isCorrect: true },
    { minutesAgo: 14 * 60, eventType: "practice", score: 74, practiceSessionCount: 3, practiceDelta: 8 },
    { minutesAgo: 7 * 60, eventType: "practice", score: 82, practiceSessionCount: 4, practiceDelta: 8 },
    { minutesAgo: 2 * 60, eventType: "test", score: 89, accuracyRate: 97, isCorrect: true },
    { minutesAgo: 0, eventType: "now", score: 86 },
  ],
};

function buildFallbackDemoScenarioEvents(
  question: {
    difficulty?: "easy" | "medium" | "hard" | null;
    displayOrder?: number | null;
  },
  initialEstimate: { answerLength: number }
): DemoPreviewEvent[] {
  const difficulty = question.difficulty ?? "medium";
  const answerLength = Math.max(1, initialEstimate.answerLength);
  const lengthBoost = Math.round(Math.log(answerLength + 4) * 4);
  const difficultyBoost = difficulty === "easy" ? 7 : difficulty === "hard" ? -1 : 3;
  const orderOffset = (((question.displayOrder ?? 1) % 5) - 2) * 2;

  const s1 = clampNumber(14 + lengthBoost + difficultyBoost + orderOffset, 8, 58);
  const s2 = clampNumber(s1 + 6 + Math.round(lengthBoost * 0.2), 12, 66);
  const s3 = clampNumber(s2 + 7, 16, 74);
  const t1 = clampNumber(s3 + (difficulty === "hard" ? 7 : 11), 24, 88);
  const nowScore = clampNumber(t1 - (difficulty === "hard" ? 4 : 2), 20, 92);
  const testAcc = clampNumber(
    (difficulty === "hard" ? 76 : 83) + Math.round(lengthBoost * 0.8),
    70,
    95
  );

  return [
    { minutesAgo: 26 * 60, eventType: "practice", score: s1, practiceSessionCount: 1, practiceDelta: 5 },
    { minutesAgo: 18 * 60, eventType: "practice", score: s2, practiceSessionCount: 2, practiceDelta: 6 },
    { minutesAgo: 11 * 60, eventType: "practice", score: s3, practiceSessionCount: 3, practiceDelta: 7 },
    { minutesAgo: 5 * 60, eventType: "test", score: t1, accuracyRate: testAcc, isCorrect: testAcc >= 80 },
    { minutesAgo: 0, eventType: "now", score: nowScore },
  ];
}

function buildDemoExamPrediction(
  subject: { examEndDate?: Date | string | null } | null,
  displayScore: number,
  initialEstimate: { answerLength: number; difficulty: "easy" | "medium" | "hard" }
) {
  const now = new Date();
  let examDate = toDateOrNull(subject?.examEndDate ?? null);
  if (!examDate || examDate.getTime() <= now.getTime()) {
    examDate = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  }
  const minutesUntilExam = Math.max(
    1,
    Math.round((examDate.getTime() - now.getTime()) / 60000)
  );
  const daysUntilExam = Math.floor(minutesUntilExam / (60 * 24));
  const hoursUntilExam = Math.floor((minutesUntilExam % (60 * 24)) / 60);

  const answerLength = Math.max(1, initialEstimate.answerLength);
  const lengthNorm = clampNumber((answerLength - 24) / 160, 0, 1);
  const forgetting =
    4 +
    Math.round(lengthNorm * 7) +
    (initialEstimate.difficulty === "hard"
      ? 4
      : initialEstimate.difficulty === "medium"
        ? 2
        : 1);
  const predictedScore = clampNumber(displayScore - forgetting, 0, 100);
  const predictedState = resolveStateFromScore(predictedScore);
  return {
    predictedScore,
    predictedState,
    predictedLabel: TRAFFIC_LIGHT_LABELS[predictedState],
    daysUntilExam,
    hoursUntilExam,
    minutesUntilExam,
    examAtISO: examDate.toISOString(),
    currentScore: displayScore,
    scoreDelta: predictedScore - displayScore,
    canReachGreen: predictedScore >= 80,
  };
}

function buildDemoQuestionPreview(
  question: {
    id: number;
    question?: string | null;
    difficulty?: "easy" | "medium" | "hard" | null;
    displayOrder?: number | null;
    answer?: string | null;
    tableData?: string | null;
  },
  subject: { examEndDate?: Date | string | null } | null
): DemoQuestionPreview {
  const initialEstimate = buildInitialConfidenceEstimate(question);
  const showcaseKey = resolveDemoShowcaseKeyByQuestionTitle(question.question);
  const scenario =
    (showcaseKey ? DEMO_SCENARIO_OVERRIDES_BY_SHOWCASE_KEY[showcaseKey] : undefined) ??
    DEMO_SCENARIO_OVERRIDES_BY_ID[question.id] ??
    buildFallbackDemoScenarioEvents(question, initialEstimate);
  const nowMs = Date.now();
  const historyPoints = [...scenario]
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
    .map((event) => {
      const score = clampNumber(event.score, 0, 100);
      const state = resolveStateFromScore(score);
      return {
        at: new Date(nowMs - event.minutesAgo * 60_000).toISOString(),
        score,
        state,
        eventType: event.eventType,
        isCorrect: event.isCorrect,
        accuracyRate: event.accuracyRate,
        practiceSessionCount: event.practiceSessionCount,
        practiceDelta: event.practiceDelta,
      };
    });

  const currentPoint =
    historyPoints
      .filter((point) => point.eventType === "now")
      .at(-1) ??
    historyPoints[historyPoints.length - 1];
  const displayScore = clampNumber(currentPoint?.score ?? 0, 0, 100);
  const state = resolveStateFromScore(displayScore);
  const lastTestPoint = [...historyPoints].reverse().find((point) => point.eventType === "test");
  const lastTestAccuracyRate =
    typeof lastTestPoint?.accuracyRate === "number" ? lastTestPoint.accuracyRate : null;
  const lastTestWrong = lastTestPoint
    ? (typeof lastTestPoint.accuracyRate === "number"
      ? lastTestPoint.accuracyRate < 80
      : !lastTestPoint.isCorrect)
    : false;

  const warnZoneLines =
    showcaseKey === "box1"
      ? [
          { lineIndex: 2, wrongCount: 2 },
          { lineIndex: 4, wrongCount: 2 },
        ]
      : [];
  const lastTestWrongLines = showcaseKey === "box1" ? [2, 4] : [];

  return {
    displayScore,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
    isColdStart: false,
    badges: {
      lastTestWrong,
      frequentlyWrong: showcaseKey === "box1",
      hasWarnZone: warnZoneLines.length > 0,
    },
    warnZoneLines,
    lastTestWrongLines,
    lastTestAccuracyRate,
    examDatePrediction: buildDemoExamPrediction(subject, displayScore, initialEstimate),
    historyPoints,
    isExample: true,
  };
}

function buildDemoSubjectHistoryFromPreviews(
  previews: DemoQuestionPreview[]
): Array<{
  at: string;
  score: number;
  state: "green" | "yellow" | "red";
  eventType: "practice" | "test" | "now";
  questionCount: number;
}> {
  if (previews.length === 0) return [];

  const timeline = Array.from(
    new Set(
      previews
        .flatMap((preview) => preview.historyPoints)
        .map((point) => point.at)
    )
  ).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  if (timeline.length === 0) return [];

  return timeline.map((at, index) => {
    const atMs = new Date(at).getTime();
    const scores = previews.map((preview) => {
      const points = preview.historyPoints
        .filter((point) => new Date(point.at).getTime() <= atMs)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const fallback = preview.historyPoints[0];
      return (points.at(-1) ?? fallback)?.score ?? 0;
    });
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;
    const eventType = index === timeline.length - 1
      ? "now"
      : previews.some((preview) =>
          preview.historyPoints.some((point) => point.at === at && point.eventType === "test")
        )
        ? "test"
        : "practice";

    return {
      at,
      score: avgScore,
      state: resolveStateFromScore(avgScore),
      eventType,
      questionCount: previews.length,
    };
  });
}

function aggregateDemoPreviewByQuestions(
  items: Array<{ displayScore: number; state: "green" | "yellow" | "red" }>
) {
  const totalQuestions = items.length;
  const averageScore =
    totalQuestions > 0
      ? Math.round(items.reduce((sum, item) => sum + item.displayScore, 0) / totalQuestions)
      : 0;
  const greenCount = items.filter((item) => item.state === "green").length;
  const yellowCount = items.filter((item) => item.state === "yellow").length;
  const redCount = items.filter((item) => item.state === "red").length;
  const state = resolveStateFromScore(averageScore);
  return {
    totalQuestions,
    averageScore,
    greenCount,
    yellowCount,
    redCount,
    state,
    label: TRAFFIC_LIGHT_LABELS[state],
  };
}

async function ensureCriticalToothDemoQuestionExists() {
  const demoSubjects = await db.getDemoSubjects();
  const toothDemoSubject = demoSubjects.find((subject) => subject.name === TOOTH_MORPHOLOGY_SUBJECT_NAME);
  if (!toothDemoSubject) return;

  const existingDemoQuestions = await db.getDemoQuestions(toothDemoSubject.id);
  const targetNormalized = normalizeQuestionTextValue(CRITICAL_TOOTH_DEMO_QUESTION_TEXT);
  const alreadyExists = existingDemoQuestions.some(
    (question) => normalizeQuestionTextValue(question.question) === targetNormalized
  );
  if (alreadyExists) return;

  const sourceCandidates = await db.getQuestionsByExactQuestionText(CRITICAL_TOOTH_DEMO_QUESTION_TEXT);
  if (sourceCandidates.length === 0) {
    console.warn(`[StarterData] Missing source question for demo recovery: ${CRITICAL_TOOTH_DEMO_QUESTION_TEXT}`);
    return;
  }

  const ownerUser = ENV.ownerEmail ? await db.getUserByEmail(ENV.ownerEmail) : undefined;
  const preferredOwnerId = ownerUser?.id ?? null;

  const prioritized = [...sourceCandidates].sort((a, b) => {
    const score = (row: typeof sourceCandidates[number]) => {
      let value = 0;
      if (preferredOwnerId && row.userId === preferredOwnerId) value += 1000;
      if (row.isDemo === 0) value += 100;
      if (row.tableData) value += 30;
      if (row.answer && row.answer.trim().length > 0) value += 20;
      if (typeof row.displayOrder === "number") value += Math.max(0, row.displayOrder);
      return value;
    };
    return score(b) - score(a);
  });

  const source = prioritized[0];
  const fallbackDisplayOrder =
    existingDemoQuestions.length > 0
      ? Math.max(...existingDemoQuestions.map((question) => question.displayOrder ?? 0)) + 1
      : 0;
  const displayOrder =
    typeof source.displayOrder === "number" && source.displayOrder >= 0
      ? source.displayOrder
      : fallbackDisplayOrder;

  await db.createDemoQuestion({
    subjectId: toothDemoSubject.id,
    userId: toothDemoSubject.userId,
    question: source.question,
    answer: source.answer ?? "",
    difficulty: source.difficulty ?? "medium",
    imageUrl: source.imageUrl ?? undefined,
    imageLabels: source.imageLabels ?? undefined,
    autoNumbering: source.autoNumbering ?? 1,
    tableData: source.tableData ?? undefined,
    displayOrder,
    isDemo: 1,
    isStarred: source.isStarred ?? 0,
    useAIGrading: source.useAIGrading ?? 0,
    memo: source.memo ?? undefined,
  });

  console.log(
    `[StarterData] Restored demo question "${CRITICAL_TOOTH_DEMO_QUESTION_TEXT}" into "${TOOTH_MORPHOLOGY_SUBJECT_NAME}".`
  );
}

async function syncDemoQuestionsToSubject(
  userId: number,
  userSubjectId: number,
  demoQuestions: Array<{
    id: number;
    question: string;
    answer: string;
    difficulty: "easy" | "medium" | "hard" | null;
    imageUrl: string | null;
    imageLabels: string | null;
    autoNumbering: number;
    tableData: string | null;
    displayOrder: number;
    isStarred: number;
    useAIGrading: number;
  }>
) {
  const userQuestions = await db.getQuestionsBySubjectId(userSubjectId);
  const linkedQuestionsBySourceId = new Map(
    userQuestions
      .filter((q) => typeof q.demoSourceQuestionId === "number" && q.demoSourceQuestionId > 0)
      .map((q) => [q.demoSourceQuestionId as number, q] as const)
  );
  const unlinkedQuestions = userQuestions.filter(
    (q) => !(typeof q.demoSourceQuestionId === "number" && q.demoSourceQuestionId > 0)
  );
  const consumedUnlinkedQuestionIds = new Set<number>();
  const unlinkedByDisplayOrder = new Map<number, typeof unlinkedQuestions>();
  for (const q of unlinkedQuestions) {
    const arr = unlinkedByDisplayOrder.get(q.displayOrder) ?? [];
    arr.push(q);
    unlinkedByDisplayOrder.set(q.displayOrder, arr);
  }

  const hasLearningHistory = async (questionId: number): Promise<boolean> => {
    const [practiceSessions, testSessions] = await Promise.all([
      db.getPracticeSessionsByQuestionId(questionId),
      db.getTestSessionsByQuestionId(questionId),
    ]);
    return practiceSessions.length > 0 || testSessions.length > 0;
  };

  for (const dq of demoQuestions) {
    let targetQuestion = linkedQuestionsBySourceId.get(dq.id);

    if (!targetQuestion) {
      const signature = makeQuestionSignature(dq);
      const signatureMatchedQuestion = unlinkedQuestions.find(
        (q) => !consumedUnlinkedQuestionIds.has(q.id) && makeQuestionSignature(q) === signature
      );
      if (signatureMatchedQuestion) {
        targetQuestion = signatureMatchedQuestion;
        consumedUnlinkedQuestionIds.add(signatureMatchedQuestion.id);
      }
    }

    // 기존 사용자 데이터가 소스 ID 없이 남아있는 경우를 위해,
    // displayOrder가 유일하면 동일 문제로 간주하여 링크 복구한다.
    if (!targetQuestion) {
      const candidates = (unlinkedByDisplayOrder.get(dq.displayOrder) ?? []).filter(
        (q) => !consumedUnlinkedQuestionIds.has(q.id)
      );
      if (candidates.length === 1) {
        targetQuestion = candidates[0];
        consumedUnlinkedQuestionIds.add(candidates[0].id);
      }
    }

    const syncedData = {
      question: dq.question,
      answer: dq.answer,
      difficulty: dq.difficulty ?? "medium",
      imageUrl: dq.imageUrl ?? null,
      imageLabels: dq.imageLabels ?? null,
      autoNumbering: dq.autoNumbering,
      tableData: dq.tableData ?? null,
      displayOrder: dq.displayOrder,
      isDemo: 0,
      isStarred: dq.isStarred ?? 0,
      useAIGrading: dq.useAIGrading ?? 0,
      demoSourceQuestionId: dq.id,
    } as const;

    if (!targetQuestion) {
      await db.createQuestion({
        subjectId: userSubjectId,
        userId,
        ...syncedData,
      });
      continue;
    }

    await db.updateQuestion(targetQuestion.id, syncedData);
  }

  const activeDemoQuestionIds = new Set(demoQuestions.map((q) => q.id));
  for (const question of userQuestions) {
    if (!(typeof question.demoSourceQuestionId === "number" && question.demoSourceQuestionId > 0)) continue;
    if (activeDemoQuestionIds.has(question.demoSourceQuestionId)) continue;

    const hasMemo = Boolean(question.memo && question.memo.trim().length > 0);
    const hasHistory = await hasLearningHistory(question.id);
    if (hasMemo || hasHistory) {
      await db.updateQuestion(question.id, { demoSourceQuestionId: null });
      continue;
    }

    await db.deleteQuestion(question.id);
  }
}

async function cleanupStaleDemoLinkedSubjects(userId: number, activeDemoSubjectIds: Set<number>) {
  const userSubjects = await db.getSubjectsByUserId(userId);
  for (const subject of userSubjects) {
    if (!(typeof subject.demoSourceSubjectId === "number" && subject.demoSourceSubjectId > 0)) continue;
    if (activeDemoSubjectIds.has(subject.demoSourceSubjectId)) continue;

    const subjectQuestions = await db.getQuestionsBySubjectId(subject.id);

    for (const question of subjectQuestions) {
      if (!(typeof question.demoSourceQuestionId === "number" && question.demoSourceQuestionId > 0)) continue;

      const hasMemo = Boolean(question.memo && question.memo.trim().length > 0);
      const [practiceSessions, testSessions] = await Promise.all([
        db.getPracticeSessionsByQuestionId(question.id),
        db.getTestSessionsByQuestionId(question.id),
      ]);
      const hasHistory = practiceSessions.length > 0 || testSessions.length > 0;

      if (hasMemo || hasHistory) {
        await db.updateQuestion(question.id, { demoSourceQuestionId: null });
        continue;
      }

      await db.deleteQuestion(question.id);
    }

    const remainingQuestions = await db.getQuestionsBySubjectId(subject.id);
    if (remainingQuestions.length === 0) {
      await db.deleteSubject(subject.id);
      continue;
    }

    await db.updateSubject(subject.id, { demoSourceSubjectId: null });
  }
}

async function ensureStarterDataForUser(userId: number) {
  await ensureCriticalToothDemoQuestionExists();
  const demoSubjects = await db.getDemoSubjects();
  const toothDemoSubject = demoSubjects.find((subject) => subject.name === TOOTH_MORPHOLOGY_SUBJECT_NAME);
  if (toothDemoSubject) {
    await db.normalizeQuestionDisplayOrderForSubject(toothDemoSubject.id);
  }
  const activeDemoSubjectIds = new Set(demoSubjects.map((subject) => subject.id));
  if (demoSubjects.length === 0) {
    await cleanupStaleDemoLinkedSubjects(userId, activeDemoSubjectIds);
    console.warn("[StarterData] No demo subjects configured. Skipping starter copy.");
    return;
  }

  const userSubjects = await db.getSubjectsByUserId(userId);
  const userSubjectByName = new Map(userSubjects.map((s) => [s.name, s] as const));
  const userSubjectByDemoSourceId = new Map(
    userSubjects
      .filter((s) => typeof s.demoSourceSubjectId === "number" && s.demoSourceSubjectId > 0)
      .map((s) => [s.demoSourceSubjectId as number, s] as const)
  );

  for (const demoSubject of demoSubjects) {
    const demoQuestions = await db.getDemoQuestions(demoSubject.id);
    if (demoQuestions.length === 0) continue;

    const starterExamDate = getStarterExamDateForSubject(demoSubject);
    let targetSubject =
      userSubjectByDemoSourceId.get(demoSubject.id) ??
      userSubjectByName.get(demoSubject.name);

    if (!targetSubject) {
      targetSubject = await db.createSubject({
        userId,
        demoSourceSubjectId: demoSubject.id,
        name: demoSubject.name,
        description: demoSubject.description ?? undefined,
        color: demoSubject.color ?? "#3B82F6",
        isDemo: 0,
        displayOrder: demoSubject.displayOrder,
        examEndDate: starterExamDate ?? undefined,
      });
    } else {
      await db.updateSubject(targetSubject.id, {
        demoSourceSubjectId: demoSubject.id,
        name: demoSubject.name,
        description: demoSubject.description ?? null,
        color: demoSubject.color ?? "#3B82F6",
        displayOrder: demoSubject.displayOrder,
        examEndDate: starterExamDate ?? null,
        isDemo: 0,
      });

      const refreshed = await db.getSubjectById(targetSubject.id);
      if (refreshed) {
        targetSubject = refreshed;
      }
    }

    await syncDemoQuestionsToSubject(userId, targetSubject.id, demoQuestions);
    if (demoSubject.name === TOOTH_MORPHOLOGY_SUBJECT_NAME) {
      await db.normalizeQuestionDisplayOrderForSubject(targetSubject.id);
    }
  }

  await cleanupStaleDemoLinkedSubjects(userId, activeDemoSubjectIds);
}

async function syncStarterDataSafely(userId: number) {
  try {
    await ensureStarterDataForUser(userId);
  } catch (error) {
    console.error("[StarterData] Failed to sync demo starter data:", error);
  }
}

const starterSyncInFlightByUser = new Map<number, Promise<void>>();
const starterSyncLastRunAtByUser = new Map<number, number>();
const STARTER_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;

function triggerStarterSyncInBackground(userId: number, options?: { force?: boolean }) {
  if (!options?.force) {
    const lastRunAt = starterSyncLastRunAtByUser.get(userId) ?? 0;
    if (Date.now() - lastRunAt < STARTER_SYNC_MIN_INTERVAL_MS) return;
  }
  if (starterSyncInFlightByUser.has(userId)) return;

  const task = (async () => {
    await syncStarterDataSafely(userId);
    starterSyncLastRunAtByUser.set(userId, Date.now());
  })();

  starterSyncInFlightByUser.set(userId, task);
  void task.finally(() => {
    starterSyncInFlightByUser.delete(userId);
  });
}

function makePracticeSignature(s: {
  questionId: number;
  completedAt: Date;
  duration: number;
  typingSpeed: number;
  accuracy: number;
  errorCount: number;
}) {
  return [
    s.questionId,
    new Date(s.completedAt).toISOString(),
    s.duration,
    s.typingSpeed,
    s.accuracy,
    s.errorCount,
  ].join("||");
}

function makeTestSignature(s: {
  questionId: number;
  completedAt: Date;
  userAnswer: string;
  isCorrect: number;
  similarityScore: number | null;
  recallTime: number;
}) {
  return [
    s.questionId,
    new Date(s.completedAt).toISOString(),
    s.userAnswer,
    s.isCorrect,
    s.similarityScore ?? "",
    s.recallTime,
  ].join("||");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pearsonCorrelation(pairs: Array<{ x: number; y: number }>): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX <= 0 || denomY <= 0) return null;
  return clampNumber(numerator / Math.sqrt(denomX * denomY), -1, 1);
}

function computeStd(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function buildUserAdaptiveProfile(
  allPractice: Array<{ questionId: number; completedAt: Date | string }>,
  allTests: Array<{ questionId: number; completedAt: Date | string; isCorrect: number; similarityScore: number | null }>
) {
  if (allPractice.length === 0 && allTests.length === 0) {
    return {
      practiceEffectiveness: 1,
      testReliability: 1,
      recoveryPower: 1,
      pacingDiscipline: 1,
    };
  }

  // 1) 연습 효과성: 연습량이 높은 문제일수록 최근 시험 품질이 높았는지
  const practiceCountByQuestion = new Map<number, number>();
  for (const p of allPractice) {
    practiceCountByQuestion.set(p.questionId, (practiceCountByQuestion.get(p.questionId) ?? 0) + 1);
  }

  const latestTestByQuestion = new Map<number, { at: number; similarity: number }>();
  for (const t of allTests) {
    const at = new Date(t.completedAt).getTime();
    const prev = latestTestByQuestion.get(t.questionId);
    if (!prev || at > prev.at) {
      latestTestByQuestion.set(t.questionId, {
        at,
        similarity: clampNumber(Math.round(t.similarityScore ?? 0), 0, 100),
      });
    }
  }

  const transferPairs: Array<{ x: number; y: number }> = [];
  for (const [questionId, latest] of Array.from(latestTestByQuestion.entries())) {
    transferPairs.push({
      x: practiceCountByQuestion.get(questionId) ?? 0,
      y: latest.similarity,
    });
  }
  const transferCorr = pearsonCorrelation(transferPairs);
  const practiceEffectiveness = transferCorr === null
    ? 1
    : clampNumber(1 + transferCorr * 0.18, 0.8, 1.2);

  // 2) 시험 신뢰도: 최근 시험 유사도의 변동성이 낮을수록 신뢰도 상승
  const recentSims = [...allTests]
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 80)
    .map((t) => clampNumber(Math.round(t.similarityScore ?? 0), 0, 100));
  const simStd = computeStd(recentSims);
  const consistencyRaw = clampNumber(1.15 - simStd / 50, 0.85, 1.15);
  const consistencyWeight = clampNumber(recentSims.length / 24, 0, 1);
  const testReliability = 1 + (consistencyRaw - 1) * consistencyWeight;

  // 3) 회복력: 오답 후 다음 시도에서 회복하는 비율
  const testsByQuestion = new Map<number, Array<{ at: number; isCorrect: boolean; sim: number }>>();
  for (const t of allTests) {
    const arr = testsByQuestion.get(t.questionId) ?? [];
    arr.push({
      at: new Date(t.completedAt).getTime(),
      isCorrect: t.isCorrect === 1,
      sim: clampNumber(Math.round(t.similarityScore ?? 0), 0, 100),
    });
    testsByQuestion.set(t.questionId, arr);
  }

  let recoveryTrials = 0;
  let recoverySuccess = 0;
  for (const arr of Array.from(testsByQuestion.values())) {
    arr.sort((a, b) => a.at - b.at);
    for (let i = 0; i < arr.length - 1; i++) {
      const cur = arr[i];
      const next = arr[i + 1];
      if (cur.isCorrect) continue;
      const gapHours = (next.at - cur.at) / (1000 * 60 * 60);
      if (gapHours > 72) continue;
      recoveryTrials += 1;
      if (next.isCorrect || next.sim >= cur.sim + 12) recoverySuccess += 1;
    }
  }
  const recoveryRate = recoveryTrials > 0 ? recoverySuccess / recoveryTrials : 0.5;
  const recoveryWeight = clampNumber(recoveryTrials / 12, 0, 1);
  const recoveryPower = 1 + (recoveryRate - 0.5) * 0.3 * recoveryWeight;

  // 4) 페이싱: 세션 간격이 너무 촘촘/너무 긴 경우 감점
  const allSessionTimes = [
    ...allPractice.map((p) => new Date(p.completedAt).getTime()),
    ...allTests.map((t) => new Date(t.completedAt).getTime()),
  ].sort((a, b) => a - b);
  const gapsHours: number[] = [];
  for (let i = 1; i < allSessionTimes.length; i++) {
    gapsHours.push((allSessionTimes[i] - allSessionTimes[i - 1]) / (1000 * 60 * 60));
  }
  const medianGap = gapsHours.length === 0
    ? Number.NaN
    : gapsHours[Math.floor(gapsHours.length / 2)];
  let pacingBase = 1;
  if (Number.isFinite(medianGap)) {
    if (medianGap < 0.2) pacingBase = 0.9;
    else if (medianGap < 1) pacingBase = 0.97;
    else if (medianGap < 12) pacingBase = 1.12;
    else if (medianGap < 24) pacingBase = 1.03;
    else if (medianGap < 48) pacingBase = 0.95;
    else pacingBase = 0.88;
  }
  const pacingWeight = clampNumber(gapsHours.length / 20, 0, 1);
  const pacingDiscipline = 1 + (pacingBase - 1) * pacingWeight;

  return {
    practiceEffectiveness: clampNumber(practiceEffectiveness, 0.8, 1.2),
    testReliability: clampNumber(testReliability, 0.85, 1.15),
    recoveryPower: clampNumber(recoveryPower, 0.85, 1.15),
    pacingDiscipline: clampNumber(pacingDiscipline, 0.85, 1.15),
  };
}

async function mergeGuestDataToUser(sourceUserId: number, targetUserId: number) {
  if (sourceUserId === targetUserId) return;

  const sourceSubjects = await db.getSubjectsByUserId(sourceUserId);
  if (sourceSubjects.length === 0) return;

  const targetSubjects = await db.getSubjectsByUserId(targetUserId);
  const targetSubjectByName = new Map<string, (typeof targetSubjects)[number]>();
  for (const s of targetSubjects) {
    if (!targetSubjectByName.has(s.name)) targetSubjectByName.set(s.name, s);
  }

  const questionIdMap = new Map<number, number>();

  for (const sourceSubject of sourceSubjects) {
    let targetSubject = targetSubjectByName.get(sourceSubject.name);
    if (!targetSubject) {
      targetSubject = await db.createSubject({
        userId: targetUserId,
        name: sourceSubject.name,
        description: sourceSubject.description ?? undefined,
        color: sourceSubject.color ?? "#3B82F6",
        displayOrder: sourceSubject.displayOrder ?? 0,
        isDemo: 0,
        examEndDate: sourceSubject.examEndDate ?? undefined,
      });
      targetSubjectByName.set(targetSubject.name, targetSubject);
    }

    const sourceQuestions = await db.getQuestionsBySubjectId(sourceSubject.id);
    const targetQuestions = await db.getQuestionsBySubjectId(targetSubject.id);
    const targetQuestionBySignature = new Map(
      targetQuestions.map((q) => [makeQuestionSignature(q), q] as const)
    );

    for (const sourceQuestion of sourceQuestions) {
      const signature = makeQuestionSignature(sourceQuestion);
      let targetQuestion = targetQuestionBySignature.get(signature);

      if (!targetQuestion) {
        targetQuestion = await db.createQuestion({
          subjectId: targetSubject.id,
          userId: targetUserId,
          question: sourceQuestion.question,
          answer: sourceQuestion.answer,
          difficulty: sourceQuestion.difficulty ?? "medium",
          imageUrl: sourceQuestion.imageUrl ?? undefined,
          imageLabels: sourceQuestion.imageLabels ?? undefined,
          autoNumbering: sourceQuestion.autoNumbering,
          tableData: sourceQuestion.tableData ?? undefined,
          displayOrder: sourceQuestion.displayOrder,
          isDemo: 0,
          isStarred: sourceQuestion.isStarred ?? 0,
          useAIGrading: sourceQuestion.useAIGrading ?? 0,
          memo: sourceQuestion.memo ?? undefined,
        });
        targetQuestionBySignature.set(signature, targetQuestion);
      }

      questionIdMap.set(sourceQuestion.id, targetQuestion.id);
    }
  }

  const sourcePracticeSessions = await db.getPracticeSessionsByUserId(sourceUserId);
  const targetPracticeSessions = await db.getPracticeSessionsByUserId(targetUserId);
  const targetPracticeSignatures = new Set(
    targetPracticeSessions.map((s) => makePracticeSignature({
      questionId: s.questionId,
      completedAt: new Date(s.completedAt),
      duration: s.duration,
      typingSpeed: s.typingSpeed,
      accuracy: s.accuracy,
      errorCount: s.errorCount,
    }))
  );

  for (const session of sourcePracticeSessions) {
    const mappedQuestionId = questionIdMap.get(session.questionId);
    if (!mappedQuestionId) continue;

    const signature = makePracticeSignature({
      questionId: mappedQuestionId,
      completedAt: new Date(session.completedAt),
      duration: session.duration,
      typingSpeed: session.typingSpeed,
      accuracy: session.accuracy,
      errorCount: session.errorCount,
    });
    if (targetPracticeSignatures.has(signature)) continue;

    await db.createPracticeSession({
      questionId: mappedQuestionId,
      userId: targetUserId,
      duration: session.duration,
      typingSpeed: session.typingSpeed,
      accuracy: session.accuracy,
      errorCount: session.errorCount,
      completedAt: new Date(session.completedAt),
    });
    targetPracticeSignatures.add(signature);
  }

  const sourceTestSessions = await db.getTestSessionsByUserId(sourceUserId);
  const targetTestSessions = await db.getTestSessionsByUserId(targetUserId);
  const targetTestSignatures = new Set(
    targetTestSessions.map((s) => makeTestSignature({
      questionId: s.questionId,
      completedAt: new Date(s.completedAt),
      userAnswer: s.userAnswer,
      isCorrect: s.isCorrect,
      similarityScore: s.similarityScore ?? null,
      recallTime: s.recallTime,
    }))
  );

  for (const session of sourceTestSessions) {
    const mappedQuestionId = questionIdMap.get(session.questionId);
    if (!mappedQuestionId) continue;

    const signature = makeTestSignature({
      questionId: mappedQuestionId,
      completedAt: new Date(session.completedAt),
      userAnswer: session.userAnswer,
      isCorrect: session.isCorrect,
      similarityScore: session.similarityScore ?? null,
      recallTime: session.recallTime,
    });
    if (targetTestSignatures.has(signature)) continue;

    await db.createTestSession({
      questionId: mappedQuestionId,
      userId: targetUserId,
      userAnswer: session.userAnswer,
      isCorrect: session.isCorrect,
      similarityScore: session.similarityScore ?? undefined,
      recallTime: session.recallTime,
      mistakeHighlights: session.mistakeHighlights ?? undefined,
      llmFeedback: session.llmFeedback ?? undefined,
      completedAt: new Date(session.completedAt),
    });
    targetTestSignatures.add(signature);
  }

  const sourceSchedules = await db.getReviewSchedulesByUserId(sourceUserId);
  for (const schedule of sourceSchedules) {
    const mappedQuestionId = questionIdMap.get(schedule.questionId);
    if (!mappedQuestionId) continue;

    const existing = await db.getReviewScheduleByQuestionId(mappedQuestionId, targetUserId);
    if (!existing) {
      await db.createReviewSchedule({
        questionId: mappedQuestionId,
        userId: targetUserId,
        nextReviewDate: schedule.nextReviewDate,
        repetitionCount: schedule.repetitionCount,
        easeFactor: schedule.easeFactor,
        interval: schedule.interval,
        lastReviewedAt: schedule.lastReviewedAt ?? undefined,
      });
      continue;
    }

    const shouldUpdate = new Date(existing.nextReviewDate).getTime() < new Date(schedule.nextReviewDate).getTime();
    if (shouldUpdate) {
      await db.updateReviewSchedule(existing.id, {
        nextReviewDate: schedule.nextReviewDate,
        repetitionCount: Math.max(existing.repetitionCount, schedule.repetitionCount),
        easeFactor: Math.max(existing.easeFactor, schedule.easeFactor),
        interval: Math.max(existing.interval, schedule.interval),
        lastReviewedAt: schedule.lastReviewedAt ?? existing.lastReviewedAt ?? undefined,
      });
    }
  }
}

function ensureOCREnabled() {
  if (!ocrModule.isOCREnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "OCR is temporarily disabled.",
    });
  }
}

function guessMimeTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function normalizeOcrMimeType(fileName: string, mimeType?: string): string {
  const normalized = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (normalized) return normalized;
  return guessMimeTypeFromFileName(fileName);
}

function isSyncImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/tiff" && mimeType !== "image/tif";
}

function isAsyncDocumentMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType === "image/tiff" || mimeType === "image/tif";
}

async function buildPdfSubset(
  fileBuffer: Uint8Array,
  selectedPages: number[]
): Promise<Uint8Array> {
  const sourcePdf = await PDFDocument.load(fileBuffer);
  const pageCount = sourcePdf.getPageCount();

  const normalizedPages = Array.from(
    new Set(
      selectedPages
        .map((page) => Math.trunc(page))
        .filter((page) => Number.isFinite(page) && page >= 1 && page <= pageCount)
    )
  ).sort((a, b) => a - b);

  if (normalizedPages.length === 0 || normalizedPages.length === pageCount) {
    return fileBuffer;
  }

  const targetPdf = await PDFDocument.create();
  const copiedPages = await targetPdf.copyPages(
    sourcePdf,
    normalizedPages.map((pageNumber) => pageNumber - 1)
  );
  copiedPages.forEach((page) => targetPdf.addPage(page));
  return await targetPdf.save();
}

type PublicUser = Omit<User, "passwordHash" | "openId">;

function sanitizeUserForClient(user: User | null | undefined): PublicUser | null {
  if (!user) return null;
  // Never expose credential hash or raw provider-linked openId to client payloads.
  const { passwordHash: _passwordHash, openId: _openId, ...safeUser } = user;
  return safeUser;
}

async function assertSubjectOwnershipOrThrow(subjectId: number, userId: number) {
  const subject = await db.getSubjectById(subjectId);
  if (!subject) {
    throw new TRPCError({ code: "NOT_FOUND", message: "과목을 찾을 수 없습니다" });
  }
  if (subject.isDemo) {
    throw new TRPCError({ code: "FORBIDDEN", message: "데모 과목은 수정할 수 없습니다" });
  }
  if (subject.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "본인 과목만 접근할 수 있습니다" });
  }
  return subject;
}

async function assertQuestionOwnershipOrThrow(questionId: number, userId: number) {
  const question = await db.getQuestionById(questionId);
  if (!question) {
    throw new TRPCError({ code: "NOT_FOUND", message: "문제를 찾을 수 없습니다" });
  }
  if (question.isDemo) {
    throw new TRPCError({ code: "FORBIDDEN", message: "데모 문제는 수정할 수 없습니다" });
  }
  if (question.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 접근할 수 있습니다" });
  }
  return question;
}

type CookieCapableResponse = {
  cookie: (name: string, value: string, options?: Record<string, unknown>) => void;
  clearCookie: (name: string, options?: Record<string, unknown>) => void;
};

function cookieResponse(res: unknown): CookieCapableResponse {
  return res as CookieCapableResponse;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      const user = opts.ctx.user;
      return sanitizeUserForClient(user);
    }),
    verifySitePassword: publicProcedure
      .input(z.object({ password: z.string() }))
      .mutation(({ input }) => {
        const expected = ENV.siteGatePassword;
        if (!expected) {
          // If no gate password is configured in env, do not block access.
          return { success: true };
        }
        if (input.password !== expected) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "비밀번호가 올바르지 않습니다",
          });
        }
        return { success: true };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      cookieResponse(ctx.res).clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    // 간편 가입: 접속 비밀번호 확인 후 개인 아이디/비밀번호로 계정 생성
    simpleSignup: publicProcedure
      .input(z.object({
        accessPassword: z.string().optional(),
        username: z.string().min(2).max(20),
        password: z.string().min(4),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ENV.signupAccessPassword) {
          const provided = input.accessPassword ?? "";
          if (provided !== ENV.signupAccessPassword) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "접속 비밀번호가 일치하지 않습니다",
            });
          }
        }

        // 아이디 중복 확인
        const existing = await db.getUserByUsername(input.username);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "이미 사용 중인 아이디입니다",
          });
        }

        // 비밀번호 해시
        const bcrypt = await import("bcryptjs");
        const passwordHash = await bcrypt.hash(input.password, 10);

        // 고유한 openId 생성 (간편 가입용)
        const simpleOpenId = `simple_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        // 사용자 생성
        await db.upsertUser({
          openId: simpleOpenId,
          name: input.username,
          email: null,
          loginMethod: "simple",
          lastSignedIn: new Date(),
        });

        // 사용자 조회
        const user = await db.getUserByOpenId(simpleOpenId);
        if (!user) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "사용자 생성 실패",
          });
        }

        // 아이디/비밀번호 저장
        await db.setUserCredentials(user.id, input.username, passwordHash);

        // 게스트에서 바로 가입한 경우, 학습 이력을 신규 계정으로 병합해 통계 유실을 방지한다.
        if (ctx.user?.loginMethod === "guest" && ctx.user.id !== user.id) {
          await mergeGuestDataToUser(ctx.user.id, user.id);
        }

        // 신규 사용자 초기 학습 데이터 보장
        await syncStarterDataSafely(user.id);

        // 세션 토큰 생성
        const sessionToken = await sdk.createSessionToken(simpleOpenId, {
          name: user.name || input.username,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        cookieResponse(ctx.res).cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { success: true, userId: user.id };
      }),

    // 간편 로그인: 개인 아이디/비밀번호로 재로그인
    simpleLogin: publicProcedure
      .input(z.object({
        identifier: z.string().optional(),
        username: z.string().optional(), // 하위 호환성 유지
        password: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const loginIdentifier = (input.identifier ?? input.username ?? "").trim();
        if (!loginIdentifier) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "아이디 또는 이메일을 입력해주세요",
          });
        }

        const isEmailIdentifier = loginIdentifier.includes("@");
        const normalizedIdentifier = loginIdentifier.toLowerCase();
        let user = await db.getUserByLoginIdentifier(loginIdentifier);

        // 이메일 로그인 도입 이전 계정 호환: owner 이메일로 로그인 시 username(local-part) 계정도 허용
        if (!user && isEmailIdentifier) {
          const localPart = loginIdentifier.split("@")[0];
          if (localPart) {
            user = await db.getUserByUsername(localPart);
          }
        }

        if (!user || !user.passwordHash) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "아이디 또는 비밀번호가 일치하지 않습니다",
          });
        }

        const bcrypt = await import("bcryptjs");
        const isValid = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "아이디 또는 비밀번호가 일치하지 않습니다",
          });
        }

        const ownerEmail = ENV.ownerEmail.toLowerCase();
        const isOwnerEmailLogin = normalizedIdentifier === ownerEmail;
        const isOwnerAccountByEmail =
          Boolean(user.email) && String(user.email).toLowerCase() === ownerEmail;

        if (isOwnerEmailLogin || isOwnerAccountByEmail) {
          const nextEmail = user.email ?? (isEmailIdentifier ? loginIdentifier : ENV.ownerEmail);
          if (user.role !== "admin" || user.email !== nextEmail) {
            await db.updateUserEmailAndRole(user.id, nextEmail, "admin");
            user = { ...user, email: nextEmail, role: "admin" };
          }
        } else {
          await db.updateUserEmailAndRole(user.id, user.email ?? null);
        }

        // 게스트 진행 데이터가 있으면 로그인 계정으로 병합
        if (ctx.user?.loginMethod === "guest" && ctx.user.id !== user.id) {
          await mergeGuestDataToUser(ctx.user.id, user.id);
        }

        // 로그인 사용자도 과목 0개 상태면 데모 기반 스타터 데이터 자동 복구
        await syncStarterDataSafely(user.id);

        // 세션 토큰 생성
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || loginIdentifier,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        cookieResponse(ctx.res).cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { success: true, userId: user.id };
      }),

    googleLoginWithCode: publicProcedure
      .input(
        z.object({
          code: z.string().min(8),
          redirectUri: z.string().url().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!ENV.googleClientId || !ENV.googleClientSecret) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Google OAuth 설정이 누락되었습니다. GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET을 확인해주세요.",
          });
        }

        const redirectUri = input.redirectUri?.trim() || resolveGoogleRedirectUri(ctx.req as any);
        const tokenResponse = await exchangeGoogleCodeForTokens({
          code: input.code,
          redirectUri,
        });

        const idToken = tokenResponse.id_token;
        if (!idToken) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google ID 토큰이 응답에 없습니다.",
          });
        }

        const tokenInfo = await getGoogleTokenInfo(idToken);
        if (tokenInfo.aud !== ENV.googleClientId) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google 토큰의 aud가 앱 설정과 일치하지 않습니다.",
          });
        }
        if (tokenInfo.email && tokenInfo.email_verified !== "true") {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google 이메일 검증이 완료되지 않은 계정입니다.",
          });
        }

        const sub = tokenInfo.sub;
        if (!sub) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google 사용자 식별자(sub)를 확인할 수 없습니다.",
          });
        }

        const jwtPayload = decodeJwtPayload(idToken) ?? {};
        const preferredName =
          (typeof tokenInfo.name === "string" && tokenInfo.name.trim()) ||
          (typeof jwtPayload.name === "string" && jwtPayload.name.trim()) ||
          (typeof tokenInfo.email === "string" && tokenInfo.email.split("@")[0]) ||
          "Google 사용자";
        const preferredEmail =
          typeof tokenInfo.email === "string" && tokenInfo.email.length > 0
            ? tokenInfo.email
            : typeof jwtPayload.email === "string" && jwtPayload.email.length > 0
              ? jwtPayload.email
              : null;

        const openId = `google_${sub}`;
        let user = null as Awaited<ReturnType<typeof db.getUserByOpenId>> | null;

        // 동일 이메일의 기존 계정이 있으면 해당 계정을 우선 사용해 통계/데이터 분리를 방지한다.
        const existingByEmail = preferredEmail ? await db.getUserByEmail(preferredEmail) : undefined;
        if (existingByEmail) {
          await db.upsertUser({
            openId: existingByEmail.openId,
            name: preferredName || existingByEmail.name || "Google 사용자",
            email: preferredEmail,
            loginMethod: "google",
            role: existingByEmail.role,
            lastSignedIn: new Date(),
          });
          user = await db.getUserByOpenId(existingByEmail.openId);
        } else {
          await db.upsertUser({
            openId,
            name: preferredName || "Google 사용자",
            email: preferredEmail,
            loginMethod: "google",
            lastSignedIn: new Date(),
          });
          user = await db.getUserByOpenId(openId);
        }
        if (!user) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Google 사용자 저장에 실패했습니다.",
          });
        }

        const ownerEmail = ENV.ownerEmail.trim().toLowerCase();
        const normalizedKnownEmail = String(preferredEmail ?? user.email ?? "").toLowerCase();
        const shouldBeAdmin = Boolean(ownerEmail) && normalizedKnownEmail === ownerEmail;
        if (shouldBeAdmin) {
          const nextEmail = preferredEmail ?? user.email ?? ENV.ownerEmail;
          if (user.role !== "admin" || user.email !== nextEmail) {
            await db.updateUserEmailAndRole(user.id, nextEmail, "admin");
            user = { ...user, email: nextEmail, role: "admin" };
          }
        }

        if (ctx.user?.loginMethod === "guest" && ctx.user.id !== user.id) {
          await mergeGuestDataToUser(ctx.user.id, user.id);
        }

        await syncStarterDataSafely(user.id);

        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: preferredName || user.name || "Google 사용자",
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        cookieResponse(ctx.res).cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { success: true, userId: user.id, provider: "google" as const };
      }),

    // 소셜 로그인(내부 제공) - 보안상 비활성화(실제 OAuth 연동 시 재오픈)
    socialLogin: publicProcedure
      .input(
        z.object({
          provider: z.enum(["google", "apple", "kakao", "naver"]),
          socialId: z.string().min(6).max(128),
        })
      )
      .mutation(async ({ input }) => {
        const providerLabel =
          input.provider === "apple"
            ? "Apple"
            : input.provider === "kakao"
              ? "Kakao"
              : input.provider === "naver"
                ? "Naver"
                : "Google";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${providerLabel} 로그인은 아직 실제 OAuth 연동 전입니다.`,
        });
      }),

    // 자동 게스트 로그인: 접속 비밀번호 통과 후 자동으로 게스트 계정 생성/로그인
    autoGuestLogin: publicProcedure
      .input(z.object({
        guestId: z.string(), // 클라이언트에서 생성한 고유 게스트 ID (localStorage에 저장)
      }))
      .mutation(async ({ input, ctx }) => {
        // 이미 정식 로그인된 사용자(simple, oauth 등)가 있으면 게스트 세션으로 덮어쓰지 않음
        if (ctx.user && ctx.user.loginMethod !== "guest") {
          return { success: true, userId: ctx.user.id, isNewGuest: false, skipped: true };
        }
        const guestOpenId = `guest_${input.guestId}`;
        let isNewGuest = false;

        // 기존 게스트 계정 조회
        let user = await db.getUserByOpenId(guestOpenId);

        if (!user) {
          isNewGuest = true;
          // 새 게스트 계정 생성
          await db.upsertUser({
            openId: guestOpenId,
            name: `게스트_${input.guestId.substring(0, 6)}`,
            email: null,
            loginMethod: "guest",
            lastSignedIn: new Date(),
          });
          user = await db.getUserByOpenId(guestOpenId);
          if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "게스트 계정 생성 실패" });
        }

        // Do not block initial app boot on starter-data sync.
        // Subject list endpoint performs safe sync when needed.

        // 세션 토큰 생성
        const sessionToken = await sdk.createSessionToken(guestOpenId, {
          name: user.name || `게스트`,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        cookieResponse(ctx.res).cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { success: true, userId: user.id, isNewGuest };
      }),
  }),

  // Demo mode - public access
  demo: router({
    subjects: publicProcedure.query(async () => {
      const demoSubjects = await db.getDemoSubjects();
      return demoSubjects;
    }),
    
    questions: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        const subject = await db.getSubjectById(input.subjectId);
        if (!subject || subject.isDemo !== 1) {
          return [];
        }
        const rawQuestions = await db.getDemoQuestions(input.subjectId);
        return selectPublicDemoShowcaseQuestions(subject, rawQuestions);
      }),

    confidenceByQuestion: publicProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.isDemo !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "데모 문제를 찾을 수 없습니다" });
        }
        const subject = question.subjectId ? await db.getSubjectById(question.subjectId) : null;
        if (!isPublicDemoShowcaseQuestion(question, subject)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "선택한 데모 문제를 찾을 수 없습니다" });
        }
        const preview = buildDemoQuestionPreview(question, subject ?? null);
        return {
          ...preview,
          previewLabel: "예시 화면",
        };
      }),

    confidenceHistory: publicProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.isDemo !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "데모 문제를 찾을 수 없습니다" });
        }
        const subject = question.subjectId ? await db.getSubjectById(question.subjectId) : null;
        if (!isPublicDemoShowcaseQuestion(question, subject)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "선택한 데모 문제를 찾을 수 없습니다" });
        }
        const preview = buildDemoQuestionPreview(question, subject ?? null);
        return {
          points: preview.historyPoints,
          isExample: true,
          previewLabel: "예시 화면",
        };
      }),

    confidenceBySubject: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        const subject = await db.getSubjectById(input.subjectId);
        if (!subject || subject.isDemo !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "데모 과목을 찾을 수 없습니다" });
        }
        const rawQuestions = await db.getDemoQuestions(input.subjectId);
        const questions = selectPublicDemoShowcaseQuestions(subject, rawQuestions);
        const sortedQuestions = [...questions].sort(
          (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
        );

        const previewRows = sortedQuestions.map((question) => {
          const preview = buildDemoQuestionPreview(question, subject);
          return {
            questionId: question.id,
            displayScore: preview.displayScore,
            state: preview.state,
            label: preview.label,
            isColdStart: preview.isColdStart,
            displayOrder: question.displayOrder ?? 0,
            isStarred: question.isStarred ?? 0,
            badges: preview.badges,
          };
        });

        return {
          questions: previewRows,
          aggregate: aggregateDemoPreviewByQuestions(
            previewRows.map((row) => ({ displayScore: row.displayScore, state: row.state }))
          ),
          isExample: true,
          previewLabel: "예시 화면",
        };
      }),

    confidenceHistoryBySubject: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        const subject = await db.getSubjectById(input.subjectId);
        if (!subject || subject.isDemo !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "데모 과목을 찾을 수 없습니다" });
        }
        const rawQuestions = await db.getDemoQuestions(input.subjectId);
        const questions = selectPublicDemoShowcaseQuestions(subject, rawQuestions);
        const previews = questions.map((question) => buildDemoQuestionPreview(question, subject));
        return {
          points: buildDemoSubjectHistoryFromPreviews(previews),
          isExample: true,
          previewLabel: "예시 화면",
        };
      }),

    evaluate: publicProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        recallTime: z.number(),
      }))
      .mutation(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question) {
          throw new Error("문제를 찾을 수 없습니다");
        }
        const subject = question.subjectId ? await db.getSubjectById(question.subjectId) : null;
        if (!isPublicDemoShowcaseQuestion(question, subject)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "선택한 데모 문제를 찾을 수 없습니다" });
        }

        // 이미지 문제인 경우 imageLabels에서 정답 추출
        const isImageQuestion = question.imageUrl && question.imageLabels;
        let correctAnswer = question.answer || "";

        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            correctAnswer = imageLabels.map((label: any, index: number) =>
              `${index + 1}. ${label.answer}`
            ).join("\n");
          } catch (e) {
            console.error("Failed to parse imageLabels:", e);
          }
        }

        // 이미지 문제 라벨별 채점
        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            const userAnswerLines = input.userAnswer.split("\n");

            let correctCount = 0;
            const totalCount = imageLabels.length;
            const labelComparisons: any[] = [];

            for (let i = 0; i < totalCount; i++) {
              const correctAns = imageLabels[i]?.answer?.trim().toLowerCase() || "";
              const userAnswerLine = userAnswerLines[i] || "";
              const userAns = userAnswerLine.replace(/^\d+\.\s*/, "").trim().toLowerCase();
              const isLabelCorrect = userAns === correctAns;
              if (isLabelCorrect) correctCount++;

              labelComparisons.push({
                labelIndex: i + 1,
                correctAnswer: correctAns,
                userAnswer: userAns,
                isCorrect: isLabelCorrect
              });
            }

            const accuracyRate = Math.round((correctCount / totalCount) * 100);
            const isCorrect = accuracyRate === 100;

            return {
              isCorrect,
              similarityScore: accuracyRate,
              accuracyRate,
              mistakes: labelComparisons,
              feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctCount}/${totalCount} 정답`,
              missingKeywords: [],
            };
          } catch (e) {
            console.error("Failed to grade image question:", e);
          }
        }

        // 텍스트 문제: 줄 매칭 후 채점 (영어는 단어 단위)
        const ignoreAutoNumbering = question.autoNumbering === 1;
        return evaluateTextAnswerByBestLineMatch(input.userAnswer, correctAnswer, ignoreAutoNumbering);
      }),
  }),

  // Subject management
  subjects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      let currentSubjects = await db.getSubjectsByUserId(ctx.user.id);

      // 과목이 아직 없는 첫 진입 시에만 동기화를 기다려 초기 화면이 비지 않게 보장한다.
      if (currentSubjects.length === 0) {
        await syncStarterDataSafely(ctx.user.id);
        currentSubjects = await db.getSubjectsByUserId(ctx.user.id);
        return currentSubjects;
      }

      // 이후 조회는 즉시 응답하고, 스타터 데이터 동기화는 백그라운드로 돌린다.
      triggerStarterSyncInBackground(ctx.user.id);
      return currentSubjects;
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const subject = await db.getSubjectById(input.id);
        // Allow access to demo subjects without auth
        if (subject?.isDemo) return subject;
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        if (!subject || subject.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 과목만 조회할 수 있습니다" });
        }
        return subject;
      }),
    
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        color: z.string().optional(),
        examEndDate: z.string().optional(), // ISO date/time string
        displayOrder: z.number().optional(),
        isDemo: z.number().optional(), // 0 or 1
      }))
      .mutation(async ({ ctx, input }) => {
        const safeDemoValue = resolveRequestedDemoValue(input.isDemo, ctx.user.role);
        return db.createSubject({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          color: input.color,
          examEndDate: input.examEndDate ? parseExamEndDateInput(input.examEndDate) : undefined,
          displayOrder: input.displayOrder,
          isDemo: safeDemoValue ?? 0,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        color: z.string().optional(),
        examEndDate: z.string().nullable().optional(), // ISO date/time string or null to clear
        isDemo: z.number().optional(), // 0 or 1
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, examEndDate, ...data } = input;
        await assertSubjectOwnershipOrThrow(id, ctx.user.id);
        const updateData: any = { ...data };
        let nextDemoValue: number | undefined;
        if (updateData.isDemo === undefined) {
          delete updateData.isDemo;
        }
        if (examEndDate !== undefined) {
          updateData.examEndDate = examEndDate ? parseExamEndDateInput(examEndDate) : null;
        }
        if (input.isDemo !== undefined) {
          nextDemoValue = resolveRequestedDemoValue(input.isDemo, ctx.user.role) ?? 0;
          updateData.isDemo = nextDemoValue;
        }
        const updated = await db.updateSubject(id, updateData);
        if (nextDemoValue !== undefined) {
          await db.updateQuestionsIsDemoBySubjectId(id, nextDemoValue);
        }
        return updated;
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.id, ctx.user.id);
        return db.deleteSubject(input.id);
      }),
    
    updateOrder: protectedProcedure
      .input(z.object({
        subjectOrders: z.array(z.object({
          id: z.number(),
          displayOrder: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.updateSubjectOrder(ctx.user.id, input.subjectOrders);
      }),
  }),

  // Password-protected subject share (Quizlet-like set sharing)
  share: router({
    getMineBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const share = await db.getSubjectShareBySubjectIdOwner(input.subjectId, ctx.user.id);
        if (!share) return null;
        return {
          subjectId: share.subjectId,
          token: share.shareToken,
          isActive: share.isActive === 1,
          viewCount: share.viewCount ?? 0,
          lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
          sharePath: `/shared/${share.shareToken}`,
        };
      }),

    upsertBySubject: protectedProcedure
      .input(
        z.object({
          subjectId: z.number(),
          password: z.string().min(4).max(128),
        })
      )
      .mutation(async ({ ctx, input, }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const bcrypt = await import("bcryptjs");
        const passwordHash = await bcrypt.hash(input.password, 10);
        const nextToken = nanoid(24);

        const existing = await db.getSubjectShareBySubjectIdOwner(input.subjectId, ctx.user.id);
        const saved = existing
          ? await db.updateSubjectShare(existing.id, {
              shareToken: nextToken,
              passwordHash,
              isActive: 1,
            })
          : await db.createSubjectShare({
              subjectId: input.subjectId,
              ownerUserId: ctx.user.id,
              shareToken: nextToken,
              passwordHash,
              isActive: 1,
            });

        return {
          success: true,
          token: saved.shareToken,
          sharePath: `/shared/${saved.shareToken}`,
        };
      }),

    disableBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const existing = await db.getSubjectShareBySubjectIdOwner(input.subjectId, ctx.user.id);
        if (!existing) return { success: true };
        await db.updateSubjectShare(existing.id, { isActive: 0 });
        return { success: true };
      }),

    accessByToken: publicProcedure
      .input(
        z.object({
          token: z.string().min(8).max(80),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ input }) => {
        const share = await db.getSubjectShareByToken(input.token);
        if (!share || share.isActive !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "공유 링크를 찾을 수 없습니다." });
        }

        const bcrypt = await import("bcryptjs");
        const ok = await bcrypt.compare(input.password, share.passwordHash);
        if (!ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "비밀번호가 올바르지 않습니다." });
        }

        const subject = await db.getSubjectById(share.subjectId);
        if (!subject) {
          throw new TRPCError({ code: "NOT_FOUND", message: "공유 과목을 찾을 수 없습니다." });
        }
        const questions = await db.getQuestionsBySubjectId(subject.id);

        await db.markSubjectShareAccessed(share.id);

        return {
          subject: {
            id: subject.id,
            name: subject.name,
            description: subject.description,
            color: subject.color,
          },
          questions: questions.map((q) => ({
            id: q.id,
            question: q.question,
            answer: q.answer,
            imageUrl: q.imageUrl,
            imageLabels: q.imageLabels,
            tableData: q.tableData,
            autoNumbering: q.autoNumbering,
            displayOrder: q.displayOrder,
          })),
          disclaimer:
            "저작권이 있는 자료의 유출에는 본인 책임입니다. 공유받은 자료의 재배포/유출을 금지합니다.",
        };
      }),

    importByToken: protectedProcedure
      .input(
        z.object({
          token: z.string().min(8).max(80),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const share = await db.getSubjectShareByToken(input.token);
        if (!share || share.isActive !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "공유 링크를 찾을 수 없습니다." });
        }

        const bcrypt = await import("bcryptjs");
        const ok = await bcrypt.compare(input.password, share.passwordHash);
        if (!ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "비밀번호가 올바르지 않습니다." });
        }

        const sourceSubject = await db.getSubjectById(share.subjectId);
        if (!sourceSubject) {
          throw new TRPCError({ code: "NOT_FOUND", message: "공유 과목을 찾을 수 없습니다." });
        }
        const sourceQuestions = await db.getQuestionsBySubjectId(sourceSubject.id);

        const mySubjects = await db.getSubjectsByUserId(ctx.user.id);
        const normalizeName = (value: string) => value.trim().toLowerCase();
        const usedNames = new Set(mySubjects.map((subject) => normalizeName(subject.name)));
        const baseName = sourceSubject.name?.trim() || "공유 과목";
        let nextName = baseName;
        if (usedNames.has(normalizeName(nextName))) {
          let suffix = 1;
          while (true) {
            const candidate = `${baseName} (공유${suffix === 1 ? "" : ` ${suffix}`})`;
            if (!usedNames.has(normalizeName(candidate))) {
              nextName = candidate;
              break;
            }
            suffix += 1;
          }
        }
        const nextSubjectDisplayOrder =
          mySubjects.reduce((max, subject) => Math.max(max, subject.displayOrder ?? 0), 0) + 1;

        const createdSubject = await db.createSubject({
          userId: ctx.user.id,
          name: nextName,
          description: sourceSubject.description ?? "",
          color: sourceSubject.color ?? "#3B82F6",
          examEndDate: sourceSubject.examEndDate ?? undefined,
          displayOrder: nextSubjectDisplayOrder,
          isDemo: 0,
        });

        const orderedQuestions = [...sourceQuestions].sort(
          (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id - b.id
        );
        for (let i = 0; i < orderedQuestions.length; i++) {
          const sourceQuestion = orderedQuestions[i];
          await db.createQuestion({
            userId: ctx.user.id,
            subjectId: createdSubject.id,
            question: sourceQuestion.question,
            answer: sourceQuestion.answer ?? "",
            imageUrl: sourceQuestion.imageUrl ?? undefined,
            imageLabels: sourceQuestion.imageLabels ?? undefined,
            useAIGrading: sourceQuestion.useAIGrading ?? 0,
            autoNumbering: sourceQuestion.autoNumbering ?? 1,
            tableData: sourceQuestion.tableData ?? undefined,
            difficulty: sourceQuestion.difficulty ?? "medium",
            displayOrder: i + 1,
            isDemo: 0,
            isStarred: sourceQuestion.isStarred ?? 0,
            memo: sourceQuestion.memo ?? undefined,
          });
        }

        await db.markSubjectShareAccessed(share.id);

        return {
          success: true,
          subjectId: createdSubject.id,
          subjectName: createdSubject.name,
          questionCount: orderedQuestions.length,
        };
      }),
  }),

  // Question management
  questions: router({
    listBySubject: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input, ctx }) => {
        // Check if subject is demo - allow without auth
        const subject = await db.getSubjectById(input.subjectId);
        if (subject?.isDemo) {
          return db.getDemoQuestions(input.subjectId);
        }
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        if (!subject || subject.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 과목만 조회할 수 있습니다" });
        }
        return db.getQuestionsBySubjectId(input.subjectId);
      }),
    
    listAll: protectedProcedure.query(async ({ ctx }) => {
      return db.getQuestionsByUserId(ctx.user.id);
    }),
    
    count: protectedProcedure.query(async ({ ctx }) => {
      return db.countQuestionsByUserId(ctx.user.id);
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const question = await db.getQuestionById(input.id);
        // Allow access to demo questions without auth
        if (question?.isDemo) {
          return question;
        }
        // Require auth for non-demo questions
        if (!ctx.user) {
          throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        return question;
      }),
    
    create: protectedProcedure
      .input(z.object({
        subjectId: z.number(),
        question: z.string().min(1),
        answer: z.string().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        imageUrl: z.string().optional(),
        imageLabels: z.string().optional(),
        autoNumbering: z.number().optional(),
        tableData: z.string().optional(),
        isDemo: z.number().optional(), // 0 or 1
      }))
      .mutation(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const subject = await db.getSubjectById(input.subjectId);
        const defaultDemoBySubject = subject?.isDemo === 1 ? 1 : 0;
        const safeDemoValue =
          input.isDemo !== undefined
            ? resolveRequestedDemoValue(input.isDemo, ctx.user.role)
            : defaultDemoBySubject;
        return db.createQuestion({
          userId: ctx.user.id,
          subjectId: input.subjectId,
          question: input.question,
          answer: input.answer || "",
          difficulty: input.difficulty,
          imageUrl: input.imageUrl,
          imageLabels: input.imageLabels,
          autoNumbering: input.autoNumbering,
          tableData: input.tableData,
          isDemo: safeDemoValue ?? 0,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        question: z.string().min(1).optional(),
        answer: z.string().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        imageUrl: z.string().optional(),
        imageLabels: z.string().optional(),
        autoNumbering: z.number().optional(),
        tableData: z.string().optional(),
        isDemo: z.number().optional(), // 0 or 1
        isStarred: z.number().optional(), // 0 or 1
        memo: z.string().nullable().optional(), // 암기법/설명 메모
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const ownedQuestion = await assertQuestionOwnershipOrThrow(id, ctx.user.id);
        const parentSubject = await db.getSubjectById(ownedQuestion.subjectId);
        const defaultDemoBySubject = parentSubject?.isDemo === 1 ? 1 : 0;
        const updateData: any = { ...data };
        if (input.isDemo === undefined) {
          delete updateData.isDemo;
        } else {
          updateData.isDemo = resolveRequestedDemoValue(input.isDemo, ctx.user.role) ?? defaultDemoBySubject;
        }
        return db.updateQuestion(id, updateData);
      }),
    
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertQuestionOwnershipOrThrow(input.id, ctx.user.id);
        return db.deleteQuestion(input.id);
      }),
    
    updateOrder: protectedProcedure
      .input(z.object({
        questionOrders: z.array(z.object({
          id: z.number(),
          displayOrder: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.updateQuestionOrder(ctx.user.id, input.questionOrders);
      }),
    
    copy: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        targetSubjectId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await assertQuestionOwnershipOrThrow(input.questionId, ctx.user.id);
        await assertSubjectOwnershipOrThrow(input.targetSubjectId, ctx.user.id);
        return db.copyQuestion(ctx.user.id, input.questionId, input.targetSubjectId);
      }),
    
    move: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        targetSubjectId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        await assertQuestionOwnershipOrThrow(input.questionId, ctx.user.id);
        await assertSubjectOwnershipOrThrow(input.targetSubjectId, ctx.user.id);
        return db.moveQuestion(input.questionId, input.targetSubjectId);
      }),
    
    saveMemo: protectedProcedure
      .input(z.object({
        id: z.number(),
        memo: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.id);
        if (!question) throw new TRPCError({ code: 'NOT_FOUND' });
        if (question.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
        return db.updateQuestion(input.id, { memo: input.memo });
      }),

    toggleStar: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.id);
        if (!question) throw new TRPCError({ code: 'NOT_FOUND' });
        if (question.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
        return db.updateQuestion(input.id, { isStarred: question.isStarred ? 0 : 1 });
      }),
  }),

  // Practice session management
  practice: router({
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        return db.getPracticeSessionsByQuestionIdForUser(input.questionId, ctx.user.id);
      }),
    
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getPracticeSessionsByUserId(ctx.user.id);
    }),
    
    getBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getPracticeSessionsBySubjectId(ctx.user.id, input.subjectId);
      }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        duration: z.number(),
        typingSpeed: z.number(),
        accuracy: z.number(),
        errorCount: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 기록할 수 있습니다" });
        }
        return db.createPracticeSession({
          userId: ctx.user.id,
          questionId: input.questionId,
          duration: input.duration,
          typingSpeed: input.typingSpeed,
          accuracy: input.accuracy,
          errorCount: input.errorCount,
          completedAt: new Date(),
        });
      }),
    
    deleteAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        return db.deleteAllPracticeSessions(ctx.user.id);
      }),
    
    countByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        const sessions = await db.getPracticeSessionsByQuestionIdForUser(input.questionId, ctx.user.id);
        return { count: sessions.length };
      })
  }),

  // Voice transcription
  voice: router({
    transcribe: protectedProcedure
      .input(z.object({
        audioUrl: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const result = await transcribeAudio({
            audioUrl: input.audioUrl,
            language: "ko",
          });
          
          if ("error" in result) {
            throw new Error(result.error);
          }
          
          return { text: result.text };
        } catch (error) {
          console.error("Transcription error:", error);
          throw new Error("음성 변환에 실패했습니다");
        }
      }),
  }),

  // Test session management
  test: router({
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        return db.getTestSessionsByQuestionIdForUser(input.questionId, ctx.user.id);
      }),
    
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getTestSessionsByUserId(ctx.user.id);
    }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        isCorrect: z.number(),
        recallTime: z.number(),
        similarityScore: z.number().optional(),
        mistakeHighlights: z.string().optional(),
        llmFeedback: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 기록할 수 있습니다" });
        }
        return db.createTestSession({
          userId: ctx.user.id,
          questionId: input.questionId,
          userAnswer: input.userAnswer,
          isCorrect: input.isCorrect,
          recallTime: input.recallTime,
          similarityScore: input.similarityScore,
          mistakeHighlights: input.mistakeHighlights,
          llmFeedback: input.llmFeedback,
          completedAt: new Date(),
        });
      }),
    
    evaluate: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        userAnswer: z.string(),
        recallTime: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question) {
          throw new Error("문제를 찾을 수 없습니다");
        }

        // 이미지 문제인 경우 imageLabels에서 정답 추출
        const isImageQuestion = question.imageUrl && question.imageLabels;
        let correctAnswer = question.answer || "";
        
        if (isImageQuestion) {
          try {
            const imageLabels = JSON.parse(question.imageLabels || "[]");
            // 각 라벨의 정답을 합쳐서 정답 문자열 생성
            correctAnswer = imageLabels.map((label: any, index: number) => 
              `${index + 1}. ${label.answer}`
            ).join("\n");
            console.log("[DEBUG] Image question detected");
            console.log("[DEBUG] correctAnswer:", correctAnswer);
            console.log("[DEBUG] userAnswer:", input.userAnswer);
          } catch (e) {
            console.error("Failed to parse imageLabels:", e);
          }
        }
        
        console.log("[DEBUG] useAIGrading:", question.useAIGrading);

        // Check if AI grading is enabled for this question
        if (!question.useAIGrading) {
          // 이미지 문제인 경우 라벨별로 채점
          if (isImageQuestion) {
            try {
              const imageLabels = JSON.parse(question.imageLabels || "[]");
              const userAnswerLines = input.userAnswer.split("\n");
              
              let correctCount = 0;
              const totalCount = imageLabels.length;
              const labelComparisons: any[] = [];
              
              for (let i = 0; i < totalCount; i++) {
                const correctAnswer = imageLabels[i]?.answer?.trim().toLowerCase() || "";
                const userAnswerLine = userAnswerLines[i] || "";
                const userAnswer = userAnswerLine.replace(/^\d+\.\s*/, "").trim().toLowerCase();
                
                console.log(`[DEBUG] Label ${i + 1}: correct="${correctAnswer}", user="${userAnswer}"`);
                
                const isLabelCorrect = userAnswer === correctAnswer;
                if (isLabelCorrect) {
                  correctCount++;
                }
                
                labelComparisons.push({
                  labelIndex: i + 1,
                  correctAnswer,
                  userAnswer,
                  isCorrect: isLabelCorrect
                });
              }
              
              const accuracyRate = Math.round((correctCount / totalCount) * 100);
              const isCorrect = accuracyRate === 100;
              
              console.log(`[DEBUG] Image question grading: ${correctCount}/${totalCount} correct, accuracy: ${accuracyRate}%`);
              
              // Save test session
              await db.createTestSession({
                userId: ctx.user.id,
                questionId: input.questionId,
                userAnswer: input.userAnswer,
                isCorrect: isCorrect ? 1 : 0,
                recallTime: input.recallTime,
                similarityScore: accuracyRate,
                mistakeHighlights: JSON.stringify(labelComparisons),
                llmFeedback: null,
                completedAt: new Date(),
              });
              
              return {
                isCorrect,
                similarityScore: accuracyRate,
                accuracyRate,
                mistakes: labelComparisons,
                feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctCount}/${totalCount} 정답`,
                missingKeywords: [],
              };
            } catch (e) {
              console.error("Failed to grade image question:", e);
            }
          }
          
          const ignoreAutoNumbering = question.autoNumbering === 1;
          const graded = evaluateTextAnswerByBestLineMatch(input.userAnswer, correctAnswer, ignoreAutoNumbering);

          console.log("[DEBUG] Line matching comparison mode");
          console.log("[DEBUG] correctLineCount:", graded.correctLineCount, "/", graded.totalLines);
          console.log("[DEBUG] isCorrect:", graded.isCorrect);
          console.log("[DEBUG] accuracyRate:", graded.accuracyRate);
          console.log("[DEBUG] similarityScore:", graded.similarityScore);

          // Save test session
          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect: graded.isCorrect ? 1 : 0,
            recallTime: input.recallTime,
            similarityScore: graded.similarityScore,
            mistakeHighlights: JSON.stringify(graded.mistakes),
            llmFeedback: null,
            completedAt: new Date(),
          });

          return graded;
        }

        // Deduct AI credit
        try {
          await db.deductAICredits(ctx.user.id, 1);
        } catch (error: any) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message || "AI 크레딧이 부족합니다. 설정에서 충전하세요.",
          });
        }

        // LLM-based evaluation
        const evaluationPrompt = `다음 서술형 문제의 모범 답안과 학생 답안을 비교하여 평가해주세요.

**문제:**
${question.question}

**모범 답안:**
${correctAnswer}

**학생 답안:**
${input.userAnswer}

다음 형식으로 JSON으로 답변해주세요:
{
  "isCorrect": true/false,
  "similarityScore": 0-100 사이의 점수,
  "mistakes": [
    {
      "type": "오류 유형 (예: 키워드 누락, 논리적 오류, 부정확한 표현)",
      "description": "구체적인 오류 설명",
      "position": "오류 위치"
    }
  ],
  "feedback": "개선 제안 및 피드백 (한글로)",
  "missingKeywords": ["누락된 핵심 키워드 목록"]
}`;

        try {
          const llmResponse = await invokeLLM({
            messages: [
              { role: "system", content: "당신은 교육 평가 전문가입니다. 학생의 서술형 답안을 의미적으로 분석하고 건설적인 피드백을 제공합니다." },
              { role: "user", content: evaluationPrompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "answer_evaluation",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    isCorrect: { type: "boolean" },
                    similarityScore: { type: "integer" },
                    mistakes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string" },
                          description: { type: "string" },
                          position: { type: "string" },
                        },
                        required: ["type", "description", "position"],
                        additionalProperties: false,
                      },
                    },
                    feedback: { type: "string" },
                    missingKeywords: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["isCorrect", "similarityScore", "mistakes", "feedback", "missingKeywords"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = llmResponse.choices[0]?.message?.content;
          const contentStr = typeof content === "string" ? content : JSON.stringify(content);
          const evaluation = JSON.parse(contentStr || "{}");
          const isCorrect = evaluation.isCorrect ? 1 : 0;
          const similarityScore = evaluation.similarityScore || 0;
          const mistakeHighlights = JSON.stringify(evaluation.mistakes || []);
          const llmFeedback = evaluation.feedback || "";

          // Save test session
          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights,
            llmFeedback,
            completedAt: new Date(),
          });

          return {
            isCorrect,
            similarityScore,
            accuracyRate: similarityScore,
            mistakeHighlights,
            llmFeedback,
            missingKeywords: evaluation.missingKeywords || [],
          };
        } catch (error) {
          console.error("LLM evaluation error:", error);
          
          // Fallback to simple comparison (use correctAnswer from above)
          const correctAnswerNormalized = correctAnswer.trim().toLowerCase();
          const userAnswerNormalized = input.userAnswer.trim().toLowerCase();
          const isCorrect = correctAnswerNormalized === userAnswerNormalized ? 1 : 0;
          const similarityScore = Math.round(
            (1 - (Math.abs(correctAnswerNormalized.length - userAnswerNormalized.length) / Math.max(correctAnswerNormalized.length, userAnswerNormalized.length))) * 100
          );

          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights: null,
            llmFeedback: null,
            completedAt: new Date(),
          });

          return {
            isCorrect,
            similarityScore,
            accuracyRate: similarityScore,
            mistakeHighlights: null,
            llmFeedback: "LLM 평가를 사용할 수 없어 기본 평가를 사용했습니다.",
          };
        }
      }),
    
    deleteAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        return db.deleteAllTestSessions(ctx.user.id);
      }),
  }),

  // Typing Speed Bonus
  typing: router({
    /** 타이핑 시도 기록 저장 + 베이스라인 업데이트 + 보너스 계산 */
    recordAttempt: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        answerLength: z.number(),
        inputChars: z.number(),
        timeToFirstKey: z.number(),
        typingStartTime: z.number(),
        typingEndTime: z.number(),
        backspaceCount: z.number(),
        pasteDetected: z.boolean(),
        mode: z.enum(["practice", "exam"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const attempt: TypingAttemptInput = {
          answerLength: input.answerLength,
          inputChars: input.inputChars,
          timeToFirstKey: input.timeToFirstKey,
          typingStartTime: input.typingStartTime,
          typingEndTime: input.typingEndTime,
          backspaceCount: input.backspaceCount,
          pasteDetected: input.pasteDetected,
          mode: input.mode,
        };

        const { effectiveSpeed, typingDuration, lengthBucket } = calculateEffectiveSpeed(attempt);

        // 베이스라인 업데이트 (조건 충족 시)
        if (shouldUpdateBaseline(attempt)) {
          // 시도 저장
          await db.createTypingAttempt({
            userId: ctx.user.id,
            questionId: input.questionId,
            mode: input.mode,
            answerLength: input.answerLength,
            inputChars: input.inputChars,
            timeToFirstKey: input.timeToFirstKey,
            typingDuration,
            backspaceCount: input.backspaceCount,
            pasteDetected: input.pasteDetected ? 1 : 0,
            effectiveSpeed: speedToInt(effectiveSpeed),
            lengthBucket,
          });

          // 최근 50개 샘플로 p60 재계산
          const samples = await db.getTypingAttempts(ctx.user.id, input.mode, lengthBucket, 50);
          const sampleCount = samples.length;
          if (sampleCount > 0) {
            const p60 = computeP60(samples.map(intToSpeed));
            await db.upsertTypingBaseline(ctx.user.id, input.mode, lengthBucket, speedToInt(p60), sampleCount);
          }
        }

        // exam 모드일 때만 보너스 계산
        if (input.mode !== "exam") {
          return { bonus: 0, ratio: 1, effectiveSpeed, expectedSpeed: 0, label: "normal" as const };
        }

        // 베이스라인 조회
        const examBaseline = await db.getTypingBaseline(ctx.user.id, "exam", lengthBucket);
        const practiceBaseline = await db.getTypingBaseline(ctx.user.id, "practice", lengthBucket);

        // 글로벌 기본값 (버킷별 경험치 기반)
        const globalDefaults: Record<number, number> = { 1: 3.0, 2: 2.5, 3: 2.0, 4: 1.5 };
        const globalBaseline = globalDefaults[lengthBucket] ?? 2.0;

        const practiceSpeed = practiceBaseline
          ? computeBlendedBaseline(intToSpeed(practiceBaseline.baselineSpeed), practiceBaseline.sampleCount, globalBaseline)
          : globalBaseline;

        const examSpeed = examBaseline
          ? computeBlendedBaseline(intToSpeed(examBaseline.baselineSpeed), examBaseline.sampleCount, practiceSpeed * 0.8)
          : null;

        const expectedSpeed = computeExpectedSpeed(examSpeed, practiceSpeed);
        const bonusResult = calculateSpeedBonus(effectiveSpeed, expectedSpeed);

        return bonusResult;
      }),
  }),

  // Review schedule management
  review: router({
    getByUser: protectedProcedure.query(async ({ ctx }) => {
      return db.getReviewSchedulesByUserId(ctx.user.id);
    }),
    
    getDue: protectedProcedure.query(async ({ ctx }) => {
      const schedules = await db.getReviewSchedulesByUserId(ctx.user.id);
      const now = new Date();
      return schedules.filter(s => s.nextReviewDate <= now);
    }),
    
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getReviewScheduleByQuestionId(input.questionId, ctx.user.id);
      }),
    
    create: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        nextReviewDate: z.date(),
        repetitionCount: z.number().optional(),
        easeFactor: z.number().optional(),
        interval: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createReviewSchedule({
          userId: ctx.user.id,
          questionId: input.questionId,
          nextReviewDate: input.nextReviewDate,
          repetitionCount: input.repetitionCount,
          easeFactor: input.easeFactor,
          interval: input.interval,
        });
      }),
    
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        nextReviewDate: z.date().optional(),
        repetitionCount: z.number().optional(),
        easeFactor: z.number().optional(),
        interval: z.number().optional(),
        lastReviewedAt: z.date().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return db.updateReviewSchedule(id, data);
      }),
    
    // SM-2 algorithm for spaced repetition
    updateAfterReview: protectedProcedure
      .input(z.object({
        questionId: z.number(),
        quality: z.number().min(0).max(5), // 0-5 quality rating
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getReviewScheduleByQuestionId(input.questionId, ctx.user.id);
        
        let repetitionCount = 0;
        let easeFactor = 250; // 2.5 * 100
        let interval = 1;
        
        if (existing) {
          repetitionCount = existing.repetitionCount || 0;
          easeFactor = existing.easeFactor || 250;
          interval = existing.interval || 1;
        }
        
        // SM-2 algorithm
        if (input.quality >= 3) {
          if (repetitionCount === 0) {
            interval = 1;
          } else if (repetitionCount === 1) {
            interval = 6;
          } else {
            interval = Math.round(interval * (easeFactor / 100));
          }
          repetitionCount += 1;
        } else {
          repetitionCount = 0;
          interval = 1;
        }
        
        easeFactor = easeFactor + (80 - 50 * (5 - input.quality));
        // easeFactor 범위 제한: 130~300 (1.3배~3.0배)
        if (easeFactor < 130) easeFactor = 130;
        if (easeFactor > 300) easeFactor = 300;
        // interval 상한 제한: 최대 365일 (1년)
        if (interval > 365) interval = 365;
        
        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + interval);
        
        if (existing) {
          await db.updateReviewSchedule(existing.id, {
            nextReviewDate,
            repetitionCount,
            easeFactor,
            interval,
            lastReviewedAt: new Date(),
          });
        } else {
          await db.createReviewSchedule({
            userId: ctx.user.id,
            questionId: input.questionId,
            nextReviewDate,
            repetitionCount,
            easeFactor,
            interval,
            lastReviewedAt: new Date(),
          });
        }
        
        return { nextReviewDate, interval };
      }),
  }),

  // OCR - Document text extraction
  ocr: router({
    // Upload file to S3
    uploadFile: protectedProcedure
      .input(z.object({ fileBuffer: z.instanceof(Uint8Array), fileName: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        ensureOCREnabled();
        try {
          const fileKey = `ocr/${ctx.user.id}/${Date.now()}-${input.fileName}`;
          const { url } = await storagePut(fileKey, Buffer.from(input.fileBuffer), input.mimeType);
          return { s3Url: url };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("[OCR] Upload file failed:", errorMsg);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `File upload failed: ${errorMsg}`,
          });
        }
      }),

    // Start OCR job
    startJob: protectedProcedure
      .input(
        z
          .object({
            fileName: z.string().min(1),
            mimeType: z.string().optional(),
            s3Url: z.string().url().optional(),
            fileBuffer: z.instanceof(Uint8Array).optional(),
            selectedPages: z.array(z.number().int().min(1).max(2000)).max(500).optional(),
          })
          .refine((input) => Boolean(input.fileBuffer || input.s3Url), {
            message: "fileBuffer 또는 s3Url 중 하나는 필요합니다.",
          })
      )
      .mutation(async ({ ctx, input }) => {
        ensureOCREnabled();
        try {
          let rawBuffer: Uint8Array;
          if (input.fileBuffer) {
            rawBuffer = input.fileBuffer;
          } else {
            // Backward compatibility path: start from uploaded URL
            const response = await fetch(input.s3Url!);
            if (!response.ok) {
              throw new Error(`Failed to download file: ${response.statusText}`);
            }
            rawBuffer = new Uint8Array(await response.arrayBuffer());
          }

          const mimeType = normalizeOcrMimeType(input.fileName, input.mimeType);
          if (mimeType === "application/pdf" && input.selectedPages && input.selectedPages.length > 0) {
            rawBuffer = await buildPdfSubset(rawBuffer, input.selectedPages);
          }

          const isSyncImage = isSyncImageMimeType(mimeType);
          const isAsyncDocument = isAsyncDocumentMimeType(mimeType);
          if (!isSyncImage && !isAsyncDocument) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `지원하지 않는 OCR 파일 형식입니다: ${mimeType}. (PDF/JPG/PNG/WEBP/BMP/TIFF/GIF 지원)`,
            });
          }

          if (isSyncImage) {
            const extractedText = await ocrModule.extractTextFromImageBuffer(
              Buffer.from(rawBuffer),
              mimeType
            );

            const job = await db.createOcrJob({
              userId: ctx.user.id,
              fileName: input.fileName,
              s3Url: input.s3Url ?? "",
              status: "completed",
              extractedText,
              completedAt: new Date(),
            });

            return {
              jobId: job.id,
              status: "completed" as const,
              extractedText,
            };
          }

          const documentBuffer = Buffer.from(rawBuffer);
          let gcsUri: string | undefined;
          let operationName: string;

          // PDF/TIFF는 일정 크기 이하일 때 inline 입력으로 시작하면 GCS 입력 업로드 단계를 건너뛰어 체감 속도가 빨라진다.
          const shouldTryInline =
            mimeType === "application/pdf" &&
            ocrModule.canUseInlineDocumentInput(mimeType, documentBuffer.byteLength);

          if (shouldTryInline) {
            try {
              operationName = await ocrModule.startOCRJobFromBuffer(documentBuffer, mimeType);
            } catch (inlineError) {
              const inlineErrorMsg =
                inlineError instanceof Error ? inlineError.message : String(inlineError);
              console.warn(
                "[OCR] Inline document OCR start failed, falling back to GCS input:",
                inlineErrorMsg
              );
              gcsUri = await ocrModule.uploadToGCS(documentBuffer, input.fileName, mimeType);
              operationName = await ocrModule.startOCRJob(gcsUri, mimeType);
            }
          } else {
            gcsUri = await ocrModule.uploadToGCS(documentBuffer, input.fileName, mimeType);
            operationName = await ocrModule.startOCRJob(gcsUri, mimeType);
          }

          // Create job record in database
          const job = await db.createOcrJob({
            userId: ctx.user.id,
            fileName: input.fileName,
            s3Url: input.s3Url ?? "",
            gcsUri,
            operationName,
            status: "processing",
          });

          return { jobId: job.id, status: "processing" };
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("[OCR] Start job failed:", errorMsg);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `OCR job failed: ${errorMsg}`,
          });
        }
      }),

    // Check job status
    getStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        ensureOCREnabled();
        const job = await db.getOcrJobById(input.jobId);
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "OCR job not found",
          });
        }

        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Access denied",
          });
        }

        // If already completed or failed, return cached status
        if (job.status === "completed" || job.status === "failed") {
          return {
            jobId: job.id,
            status: job.status,
            extractedText: job.extractedText,
            errorMessage: job.errorMessage,
          };
        }

        // Poll operation status
        try {
          if (!job.operationName) {
            await db.updateOcrJob(job.id, {
              status: "failed",
              errorMessage: "Missing operationName for processing OCR job",
            });
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "OCR job metadata is invalid.",
            });
          }
          const isComplete = await ocrModule.checkOCRJobStatus(job.operationName!);

          if (isComplete) {
            // Get results
            const extractedText = await ocrModule.getOCRResults(job.operationName!);

            // Update job record
            await db.updateOcrJob(job.id, {
              status: "completed",
              extractedText,
              completedAt: new Date(),
            });

            // Cleanup GCS files
            if (job.gcsUri) {
              await ocrModule.cleanupGCSFiles(job.gcsUri).catch(err => {
                console.error("[OCR] Cleanup failed:", err);
              });
            }
            const outputUri = ocrModule.getOutputUriFromOperationRef(job.operationName);
            if (outputUri) {
              await ocrModule.cleanupGCSFiles(outputUri).catch(err => {
                console.error("[OCR] Output cleanup failed:", err);
              });
            }

            return {
              jobId: job.id,
              status: "completed",
              extractedText,
            };
          } else {
            return {
              jobId: job.id,
              status: "processing",
            };
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("[OCR] Status check failed:", errorMsg);

          // Update job as failed
          await db.updateOcrJob(job.id, {
            status: "failed",
            errorMessage: errorMsg,
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `OCR status check failed: ${errorMsg}`,
          });
        }
      }),

    // Get job result
    getResult: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        ensureOCREnabled();
        const job = await db.getOcrJobById(input.jobId);
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "OCR job not found",
          });
        }

        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Access denied",
          });
        }

        if (job.status !== "completed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Job not completed (status: ${job.status})`,
          });
        }

        return {
          jobId: job.id,
          fileName: job.fileName,
          extractedText: job.extractedText || "",
          completedAt: job.completedAt,
        };
      }),

    // List user's OCR jobs
    listJobs: protectedProcedure.query(async ({ ctx }) => {
      ensureOCREnabled();
      return db.getOcrJobsByUserId(ctx.user.id);
    }),

    // Delete OCR job
    deleteJob: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        ensureOCREnabled();
        const job = await db.getOcrJobById(input.jobId);
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "OCR job not found",
          });
        }

        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Access denied",
          });
        }

        // Cleanup GCS files if exists
        if (job.gcsUri) {
          await ocrModule.cleanupGCSFiles(job.gcsUri).catch(err => {
            console.error("[OCR] Cleanup failed:", err);
          });
        }
        const outputUri = ocrModule.getOutputUriFromOperationRef(job.operationName);
        if (outputUri) {
          await ocrModule.cleanupGCSFiles(outputUri).catch(err => {
            console.error("[OCR] Output cleanup failed:", err);
          });
        }

        await db.deleteOcrJob(job.id);
        return { success: true };
      }),
  }),

  // 학습 통계 분석 API
  statistics: router({
    // 과목별 학습 분석: 연습 횟수/시간 vs 시험 점수(난도별)
    getSubjectAnalysis: protectedProcedure.query(async ({ ctx }) => {
      const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
      const allTests = await db.getTestSessionsByUserId(ctx.user.id);
      const allQuestions = await db.getQuestionsByUserId(ctx.user.id);
      const allSubjects = await db.getSubjectsByUserId(ctx.user.id);

      return allSubjects.map(subject => {
        const subjectQs = allQuestions.filter(q => q.subjectId === subject.id);
        const subjectQIds = subjectQs.map(q => q.id);

        const practices = allPractice.filter(p => subjectQIds.includes(p.questionId));
        const tests = allTests.filter(t => subjectQIds.includes(t.questionId));

        const totalPracticeTime = practices.reduce((sum, p) => sum + p.duration, 0);
        const practiceCount = practices.length;

        // 문제별 분석 (연습 횟수 vs 시험 정답률)
        const questionAnalysis = subjectQs.map(q => {
          const qPractices = practices.filter(p => p.questionId === q.id);
          const qTests = tests.filter(t => t.questionId === q.id);
          const qCorrect = qTests.filter(t => t.isCorrect === 1).length;
          return {
            questionId: q.id,
            question: q.question.substring(0, 50),
            practiceCount: qPractices.length,
            practiceTime: qPractices.reduce((s, p) => s + p.duration, 0),
            testCount: qTests.length,
            correctCount: qCorrect,
            correctRate: qTests.length > 0 ? Math.round((qCorrect / qTests.length) * 100) : 0,
            latestSimilarity: qTests.length > 0 ? (qTests[qTests.length - 1].similarityScore || 0) : null,
          };
        });

        // 시간 경과에 따른 시험 성과 추이 (날짜별 그룹)
        const testsByDate = tests.reduce((acc, t) => {
          const date = new Date(t.completedAt).toISOString().split('T')[0];
          if (!acc[date]) acc[date] = [];
          acc[date].push(t);
          return acc;
        }, {} as Record<string, typeof tests>);

        const performanceTrend = Object.entries(testsByDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dayTests]) => {
            const correct = dayTests.filter(t => t.isCorrect === 1).length;
            const avgSim = Math.round(dayTests.reduce((s, t) => s + (t.similarityScore || 0), 0) / dayTests.length);
            // 해당 날짜까지의 누적 연습 횟수
            const cumulativePractice = practices.filter(p => 
              new Date(p.completedAt) <= new Date(date + 'T23:59:59')
            ).length;
            return {
              date,
              correctRate: Math.round((correct / dayTests.length) * 100),
              avgSimilarity: avgSim,
              testCount: dayTests.length,
              cumulativePractice,
            };
          });

        return {
          subjectId: subject.id,
          subjectName: subject.name,
          subjectColor: subject.color,
          totalQuestions: subjectQs.length,
          practiceCount,
          totalPracticeTime,
          totalTests: tests.length,
          overallCorrectRate: tests.length > 0
            ? Math.round((tests.filter(t => t.isCorrect === 1).length / tests.length) * 100)
            : 0,
          overallAvgSimilarity: tests.length > 0
            ? Math.round(tests.reduce((s, t) => s + (t.similarityScore || 0), 0) / tests.length)
            : 0,
          questionAnalysis,
          performanceTrend,
        };
      });
    }),

    // 전체 학습 요약 - 핵심 숫자들
    getSummary: protectedProcedure.query(async ({ ctx }) => {
      const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
      const allTests = await db.getTestSessionsByUserId(ctx.user.id);
      const allQuestions = await db.getQuestionsByUserId(ctx.user.id);

      const totalPracticeTime = allPractice.reduce((sum, p) => sum + p.duration, 0);
      const totalPracticeCount = allPractice.length;
      const totalTestCount = allTests.length;
      const totalCorrect = allTests.filter(t => t.isCorrect === 1).length;
      const validTypingSpeeds = allPractice
        .map((p) => p.typingSpeed)
        .filter((speed) => Number.isFinite(speed) && speed > 0);
      const avgPracticeTypingSpeed = validTypingSpeeds.length > 0
        ? Math.round(validTypingSpeeds.reduce((sum, speed) => sum + speed, 0) / validTypingSpeeds.length)
        : 0;

      // 연습 횟수 구간별 시험 정답률
      const practiceCountBuckets = allQuestions.map(q => {
        const pCount = allPractice.filter(p => p.questionId === q.id).length;
        const qTests = allTests.filter(t => t.questionId === q.id);
        const correct = qTests.filter(t => t.isCorrect === 1).length;
        return { practiceCount: pCount, testCount: qTests.length, correctCount: correct };
      });

      // 연습 횟수 구간별 그룹화 (0회, 1-2회, 3-5회, 6-10회, 11회+)
      const bucketRanges = [
        { label: "0회", min: 0, max: 0 },
        { label: "1-2회", min: 1, max: 2 },
        { label: "3-5회", min: 3, max: 5 },
        { label: "6-10회", min: 6, max: 10 },
        { label: "11회+", min: 11, max: Infinity },
      ];

      const practiceVsTestData = bucketRanges.map(range => {
        const inRange = practiceCountBuckets.filter(
          b => b.practiceCount >= range.min && b.practiceCount <= range.max
        );
        const totalTests = inRange.reduce((s, b) => s + b.testCount, 0);
        const totalCorrectInRange = inRange.reduce((s, b) => s + b.correctCount, 0);
        return {
          label: range.label,
          questionCount: inRange.length,
          testCount: totalTests,
          correctRate: totalTests > 0 ? Math.round((totalCorrectInRange / totalTests) * 100) : 0,
        };
      });

      // 연습 부족 문제 (시험 봤는데 틀린 문제 중 연습 적은 것)
      const weakQuestions = allQuestions
        .map(q => {
          const qTests = allTests.filter(t => t.questionId === q.id);
          const qPractices = allPractice.filter(p => p.questionId === q.id);
          const correct = qTests.filter(t => t.isCorrect === 1).length;
          const latestTest = qTests.length > 0 ? qTests[qTests.length - 1] : null;
          return {
            questionId: q.id,
            question: q.question.substring(0, 60),
            subjectId: q.subjectId,
            practiceCount: qPractices.length,
            testCount: qTests.length,
            correctRate: qTests.length > 0 ? Math.round((correct / qTests.length) * 100) : -1,
            latestSimilarity: latestTest?.similarityScore || null,
          };
        })
        .filter(q => q.testCount > 0 && q.correctRate < 70)
        .sort((a, b) => a.correctRate - b.correctRate)
        .slice(0, 10);

      return {
        totalPracticeTime,
        totalPracticeCount,
        totalTestCount,
        totalCorrect,
        avgPracticeTypingSpeed,
        overallCorrectRate: totalTestCount > 0 ? Math.round((totalCorrect / totalTestCount) * 100) : 0,
        practiceVsTestData,
        weakQuestions,
      };
    }),
  }),

  // 베타 UX 텔레메트리
  telemetry: router({
    ingest: protectedProcedure
      .input(
        z.object({
          events: z.array(
            z.object({
              sessionId: z.string().min(1).max(96),
              path: z.string().min(1).max(512),
              eventType: z.string().min(1).max(64),
              activeMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
              interactionCount: z.number().int().min(0).max(10_000).optional(),
              visible: z.boolean().optional(),
              occurredAt: z.string().optional(),
              payload: z.unknown().optional(),
            })
          ).min(1).max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const rows = input.events.map((event) => {
          const parsedOccurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
          const occurredAt = parsedOccurredAt && !Number.isNaN(parsedOccurredAt.getTime())
            ? parsedOccurredAt
            : new Date();
          return {
            userId: ctx.user.id,
            sessionId: event.sessionId,
            path: event.path,
            eventType: event.eventType,
            activeMs: Math.max(0, Math.min(10 * 60 * 1000, event.activeMs ?? 0)),
            interactionCount: Math.max(0, Math.min(10_000, event.interactionCount ?? 0)),
            visible: event.visible === false ? 0 : 1,
            payload: event.payload === undefined ? null : JSON.stringify(event.payload),
            occurredAt,
          };
        });

        const saved = await db.createTelemetryEvents(rows);
        return { success: true, saved };
      }),

    getOverview: adminProcedure
      .input(z.object({ days: z.number().int().min(1).max(90).default(14) }).optional())
      .query(async ({ input }) => {
        const days = input?.days ?? 14;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const events = await db.getTelemetryEventsSince(since);

        const userIds = Array.from(new Set(events.map((e) => e.userId)));
        const userRows = await db.getUsersByIds(userIds);
        const userMap = new Map(userRows.map((u) => [u.id, u]));

        type SessionAgg = {
          userId: number;
          sessionId: string;
          firstAt: Date;
          lastAt: Date;
          activeMs: number;
          interactionCount: number;
          pageViews: number;
          paths: Set<string>;
        };

        const sessions = new Map<string, SessionAgg>();
        const pathAgg = new Map<string, {
          path: string;
          activeMs: number;
          interactionCount: number;
          pageViews: number;
          sessions: Set<string>;
        }>();
        const eventTypeCount = new Map<string, number>();
        const daily = new Map<string, {
          users: Set<number>;
          sessions: Set<string>;
          activeMs: number;
          interactionCount: number;
          pageViews: number;
        }>();
        const userAgg = new Map<number, {
          userId: number;
          activeMs: number;
          interactionCount: number;
          pageViews: number;
          sessions: Set<string>;
          lastSeenAt: Date | null;
        }>();

        const isPageViewEvent = (eventType: string) => eventType === "page_view";

        for (const event of events) {
          const at = new Date(event.occurredAt);
          const sessionKey = `${event.userId}:${event.sessionId}`;

          let session = sessions.get(sessionKey);
          if (!session) {
            session = {
              userId: event.userId,
              sessionId: event.sessionId,
              firstAt: at,
              lastAt: at,
              activeMs: 0,
              interactionCount: 0,
              pageViews: 0,
              paths: new Set<string>(),
            };
            sessions.set(sessionKey, session);
          }
          session.firstAt = at < session.firstAt ? at : session.firstAt;
          session.lastAt = at > session.lastAt ? at : session.lastAt;
          session.activeMs += event.activeMs ?? 0;
          session.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) session.pageViews += 1;
          session.paths.add(event.path);

          let pathRow = pathAgg.get(event.path);
          if (!pathRow) {
            pathRow = {
              path: event.path,
              activeMs: 0,
              interactionCount: 0,
              pageViews: 0,
              sessions: new Set<string>(),
            };
            pathAgg.set(event.path, pathRow);
          }
          pathRow.activeMs += event.activeMs ?? 0;
          pathRow.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) pathRow.pageViews += 1;
          pathRow.sessions.add(sessionKey);

          eventTypeCount.set(event.eventType, (eventTypeCount.get(event.eventType) ?? 0) + 1);

          const dateKey = at.toISOString().slice(0, 10);
          let day = daily.get(dateKey);
          if (!day) {
            day = {
              users: new Set<number>(),
              sessions: new Set<string>(),
              activeMs: 0,
              interactionCount: 0,
              pageViews: 0,
            };
            daily.set(dateKey, day);
          }
          day.users.add(event.userId);
          day.sessions.add(sessionKey);
          day.activeMs += event.activeMs ?? 0;
          day.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) day.pageViews += 1;

          let perUser = userAgg.get(event.userId);
          if (!perUser) {
            perUser = {
              userId: event.userId,
              activeMs: 0,
              interactionCount: 0,
              pageViews: 0,
              sessions: new Set<string>(),
              lastSeenAt: null,
            };
            userAgg.set(event.userId, perUser);
          }
          perUser.activeMs += event.activeMs ?? 0;
          perUser.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) perUser.pageViews += 1;
          perUser.sessions.add(sessionKey);
          perUser.lastSeenAt = !perUser.lastSeenAt || at > perUser.lastSeenAt ? at : perUser.lastSeenAt;
        }

        const sessionList = Array.from(sessions.values());
        const totalActiveMs = sessionList.reduce((sum, s) => sum + s.activeMs, 0);
        const totalInteractions = sessionList.reduce((sum, s) => sum + s.interactionCount, 0);
        const totalPageViews = sessionList.reduce((sum, s) => sum + s.pageViews, 0);
        const bounceSessionCount = sessionList.filter((s) => s.pageViews <= 1).length;
        const longStaySessionCount = sessionList.filter((s) => s.activeMs >= 5 * 60 * 1000).length;
        const avgActiveMsPerSession = sessionList.length > 0 ? Math.round(totalActiveMs / sessionList.length) : 0;
        const avgInteractionsPerSession = sessionList.length > 0
          ? Number((totalInteractions / sessionList.length).toFixed(1))
          : 0;

        const topPaths = Array.from(pathAgg.values())
          .map((row) => ({
            path: row.path,
            activeMs: row.activeMs,
            activeMinutes: Number((row.activeMs / 60000).toFixed(1)),
            interactionCount: row.interactionCount,
            pageViews: row.pageViews,
            sessionCount: row.sessions.size,
          }))
          .sort((a, b) => b.activeMs - a.activeMs)
          .slice(0, 12);

        const topUsers = Array.from(userAgg.values())
          .map((row) => {
            const user = userMap.get(row.userId);
            return {
              userId: row.userId,
              name: user?.name ?? null,
              email: user?.email ?? null,
              loginMethod: user?.loginMethod ?? null,
              activeMs: row.activeMs,
              activeMinutes: Number((row.activeMs / 60000).toFixed(1)),
              interactionCount: row.interactionCount,
              pageViews: row.pageViews,
              sessionCount: row.sessions.size,
              lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
            };
          })
          .sort((a, b) => b.activeMs - a.activeMs)
          .slice(0, 20);

        const dauTrend = Array.from(daily.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, row]) => ({
            date,
            activeUsers: row.users.size,
            sessions: row.sessions.size,
            activeMinutes: Number((row.activeMs / 60000).toFixed(1)),
            interactions: row.interactionCount,
            pageViews: row.pageViews,
          }));

        const eventTypeDistribution = Array.from(eventTypeCount.entries())
          .map(([eventType, count]) => ({ eventType, count }))
          .sort((a, b) => b.count - a.count);

        return {
          days,
          since: since.toISOString(),
          summary: {
            activeUserCount: userIds.length,
            sessionCount: sessionList.length,
            totalEventCount: events.length,
            totalPageViews,
            totalActiveMs,
            totalActiveMinutes: Number((totalActiveMs / 60000).toFixed(1)),
            totalInteractions,
            avgActiveMsPerSession,
            avgActiveMinutesPerSession: Number((avgActiveMsPerSession / 60000).toFixed(1)),
            avgInteractionsPerSession,
            bounceRate: sessionList.length > 0 ? Math.round((bounceSessionCount / sessionList.length) * 100) : 0,
            longStayRate: sessionList.length > 0 ? Math.round((longStaySessionCount / sessionList.length) * 100) : 0,
          },
          dauTrend,
          topPaths,
          topUsers,
          eventTypeDistribution,
        };
      }),

    getUserEngagement: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive().optional(),
          email: z.string().email().optional(),
          days: z.number().int().min(1).max(90).default(14),
        }).refine((value) => value.userId !== undefined || value.email !== undefined, {
          message: "userId 또는 email이 필요합니다.",
        })
      )
      .query(async ({ input }) => {
        let targetUserId = input.userId;
        if (!targetUserId && input.email) {
          const user = await db.getUserByEmail(input.email);
          if (!user) {
            throw new TRPCError({ code: "NOT_FOUND", message: "해당 이메일 사용자 없음" });
          }
          targetUserId = user.id;
        }
        if (!targetUserId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "조회 대상 사용자 누락" });
        }

        const [targetUser] = await db.getUsersByIds([targetUserId]);
        if (!targetUser) {
          throw new TRPCError({ code: "NOT_FOUND", message: "사용자를 찾을 수 없습니다." });
        }

        const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
        const events = await db.getTelemetryEventsByUserSince(targetUserId, since);

        type SessionAgg = {
          sessionId: string;
          firstAt: Date;
          lastAt: Date;
          activeMs: number;
          interactionCount: number;
          pageViews: number;
          paths: Set<string>;
        };
        const sessions = new Map<string, SessionAgg>();
        const routes = new Map<string, { path: string; activeMs: number; interactionCount: number; pageViews: number }>();
        const timeline = new Map<string, { date: string; activeMs: number; interactionCount: number; pageViews: number }>();
        const isPageViewEvent = (eventType: string) => eventType === "page_view";

        for (const event of events) {
          const at = new Date(event.occurredAt);
          let session = sessions.get(event.sessionId);
          if (!session) {
            session = {
              sessionId: event.sessionId,
              firstAt: at,
              lastAt: at,
              activeMs: 0,
              interactionCount: 0,
              pageViews: 0,
              paths: new Set<string>(),
            };
            sessions.set(event.sessionId, session);
          }
          session.firstAt = at < session.firstAt ? at : session.firstAt;
          session.lastAt = at > session.lastAt ? at : session.lastAt;
          session.activeMs += event.activeMs ?? 0;
          session.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) session.pageViews += 1;
          session.paths.add(event.path);

          let route = routes.get(event.path);
          if (!route) {
            route = { path: event.path, activeMs: 0, interactionCount: 0, pageViews: 0 };
            routes.set(event.path, route);
          }
          route.activeMs += event.activeMs ?? 0;
          route.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) route.pageViews += 1;

          const dateKey = at.toISOString().slice(0, 10);
          let day = timeline.get(dateKey);
          if (!day) {
            day = { date: dateKey, activeMs: 0, interactionCount: 0, pageViews: 0 };
            timeline.set(dateKey, day);
          }
          day.activeMs += event.activeMs ?? 0;
          day.interactionCount += event.interactionCount ?? 0;
          if (isPageViewEvent(event.eventType)) day.pageViews += 1;
        }

        const sessionList = Array.from(sessions.values())
          .map((session) => ({
            sessionId: session.sessionId,
            firstAt: session.firstAt.toISOString(),
            lastAt: session.lastAt.toISOString(),
            durationMinutes: Number(((session.lastAt.getTime() - session.firstAt.getTime()) / 60000).toFixed(1)),
            activeMinutes: Number((session.activeMs / 60000).toFixed(1)),
            interactionCount: session.interactionCount,
            pageViews: session.pageViews,
            pathCount: session.paths.size,
          }))
          .sort((a, b) => b.activeMinutes - a.activeMinutes);

        const routeBreakdown = Array.from(routes.values())
          .map((route) => ({
            path: route.path,
            activeMinutes: Number((route.activeMs / 60000).toFixed(1)),
            interactionCount: route.interactionCount,
            pageViews: route.pageViews,
          }))
          .sort((a, b) => b.activeMinutes - a.activeMinutes);

        const timelineRows = Array.from(timeline.values()).sort((a, b) => a.date.localeCompare(b.date));
        const totalActiveMs = events.reduce((sum, event) => sum + (event.activeMs ?? 0), 0);
        const totalInteractions = events.reduce((sum, event) => sum + (event.interactionCount ?? 0), 0);
        const totalPageViews = events.filter((event) => isPageViewEvent(event.eventType)).length;

        return {
          user: {
            id: targetUser.id,
            name: targetUser.name ?? null,
            email: targetUser.email ?? null,
            loginMethod: targetUser.loginMethod ?? null,
          },
          period: { days: input.days, since: since.toISOString() },
          summary: {
            totalEvents: events.length,
            totalActiveMinutes: Number((totalActiveMs / 60000).toFixed(1)),
            totalInteractions,
            totalPageViews,
            sessionCount: sessionList.length,
            avgActiveMinutesPerSession: sessionList.length > 0
              ? Number(((totalActiveMs / sessionList.length) / 60000).toFixed(1))
              : 0,
          },
          sessions: sessionList,
          routes: routeBreakdown,
          timeline: timelineRows.map((row) => ({
            date: row.date,
            activeMinutes: Number((row.activeMs / 60000).toFixed(1)),
            interactionCount: row.interactionCount,
            pageViews: row.pageViews,
          })),
        };
      }),
  }),

  // Expiring questions management
  expiring: router({
    // 만료 예정 문제 조회 (1달 이내 삭제 예정)
    getQuestions: protectedProcedure.query(async ({ ctx }) => {
      return db.getExpiringQuestions(ctx.user.id);
    }),
    
    // 만료된 문제 자동 삭제
    cleanup: protectedProcedure.mutation(async () => {
      return db.deleteExpiredQuestions();
    }),
  }),

  // 시험 안정도 (Exam Confidence)
  confidence: router({
    // 단일 문제 안정도 점수 조회
    getByQuestion: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
        const allTests = await db.getTestSessionsByUserId(ctx.user.id);
        const now = new Date();
        const userProfile = buildUserAdaptiveProfile(allPractice, allTests);

        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        const subject = question?.subjectId ? await db.getSubjectById(question.subjectId) : null;
        const examDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;
        const initialEstimate = question ? buildInitialConfidenceEstimate(question) : undefined;

        const qPractice = allPractice.filter(p => p.questionId === input.questionId);
        const qTests = allTests.filter(t => t.questionId === input.questionId);

        const practiceSignal: PracticeSignal = {
          practiceCount: qPractice.length,
          totalPracticeDuration: qPractice.reduce((sum, p) => sum + p.duration, 0),
          mostRecentPracticeAt: qPractice.length > 0
            ? new Date(Math.max(...qPractice.map(p => new Date(p.completedAt).getTime())))
            : null,
        };

        const correctTests = qTests.filter(t => t.isCorrect === 1);
        const wrongTests = qTests.filter(t => t.isCorrect === 0);
        const avgSimilarity = qTests.length > 0
          ? qTests.reduce((sum, t) => sum + (t.similarityScore || 0), 0) / qTests.length
          : 0;
        const sortedTests = [...qTests].sort((a, b) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );
        let recentCorrectStreak = 0;
        for (const t of sortedTests) {
          if (t.isCorrect === 1) recentCorrectStreak++;
          else break;
        }
        const mostRecentTest = sortedTests[0] || null;
        const mostRecentTestWasPoor = mostRecentTest
          ? ((mostRecentTest.similarityScore ?? 0) < 50)
          : false;

        const avgRecallTime = qTests.length > 0
          ? qTests.reduce((sum, t) => sum + (t.recallTime || 0), 0) / qTests.length
          : undefined;

        const testSignal: TestSignal = {
          testCount: qTests.length,
          correctCount: correctTests.length,
          wrongCount: wrongTests.length,
          averageSimilarityScore: Math.round(avgSimilarity),
          mostRecentTestAt: sortedTests.length > 0 ? new Date(sortedTests[0].completedAt) : null,
          recentCorrectStreak,
          mostRecentTestWasPoor,
          averageRecallTime: avgRecallTime,
          recentTestHistory: sortedTests.map(t => ({
            completedAt: new Date(t.completedAt),
            isCorrect: t.isCorrect === 1,
            similarityScore: t.similarityScore ?? 0,
          })),
        };

        const confidence = computeExamConfidence({
          practice: practiceSignal,
          test: testSignal,
          now,
          examDate,
          userProfile,
          initialEstimate,
        });

        const starterInitialScoreOverride = getStarterInitialScoreOverride({
          subjectName: subject?.name,
          question,
          practiceCount: qPractice.length,
          testCount: qTests.length,
          userRole: ctx.user.role,
        });
        let effectiveConfidence = starterInitialScoreOverride === null
          ? confidence
          : applyDisplayScoreOverride(confidence, starterInitialScoreOverride);
        const starterBaseScore = getStarterBaseScoreOverride({
          subjectName: subject?.name,
          question,
          userRole: ctx.user.role,
        });
        if (starterBaseScore !== null && qTests.length === 0 && qPractice.length > 0) {
          effectiveConfidence = applyStarterPracticeFloor(effectiveConfidence, starterBaseScore, qPractice.length);
        }
        effectiveConfidence = applyUnlearnedLabel(effectiveConfidence);

        // 시험일 예측: question의 subjectId를 통해 과목의 examEndDate 조회
        let examDatePrediction: ReturnType<typeof predictExamDayConfidence> | null = null;
        const currentQuestionLength = Math.max(1, initialEstimate?.answerLength ?? 1);
        let minQuestionLength = currentQuestionLength;
        let maxQuestionLength = currentQuestionLength;
        if (subject?.id) {
          const subjectQuestions = await db.getQuestionsBySubjectId(subject.id);
          if (subjectQuestions.length > 0) {
            const answerLengths = subjectQuestions.map((q) =>
              Math.max(1, buildInitialConfidenceEstimate(q).answerLength)
            );
            minQuestionLength = Math.min(...answerLengths);
            maxQuestionLength = Math.max(...answerLengths);
          }
        }
        if (examDate) {
          examDatePrediction = predictExamDayConfidence(
            effectiveConfidence,
            examDate,
            now,
            {
              questionLength: currentQuestionLength,
              minQuestionLength,
              maxQuestionLength,
              examPeriodHours: 72,
            }
          );
        }

        // 배지 계산
        const lastTest = sortedTests[0];
        const lastTestWrong = !!lastTest && lastTest.isCorrect === 0;
        const wrongCount = wrongTests.length;
        const frequentlyWrong = qTests.length >= 3 && wrongCount / qTests.length >= 0.5;

        // 주의구간: 여러 시험에서 반복적으로 틀린 줄 집계
        const warnZoneLines = extractWarnZoneLinesFromTests(qTests);
        const hasWarnZone = warnZoneLines.length > 0;

        // 마지막 시험의 오답 줄 정보 파싱
        let lastTestWrongLines: number[] = [];
        if (lastTest?.mistakeHighlights) {
          try {
            const highlights = JSON.parse(lastTest.mistakeHighlights as string);
            if (Array.isArray(highlights)) {
              lastTestWrongLines = highlights
                .filter((h: any) => h.isCorrect === false)
                .map((h: any) => (h.lineIndex ?? h.labelIndex ?? 1) - 1);
            }
          } catch {}
        }

        return {
          displayScore: effectiveConfidence.displayScore,
          state: effectiveConfidence.state,
          label: effectiveConfidence.label,
          isColdStart: effectiveConfidence.isColdStart,
          breakdown: effectiveConfidence.breakdown,
          badges: { lastTestWrong, frequentlyWrong, hasWarnZone },
          lastTestWrongLines,
          lastTestAccuracyRate: lastTest ? (lastTest.similarityScore ?? null) : null,
          examDatePrediction,
          warnZoneLines,
        };
      }),
    // 과목별 문제 안정도 점수 조회
    getBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const subjectQuestions = await db.getQuestionsBySubjectId(input.subjectId);
        const questionIds = subjectQuestions.map(q => q.id);
        if (questionIds.length === 0) return { questions: [], aggregate: aggregateConfidence([]) };
        const questionIdSet = new Set(questionIds);
        const questionById = new Map(subjectQuestions.map((q) => [q.id, q]));

        const subject = await db.getSubjectById(input.subjectId);
        const examDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;

        const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
        const allTests = await db.getTestSessionsByUserId(ctx.user.id);
        const now = new Date();
        const userProfile = buildUserAdaptiveProfile(allPractice, allTests);

        const practiceByQuestion = new Map<number, typeof allPractice>();
        const testsByQuestion = new Map<number, typeof allTests>();

        for (const practice of allPractice) {
          if (!questionIdSet.has(practice.questionId)) continue;
          const arr = practiceByQuestion.get(practice.questionId) ?? [];
          arr.push(practice);
          practiceByQuestion.set(practice.questionId, arr);
        }
        for (const test of allTests) {
          if (!questionIdSet.has(test.questionId)) continue;
          const arr = testsByQuestion.get(test.questionId) ?? [];
          arr.push(test);
          testsByQuestion.set(test.questionId, arr);
        }

        const results: { questionId: number; confidence: ConfidenceResult }[] = [];

        for (const qId of questionIds) {
          const qPractice = practiceByQuestion.get(qId) ?? [];
          const qTests = testsByQuestion.get(qId) ?? [];

          // Build practice signal
          const practiceSignal: PracticeSignal = {
            practiceCount: qPractice.length,
            totalPracticeDuration: qPractice.reduce((sum, p) => sum + p.duration, 0),
            mostRecentPracticeAt: qPractice.length > 0
              ? new Date(Math.max(...qPractice.map(p => new Date(p.completedAt).getTime())))
              : null,
          };

          // Build test signal
          const correctTests = qTests.filter(t => t.isCorrect === 1);
          const wrongTests = qTests.filter(t => t.isCorrect === 0);
          const avgSimilarity = qTests.length > 0
            ? qTests.reduce((sum, t) => sum + (t.similarityScore || 0), 0) / qTests.length
            : 0;

          // Calculate recent correct streak (from most recent test backward)
          const sortedTests = [...qTests].sort((a, b) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
          );
          let recentCorrectStreak = 0;
          for (const t of sortedTests) {
            if (t.isCorrect === 1) recentCorrectStreak++;
            else break;
          }

          const mostRecentTest = sortedTests[0] || null;
          const mostRecentTestWasPoor = mostRecentTest
            ? ((mostRecentTest.similarityScore ?? 0) < 50)
            : false;

           const avgRecallTime = qTests.length > 0
            ? qTests.reduce((sum, t) => sum + (t.recallTime || 0), 0) / qTests.length
            : undefined;
          const testSignal: TestSignal = {
            testCount: qTests.length,
            correctCount: correctTests.length,
            wrongCount: wrongTests.length,
            averageSimilarityScore: Math.round(avgSimilarity),
            mostRecentTestAt: sortedTests.length > 0
              ? new Date(sortedTests[0].completedAt)
              : null,
            recentCorrectStreak,
            mostRecentTestWasPoor,
            averageRecallTime: avgRecallTime,
            recentTestHistory: sortedTests.map(t => ({
              completedAt: new Date(t.completedAt),
              isCorrect: t.isCorrect === 1,
              similarityScore: t.similarityScore ?? 0,
            })),
          };
          const confidenceBase = computeExamConfidence({
            practice: practiceSignal,
            test: testSignal,
            now,
            examDate,
            userProfile,
            initialEstimate: buildInitialConfidenceEstimate(questionById.get(qId) ?? {}),
          });
          const starterInitialScoreOverride = getStarterInitialScoreOverride({
            subjectName: subject?.name,
            question: questionById.get(qId),
            practiceCount: qPractice.length,
            testCount: qTests.length,
            userRole: ctx.user.role,
          });
          let confidence = starterInitialScoreOverride === null
            ? confidenceBase
            : applyDisplayScoreOverride(confidenceBase, starterInitialScoreOverride);
          const starterBaseScore = getStarterBaseScoreOverride({
            subjectName: subject?.name,
            question: questionById.get(qId),
            userRole: ctx.user.role,
          });
          if (starterBaseScore !== null && qTests.length === 0 && qPractice.length > 0) {
            confidence = applyStarterPracticeFloor(confidence, starterBaseScore, qPractice.length);
          }
          confidence = applyUnlearnedLabel(confidence);
          results.push({ questionId: qId, confidence });
        }

        const aggregate = aggregateConfidence(results.map(r => r.confidence));

        // 배지 계산
        const badgeMap: Record<number, { lastTestWrong: boolean; frequentlyWrong: boolean; hasWarnZone: boolean }> = {};
        for (const qId of questionIds) {
          const qTests = testsByQuestion.get(qId) ?? [];
          const sortedQTests = [...qTests].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
          const lastTest = sortedQTests[0];
          const lastTestWrong = !!lastTest && lastTest.isCorrect === 0;
          const wrongCount = qTests.filter(t => t.isCorrect === 0).length;
          const frequentlyWrong = qTests.length >= 3 && wrongCount / qTests.length >= 0.5;
          const hasWarnZone = extractWarnZoneLinesFromTests(qTests).length > 0;
          badgeMap[qId] = { lastTestWrong, frequentlyWrong, hasWarnZone };
        }

        return {
          questions: results.map(r => ({
            questionId: r.questionId,
            displayScore: r.confidence.displayScore,
            state: r.confidence.state,
            label: r.confidence.label,
            isColdStart: r.confidence.isColdStart,
            displayOrder: questionById.get(r.questionId)?.displayOrder ?? 0,
            isStarred: questionById.get(r.questionId)?.isStarred ?? 0,
            badges: badgeMap[r.questionId] ?? { lastTestWrong: false, frequentlyWrong: false, hasWarnZone: false },
          })),
          aggregate,
        };
      }),
    // 문제 안정도 시간별 변화 이력 조회
    getHistory: protectedProcedure
      .input(z.object({ questionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
        const allTests = await db.getTestSessionsByUserId(ctx.user.id);
        const userProfile = buildUserAdaptiveProfile(allPractice, allTests);
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인 문제만 조회할 수 있습니다" });
        }
        const subject = question?.subjectId ? await db.getSubjectById(question.subjectId) : null;
        const examDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;
        const initialEstimate = question ? buildInitialConfidenceEstimate(question) : undefined;
        const qPractice = allPractice
          .filter(p => p.questionId === input.questionId)
          .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
        const qTests = allTests
          .filter(t => t.questionId === input.questionId)
          .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
        const starterBaseScore = getStarterBaseScoreOverride({
          subjectName: subject?.name,
          question,
          userRole: ctx.user.role,
        });

        // 모든 이벤트를 시간순으로 합치기
        type Ev = { at: Date; type: 'practice' | 'test'; idx: number };
        const events: Ev[] = [
          ...qPractice.map((p, i) => ({ at: new Date(p.completedAt), type: 'practice' as const, idx: i })),
          ...qTests.map((t, i) => ({ at: new Date(t.completedAt), type: 'test' as const, idx: i })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());

        if (events.length === 0) {
          const nowForPreview = new Date();
          const emptyPracticeSignal: PracticeSignal = {
            practiceCount: 0,
            totalPracticeDuration: 0,
            mostRecentPracticeAt: null,
          };
          const emptyTestSignal: TestSignal = {
            testCount: 0,
            correctCount: 0,
            wrongCount: 0,
            averageSimilarityScore: 0,
            mostRecentTestAt: null,
            recentCorrectStreak: 0,
            mostRecentTestWasPoor: false,
            recentTestHistory: [],
          };
          const baseConfidence = computeExamConfidence({
            practice: emptyPracticeSignal,
            test: emptyTestSignal,
            now: nowForPreview,
            examDate,
            userProfile,
            initialEstimate,
          });
          const starterInitialScoreOverride = getStarterInitialScoreOverride({
            subjectName: subject?.name,
            question,
            practiceCount: 0,
            testCount: 0,
            userRole: ctx.user.role,
          });
          const effectiveConfidence = applyUnlearnedLabel(
            starterInitialScoreOverride === null
              ? baseConfidence
              : applyDisplayScoreOverride(baseConfidence, starterInitialScoreOverride)
          );
          const scenario = buildUnlearnedScenarioEvents(
            question,
            initialEstimate ?? buildInitialConfidenceEstimate(question),
            effectiveConfidence.displayScore
          );
          return {
            points: mapScenarioEventsToHistoryPoints(scenario, nowForPreview.getTime()),
            isExample: true,
            previewLabel: "미학습 예상 시나리오",
          };
        }

        // 각 이벤트 시점에서 안정도 계산 (누적 방식)
        const points: {
          at: string;
          score: number;
          state: string;
          eventType: string;
          isCorrect?: boolean;
          accuracyRate?: number;
          practiceSessionCount?: number;
        }[] = [];
        let pCount = 0, pDuration = 0;
        let mostRecentPracticeAt: Date | null = null;
        const cumTests: typeof qTests = [];

        for (const ev of events) {
          if (ev.type === 'practice') {
            const p = qPractice[ev.idx];
            pCount++;
            pDuration += p.duration;
            mostRecentPracticeAt = new Date(p.completedAt);
          } else {
            cumTests.push(qTests[ev.idx]);
          }

          const practiceSignal: PracticeSignal = {
            practiceCount: pCount,
            totalPracticeDuration: pDuration,
            mostRecentPracticeAt,
          };

          const sortedCumTests = [...cumTests].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
          let streak = 0;
          for (const t of sortedCumTests) { if (t.isCorrect === 1) streak++; else break; }
          const mostRecentTest = sortedCumTests[0] || null;
          const avgSimilarity = cumTests.length > 0 ? cumTests.reduce((s, t) => s + (t.similarityScore || 0), 0) / cumTests.length : 0;
          const avgRecallTime = cumTests.length > 0 ? cumTests.reduce((s, t) => s + (t.recallTime || 0), 0) / cumTests.length : undefined;

          const testSignal: TestSignal = {
            testCount: cumTests.length,
            correctCount: cumTests.filter(t => t.isCorrect === 1).length,
            wrongCount: cumTests.filter(t => t.isCorrect === 0).length,
            averageSimilarityScore: Math.round(avgSimilarity),
            mostRecentTestAt: mostRecentTest ? new Date(mostRecentTest.completedAt) : null,
            recentCorrectStreak: streak,
            mostRecentTestWasPoor: mostRecentTest ? ((mostRecentTest.similarityScore ?? 0) < 50) : false,
            averageRecallTime: avgRecallTime,
            recentTestHistory: sortedCumTests.map(t => ({
              completedAt: new Date(t.completedAt),
              isCorrect: t.isCorrect === 1,
              similarityScore: t.similarityScore ?? 0,
            })),
          };

          let result = computeExamConfidence({
            practice: practiceSignal,
            test: testSignal,
            now: ev.at,
            examDate,
            userProfile,
            initialEstimate,
          });
          if (starterBaseScore !== null && cumTests.length === 0 && pCount > 0) {
            result = applyStarterPracticeFloor(result, starterBaseScore, pCount);
          }
          const lastTest = ev.type === 'test' ? qTests[ev.idx] : undefined;
          // 시험 정답률: similarityScore를 accuracyRate로 사용 (evaluate 시 저장됨)
          const testAccuracyRate = lastTest?.similarityScore ?? undefined;
          points.push({
            at: ev.at.toISOString(),
            score: result.displayScore,
            state: result.state,
            eventType: ev.type,
            ...(ev.type === "practice" ? { practiceSessionCount: pCount } : {}),
            ...(ev.type === 'test' ? {
              isCorrect: lastTest?.isCorrect === 1,
              accuracyRate: testAccuracyRate,
            } : {}),
          });
        }

        // 현재 시점 안정도도 추가 (마지막 이벤트 이후 망각 반영)
        const now = new Date();
        const lastEvent = events[events.length - 1];
        if (now.getTime() - lastEvent.at.getTime() > 3600_000) {
          const practiceSignal: PracticeSignal = {
            practiceCount: qPractice.length,
            totalPracticeDuration: qPractice.reduce((s, p) => s + p.duration, 0),
            mostRecentPracticeAt: qPractice.length > 0 ? new Date(qPractice[qPractice.length - 1].completedAt) : null,
          };
          const sortedTests = [...qTests].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
          let streak = 0;
          for (const t of sortedTests) { if (t.isCorrect === 1) streak++; else break; }
          const mostRecentTest = sortedTests[0] || null;
          const avgSimilarity = qTests.length > 0 ? qTests.reduce((s, t) => s + (t.similarityScore || 0), 0) / qTests.length : 0;
          const avgRecallTime = qTests.length > 0 ? qTests.reduce((s, t) => s + (t.recallTime || 0), 0) / qTests.length : undefined;
          const testSignal: TestSignal = {
            testCount: qTests.length,
            correctCount: qTests.filter(t => t.isCorrect === 1).length,
            wrongCount: qTests.filter(t => t.isCorrect === 0).length,
            averageSimilarityScore: Math.round(avgSimilarity),
            mostRecentTestAt: mostRecentTest ? new Date(mostRecentTest.completedAt) : null,
            recentCorrectStreak: streak,
            mostRecentTestWasPoor: mostRecentTest ? ((mostRecentTest.similarityScore ?? 0) < 50) : false,
            averageRecallTime: avgRecallTime,
            recentTestHistory: sortedTests.map(t => ({
              completedAt: new Date(t.completedAt),
              isCorrect: t.isCorrect === 1,
              similarityScore: t.similarityScore ?? 0,
            })),
          };
          let result = computeExamConfidence({
            practice: practiceSignal,
            test: testSignal,
            now,
            examDate,
            userProfile,
            initialEstimate,
          });
          if (starterBaseScore !== null && qTests.length === 0 && qPractice.length > 0) {
            result = applyStarterPracticeFloor(result, starterBaseScore, qPractice.length);
          }
          points.push({ at: now.toISOString(), score: result.displayScore, state: result.state, eventType: 'now' });
        }

        return { points };
      }),

    // 과목 전체 시간별 평균 안정도 추이
    getHistoryBySubject: protectedProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ ctx, input }) => {
        await assertSubjectOwnershipOrThrow(input.subjectId, ctx.user.id);
        const subjectQuestions = await db.getQuestionsBySubjectId(input.subjectId);
        const questionIds = subjectQuestions.map(q => q.id);
        if (questionIds.length === 0) return { points: [] };
        const subject = await db.getSubjectById(input.subjectId);
        const examDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;
        const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
        const allTests = await db.getTestSessionsByUserId(ctx.user.id);
        const userProfile = buildUserAdaptiveProfile(allPractice, allTests);
        const questionById = new Map(subjectQuestions.map((q) => [q.id, q]));
        const starterBaseScoreByQuestionId = new Map<number, number | null>();
        for (const qId of questionIds) {
          starterBaseScoreByQuestionId.set(
            qId,
            getStarterBaseScoreOverride({
              subjectName: subject?.name,
              question: questionById.get(qId),
              userRole: ctx.user.role,
            })
          );
        }
        const qPractice = allPractice.filter(p => questionIds.includes(p.questionId));
        const qTests = allTests.filter(t => questionIds.includes(t.questionId));
        // 모든 이벤트를 시간순으로 합치기
        type Ev = { at: Date; type: 'practice' | 'test'; questionId: number; sessionIdx: number };
        const events: Ev[] = [
          ...qPractice.map((p, i) => ({ at: new Date(p.completedAt), type: 'practice' as const, questionId: p.questionId, sessionIdx: i })),
          ...qTests.map((t, i) => ({ at: new Date(t.completedAt), type: 'test' as const, questionId: t.questionId, sessionIdx: i })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());
        if (events.length === 0) return { points: [] };
        // 문제별 누적 상태 추적
        const cumPractice: Map<number, typeof qPractice> = new Map();
        const cumTests: Map<number, typeof qTests> = new Map();
        for (const qId of questionIds) {
          cumPractice.set(qId, []);
          cumTests.set(qId, []);
        }
        // 이벤트 간격 축소 (같은 시간대 이벤트 묶기)
        const BUCKET_MS = 60_000;
        let lastBucketAt = -Infinity;
        const points: { at: string; score: number; eventType: string; questionCount: number }[] = [];
        for (const ev of events) {
          if (ev.type === 'practice') {
            cumPractice.get(ev.questionId)!.push(qPractice[ev.sessionIdx]);
          } else {
            cumTests.get(ev.questionId)!.push(qTests[ev.sessionIdx]);
          }
          if (ev.at.getTime() - lastBucketAt < BUCKET_MS) continue;
          lastBucketAt = ev.at.getTime();
          let totalScore = 0;
          let activeCount = 0;
          for (const qId of questionIds) {
            const pList = cumPractice.get(qId)!;
            const tList = cumTests.get(qId)!;
            if (pList.length === 0 && tList.length === 0) continue;
            activeCount++;
            const practiceSignal: PracticeSignal = {
              practiceCount: pList.length,
              totalPracticeDuration: pList.reduce((s, p) => s + p.duration, 0),
              mostRecentPracticeAt: pList.length > 0 ? new Date(pList[pList.length - 1].completedAt) : null,
            };
            const sortedT = [...tList].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
            let streak = 0;
            for (const t of sortedT) { if (t.isCorrect === 1) streak++; else break; }
            const mostRecentTest = sortedT[0] || null;
            const avgSim = tList.length > 0 ? tList.reduce((s, t) => s + (t.similarityScore || 0), 0) / tList.length : 0;
            const testSignal: TestSignal = {
              testCount: tList.length,
              correctCount: tList.filter(t => t.isCorrect === 1).length,
              wrongCount: tList.filter(t => t.isCorrect === 0).length,
              averageSimilarityScore: Math.round(avgSim),
              mostRecentTestAt: mostRecentTest ? new Date(mostRecentTest.completedAt) : null,
              recentCorrectStreak: streak,
              mostRecentTestWasPoor: mostRecentTest ? ((mostRecentTest.similarityScore ?? 0) < 50) : false,
              recentTestHistory: sortedT.map(t => ({
                completedAt: new Date(t.completedAt),
                isCorrect: t.isCorrect === 1,
                similarityScore: t.similarityScore ?? 0,
              })),
            };
            let result = computeExamConfidence({
              practice: practiceSignal,
              test: testSignal,
              now: ev.at,
              examDate,
              userProfile,
            });
            const starterBaseScore = starterBaseScoreByQuestionId.get(qId) ?? null;
            if (starterBaseScore !== null && tList.length === 0 && pList.length > 0) {
              result = applyStarterPracticeFloor(result, starterBaseScore, pList.length);
            }
            totalScore += result.displayScore;
          }
          if (activeCount === 0) continue;
          points.push({ at: ev.at.toISOString(), score: Math.round(totalScore / activeCount), eventType: ev.type, questionCount: activeCount });
        }
        // 현재 시점 안정도 추가
        const nowDate = new Date();
        const lastEvent = events[events.length - 1];
        if (nowDate.getTime() - lastEvent.at.getTime() > 3600_000) {
          let totalScore = 0;
          let activeCount = 0;
          for (const qId of questionIds) {
            const pList = cumPractice.get(qId)!;
            const tList = cumTests.get(qId)!;
            if (pList.length === 0 && tList.length === 0) continue;
            activeCount++;
            const practiceSignal: PracticeSignal = {
              practiceCount: pList.length,
              totalPracticeDuration: pList.reduce((s, p) => s + p.duration, 0),
              mostRecentPracticeAt: pList.length > 0 ? new Date(pList[pList.length - 1].completedAt) : null,
            };
            const sortedT = [...tList].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
            let streak = 0;
            for (const t of sortedT) { if (t.isCorrect === 1) streak++; else break; }
            const mostRecentTest = sortedT[0] || null;
            const avgSim = tList.length > 0 ? tList.reduce((s, t) => s + (t.similarityScore || 0), 0) / tList.length : 0;
            const testSignal: TestSignal = {
              testCount: tList.length,
              correctCount: tList.filter(t => t.isCorrect === 1).length,
              wrongCount: tList.filter(t => t.isCorrect === 0).length,
              averageSimilarityScore: Math.round(avgSim),
              mostRecentTestAt: mostRecentTest ? new Date(mostRecentTest.completedAt) : null,
              recentCorrectStreak: streak,
              mostRecentTestWasPoor: mostRecentTest ? ((mostRecentTest.similarityScore ?? 0) < 50) : false,
            };
            let result = computeExamConfidence({
              practice: practiceSignal,
              test: testSignal,
              now: nowDate,
              examDate,
              userProfile,
            });
            const starterBaseScore = starterBaseScoreByQuestionId.get(qId) ?? null;
            if (starterBaseScore !== null && tList.length === 0 && pList.length > 0) {
              result = applyStarterPracticeFloor(result, starterBaseScore, pList.length);
            }
            totalScore += result.displayScore;
          }
          if (activeCount > 0) {
            points.push({ at: nowDate.toISOString(), score: Math.round(totalScore / activeCount), eventType: 'now', questionCount: activeCount });
          }
        }
        return { points };
      }),
  }),
  // Admin routes
  admin: adminRouter,
});;

export type AppRouter = typeof appRouter;
/**
 * 초기 안정도 데이터 생성
 * 문제 길이와 난이도를 고려하여 realistic한 초기값 설정
 */
async function createInitialDataForUser(userId: number) {
  // 1. 초기 과목 생성
  const subject1 = await db.createSubject({
    userId,
    name: "영어 단어",
    description: "일상 영어 단어 암기",
    color: "#3B82F6",
    displayOrder: 1,
  });

  const subject2 = await db.createSubject({
    userId,
    name: "한국사",
    description: "한국사 시험 대비",
    color: "#EF4444",
    displayOrder: 2,
  });

  const subject3 = await db.createSubject({
    userId,
    name: "수학 공식",
    description: "수학 공식 및 정리",
    color: "#10B981",
    displayOrder: 3,
  });

  // 2. 각 과목별 문제 생성 및 초기 안정도 설정
  await createSubjectQuestionsWithData(userId, subject1.id, "short");
  await createSubjectQuestionsWithData(userId, subject2.id, "medium");
  await createSubjectQuestionsWithData(userId, subject3.id, "long");
}

/**
 * 문제 길이별 초기 데이터 생성
 */
async function createSubjectQuestionsWithData(
  userId: number,
  subjectId: number,
  length: "short" | "medium" | "long"
) {
  const questionTemplates = {
    short: [
      { q: "apple", a: "사과" },
      { q: "book", a: "책" },
      { q: "cat", a: "고양이" },
      { q: "dog", a: "개" },
      { q: "tree", a: "나무" },
    ],
    medium: [
      { q: "삼국통일을 이룬 왕은?", a: "신문왕" },
      { q: "한글을 창제한 왕은?", a: "세종대왕" },
      { q: "임진왜란을 격퇴한 장군은?", a: "이순신" },
      { q: "조선을 건국한 인물은?", a: "이성계" },
      { q: "한반도 최초의 국가는?", a: "고조선" },
    ],
    long: [
      { q: "이차방정식의 근의 공식은?", a: "x = (-b ± √(b²-4ac)) / 2a" },
      { q: "삼각함수 sin²θ + cos²θ = ?", a: "1" },
      { q: "원의 넓이 공식은?", a: "πr²" },
      { q: "피타고라스 정리는?", a: "a² + b² = c²" },
      { q: "등차수열의 합 공식은?", a: "Sn = n(a₁ + aₙ)/2" },
    ],
  };

  const templates = questionTemplates[length];
  const now = new Date();

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const question = await db.createQuestion({
      userId,
      subjectId,
      question: template.q,
      answer: template.a,
      difficulty: length === "short" ? "easy" : length === "medium" ? "medium" : "hard",
      displayOrder: i + 1,
      isDemo: 0,
    });

    // 초기 연습 세션 생성 (realistic한 데이터)
    const practiceCount = length === "short" ? 5 : length === "medium" ? 3 : 2;
    for (let j = 0; j < practiceCount; j++) {
      const daysAgo = Math.floor(Math.random() * 14);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      await db.createPracticeSession({
        userId,
        questionId: question.id,
        duration: length === "short" ? 10 + Math.random() * 20 : length === "medium" ? 30 + Math.random() * 40 : 50 + Math.random() * 60,
        typingSpeed: length === "short" ? 300 + Math.random() * 100 : length === "medium" ? 250 + Math.random() * 100 : 200 + Math.random() * 80,
        accuracy: 80 + Math.random() * 20, // 80-100% 정확도
        errorCount: Math.floor(Math.random() * 3),
        completedAt: sessionDate,
      });
    }

    // 초기 시험 세션 생성
    const testCount = length === "short" ? 3 : length === "medium" ? 2 : 1;
    for (let j = 0; j < testCount; j++) {
      const daysAgo = Math.floor(Math.random() * 7);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      await db.createTestSession({
        userId,
        questionId: question.id,
        userAnswer: template.a,
        isCorrect: Math.random() > 0.15 ? 1 : 0, // 85% 정답률
        similarityScore: 85 + Math.random() * 15,
        recallTime: length === "short" ? 1500 + Math.random() * 2000 : length === "medium" ? 3500 + Math.random() * 4000 : 5500 + Math.random() * 6000,
        completedAt: sessionDate,
      });
    }
  }
}
