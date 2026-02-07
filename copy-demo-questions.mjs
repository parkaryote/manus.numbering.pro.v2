import mysql from "mysql2/promise";
import fs from "fs";

async function main() {
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
  });

  // Get full data for both questions
  const [questions] = await connection.execute(
    "SELECT * FROM questions WHERE id IN (450001, 450002)"
  );

  for (const q of questions) {
    console.log("Copying question:", q.id, q.question);
    
    // Insert as demo question with same subjectId (already in demo subjects)
    await connection.execute(
      `INSERT INTO questions (subjectId, userId, question, answer, imageUrl, imageLabels, tableData, difficulty, displayOrder, isDemo, useAIGrading, autoNumbering, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
      [
        q.subjectId,
        q.userId,
        q.question,
        q.answer,
        q.imageUrl,
        q.imageLabels,
        q.tableData,
        q.difficulty,
        q.displayOrder,
        q.useAIGrading,
        q.autoNumbering,
      ]
    );
    console.log("  -> Copied as demo question");
  }

  // Verify
  const [demoQs] = await connection.execute(
    "SELECT id, subjectId, question, isDemo FROM questions WHERE isDemo = 1"
  );
  console.log("\n=== All Demo Questions ===");
  for (const q of demoQs) {
    console.log(`  ID: ${q.id}, Subject: ${q.subjectId}, Question: ${q.question}`);
  }

  await connection.end();
}

main().catch(console.error);
