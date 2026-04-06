import { describe, it, expect } from "vitest";

describe("SubjectPractice 라우트 및 UI 통합", () => {
  it("App.tsx에 /subject-practice/:subjectId 라우트가 등록되어 있어야 함", async () => {
    const fs = await import("fs");
    const appContent = fs.readFileSync("client/src/App.tsx", "utf-8");
    expect(appContent).toContain("subject-practice/:subjectId");
    expect(appContent).toContain("SubjectPractice");
  });

  it("SubjectPractice 컴포넌트가 subjectId prop을 받아야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("subjectId: number");
    expect(content).toContain("export default function SubjectPractice");
  });

  it("Questions.tsx에 모의고사 버튼이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/Questions.tsx", "utf-8");
    expect(content).toContain("모의고사");
    expect(content).toContain("subject-exam");
    expect(content).toContain("ClipboardCheck");
  });

  it("SubjectPractice에 sticky 입력 패널이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("StickyInputPanel");
    expect(content).toContain("fixed bottom-0");
  });

  it("SubjectPractice에 IntersectionObserver 기반 포커스 추적이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("IntersectionObserver");
    expect(content).toContain("visibleQuestionsRef");
  });

  it("SubjectPractice에 우측 북마크 패널이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("scrollToQuestion");
    expect(content).toContain("hidden lg:flex");
  });

  it("SubjectPractice에 연습 완료 시 DB 저장 로직이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("practice.create");
    expect(content).toContain("createSession.mutate");
  });

  it("SubjectPractice에 글자별 채점 렌더링이 있어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("renderColoredText");
    expect(content).toContain("isPartialMatch");
  });

  it("SubjectPractice에 시험 이동 기능이 있어야 함 (Shift+Enter)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("Shift");
    expect(content).toContain("handleGoToTest");
    expect(content).toContain("/test/");
  });

  it("SubjectPractice에 안정도 정보가 표시되어야 함", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SubjectPractice.tsx", "utf-8");
    expect(content).toContain("confidence.getBySubject");
    expect(content).toContain("confidenceMap");
    expect(content).toContain("getStateBarColor");
  });
});
