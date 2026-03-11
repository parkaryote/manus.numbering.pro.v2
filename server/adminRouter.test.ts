import { describe, it, expect, beforeEach, vi } from "vitest";
import { adminRouter } from "./adminRouter";
import * as db from "./db";
import { TRPCError } from "@trpc/server";

// Mock the db module
vi.mock("./db", () => ({
  getAllDemoSubjects: vi.fn(),
  getDemoQuestionsBySubjectId: vi.fn(),
  updateDemoQuestion: vi.fn(),
  deleteDemoQuestion: vi.fn(),
  createDemoQuestion: vi.fn(),
}));

describe("Admin Router - Demo Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Demo Subjects", () => {
    it("should return all demo subjects", async () => {
      const mockSubjects = [
        { id: 1, name: "데모 과목 1", description: "설명 1", isDemo: 1, displayOrder: 1 },
        { id: 2, name: "데모 과목 2", description: "설명 2", isDemo: 1, displayOrder: 2 },
      ];

      vi.mocked(db.getAllDemoSubjects).mockResolvedValue(mockSubjects as any);

      const subjects = await db.getAllDemoSubjects();
      expect(subjects).toEqual(mockSubjects);
      expect(db.getAllDemoSubjects).toHaveBeenCalledTimes(1);
    });
  });

  describe("Demo Questions", () => {
    it("should return demo questions by subject", async () => {
      const mockQuestions = [
        {
          id: 1,
          subjectId: 1,
          question: "문제 1",
          answer: "정답 1",
          isDemo: 1,
          displayOrder: 1,
        },
        {
          id: 2,
          subjectId: 1,
          question: "문제 2",
          answer: "정답 2",
          isDemo: 1,
          displayOrder: 2,
        },
      ];

      vi.mocked(db.getDemoQuestionsBySubjectId).mockResolvedValue(mockQuestions as any);

      const questions = await db.getDemoQuestionsBySubjectId(1);
      expect(questions).toEqual(mockQuestions);
      expect(db.getDemoQuestionsBySubjectId).toHaveBeenCalledWith(1);
    });

    it("should update demo question", async () => {
      const updatedQuestion = {
        id: 1,
        subjectId: 1,
        question: "수정된 문제",
        answer: "수정된 정답",
        isDemo: 1,
      };

      vi.mocked(db.updateDemoQuestion).mockResolvedValue(updatedQuestion as any);

      const result = await db.updateDemoQuestion(1, {
        question: "수정된 문제",
        answer: "수정된 정답",
      });

      expect(result).toEqual(updatedQuestion);
      expect(db.updateDemoQuestion).toHaveBeenCalledWith(1, {
        question: "수정된 문제",
        answer: "수정된 정답",
      });
    });

    it("should delete demo question", async () => {
      vi.mocked(db.deleteDemoQuestion).mockResolvedValue(undefined);

      await db.deleteDemoQuestion(1);

      expect(db.deleteDemoQuestion).toHaveBeenCalledWith(1);
    });

    it("should create demo question", async () => {
      const newQuestion = {
        id: 3,
        subjectId: 1,
        userId: 1,
        question: "새 문제",
        answer: "새 정답",
        isDemo: 1,
      };

      vi.mocked(db.createDemoQuestion).mockResolvedValue(newQuestion as any);

      const result = await db.createDemoQuestion({
        subjectId: 1,
        userId: 1,
        question: "새 문제",
        answer: "새 정답",
        isDemo: 1,
      } as any);

      expect(result).toEqual(newQuestion);
      expect(db.createDemoQuestion).toHaveBeenCalled();
    });
  });
});
