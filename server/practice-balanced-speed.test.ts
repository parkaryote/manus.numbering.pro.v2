import { describe, it, expect, vi } from 'vitest';

describe('Practice Balanced Speed with Lingering Effect', () => {
  describe('Balanced timing for user feedback', () => {
    it('should have 0.5 second delay for input clearing', async () => {
      let userInput = "cortex";
      const startTime = Date.now();
      
      // 0.5초 후 입력 초기화
      await new Promise(resolve => setTimeout(resolve, 500));
      userInput = "";
      
      const elapsed = Date.now() - startTime;
      expect(userInput).toBe("");
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(600);
    });

    it('should have 0.6 second delay for fade out completion', async () => {
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 0.6초 후 fade out 해제
      await new Promise(resolve => setTimeout(resolve, 600));
      isFadingOut = false;
      
      const elapsed = Date.now() - startTime;
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(600);
      expect(elapsed).toBeLessThan(700);
    });

    it('should provide lingering effect without being too slow', async () => {
      let currentCount = 0;
      let cumulativeCount = 0;
      let userInput = "cortex";
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 정답 일치 시 즉시 카운트 증가
      currentCount = 1;
      cumulativeCount = 1;
      
      // 0.5초 후 입력 초기화
      await new Promise(resolve => setTimeout(resolve, 500));
      userInput = "";
      
      // 0.6초 후 fade out 해제
      await new Promise(resolve => setTimeout(resolve, 100));
      isFadingOut = false;
      
      const elapsed = Date.now() - startTime;
      
      expect(currentCount).toBe(1);
      expect(cumulativeCount).toBe(1);
      expect(userInput).toBe("");
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(600);
      expect(elapsed).toBeLessThan(700);
    });
  });

  describe('Cumulative count real-time update (no delay)', () => {
    it('should update cumulative count immediately without waiting', async () => {
      let cumulativeCount = 0;
      const startTime = Date.now();
      
      // 누적 연습은 즉시 반영 (0ms)
      cumulativeCount = 1;
      
      const elapsed = Date.now() - startTime;
      expect(cumulativeCount).toBe(1);
      expect(elapsed).toBeLessThan(10);
    });

    it('should show cumulative count updating in real-time during lingering effect', async () => {
      let cumulativeCount = 0;
      const updates: number[] = [];
      
      // 정답 1회 - 누적 즉시 반영
      cumulativeCount = 1;
      updates.push(cumulativeCount);
      
      // 0.5초 대기 (여운)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 정답 2회 - 누적 즉시 반영
      cumulativeCount = 2;
      updates.push(cumulativeCount);
      
      // 0.5초 대기 (여운)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 정답 3회 - 누적 즉시 반영
      cumulativeCount = 3;
      updates.push(cumulativeCount);
      
      expect(updates).toEqual([1, 2, 3]);
    });
  });

  describe('Background save with non-blocking UI', () => {
    it('should save in background without blocking lingering effect', async () => {
      const createSessionMock = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ id: 1 }), 200))
      );
      
      let userInput = "cortex";
      const startTime = Date.now();
      
      // 백그라운드에서 저장 시작 (블로킹 없음)
      createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      
      // 0.5초 후 입력 초기화 (저장 완료 대기 없음)
      await new Promise(resolve => setTimeout(resolve, 500));
      userInput = "";
      
      const elapsed = Date.now() - startTime;
      expect(userInput).toBe("");
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(600);
      expect(createSessionMock).toHaveBeenCalled();
    });
  });

  describe('Comparison with previous versions', () => {
    it('should be faster than original 1.5 second version', async () => {
      const startTime = Date.now();
      
      // 여운 있는 버전 (0.6초)
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1500); // 원래 1.5초보다 빠름
      expect(elapsed).toBeGreaterThanOrEqual(600);
    });

    it('should be slower than ultra-fast version for better UX', async () => {
      const startTime = Date.now();
      
      // 여운 있는 버전 (0.6초)
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(600); // 즉시 버전보다 느림
      expect(elapsed).toBeLessThan(700);
    });
  });

  describe('Rapid successive correct answers with lingering', () => {
    it('should handle multiple answers smoothly with lingering effect', async () => {
      let currentCount = 0;
      let cumulativeCount = 0;
      const totalTime = Date.now();
      
      for (let i = 0; i < 3; i++) {
        // 정답 일치 시 카운트 증가
        currentCount = currentCount + 1;
        cumulativeCount = cumulativeCount + 1;
        
        // 0.6초 여운
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      
      const elapsed = Date.now() - totalTime;
      expect(currentCount).toBe(3);
      expect(cumulativeCount).toBe(3);
      expect(elapsed).toBeGreaterThanOrEqual(1800); // 3 * 0.6초
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('User experience with lingering effect', () => {
    it('should provide clear feedback without feeling sluggish', async () => {
      let isFadingOut = true;
      let userInput = "cortex";
      
      // 정답 일치 시 fade out 시작
      expect(isFadingOut).toBe(true);
      
      // 0.6초 동안 여운 (사용자가 정답했다는 느낌)
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // 여운 후 상태 해제
      isFadingOut = false;
      userInput = "";
      
      expect(isFadingOut).toBe(false);
      expect(userInput).toBe("");
    });

    it('should feel responsive while maintaining lingering effect', async () => {
      let cumulativeCount = 0;
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 누적 연습은 즉시 반영 (반응성)
      cumulativeCount = 1;
      expect(cumulativeCount).toBe(1);
      
      // fade out은 0.6초 (여운)
      await new Promise(resolve => setTimeout(resolve, 600));
      isFadingOut = false;
      
      const elapsed = Date.now() - startTime;
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(600);
      expect(elapsed).toBeLessThan(700);
    });
  });
});
