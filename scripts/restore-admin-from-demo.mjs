import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_EMAIL = (process.env.OWNER_EMAIL ?? "").trim();
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME ?? "").trim();

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!ADMIN_EMAIL && !ADMIN_USERNAME) {
  console.error("Set OWNER_EMAIL or ADMIN_USERNAME to locate the admin account safely.");
  process.exit(1);
}

function questionKey(q) {
  return [
    q.question ?? "",
    q.answer ?? "",
    q.imageUrl ?? "",
    q.imageLabels ?? "",
    q.tableData ?? "",
    q.difficulty ?? "medium",
  ].join("\u241f");
}

async function findAdminUser(connection) {
  const [rows] = await connection.execute(
    `SELECT id, username, email, role
     FROM users
     WHERE email = ? OR username = ?
     ORDER BY (email = ?) DESC, (username = ?) DESC
     LIMIT 1`,
    [ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_USERNAME]
  );

  if (!rows.length) return null;
  return rows[0];
}

async function getDemoSubjects(connection) {
  const [rows] = await connection.execute(
    `SELECT id, name, description, color, displayOrder
     FROM subjects
     WHERE isDemo = 1
     ORDER BY displayOrder, id`
  );
  return rows;
}

async function getDemoQuestions(connection, demoSubjectId) {
  const [rows] = await connection.execute(
    `SELECT question, answer, imageUrl, imageLabels, useAIGrading, autoNumbering, tableData, difficulty, displayOrder, isStarred, memo
     FROM questions
     WHERE subjectId = ? AND isDemo = 1
     ORDER BY displayOrder, id`,
    [demoSubjectId]
  );
  return rows;
}

async function findOrCreateAdminSubject(connection, adminUserId, demoSubject) {
  const [exists] = await connection.execute(
    `SELECT id
     FROM subjects
     WHERE userId = ? AND isDemo = 0 AND name = ?
     LIMIT 1`,
    [adminUserId, demoSubject.name]
  );

  if (exists.length > 0) {
    const subjectId = exists[0].id;
    await connection.execute(
      `UPDATE subjects
       SET description = ?, color = ?, displayOrder = ?, updatedAt = NOW()
       WHERE id = ?`,
      [demoSubject.description ?? null, demoSubject.color ?? "#3B82F6", demoSubject.displayOrder ?? 0, subjectId]
    );
    return { subjectId, created: false };
  }

  const [insertResult] = await connection.execute(
    `INSERT INTO subjects (userId, name, description, color, displayOrder, isDemo, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())`,
    [
      adminUserId,
      demoSubject.name,
      demoSubject.description ?? null,
      demoSubject.color ?? "#3B82F6",
      demoSubject.displayOrder ?? 0,
    ]
  );

  return { subjectId: insertResult.insertId, created: true };
}

async function getAdminQuestionsBySubject(connection, adminUserId, subjectId) {
  const [rows] = await connection.execute(
    `SELECT question, answer, imageUrl, imageLabels, useAIGrading, autoNumbering, tableData, difficulty, displayOrder, isStarred, memo
     FROM questions
     WHERE userId = ? AND subjectId = ? AND isDemo = 0`,
    [adminUserId, subjectId]
  );
  return rows;
}

async function insertAdminQuestion(connection, adminUserId, subjectId, q) {
  await connection.execute(
    `INSERT INTO questions (
       subjectId, userId, question, answer, imageUrl, imageLabels, useAIGrading,
       autoNumbering, tableData, difficulty, displayOrder, isDemo, isStarred, memo, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW(), NOW())`,
    [
      subjectId,
      adminUserId,
      q.question ?? "",
      q.answer ?? "",
      q.imageUrl ?? null,
      q.imageLabels ?? null,
      Number(q.useAIGrading ?? 0),
      Number(q.autoNumbering ?? 1),
      q.tableData ?? null,
      q.difficulty ?? "medium",
      Number(q.displayOrder ?? 0),
      Number(q.isStarred ?? 0),
      q.memo ?? null,
    ]
  );
}

async function main() {
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  try {
    const admin = await findAdminUser(connection);
    if (!admin) {
      throw new Error(`Admin user not found. Tried email=${ADMIN_EMAIL}, username=${ADMIN_USERNAME}`);
    }

    const demoSubjects = await getDemoSubjects(connection);
    if (demoSubjects.length === 0) {
      throw new Error("No demo subjects found. Run `pnpm db:sync-demo-prod` first.");
    }

    const summary = [];
    let totalInsertedQuestions = 0;
    let createdSubjects = 0;

    for (const ds of demoSubjects) {
      const { subjectId, created } = await findOrCreateAdminSubject(connection, admin.id, ds);
      if (created) createdSubjects += 1;

      const demoQuestions = await getDemoQuestions(connection, ds.id);
      const existing = await getAdminQuestionsBySubject(connection, admin.id, subjectId);
      const existingKeys = new Set(existing.map(questionKey));

      let inserted = 0;
      for (const dq of demoQuestions) {
        const key = questionKey(dq);
        if (existingKeys.has(key)) continue;
        await insertAdminQuestion(connection, admin.id, subjectId, dq);
        existingKeys.add(key);
        inserted += 1;
      }

      totalInsertedQuestions += inserted;
      summary.push({
        subject: ds.name,
        demoQuestionCount: demoQuestions.length,
        insertedQuestions: inserted,
        createdSubject: created ? "yes" : "no",
      });
    }

    const [[subjectCount]] = await connection.execute(
      `SELECT COUNT(*) AS c FROM subjects WHERE userId = ? AND isDemo = 0`,
      [admin.id]
    );
    const [[questionCount]] = await connection.execute(
      `SELECT COUNT(*) AS c FROM questions WHERE userId = ? AND isDemo = 0`,
      [admin.id]
    );

    console.log(`Admin user: id=${admin.id}, email=${admin.email ?? "null"}, username=${admin.username ?? "null"}`);
    console.log(`Created subjects: ${createdSubjects}`);
    console.log(`Inserted questions: ${totalInsertedQuestions}`);
    console.table(summary);
    console.log(`Final admin counts -> subjects=${subjectCount.c}, questions=${questionCount.c}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
