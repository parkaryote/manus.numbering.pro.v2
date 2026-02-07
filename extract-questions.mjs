// Extract specific questions from the database
import mysql from "mysql2/promise";

async function main() {
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
  });

  // Find 머리뼈 and 상악 치아 크기 questions
  const [rows] = await connection.execute(
    "SELECT id, subjectId, question, answer, imageUrl, imageLabels, tableData, difficulty, displayOrder, isDemo, useAIGrading, autoNumbering FROM questions WHERE question LIKE '%머리뼈%' OR question LIKE '%상악 치아 크기%'"
  );

  for (const row of rows) {
    console.log("--- Question ID:", row.id, "---");
    console.log("subjectId:", row.subjectId);
    console.log("question:", row.question);
    console.log("answer:", row.answer ? row.answer.substring(0, 100) : null);
    console.log("imageUrl:", row.imageUrl);
    console.log("imageLabels:", row.imageLabels ? row.imageLabels.substring(0, 500) : null);
    console.log("tableData:", row.tableData ? row.tableData.substring(0, 500) : null);
    console.log("difficulty:", row.difficulty);
    console.log("isDemo:", row.isDemo);
    console.log("useAIGrading:", row.useAIGrading);
    console.log("autoNumbering:", row.autoNumbering);
    console.log("");
  }

  // Also find demo subject IDs
  const [demoSubjects] = await connection.execute(
    "SELECT id, name FROM subjects WHERE isDemo = 1"
  );
  console.log("=== Demo Subjects ===");
  for (const s of demoSubjects) {
    console.log("ID:", s.id, "Name:", s.name);
  }

  await connection.end();
}

main().catch(console.error);
