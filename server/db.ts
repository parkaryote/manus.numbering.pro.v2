import { eq, and, desc, sql, lte, gte, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  subjects,
  questions,
  practiceSessions,
  testSessions,
  reviewSchedules,
  InsertSubject,
  InsertQuestion,
  InsertPracticeSession,
  InsertTestSession,
  InsertReviewSchedule,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserAICredits(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ credits: users.aiCreditBalance }).from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0].credits : 0;
}

export async function deductAICredits(userId: number, amount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const currentCredits = await getUserAICredits(userId);
  if (currentCredits < amount) {
    throw new Error("Insufficient AI credits");
  }
  await db.update(users).set({ aiCreditBalance: currentCredits - amount }).where(eq(users.id, userId));
}

// ========== Subject Queries ==========
export async function getSubjectsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subjects).where(eq(subjects.userId, userId)).orderBy(subjects.displayOrder);
}

export async function getSubjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subjects).where(eq(subjects.id, id)).limit(1);
  return result[0];
}

export async function createSubject(subject: InsertSubject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(subjects).values(subject);
  const insertId = Number(result[0].insertId);
  const created = await db.select().from(subjects).where(eq(subjects.id, insertId)).limit(1);
  return created[0];
}

export async function updateSubject(id: number, data: Partial<InsertSubject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(subjects).set(data).where(eq(subjects.id, id));
}

export async function deleteSubject(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(subjects).where(eq(subjects.id, id));
}

export async function updateSubjectOrder(userId: number, subjectOrders: { id: number; displayOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (const { id, displayOrder } of subjectOrders) {
    await db.update(subjects)
      .set({ displayOrder })
      .where(eq(subjects.id, id));
  }
}

// ========== Question Queries ==========
export async function getQuestionsBySubjectId(subjectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(questions)
    .where(eq(questions.subjectId, subjectId))
    .orderBy(questions.displayOrder);
}

export async function getQuestionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(questions).where(eq(questions.userId, userId));
}

export async function countQuestionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const allQuestions = await db.select().from(questions).where(eq(questions.userId, userId));
  return allQuestions.length;
}

export async function getQuestionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  return result[0];
}

export async function createQuestion(question: InsertQuestion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(questions).values(question);
  const insertId = Number(result[0].insertId);
  const created = await db.select().from(questions).where(eq(questions.id, insertId)).limit(1);
  return created[0];
}

export async function updateQuestion(id: number, data: Partial<InsertQuestion>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(questions).set(data).where(eq(questions.id, id));
}

export async function deleteQuestion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(questions).where(eq(questions.id, id));
}

export async function updateQuestionOrder(userId: number, questionOrders: { id: number; displayOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (const { id, displayOrder } of questionOrders) {
    await db.update(questions)
      .set({ displayOrder })
      .where(eq(questions.id, id));
  }
}

export async function copyQuestion(userId: number, questionId: number, targetSubjectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get the original question
  const original = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!original[0]) throw new Error("Question not found");
  
  // Get max displayOrder in target subject
  const targetQuestions = await db.select().from(questions).where(eq(questions.subjectId, targetSubjectId));
  const maxOrder = targetQuestions.reduce((max, q) => Math.max(max, q.displayOrder || 0), 0);
  
  // Create a copy
  const result = await db.insert(questions).values({
    userId,
    subjectId: targetSubjectId,
    question: original[0].question,
    answer: original[0].answer,
    imageUrl: original[0].imageUrl,
    imageLabels: original[0].imageLabels,
    useAIGrading: original[0].useAIGrading,
    difficulty: original[0].difficulty,
    displayOrder: maxOrder + 1,
  });
  
  const insertId = Number(result[0].insertId);
  const created = await db.select().from(questions).where(eq(questions.id, insertId)).limit(1);
  return created[0];
}

export async function moveQuestion(questionId: number, targetSubjectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get max displayOrder in target subject
  const targetQuestions = await db.select().from(questions).where(eq(questions.subjectId, targetSubjectId));
  const maxOrder = targetQuestions.reduce((max, q) => Math.max(max, q.displayOrder || 0), 0);
  
  // Update the question's subjectId and displayOrder
  await db.update(questions)
    .set({ subjectId: targetSubjectId, displayOrder: maxOrder + 1 })
    .where(eq(questions.id, questionId));
  
  const updated = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  return updated[0];
}

// ========== Practice Session Queries ==========
export async function getPracticeSessionsByQuestionId(questionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(practiceSessions).where(eq(practiceSessions.questionId, questionId));
}

export async function getPracticeSessionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(practiceSessions).where(eq(practiceSessions.userId, userId));
}

export async function getPracticeSessionsBySubjectId(userId: number, subjectId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // Get all questions for this subject
  const subjectQuestions = await db.select().from(questions).where(eq(questions.subjectId, subjectId));
  const questionIds = subjectQuestions.map(q => q.id);
  
  if (questionIds.length === 0) return [];
  
  // Get practice sessions for these questions
  const sessions = await db.select().from(practiceSessions)
    .where(eq(practiceSessions.userId, userId));
  
  return sessions.filter(s => questionIds.includes(s.questionId));
}

export async function deleteAllPracticeSessions(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(practiceSessions).where(eq(practiceSessions.userId, userId));
}

export async function createPracticeSession(session: InsertPracticeSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(practiceSessions).values(session);
  const insertId = Number(result[0].insertId);
  const created = await db.select().from(practiceSessions).where(eq(practiceSessions.id, insertId)).limit(1);
  return created[0];
}

// ========== Test Session Queries ==========
export async function getTestSessionsByQuestionId(questionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(testSessions).where(eq(testSessions.questionId, questionId));
}

export async function getTestSessionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(testSessions).where(eq(testSessions.userId, userId));
}

export async function createTestSession(session: InsertTestSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(testSessions).values(session);
}

export async function deleteAllTestSessions(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(testSessions).where(eq(testSessions.userId, userId));
}

// ========== Review Schedule Queries ==========
export async function getReviewSchedulesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviewSchedules).where(eq(reviewSchedules.userId, userId));
}

export async function getReviewScheduleByQuestionId(questionId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(reviewSchedules)
    .where(and(eq(reviewSchedules.questionId, questionId), eq(reviewSchedules.userId, userId)))
    .limit(1);
  return result[0];
}

export async function createReviewSchedule(schedule: InsertReviewSchedule) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(reviewSchedules).values(schedule);
}

export async function updateReviewSchedule(id: number, data: Partial<InsertReviewSchedule>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(reviewSchedules).set(data).where(eq(reviewSchedules.id, id));
}


// ========== Auto-delete expired questions ==========
/**
 * 시험 종료일 + 1달이 지난 과목의 문제 중
 * 연습/시험 기록이 없는 문제를 자동 삭제합니다.
 */
export async function deleteExpiredQuestions() {
  const db = await getDb();
  if (!db) return { deletedCount: 0, checkedSubjects: 0 };
  
  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // 시험 종료일이 1달 이상 지난 과목 조회
  const expiredSubjects = await db.select()
    .from(subjects)
    .where(
      and(
        isNotNull(subjects.examEndDate),
        lte(subjects.examEndDate, oneMonthAgo)
      )
    );
  
  let deletedCount = 0;
  
  for (const subject of expiredSubjects) {
    // 해당 과목의 모든 문제 조회
    const subjectQuestions = await db.select()
      .from(questions)
      .where(eq(questions.subjectId, subject.id));
    
    for (const question of subjectQuestions) {
      // 연습 기록 확인
      const practiceRecords = await db.select()
        .from(practiceSessions)
        .where(eq(practiceSessions.questionId, question.id))
        .limit(1);
      
      // 시험 기록 확인
      const testRecords = await db.select()
        .from(testSessions)
        .where(eq(testSessions.questionId, question.id))
        .limit(1);
      
      // 연습/시험 기록이 모두 없으면 삭제
      if (practiceRecords.length === 0 && testRecords.length === 0) {
        await db.delete(questions).where(eq(questions.id, question.id));
        deletedCount++;
      }
    }
  }
  
  return { deletedCount, checkedSubjects: expiredSubjects.length };
}

/**
 * 만료 예정인 문제 목록 조회 (대시보드 경고용)
 * 시험 종료일이 지났지만 아직 1달이 안 된 과목의 미사용 문제
 */
export async function getExpiringQuestions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  // 시험 종료일이 지났지만 1달이 안 된 과목 조회
  const expiringSubjects = await db.select()
    .from(subjects)
    .where(
      and(
        eq(subjects.userId, userId),
        isNotNull(subjects.examEndDate),
        lte(subjects.examEndDate, now),
        gte(subjects.examEndDate, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
      )
    );
  
  const expiringQuestions: any[] = [];
  
  for (const subject of expiringSubjects) {
    const subjectQuestions = await db.select()
      .from(questions)
      .where(eq(questions.subjectId, subject.id));
    
    for (const question of subjectQuestions) {
      const practiceRecords = await db.select()
        .from(practiceSessions)
        .where(eq(practiceSessions.questionId, question.id))
        .limit(1);
      
      const testRecords = await db.select()
        .from(testSessions)
        .where(eq(testSessions.questionId, question.id))
        .limit(1);
      
      if (practiceRecords.length === 0 && testRecords.length === 0) {
        const expirationDate = new Date(subject.examEndDate!.getTime() + 30 * 24 * 60 * 60 * 1000);
        expiringQuestions.push({
          ...question,
          subjectName: subject.name,
          expirationDate,
          daysUntilExpiration: Math.ceil((expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
        });
      }
    }
  }
  
  return expiringQuestions;
}


// Demo mode functions
export async function getDemoSubjects() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subjects).where(eq(subjects.isDemo, 1)).orderBy(subjects.displayOrder);
}

export async function getDemoQuestions(subjectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(questions).where(and(eq(questions.subjectId, subjectId), eq(questions.isDemo, 1))).orderBy(questions.displayOrder);
}
