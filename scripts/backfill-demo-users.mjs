import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const PLACEHOLDER_NAMES = new Set([
  "시작 과목",
  "해부학 기초",
  "치아 형태학",
  "국시 빈출 요약",
]);

async function getConfiguredDemoSubjects(connection) {
  const [demoSubjects] = await connection.execute(
    `SELECT
       s.id,
       s.name,
       s.description,
       s.color,
       s.displayOrder
     FROM subjects s
     WHERE s.isDemo = 1
        OR EXISTS (
          SELECT 1
          FROM questions q
          WHERE q.subjectId = s.id
            AND q.isDemo = 1
        )
     ORDER BY s.displayOrder, s.id`
  );

  return demoSubjects;
}

async function copyDemoToUser(connection, userId, demoSubjects) {
  for (const ds of demoSubjects) {
    const [demoQuestions] = await connection.execute(
      "SELECT id FROM questions WHERE subjectId = ? AND isDemo = 1 LIMIT 1",
      [ds.id]
    );
    if (demoQuestions.length === 0) continue;

    const [exists] = await connection.execute(
      "SELECT id FROM subjects WHERE userId = ? AND name = ? LIMIT 1",
      [userId, ds.name]
    );
    if (exists.length > 0) continue;

    const [subjectInsert] = await connection.execute(
      "INSERT INTO subjects (userId, name, description, color, displayOrder, isDemo, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())",
      [userId, ds.name, ds.description, ds.color, ds.displayOrder]
    );
    const newSubjectId = subjectInsert.insertId;

    await connection.execute(
      `INSERT INTO questions (
        subjectId, userId, question, answer, imageUrl, imageLabels, useAIGrading,
        autoNumbering, tableData, difficulty, displayOrder, isDemo, isStarred, memo, createdAt, updatedAt
      )
      SELECT
        ?, ?, question, answer, imageUrl, imageLabels, useAIGrading,
        autoNumbering, tableData, difficulty, displayOrder, 0, isStarred, memo, NOW(), NOW()
      FROM questions
      WHERE subjectId = ? AND isDemo = 1
      ORDER BY displayOrder, id`,
      [newSubjectId, userId, ds.id]
    );
  }
}

async function main() {
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  try {
    const demoSubjects = await getConfiguredDemoSubjects(connection);
    if (demoSubjects.length === 0) {
      console.warn(
        "No demo subjects/questions configured (isDemo=1). Nothing to backfill."
      );
      return;
    }

    const [users] = await connection.execute(
      "SELECT id, loginMethod FROM users ORDER BY id"
    );
    let backfilled = 0;

    for (const user of users) {
      const [userSubjects] = await connection.execute(
        "SELECT name FROM subjects WHERE userId = ?",
        [user.id]
      );
      const names = userSubjects.map(s => s.name);
      const hasNoSubjects = names.length === 0;
      const placeholderOnly =
        names.length > 0 && names.every(n => PLACEHOLDER_NAMES.has(n));

      if (hasNoSubjects || placeholderOnly) {
        await copyDemoToUser(connection, user.id, demoSubjects);
        backfilled += 1;
      }
    }

    const [subjectCounts] = await connection.execute(
      "SELECT userId, COUNT(*) AS subjectCount FROM subjects GROUP BY userId ORDER BY userId"
    );
    const [questionCounts] = await connection.execute(
      "SELECT userId, COUNT(*) AS questionCount FROM questions GROUP BY userId ORDER BY userId"
    );

    console.log(`Backfilled users: ${backfilled}`);
    console.table(subjectCounts);
    console.table(questionCounts);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
