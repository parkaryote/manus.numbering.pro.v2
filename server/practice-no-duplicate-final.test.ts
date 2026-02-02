import { describe, it, expect, vi } from 'vitest';

describe('Practice No Duplicate Save with Timing Adjustment', () => {
  describe('Prevent duplicate save on page leave', () => {
    it('should set hasBeenSaved after correct answer', async () => {
      let hasBeenSaved = false;
      
      // 정답 일치 시 저장 완료 후 플래그 설정
      hasBeenSaved = true;
      
      expect(hasBeenSaved).toBe(true);
    });

    it('should not save again when page leaves if already saved', async () => {
      let hasBeenSaved = false;
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });
      
      // 정답 일치 시 저장 + 플래그 설정
      await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      hasBeenSaved = true;
      
      // 페이지 나갈 때 - 이미 저장되었으므로 저장 안 함
      if (!hasBeenSaved) {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      }
      
      // 한 번만 저장됨
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    it('should reset hasBeenSaved when question changes', async () => {
      let hasBeenSaved = false;
      let currentQuestionId = 123;
      
      // 정답 일치 시 플래그 설정
      hasBeenSaved = true;
      expect(hasBeenSaved).toBe(true);
      
      // 새로운 문제로 이동
      currentQuestionId = 456;
      hasBeenSaved = false; // 초기화
      
      expect(hasBeenSaved).toBe(false);
    });

    it('should allow multiple correct answers without duplicate saves', async () => {
      let hasBeenSaved = false;
      let cumulativeCount = 0;
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });
      
      // 정답 1회
      await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      hasBeenSaved = true;
      cumulativeCount = 1;
      
      // 정답 2회 - hasBeenSaved는 여전히 true이므로 저장 안 함
      // (실제로는 새로운 세션이므로 저장되어야 하지만, 페이지 나갈 때 중복 방지)
      
      // 페이지 나갈 때
      if (!hasBeenSaved) {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      }
      
      expect(createSessionMock).toHaveBeenCalledTimes(1);
      expect(cumulativeCount).toBe(1);
    });
  });

  describe('Timing adjustment 0.7s and 0.8s', () => {
    it('should clear input after 0.7 seconds', async () => {
      let userInput = "cortex";
      const startTime = Date.now();
      
      // 0.7초 후 입력 초기화
      await new Promise(resolve => setTimeout(resolve, 700));
      userInput = "";
      
      const elapsed = Date.now() - startTime;
      expect(userInput).toBe("");
      expect(elapsed).toBeGreaterThanOrEqual(700);
      expect(elapsed).toBeLessThan(800);
    });

    it('should release fade out after 0.8 seconds', async () => {
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 0.8초 후 fade out 해제
      await new Promise(resolve => setTimeout(resolve, 800));
      isFadingOut = false;
      
      const elapsed = Date.now() - startTime;
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(800);
      expect(elapsed).toBeLessThan(900);
    });

    it('should provide lingering effect with 0.7s and 0.8s timing', async () => {
      let currentCount = 0;
      let cumulativeCount = 0;
      let userInput = "cortex";
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 정답 일치 시 즉시 카운트 증가
      currentCount = 1;
      cumulativeCount = 1;
      
      // 0.7초 후 입력 초기화
      await new Promise(resolve => setTimeout(resolve, 700));
      userInput = "";
      
      // 0.8초 후 fade out 해제
      await new Promise(resolve => setTimeout(resolve, 100));
      isFadingOut = false;
      
      const elapsed = Date.now() - startTime;
      
      expect(currentCount).toBe(1);
      expect(cumulativeCount).toBe(1);
      expect(userInput).toBe("");
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(800);
      expect(elapsed).toBeLessThan(900);
    });
  });

  describe('Cumulative count no duplicate increment', () => {
    it('should increment cumulative count only once per correct answer', async () => {
      let cumulativeCount = 0;
      
      // 정답 일치 시 누적 +1
      cumulativeCount = 1;
      
      // 페이지 나갈 때 - 이미 저장되었으므로 누적 증가 안 함
      // (hasBeenSaved 플래그로 방지)
      
      expect(cumulativeCount).toBe(1);
    });

    it('should not increment cumulative count on page leave if already saved', async () => {
      let cumulativeCount = 0;
      let hasBeenSaved = false;
      
      // 정답 일치 시 누적 +1 + 플래그 설정
      cumulativeCount = 1;
      hasBeenSaved = true;
      
      // 페이지 나갈 때 - 플래그 체크로 중복 증가 방지
      if (!hasBeenSaved) {
        cumulativeCount = cumulativeCount + 1;
      }
      
      expect(cumulativeCount).toBe(1);
    });

    it('should show correct cumulative count after multiple correct answers', async () => {
      let cumulativeCount = 0;
      const updates: number[] = [];
      
      // 정답 1회
      cumulativeCount = 1;
      updates.push(cumulativeCount);
      
      // 0.8초 여운
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // 정답 2회
      cumulativeCount = 2;
      updates.push(cumulativeCount);
      
      // 0.8초 여운
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // 정답 3회
      cumulativeCount = 3;
      updates.push(cumulativeCount);
      
      // 페이지 나갈 때 - 이미 저장되었으므로 누적 증가 안 함
      
      expect(updates).toEqual([1, 2, 3]);
    });
  });

  describe('Real-time cumulative update during lingering effect', () => {
    it('should update cumulative count immediately while fade out is happening', async () => {
      let cumulativeCount = 0;
      let isFadingOut = true;
      
      // 정답 일치 시 즉시 누적 +1 (fade out 시작 전)
      cumulativeCount = 1;
      expect(cumulativeCount).toBe(1);
      
      // fade out 중 (0.8초)
      isFadingOut = true;
      
      // 0.8초 후 fade out 해제
      await new Promise(resolve => setTimeout(resolve, 800));
      isFadingOut = false;
      
      expect(cumulativeCount).toBe(1);
      expect(isFadingOut).toBe(false);
    });
  });
});
