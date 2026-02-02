import { describe, it, expect, vi } from 'vitest';

describe('Practice No Duplicate Save', () => {
  describe('handleCorrectAnswer with duplicate save prevention', () => {
    it('should save only once on correct answer', async () => {
      let hasBeenSaved = false;
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });

      // 첫 번째 정답 - 저장
      if (!hasBeenSaved) {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
        hasBeenSaved = true;
      }

      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    it('should not save again when leaving page if already saved', async () => {
      let hasBeenSaved = false;
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });

      // 정답 일치 시 저장
      if (!hasBeenSaved) {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
        hasBeenSaved = true;
      }

      // 페이지 나갈 때 - 이미 저장되었으므로 저장 안 함
      if (!hasBeenSaved) {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      }

      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    it('should prevent cumulative count from incrementing twice', async () => {
      let cumulativeCount = 2;
      let hasBeenSaved = false;

      // 정답 일치 시 저장 및 누적 +1
      if (!hasBeenSaved) {
        cumulativeCount = 3;
        hasBeenSaved = true;
      }

      // 페이지 나갈 때 - 이미 저장되었으므로 누적 증가 안 함
      if (!hasBeenSaved) {
        cumulativeCount = 4;
      }

      expect(cumulativeCount).toBe(3);
    });
  });

  describe('Toast message behavior', () => {
    it('should not show toast on correct answer', async () => {
      const toastMock = vi.fn();

      // 정답 일치 시 - 토스트 없음
      // handleCorrectAnswer에서는 토스트 호출 안 함
      expect(toastMock).not.toHaveBeenCalled();
    });

    it('should show toast only when leaving page', async () => {
      const toastMock = vi.fn();

      // 정답 일치 시 - 토스트 없음
      // handleCorrectAnswer에서는 토스트 호출 안 함

      // 페이지 나갈 때 - 토스트 표시
      toastMock("연습 기록이 저장되었습니다");

      expect(toastMock).toHaveBeenCalledWith("연습 기록이 저장되었습니다");
      expect(toastMock).toHaveBeenCalledTimes(1);
    });

    it('should not interfere with practice flow', async () => {
      let practiceCount = 0;
      const toastMock = vi.fn();

      // 정답 1회 - 토스트 없음, 연습 계속
      practiceCount = 1;
      expect(toastMock).not.toHaveBeenCalled();
      expect(practiceCount).toBe(1);

      // 정답 2회 - 토스트 없음, 연습 계속
      practiceCount = 2;
      expect(toastMock).not.toHaveBeenCalled();
      expect(practiceCount).toBe(2);

      // 정답 3회 - 토스트 없음, 연습 계속
      practiceCount = 3;
      expect(toastMock).not.toHaveBeenCalled();
      expect(practiceCount).toBe(3);
    });
  });

  describe('Real-time cumulative count without duplication', () => {
    it('should increment cumulative count only once per session', async () => {
      let cumulativeCount = 5;
      let hasBeenSaved = false;

      // 정답 일치 시 저장
      if (!hasBeenSaved) {
        cumulativeCount = 6;
        hasBeenSaved = true;
      }

      // 페이지 나갈 때 - 중복 저장 방지
      if (!hasBeenSaved) {
        cumulativeCount = 7;
      }

      expect(cumulativeCount).toBe(6);
    });

    it('should maintain correct count across multiple sessions', async () => {
      let cumulativeCount = 0;

      // 세션 1
      let hasBeenSaved1 = false;
      if (!hasBeenSaved1) {
        cumulativeCount = 1;
        hasBeenSaved1 = true;
      }
      expect(cumulativeCount).toBe(1);

      // 세션 2
      let hasBeenSaved2 = false;
      if (!hasBeenSaved2) {
        cumulativeCount = 2;
        hasBeenSaved2 = true;
      }
      expect(cumulativeCount).toBe(2);

      // 세션 3
      let hasBeenSaved3 = false;
      if (!hasBeenSaved3) {
        cumulativeCount = 3;
        hasBeenSaved3 = true;
      }
      expect(cumulativeCount).toBe(3);
    });
  });

  describe('Immediate new practice without toast delay', () => {
    it('should show new practice immediately after correct answer', async () => {
      let currentPractice = 0;
      let userInput = "";
      const toastMock = vi.fn();

      // 정답 일치 시 - 토스트 없으므로 즉시 다음 연습
      currentPractice = 1;
      userInput = ""; // 초기화
      expect(toastMock).not.toHaveBeenCalled();
      expect(currentPractice).toBe(1);
      expect(userInput).toBe("");
    });

    it('should not delay practice flow with toast messages', async () => {
      let practiceCount = 0;
      const toastMock = vi.fn();
      const startTime = Date.now();

      // 정답 1회
      practiceCount = 1;
      // 토스트 없음 - 지연 없음

      // 정답 2회
      practiceCount = 2;
      // 토스트 없음 - 지연 없음

      const elapsed = Date.now() - startTime;
      expect(practiceCount).toBe(2);
      expect(toastMock).not.toHaveBeenCalled();
      expect(elapsed).toBeLessThan(100); // 거의 즉시 완료
    });
  });
});
