import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// parkham userId
const [users] = await conn.query("SELECT id FROM users WHERE username = ?", [
  "parkham",
]);
if (!users.length) {
  console.log("parkham not found");
  process.exit(1);
}
const userId = users[0].id;
console.log("parkham userId:", userId);

// 데모 과목 조회
const [demoSubjects] = await conn.query(
  "SELECT * FROM subjects WHERE isDemo = 1"
);
console.log(
  "Demo subjects:",
  demoSubjects.map(s => s.name)
);

for (const ds of demoSubjects) {
  // 과목 생성
  const [res] = await conn.query(
    "INSERT INTO subjects (userId, name, description, color, displayOrder, isDemo, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())",
    [userId, ds.name, ds.description, ds.color, ds.displayOrder]
  );
  const newSubjectId = res.insertId;
  console.log(`Created subject: ${ds.name} (id=${newSubjectId})`);

  // 해당 과목의 데모 문제 조회
  const [demoQs] = await conn.query(
    "SELECT * FROM questions WHERE subjectId = ? AND isDemo = 1",
    [ds.id]
  );
  console.log(`  Copying ${demoQs.length} questions...`);

  for (const dq of demoQs) {
    await conn.query(
      "INSERT INTO questions (subjectId, userId, question, answer, difficulty, imageUrl, imageLabels, autoNumbering, tableData, displayOrder, isDemo, isStarred, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NOW(), NOW())",
      [
        newSubjectId,
        userId,
        dq.question,
        dq.answer,
        dq.difficulty,
        dq.imageUrl,
        dq.imageLabels,
        dq.autoNumbering,
        dq.tableData,
        dq.displayOrder,
      ]
    );
  }
}

console.log("Done!");
await conn.end();
