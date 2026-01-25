import { eq, and } from "drizzle-orm";
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
