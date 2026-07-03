import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "parkaryote@snu.ac.kr").trim().toLowerCase();
const DEFAULT_COLOR = "#3B82F6";

const TARGETS = [
  {
    key: "goowoo",
    demoName: "구우회",
    sourceNames: ["구우회", "구우회 문제"],
    anchorQuestion: "구우회 선수들의 25/26 시즌 등번호를 작성하시오.",
  },
  {
    key: "full-denture-share",
    demoName: "총의치학2(공유)",
    sourceNames: ["총의치학2(공유)", "총의치학2 (공유)"],
  },
  {
    key: "periodontics",
    demoName: "치주",
    sourceNames: ["치주"],
  },
];

const LEGACY_DEMO_REMOVE_NAMES = ["총의치학2"];

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeQuestion(value) {
  return String(value || "").trim().toLowerCase();
}

function questionSignature(row) {
  return normalizeQuestion(row.question);
}

async function getOwnerId(connection) {
  const [rows] = await connection.execute(
    `SELECT id FROM users WHERE LOWER(TRIM(email)) = ? ORDER BY id DESC LIMIT 1`,
    [OWNER_EMAIL]
  );
  if (rows.length > 0) return Number(rows[0].id);

  const [fallback] = await connection.execute(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
  if (fallback.length > 0) return Number(fallback[0].id);
  return null;
}

async function getDemoSubjectsWithCount(connection) {
  const [rows] = await connection.execute(
    `SELECT s.*, (
      SELECT COUNT(*) FROM questions q WHERE q.subjectId = s.id AND q.isDemo = 1
    ) AS demoQuestionCount
    FROM subjects s
    WHERE s.isDemo = 1
    ORDER BY s.displayOrder ASC, s.id ASC`
  );
  return rows;
}

function pickBestDemoSubject(candidates) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const qDiff = Number(b.demoQuestionCount || 0) - Number(a.demoQuestionCount || 0);
    if (qDiff !== 0) return qDiff;
    const tA = new Date(a.updatedAt || 0).getTime() || 0;
    const tB = new Date(b.updatedAt || 0).getTime() || 0;
    if (tB !== tA) return tB - tA;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  return sorted[0];
}

async function resolveSourceSubject(connection, target) {
  const normalizedNames = target.sourceNames.map((name) => String(name).trim().toLowerCase());
  const placeholders = normalizedNames.map(() => "?").join(", ");

  if (target.anchorQuestion) {
    const [rows] = await connection.execute(
      `SELECT s.*
       FROM subjects s
       INNER JOIN questions q ON q.subjectId = s.id
       WHERE s.isDemo = 0
         AND LOWER(TRIM(s.name)) IN (${placeholders})
         AND LOWER(TRIM(q.question)) = ?
       ORDER BY s.updatedAt DESC, s.id DESC
       LIMIT 1`,
      [...normalizedNames, target.anchorQuestion.trim().toLowerCase()]
    );
    if (rows.length > 0) return rows[0];
  }

  const [rows] = await connection.execute(
    `SELECT s.*
     FROM subjects s
     WHERE s.isDemo = 0
       AND LOWER(TRIM(s.name)) IN (${placeholders})
     ORDER BY s.updatedAt DESC, s.id DESC
     LIMIT 1`,
    normalizedNames
  );
  return rows[0] || null;
}

async function fetchSubjectQuestions(connection, subjectId, isDemo = null) {
  const [rows] = await connection.execute(
    `SELECT * FROM questions
     WHERE subjectId = ?
       AND (? IS NULL OR isDemo = ?)
     ORDER BY displayOrder ASC, id ASC`,
    [subjectId, isDemo, isDemo]
  );
  return rows;
}

async function upsertDemoQuestion(connection, demoSubject, sourceQuestion, displayOrder) {
  const payload = [
    sourceQuestion.question || "",
    sourceQuestion.answer || "",
    sourceQuestion.imageUrl || null,
    sourceQuestion.imageLabels || null,
    Number(sourceQuestion.useAIGrading || 0),
    Number(sourceQuestion.autoNumbering || 1),
    sourceQuestion.tableData || null,
    sourceQuestion.difficulty || "medium",
    Number(displayOrder),
    Number(sourceQuestion.isStarred || 0),
    sourceQuestion.memo || null,
  ];

  const [existingRows] = await connection.execute(
    `SELECT id FROM questions WHERE subjectId = ? AND isDemo = 1 AND LOWER(TRIM(question)) = ? ORDER BY id DESC LIMIT 1`,
    [demoSubject.id, normalizeQuestion(sourceQuestion.question)]
  );

  if (existingRows.length > 0) {
    await connection.execute(
      `UPDATE questions
       SET question = ?, answer = ?, imageUrl = ?, imageLabels = ?, useAIGrading = ?, autoNumbering = ?,
           tableData = ?, difficulty = ?, displayOrder = ?, isStarred = ?, memo = ?, updatedAt = NOW()
       WHERE id = ?`,
      [...payload, Number(existingRows[0].id)]
    );
    return;
  }

  await connection.execute(
    `INSERT INTO questions (
      subjectId, userId, question, answer, imageUrl, imageLabels, useAIGrading, autoNumbering,
      tableData, difficulty, displayOrder, isDemo, isStarred, memo, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
    [
      Number(demoSubject.id),
      Number(demoSubject.userId),
      ...payload,
    ]
  );
}

async function syncDemoSubject(connection, ownerUserId, target, sourceSubject) {
  const demoSubjects = await getDemoSubjectsWithCount(connection);
  const nameKeys = new Set([target.demoName, ...target.sourceNames].map(normalizeName));
  const matching = demoSubjects.filter((row) => nameKeys.has(normalizeName(row.name)));

  const keep = pickBestDemoSubject(matching);

  for (const row of matching) {
    if (keep && Number(row.id) === Number(keep.id)) continue;
    await connection.execute(`DELETE FROM questions WHERE subjectId = ? AND isDemo = 1`, [Number(row.id)]);
    await connection.execute(`DELETE FROM subjects WHERE id = ?`, [Number(row.id)]);
  }

  let demoSubject = keep;
  if (!demoSubject) {
    const [result] = await connection.execute(
      `INSERT INTO subjects (userId, name, description, color, displayOrder, examEndDate, isDemo, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        Number(sourceSubject.userId || ownerUserId),
        target.demoName,
        sourceSubject.description || `${target.demoName} 데모 과목`,
        sourceSubject.color || DEFAULT_COLOR,
        Number(sourceSubject.displayOrder || 0),
        sourceSubject.examEndDate || null,
      ]
    );
    const [[created]] = await connection.execute(`SELECT * FROM subjects WHERE id = ? LIMIT 1`, [Number(result.insertId)]);
    demoSubject = created;
  } else {
    await connection.execute(
      `UPDATE subjects
       SET name = ?, description = ?, color = ?, displayOrder = ?, examEndDate = ?, isDemo = 1, updatedAt = NOW()
       WHERE id = ?`,
      [
        target.demoName,
        sourceSubject.description || null,
        sourceSubject.color || DEFAULT_COLOR,
        Number(demoSubject.displayOrder || sourceSubject.displayOrder || 0),
        sourceSubject.examEndDate || null,
        Number(demoSubject.id),
      ]
    );
    const [[updated]] = await connection.execute(`SELECT * FROM subjects WHERE id = ? LIMIT 1`, [Number(demoSubject.id)]);
    demoSubject = updated;
  }

  const sourceQuestions = await fetchSubjectQuestions(connection, Number(sourceSubject.id), null);
  const demoQuestions = await fetchSubjectQuestions(connection, Number(demoSubject.id), 1);

  const sourceSignatures = new Set();
  let displayOrder = 1;
  for (const sourceQuestion of sourceQuestions) {
    const sig = questionSignature(sourceQuestion);
    if (!sig || sourceSignatures.has(sig)) continue;
    sourceSignatures.add(sig);
    await upsertDemoQuestion(connection, demoSubject, sourceQuestion, displayOrder);
    displayOrder += 1;
  }

  for (const demoQuestion of demoQuestions) {
    const sig = questionSignature(demoQuestion);
    if (!sig || sourceSignatures.has(sig)) continue;
    await connection.execute(`DELETE FROM questions WHERE id = ?`, [Number(demoQuestion.id)]);
  }

  const refreshedDemoQuestions = await fetchSubjectQuestions(connection, Number(demoSubject.id), 1);
  let nextOrder = 1;
  for (const question of refreshedDemoQuestions) {
    await connection.execute(`UPDATE questions SET displayOrder = ?, updatedAt = NOW() WHERE id = ?`, [nextOrder, Number(question.id)]);
    nextOrder += 1;
  }

  return {
    targetName: target.demoName,
    sourceSubjectId: Number(sourceSubject.id),
    demoSubjectId: Number(demoSubject.id),
    questionCount: refreshedDemoQuestions.length,
  };
}

async function main() {
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  try {
    const ownerUserId = await getOwnerId(connection);
    if (!ownerUserId) {
      throw new Error("No users found. Cannot determine owner for demo subject creation.");
    }

    for (const legacyName of LEGACY_DEMO_REMOVE_NAMES) {
      const [rows] = await connection.execute(
        `SELECT id FROM subjects WHERE isDemo = 1 AND LOWER(TRIM(name)) = ? ORDER BY id ASC`,
        [legacyName.trim().toLowerCase()]
      );
      for (const row of rows) {
        await connection.execute(`DELETE FROM questions WHERE subjectId = ? AND isDemo = 1`, [Number(row.id)]);
        await connection.execute(`DELETE FROM subjects WHERE id = ?`, [Number(row.id)]);
      }
    }

    const summary = [];

    for (const target of TARGETS) {
      const sourceSubject = await resolveSourceSubject(connection, target);
      if (!sourceSubject) {
        throw new Error(`Missing source subject for target ${target.demoName}. names=${target.sourceNames.join(",")}`);
      }
      const row = await syncDemoSubject(connection, ownerUserId, target, sourceSubject);
      summary.push(row);
    }

    const [demoRows] = await connection.execute(
      `SELECT s.id, s.name, s.displayOrder,
              (SELECT COUNT(*) FROM questions q WHERE q.subjectId = s.id AND q.isDemo = 1) AS demoQuestionCount
       FROM subjects s
       WHERE s.isDemo = 1
       ORDER BY s.displayOrder ASC, s.id ASC`
    );

    console.log("[Demo sync summary]");
    console.table(summary);
    console.log("[Final demo subjects]");
    console.table(demoRows);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
