import { protectedProcedure, router } from "./_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db.js";
import { ENV } from "./_core/env.js";
import { and, eq, or } from "drizzle-orm";
import { subjects } from "../drizzle/schema.js";

// 관리자 권한 확인 미들웨어
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "관리자만 접근할 수 있습니다",
    });
  }
  return next({ ctx });
});

function assertDemoPublishingEnabled(role?: "admin" | "user") {
  // Admin workspace operations should remain available even when public demo publishing is locked.
  if (role === "admin") return;
  if (!ENV.allowDemoPublishing) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "데모 공개는 잠금 상태입니다. ALLOW_DEMO_PUBLISHING=true 설정 후 시도하세요.",
    });
  }
}

const TOOTH_MORPHOLOGY_SUBJECT_NAME = "치아형태학";
const HARD_CODED_TOOTH_BOX7_DEMO_QUESTION_TEXT =
  'Box-7 소구치의 견치, 대구치의 중간 단계로서의 특징 중 "대구치의 특징"';
const HARD_CODED_TOOTH_BOX7_DEMO_ANSWER = [
  "1. 설측교두 존재",
  "2. 교합면이 있어 가는 기능 보조",
  "3. 상악 제1 소구치는 2개의 치근",
].join("\n");
const TOOTH_MOLAR_CUSP_RIDGE_DEMO_QUESTION_TEXT =
  "[]는 구치들의 교합면에서 작은 산봉우리처럼 튀어나온 부분이고, []은 선 모양으로 솟아있는 부분이다.";
const TOOTH_MOLAR_CUSP_RIDGE_DEMO_FALLBACK_ANSWER = [
  "1. 교두",
  "2. 융선",
].join("\n");
const TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT = "치아의 방향 중 빈칸을 채우시오.";
const TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT_CANDIDATES = [
  TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT,
  "치아의 방향 중 빈칸을 채우시오",
];
const TOOTH_SHOWCASE_KEYS_IN_ORDER = [
  "box1",
  "box7",
  "cusp_ridge",
  "direction_blank",
  "box9",
  "table_i3",
] as const;
const TOOTH_PUBLIC_SHOWCASE_KEYS_IN_ORDER = [
  "box7",
  "cusp_ridge",
  "direction_blank",
  "box9",
  "table_i3",
] as const;
type ToothShowcaseKey = (typeof TOOTH_SHOWCASE_KEYS_IN_ORDER)[number];

const TOOTH_SHOWCASE_TITLE_CANDIDATES: Record<ToothShowcaseKey, string[]> = {
  box1: ["Box-1 절치들의 근원심구별"],
  box7: [HARD_CODED_TOOTH_BOX7_DEMO_QUESTION_TEXT],
  cusp_ridge: [TOOTH_MOLAR_CUSP_RIDGE_DEMO_QUESTION_TEXT],
  direction_blank: TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT_CANDIDATES,
  box9: ["Box-9 하악 제1소구치와 제2소구치의 차이점"],
  table_i3: ["표 I-3 상악 치아 크기"],
};

function normalizeSubjectNameValue(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeLookupValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^0-9a-z가-힣]/g, "");
}

const TOOTH_MORPHOLOGY_SUBJECT_KEY = normalizeSubjectNameValue(TOOTH_MORPHOLOGY_SUBJECT_NAME);
const TOOTH_SHOWCASE_TITLE_LOOKUP: Record<ToothShowcaseKey, string[]> = {
  box1: TOOTH_SHOWCASE_TITLE_CANDIDATES.box1.map((title) => normalizeLookupValue(title)),
  box7: TOOTH_SHOWCASE_TITLE_CANDIDATES.box7.map((title) => normalizeLookupValue(title)),
  cusp_ridge: TOOTH_SHOWCASE_TITLE_CANDIDATES.cusp_ridge.map((title) => normalizeLookupValue(title)),
  direction_blank: TOOTH_SHOWCASE_TITLE_CANDIDATES.direction_blank.map((title) => normalizeLookupValue(title)),
  box9: TOOTH_SHOWCASE_TITLE_CANDIDATES.box9.map((title) => normalizeLookupValue(title)),
  table_i3: TOOTH_SHOWCASE_TITLE_CANDIDATES.table_i3.map((title) => normalizeLookupValue(title)),
};

const BOX9_DEMO_FOCUSED_PRACTICE_CELLS = ["1개", "1개 또는 2개", "3:1", "2:1"];
const BOX9_DEMO_FOCUSED_PRACTICE_CELL_LOOKUP = new Set(
  BOX9_DEMO_FOCUSED_PRACTICE_CELLS.map((value) =>
    value.toLowerCase().replace(/\s+/g, "")
  )
);

function normalizeBox9DemoTableData(
  tableData: string | null | undefined
): { nextTableData: string | null; changed: boolean; focusedCellCount: number } {
  if (!tableData) return { nextTableData: tableData ?? null, changed: false, focusedCellCount: 0 };

  try {
    const parsed = JSON.parse(tableData);
    const rows: any[][] = Array.isArray(parsed?.cells) ? parsed.cells : [];
    if (rows.length === 0) return { nextTableData: tableData, changed: false, focusedCellCount: 0 };

    let changed = false;
    let focusedCellCount = 0;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell || typeof cell !== "object") continue;
        if (cell.isMerged) continue;
        const rawContent = typeof cell.content === "string" ? cell.content : "";
        const normalized = rawContent.toLowerCase().replace(/\s+/g, "");
        const shouldBlank = BOX9_DEMO_FOCUSED_PRACTICE_CELL_LOOKUP.has(normalized);
        if (shouldBlank) focusedCellCount += 1;
        const currentBlank = cell.isBlank === true;
        if (currentBlank !== shouldBlank) {
          cell.isBlank = shouldBlank;
          changed = true;
        }
      }
    }

    return {
      nextTableData: changed ? JSON.stringify(parsed) : tableData,
      changed,
      focusedCellCount,
    };
  } catch {
    return { nextTableData: tableData, changed: false, focusedCellCount: 0 };
  }
}

function isToothMorphologySubjectName(subjectName: string | null | undefined): boolean {
  return normalizeSubjectNameValue(subjectName) === TOOTH_MORPHOLOGY_SUBJECT_KEY;
}

function resolveToothShowcaseKey(questionTitle: string | null | undefined): ToothShowcaseKey | null {
  const normalizedTitle = normalizeLookupValue(questionTitle);
  if (!normalizedTitle) return null;
  for (const key of TOOTH_SHOWCASE_KEYS_IN_ORDER) {
    const candidates = TOOTH_SHOWCASE_TITLE_LOOKUP[key];
    if (candidates.some((candidate) => normalizedTitle.includes(candidate) || candidate.includes(normalizedTitle))) {
      return key;
    }
  }
  return null;
}

function pickToothShowcaseQuestions<T extends { question?: string | null; displayOrder?: number | null }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const picked = new Map<ToothShowcaseKey, T>();
  for (const row of sorted) {
    const key = resolveToothShowcaseKey(row.question);
    if (!key || picked.has(key)) continue;
    picked.set(key, row);
  }
  return TOOTH_PUBLIC_SHOWCASE_KEYS_IN_ORDER.flatMap((key) => {
    const row = picked.get(key);
    return row ? [row] : [];
  });
}

async function ensureHardcodedToothBox7DemoQuestionExists() {
  const demoSubjects = await db.getAllDemoSubjects();
  const toothDemoSubject = demoSubjects.find((subject) => isToothMorphologySubjectName(subject.name));
  if (!toothDemoSubject) return;

  const ownerUser = ENV.ownerEmail ? await db.getUserByEmail(ENV.ownerEmail) : undefined;
  const preferredOwnerId = ownerUser?.id ?? null;

  const upsertShowcaseDemoQuestion = async (input: {
    questionText: string;
    questionTextCandidates?: string[];
    fallbackAnswer: string;
    displayOrder: number;
    difficulty: "easy" | "medium" | "hard";
    fallbackAutoNumbering: number;
    requireSource?: boolean;
  }) => {
    const demoQuestions = await db.getDemoQuestionsBySubjectId(toothDemoSubject.id);
    const questionTextCandidates = Array.from(
      new Set(
        [input.questionText, ...(input.questionTextCandidates ?? [])]
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    const targetNormalizedSet = new Set(
      questionTextCandidates.map((value) => normalizeLookupValue(value))
    );
    const matchedQuestion = demoQuestions.find(
      (question) => targetNormalizedSet.has(normalizeLookupValue(question.question))
    );

    const sourceCandidates = (
      await Promise.all(
        questionTextCandidates.map((candidate) => db.getQuestionsByExactQuestionText(candidate))
      )
    ).flat();
    const source = [...sourceCandidates].sort((a, b) => {
      const score = (row: typeof sourceCandidates[number]) => {
        let value = 0;
        if (preferredOwnerId && row.userId === preferredOwnerId) value += 1000;
        if (row.isDemo === 0) value += 100;
        if (row.answer && row.answer.trim().length > 0) value += 20;
        if (row.tableData) value += 10;
        if (typeof row.displayOrder === "number") value += Math.max(0, row.displayOrder);
        return value;
      };
      return score(b) - score(a);
    })[0];
    if (!source && input.requireSource) {
      console.warn(
        `[AdminDemo] Missing source question for demo promotion: ${questionTextCandidates.join(" | ")}`
      );
      return;
    }

    const canonicalQuestionText =
      source?.question && source.question.trim().length > 0
        ? source.question
        : questionTextCandidates[0] ?? input.questionText;
    const payload = {
      question: canonicalQuestionText,
      answer: source?.answer && source.answer.trim().length > 0 ? source.answer : input.fallbackAnswer,
      autoNumbering: source?.autoNumbering ?? input.fallbackAutoNumbering,
      difficulty: source?.difficulty ?? input.difficulty,
      tableData: source?.tableData ?? undefined,
      imageUrl: source?.imageUrl ?? undefined,
      imageLabels: source?.imageLabels ?? undefined,
      useAIGrading: source?.useAIGrading ?? 0,
      isStarred: matchedQuestion?.isStarred ?? source?.isStarred ?? 0,
      displayOrder: input.displayOrder,
      memo: source?.memo ?? matchedQuestion?.memo ?? undefined,
    } as const;

    if (matchedQuestion) {
      await db.updateDemoQuestion(matchedQuestion.id, payload);
      return;
    }

    await db.createDemoQuestion({
      subjectId: toothDemoSubject.id,
      userId: toothDemoSubject.userId,
      isDemo: 1,
      ...payload,
    });
  };

  await upsertShowcaseDemoQuestion({
    questionText: HARD_CODED_TOOTH_BOX7_DEMO_QUESTION_TEXT,
    fallbackAnswer: HARD_CODED_TOOTH_BOX7_DEMO_ANSWER,
    displayOrder: 7,
    difficulty: "easy",
    fallbackAutoNumbering: 1,
  });
  await upsertShowcaseDemoQuestion({
    questionText: TOOTH_MOLAR_CUSP_RIDGE_DEMO_QUESTION_TEXT,
    fallbackAnswer: TOOTH_MOLAR_CUSP_RIDGE_DEMO_FALLBACK_ANSWER,
    displayOrder: 8,
    difficulty: "easy",
    fallbackAutoNumbering: 0,
  });
  await upsertShowcaseDemoQuestion({
    questionText: TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT,
    questionTextCandidates: TOOTH_DIRECTION_BLANK_DEMO_QUESTION_TEXT_CANDIDATES,
    fallbackAnswer: "",
    displayOrder: 9,
    difficulty: "medium",
    fallbackAutoNumbering: 1,
    requireSource: true,
  });

  const latestDemoQuestions = await db.getDemoQuestionsBySubjectId(toothDemoSubject.id);
  let deletedBox1 = false;
  for (const demoQuestion of latestDemoQuestions) {
    const showcaseKey = resolveToothShowcaseKey(demoQuestion.question);
    if (showcaseKey === "box1") {
      await db.deleteDemoQuestion(demoQuestion.id);
      deletedBox1 = true;
      continue;
    }
    if (showcaseKey === "box9") {
      const normalized = normalizeBox9DemoTableData(demoQuestion.tableData ?? null);
      if (normalized.changed) {
        await db.updateDemoQuestion(demoQuestion.id, {
          tableData: normalized.nextTableData ?? undefined,
        });
      }
    }
  }
  if (deletedBox1) {
    await db.normalizeQuestionDisplayOrderForSubject(toothDemoSubject.id);
  }
}

async function syncDemoSubjectToLinkedWorkspaces(demoSubjectId: number) {
  const database = await db.getDb();
  if (!database) return;

  const demoSubject = await db.getSubjectById(demoSubjectId);
  if (!demoSubject || demoSubject.isDemo !== 1) return;

  const rawDemoQuestions = await db.getDemoQuestionsBySubjectId(demoSubjectId);
  const demoQuestions = isToothMorphologySubjectName(demoSubject.name)
    ? pickToothShowcaseQuestions(rawDemoQuestions)
    : rawDemoQuestions;

  const candidateSubjects = await database
    .select()
    .from(subjects)
    .where(
      and(
        eq(subjects.isDemo, 0),
        or(
          eq(subjects.demoSourceSubjectId, demoSubjectId),
          eq(subjects.name, demoSubject.name)
        )
      )
    );

  for (const linkedSubject of candidateSubjects) {
    const existingQuestions = await db.getQuestionsBySubjectId(linkedSubject.id);
    const hasExplicitLink = linkedSubject.demoSourceSubjectId === demoSubjectId;
    const linkedQuestionCount = existingQuestions.filter(
      (question) =>
        typeof question.demoSourceQuestionId === "number" &&
        question.demoSourceQuestionId > 0
    ).length;

    if (!hasExplicitLink && existingQuestions.length > 0 && linkedQuestionCount === 0) {
      continue;
    }

    await db.updateSubject(linkedSubject.id, {
      demoSourceSubjectId: demoSubjectId,
      name: demoSubject.name,
      description: demoSubject.description ?? null,
      color: demoSubject.color ?? "#3B82F6",
      displayOrder: demoSubject.displayOrder ?? 0,
      examEndDate: demoSubject.examEndDate ?? null,
      isDemo: 0,
    });

    const questionBySourceId = new Map(
      existingQuestions
        .filter(
          (question) =>
            typeof question.demoSourceQuestionId === "number" &&
            question.demoSourceQuestionId > 0
        )
        .map((question) => [question.demoSourceQuestionId as number, question] as const)
    );

    const questionByNormalizedTitle = new Map<string, (typeof existingQuestions)[number]>();
    for (const question of existingQuestions) {
      const key = normalizeLookupValue(question.question);
      if (!key || questionByNormalizedTitle.has(key)) continue;
      questionByNormalizedTitle.set(key, question);
    }

    for (const demoQuestion of demoQuestions) {
      const normalizedTitle = normalizeLookupValue(demoQuestion.question);
      const targetQuestion =
        questionBySourceId.get(demoQuestion.id) ??
        (normalizedTitle ? questionByNormalizedTitle.get(normalizedTitle) : undefined);

      const syncedData = {
        question: demoQuestion.question,
        answer: demoQuestion.answer ?? "",
        difficulty: demoQuestion.difficulty ?? "medium",
        imageUrl: demoQuestion.imageUrl ?? null,
        imageLabels: demoQuestion.imageLabels ?? null,
        autoNumbering: demoQuestion.autoNumbering ?? 1,
        tableData: demoQuestion.tableData ?? null,
        displayOrder: demoQuestion.displayOrder ?? 0,
        isDemo: 0,
        isStarred: demoQuestion.isStarred ?? 0,
        useAIGrading: demoQuestion.useAIGrading ?? 0,
        demoSourceQuestionId: demoQuestion.id,
      } as const;

      if (targetQuestion) {
        await db.updateQuestion(targetQuestion.id, syncedData);
      } else {
        await db.createQuestion({
          subjectId: linkedSubject.id,
          userId: linkedSubject.userId,
          ...syncedData,
        });
      }
    }

    await db.normalizeQuestionDisplayOrderForSubject(linkedSubject.id);
  }
}

export const adminRouter = router({
  // 데모 과목 관리
  demo: router({
    // 모든 데모 과목 조회
    subjects: adminProcedure.query(async () => {
      await ensureHardcodedToothBox7DemoQuestionExists();
      return db.getAllDemoSubjects();
    }),

    // 모든 데모 문제 조회 (과목 선택 여부와 관계없이)
    allQuestions: adminProcedure.query(async () => {
      await ensureHardcodedToothBox7DemoQuestionExists();
      return await db.getAllDemoQuestions();
    }),

    // 데모 과목의 기본 문제 조회
    questions: adminProcedure
      .input(z.object({ subjectId: z.number() }))
      .query(async ({ input }) => {
        await ensureHardcodedToothBox7DemoQuestionExists();
        const subject = await db.getSubjectById(input.subjectId);
        if (!subject || subject.isDemo !== 1) return [];
        const rows = await db.getDemoQuestionsBySubjectId(input.subjectId);
        if (!isToothMorphologySubjectName(subject.name)) return rows;
        return pickToothShowcaseQuestions(rows);
      }),

    // 데모 문제 수정
    updateQuestion: adminProcedure
      .input(
        z.object({
          questionId: z.number(),
          question: z.string(),
          answer: z.string().optional().default(""),
          imageUrl: z.string().optional(),
          imageLabels: z.string().optional(),
          tableData: z.string().optional(),
          autoNumbering: z.number().optional(),
          useAIGrading: z.number().optional(),
          isStarred: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const target = await db.getQuestionById(input.questionId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
        const updated = await db.updateDemoQuestion(
          input.questionId,
          {
            question: input.question,
            answer: input.answer,
            imageUrl: input.imageUrl,
            imageLabels: input.imageLabels,
            tableData: input.tableData,
            autoNumbering: input.autoNumbering,
            useAIGrading: input.useAIGrading,
            isStarred: input.isStarred,
          }
        );

        if (target.subjectId) {
          await syncDemoSubjectToLinkedWorkspaces(target.subjectId);
        }
        
        // 캐시 무효화 신호 (클라이언트가 데이터 새로고침하도록)
        return {
          success: true,
          data: updated,
          cacheInvalidated: true,
        };
      }),

    // 데모 문제 삭제
    deleteQuestion: adminProcedure
      .input(z.object({ questionId: z.number() }))
      .mutation(async ({ input }) => {
        const target = await db.getQuestionById(input.questionId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
        await db.deleteDemoQuestion(input.questionId);
        if (target.subjectId) {
          await syncDemoSubjectToLinkedWorkspaces(target.subjectId);
        }
        return {
          success: true,
          cacheInvalidated: true,
        };
      }),

    // 데모 문제 생성
    createQuestion: adminProcedure
      .input(
        z.object({
          subjectId: z.number(),
          question: z.string(),
          answer: z.string().optional().default(""),
          imageUrl: z.string().optional(),
          imageLabels: z.string().optional(),
          tableData: z.string().optional(),
          autoNumbering: z.number().optional().default(1),
          difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
          isStarred: z.number().optional().default(0),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertDemoPublishingEnabled(ctx.user.role);
        const created = await db.createDemoQuestion({
          subjectId: input.subjectId,
          userId: ctx.user.id,
          question: input.question,
          answer: input.answer ?? "",
          imageUrl: input.imageUrl,
          imageLabels: input.imageLabels,
          tableData: input.tableData,
          autoNumbering: input.autoNumbering ?? 1,
          difficulty: input.difficulty ?? "medium",
          isStarred: input.isStarred ?? 0,
          isDemo: 1,
        });

        await syncDemoSubjectToLinkedWorkspaces(input.subjectId);
        
        return {
          success: true,
          data: created,
          cacheInvalidated: true,
        };
      }),

    // 데모 과목 생성
    createSubject: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional().default(""),
          color: z.string().optional().default("#3B82F6"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertDemoPublishingEnabled(ctx.user.role);
        const created = await db.createDemoSubject({
          userId: ctx.user.id,
          name: input.name,
          description: input.description ?? "",
          color: input.color ?? "#3B82F6",
          isDemo: 1,
          displayOrder: 0,
        });
        return { success: true, data: created };
      }),

    // 데모 과목 수정
    updateSubject: adminProcedure
      .input(
        z.object({
          subjectId: z.number(),
          name: z.string().min(1),
          description: z.string().optional(),
          color: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const target = await db.getSubjectById(input.subjectId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 과목을 찾을 수 없습니다",
          });
        }
        const updated = await db.updateDemoSubject(input.subjectId, {
          name: input.name,
          description: input.description,
          color: input.color,
        });
        await syncDemoSubjectToLinkedWorkspaces(input.subjectId);
        return { success: true, data: updated };
      }),

    // 데모 과목 삭제
    deleteSubject: adminProcedure
      .input(z.object({ subjectId: z.number() }))
      .mutation(async ({ input }) => {
        const target = await db.getSubjectById(input.subjectId);
        if (!target || target.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 과목을 찾을 수 없습니다",
          });
        }
        await db.deleteDemoSubject(input.subjectId);
        return { success: true };
      }),

    // 과목 isDemo 토글 (0 ↔ 1)
    toggleSubjectDemo: adminProcedure
      .input(z.object({ subjectId: z.number(), isDemo: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (input.isDemo === 1) {
          assertDemoPublishingEnabled(ctx.user.role);
        }
        await db.updateSubjectIsDemo(input.subjectId, input.isDemo);
        if (input.isDemo === 1) {
          await syncDemoSubjectToLinkedWorkspaces(input.subjectId);
        }
        return { success: true };
      }),

    // 문제 isDemo 토글 (0 ↔ 1)
    toggleQuestionDemo: adminProcedure
      .input(z.object({ questionId: z.number(), isDemo: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const target = await db.getQuestionById(input.questionId);
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "문제를 찾을 수 없습니다",
          });
        }
        if (input.isDemo === 1) {
          assertDemoPublishingEnabled(ctx.user.role);
        }
        await db.updateQuestionIsDemo(input.questionId, input.isDemo);
        if (input.isDemo === 1 && target.subjectId) {
          await syncDemoSubjectToLinkedWorkspaces(target.subjectId);
        }
        return { success: true };
      }),

    // 문제 중요 표시 토글
    toggleQuestionStar: adminProcedure
      .input(z.object({ questionId: z.number() }))
      .mutation(async ({ input }) => {
        const question = await db.getQuestionById(input.questionId);
        if (!question || question.isDemo !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "데모 문제를 찾을 수 없습니다",
          });
        }
        await db.updateDemoQuestion(input.questionId, {
          isStarred: question.isStarred ? 0 : 1,
        });
        if (question.subjectId) {
          await syncDemoSubjectToLinkedWorkspaces(question.subjectId);
        }
        return { success: true };
      }),
  }),
});
