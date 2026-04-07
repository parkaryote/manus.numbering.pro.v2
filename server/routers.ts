import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { sdk } from "./_core/sdk.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { adminRouter } from "./adminRouter.js";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc.js";
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

    // 소셜 로그인(내부 제공) - 외부 OAuth 리다이렉트 없이 세션 생성
    socialLogin: publicProcedure
      .input(
        z.object({
          provider: z.enum(["google", "apple", "kakao", "naver"]),
          socialId: z.string().min(6).max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const openId = `social_${input.provider}_${input.socialId}`;
        const providerName =
          input.provider === "google"
            ? "Google"
            : input.provider === "apple"
              ? "Apple"
              : input.provider === "kakao"
                ? "Kakao"
                : "Naver";

        let user = await db.getUserByOpenId(openId);
        let isNewSocialUser = false;
        if (!user) {
          isNewSocialUser = true;
          await db.upsertUser({
            openId,
            name: `${providerName} 사용자`,
            email: null,
            loginMethod: input.provider,
            lastSignedIn: new Date(),
          });
          user = await db.getUserByOpenId(openId);
          if (!user) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "소셜 계정 생성 실패",
            });
          }
        }

        // 게스트에서 소셜로 전환할 때는 신규/기존 소셜 계정 모두 진행 데이터를 병합한다.
        if (ctx.user?.loginMethod === "guest" && ctx.user.id !== user.id) {
          await mergeGuestDataToUser(ctx.user.id, user.id);
        }

        await syncStarterDataSafely(user.id);

        const sessionToken = await sdk.createSessionToken(openId, {
          name: user.name || `${providerName} 사용자`,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        cookieResponse(ctx.res).cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return { success: true, userId: user.id, provider: input.provider };
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
      return db.getDemoSubjects();
    }),
    
    questions: publicProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        return db.getDemoQuestions(input.subjectId);
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

        // 텍스트 문제 줄 단위 채점
        const userLines = input.userAnswer.split('\n').map(line => line.trim());
        const correctLines = correctAnswer.split('\n').map(line => line.trim());

        const lineComparisons: any[] = [];
        let correctLineCount = 0;
        const totalLines = correctLines.length;

        for (let i = 0; i < totalLines; i++) {
          const correctLine = correctLines[i].toLowerCase().replace(/\s+/g, "");
          const userLine = (userLines[i] || "").toLowerCase().replace(/\s+/g, "");
          const isLineCorrect = userLine === correctLine;
          if (isLineCorrect) correctLineCount++;

          lineComparisons.push({
            lineIndex: i + 1,
            correctAnswer: correctLines[i],
            userAnswer: userLines[i] || "",
            isCorrect: isLineCorrect
          });
        }

        const isCorrect = correctLineCount === totalLines && userLines.length === totalLines;
        const accuracyRate = totalLines > 0 ? Math.round((correctLineCount / totalLines) * 100) : 0;
        const similarityScore = calcCharSimilarity(input.userAnswer, correctAnswer);

        return {
          isCorrect,
          similarityScore,
          accuracyRate,
          correctLineCount,
          totalLines,
          mistakes: lineComparisons,
          feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctLineCount}/${totalLines} 줄 정답`,
          missingKeywords: [],
        };
      }),
  }),

  // Subject management
  subjects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await syncStarterDataSafely(ctx.user.id);
      return db.getSubjectsByUserId(ctx.user.id);
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
        isDemo: z.number().optional(), // 0 or 1
      }))
      .mutation(async ({ ctx, input }) => {
        return db.createSubject({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          color: input.color,
          examEndDate: input.examEndDate ? parseExamEndDateInput(input.examEndDate) : undefined,
          isDemo: input.isDemo ?? 0,
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
        if (examEndDate !== undefined) {
          updateData.examEndDate = examEndDate ? parseExamEndDateInput(examEndDate) : null;
        }
        return db.updateSubject(id, updateData);
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
          isDemo: input.isDemo ?? 0,
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
        await assertQuestionOwnershipOrThrow(id, ctx.user.id);
        return db.updateQuestion(id, data);
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
          
          // Line-by-line comparison for text questions
          const userLines = input.userAnswer.split('\n').map(line => line.trim());
          const correctLines = correctAnswer.split('\n').map(line => line.trim());
          
          // Compare each line and build lineComparisons array
          const lineComparisons: any[] = [];
          let correctLineCount = 0;
          const totalLines = correctLines.length;
          
          for (let i = 0; i < totalLines; i++) {
            const correctLine = correctLines[i].toLowerCase().replace(/\s+/g, "");
            const userLine = (userLines[i] || "").toLowerCase().replace(/\s+/g, "");
            const isLineCorrect = userLine === correctLine;
            
            if (isLineCorrect) {
              correctLineCount++;
            }
            
            lineComparisons.push({
              lineIndex: i + 1,
              correctAnswer: correctLines[i],
              userAnswer: userLines[i] || "",
              isCorrect: isLineCorrect
            });
          }
          
          // 정답 판별: 모든 줄이 완벽히 일치해야 정답
          const isCorrect = correctLineCount === totalLines && userLines.length === totalLines;
          
          // Calculate accuracy rate based on correct lines
          const accuracyRate = totalLines > 0 ? Math.round((correctLineCount / totalLines) * 100) : 0;
          const similarityScore = calcCharSimilarity(input.userAnswer, correctAnswer);
          
          console.log("[DEBUG] Line-by-line comparison mode");
          console.log("[DEBUG] correctLineCount:", correctLineCount, "/", totalLines);
          console.log("[DEBUG] isCorrect:", isCorrect);
          console.log("[DEBUG] accuracyRate:", accuracyRate);
          console.log("[DEBUG] similarityScore:", similarityScore);
          
          // Save test session
          await db.createTestSession({
            userId: ctx.user.id,
            questionId: input.questionId,
            userAnswer: input.userAnswer,
            isCorrect: isCorrect ? 1 : 0,
            recallTime: input.recallTime,
            similarityScore,
            mistakeHighlights: JSON.stringify(lineComparisons),
            llmFeedback: null,
          });
          
          return {
            isCorrect,
            similarityScore,
            accuracyRate,
            correctLineCount,
            totalLines,
            mistakes: lineComparisons,
            feedback: isCorrect ? "정확하게 작성하셨습니다!" : `${correctLineCount}/${totalLines} 줄 정답`,
            missingKeywords: [],
          };
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
      .input(z.object({ s3Url: z.string(), fileName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        ensureOCREnabled();
        try {
          // Download file from S3
          const response = await fetch(input.s3Url);
          if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
          }
          const fileBuffer = await response.arrayBuffer();

          // Upload to GCS
          const gcsUri = await ocrModule.uploadToGCS(
            Buffer.from(fileBuffer),
            input.fileName
          );

          // Start Vision API job
          const operationName = await ocrModule.startOCRJob(gcsUri);

          // Create job record in database
          const job = await db.createOcrJob({
            userId: ctx.user.id,
            fileName: input.fileName,
            s3Url: input.s3Url,
            gcsUri,
            operationName,
            status: "processing",
          });

          return { jobId: job.id, status: "processing" };
        } catch (error) {
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
        const questionById = new Map(subjectQuestions.map((q) => [q.id, q]));

        const subject = await db.getSubjectById(input.subjectId);
        const examDate = subject?.examEndDate ? new Date(subject.examEndDate) : null;

        const allPractice = await db.getPracticeSessionsByUserId(ctx.user.id);
        const allTests = await db.getTestSessionsByUserId(ctx.user.id);
        const now = new Date();
        const userProfile = buildUserAdaptiveProfile(allPractice, allTests);

        const results: { questionId: number; confidence: ConfidenceResult }[] = [];

        for (const qId of questionIds) {
          const qPractice = allPractice.filter(p => p.questionId === qId);
          const qTests = allTests.filter(t => t.questionId === qId);

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
          results.push({ questionId: qId, confidence });
        }

        const aggregate = aggregateConfidence(results.map(r => r.confidence));

        // 배지 계산
        const allTestsForSubject = allTests.filter(t => questionIds.includes(t.questionId));
        const badgeMap: Record<number, { lastTestWrong: boolean; frequentlyWrong: boolean; hasWarnZone: boolean }> = {};
        for (const qId of questionIds) {
          const qTests = allTestsForSubject.filter(t => t.questionId === qId);
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

        if (events.length === 0) return { points: [] };

        // 각 이벤트 시점에서 안정도 계산 (누적 방식)
        const points: { at: string; score: number; state: string; eventType: string; isCorrect?: boolean; accuracyRate?: number }[] = [];
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
