import "dotenv/config";
import mysql from "mysql2/promise";

const BASE_URL = process.env.DEMO_SOURCE_BASE_URL || "https://numbering.pro";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function trpcInput(payload) {
  return encodeURIComponent(JSON.stringify(payload));
}

async function fetchTrpc(path, payload) {
  const url = `${BASE_URL}/api/trpc/${path}?batch=1&input=${trpcInput(payload)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TRPC fetch failed (${res.status}) for ${path}`);
  }
  const data = await res.json();
  const first = data?.[0];
  if (first?.error) {
    throw new Error(
      `TRPC returned error for ${path}: ${JSON.stringify(first.error)}`
    );
  }
  return first?.result?.data?.json ?? null;
}

function toNullableText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function toNullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function fetchRemoteDemoBundle() {
  const subjects = await fetchTrpc("demo.subjects", { 0: { json: null } });
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new Error("Remote demo.subjects returned empty list.");
  }

  const withQuestions = [];
  for (const subject of subjects) {
    const questions = await fetchTrpc("demo.questions", {
      0: { json: { subjectId: subject.id } },
    });
    withQuestions.push({
      subject,
      questions: Array.isArray(questions) ? questions : [],
    });
  }
  return withQuestions;
}

async function syncLocalDemo(connection, bundle) {
  await connection.beginTransaction();
  try {
    await connection.execute("DELETE FROM questions WHERE isDemo = 1");
    await connection.execute("DELETE FROM subjects WHERE isDemo = 1");

    const subjectIdMap = new Map();
    for (const entry of bundle) {
      const s = entry.subject;
      const [insertResult] = await connection.execute(
        `INSERT INTO subjects (userId, name, description, color, displayOrder, examEndDate, isDemo, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [
          0,
          s.name,
          s.description ?? null,
          s.color ?? "#3B82F6",
          s.displayOrder ?? 0,
          toNullableDate(s.examEndDate),
        ]
      );
      subjectIdMap.set(s.id, insertResult.insertId);
    }

    for (const entry of bundle) {
      const localSubjectId = subjectIdMap.get(entry.subject.id);
      if (!localSubjectId) continue;

      for (const q of entry.questions) {
        await connection.execute(
          `INSERT INTO questions (
             subjectId, userId, question, answer, imageUrl, imageLabels, useAIGrading,
             autoNumbering, tableData, difficulty, displayOrder, isDemo, isStarred, memo, createdAt, updatedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
          [
            localSubjectId,
            0,
            q.question ?? "",
            q.answer ?? "",
            toNullableText(q.imageUrl),
            toNullableText(q.imageLabels),
            q.useAIGrading ?? 0,
            q.autoNumbering ?? 1,
            toNullableText(q.tableData),
            q.difficulty ?? "medium",
            q.displayOrder ?? 0,
            q.isStarred ?? 0,
            toNullableText(q.memo),
          ]
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function printVerification(connection) {
  const [subjects] = await connection.execute(
    `SELECT id, name, displayOrder
     FROM subjects
     WHERE isDemo = 1
     ORDER BY displayOrder, id`
  );
  const [questionCounts] = await connection.execute(
    `SELECT s.name, COUNT(q.id) AS count
     FROM subjects s
     LEFT JOIN questions q ON q.subjectId = s.id AND q.isDemo = 1
     WHERE s.isDemo = 1
     GROUP BY s.id, s.name
     ORDER BY s.displayOrder, s.id`
  );
  const [toothQuestions] = await connection.execute(
    `SELECT q.id, s.name AS subjectName, q.question
     FROM questions q
     JOIN subjects s ON s.id = q.subjectId
     WHERE s.isDemo = 1
       AND s.name LIKE '%치아%'
     ORDER BY q.displayOrder, q.id`
  );

  console.log("\nSynced demo subjects:");
  console.table(subjects);
  console.log("Demo question counts:");
  console.table(questionCounts);
  console.log("치아형태학 demo questions:");
  console.table(toothQuestions);
}

async function main() {
  console.log(`Sync source: ${BASE_URL}`);
  const bundle = await fetchRemoteDemoBundle();
  console.log(
    "Remote snapshot:",
    bundle.map(x => ({
      subject: x.subject.name,
      subjectId: x.subject.id,
      count: x.questions.length,
    }))
  );

  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  try {
    await syncLocalDemo(connection, bundle);
    await printVerification(connection);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
