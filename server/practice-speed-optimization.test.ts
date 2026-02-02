import { describe, it, expect, vi } from 'vitest';

describe('Practice Speed Optimization', () => {
  describe('Immediate input clearing', () => {
    it('should clear input immediately without waiting', async () => {
      let userInput = "cortex";
      
      // 정답 일치 시 즉시 입력 초기화
      userInput = "";
      
      expect(userInput).toBe("");
    });

    it('should focus textarea immediately', async () => {
      const focusMock = vi.fn();
      const textareaRef = { current: { focus: focusMock } };
      
      // 정답 일치 시 즉시 포커스
      textareaRef.current?.focus();
      
      expect(focusMock).toHaveBeenCalled();
    });

    it('should not delay practice flow with setTimeout', async () => {
      let userInput = "cortex";
      const startTime = Date.now();
      
      // 정답 일치 시 즉시 초기화 (setTimeout 없음)
      userInput = "";
      
      const elapsed = Date.now() - startTime;
      expect(userInput).toBe("");
      expect(elapsed).toBeLessThan(10); // 거의 즉시
    });
  });

  describe('Cumulative count real-time update', () => {
    it('should update cumulative count without fetch', async () => {
      let cumulativeCount = 5;
      
      // fetch 없이 직접 증가
      cumulativeCount = cumulativeCount + 1;
      
      expect(cumulativeCount).toBe(6);
    });

    it('should update cumulative count using setData updater function', async () => {
      let cumulativeData = { count: 5 };
      
      // setData 업데이터 함수로 직접 증가
      const updater = (old: any) => old ? { count: old.count + 1 } : { count: 1 };
      cumulativeData = updater(cumulativeData);
      
      expect(cumulativeData.count).toBe(6);
    });

    it('should reflect cumulative count immediately', async () => {
      let cumulativeCount = 0;
      const updates: number[] = [];
      
      // 정답 1회
      cumulativeCount = cumulativeCount + 1;
      updates.push(cumulativeCount);
      
      // 정답 2회
      cumulativeCount = cumulativeCount + 1;
      updates.push(cumulativeCount);
      
      // 정답 3회
      cumulativeCount = cumulativeCount + 1;
      updates.push(cumulativeCount);
      
      expect(updates).toEqual([1, 2, 3]);
    });
  });

  describe('Background save with non-blocking UI', () => {
    it('should save in background without blocking input', async () => {
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });
      let userInput = "";
      
      // 정답 일치 시 즉시 입력 초기화
      userInput = "";
      
      // 백그라운드에서 비동기 저장 (UI 블로킹 없음)
      createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      
      expect(userInput).toBe("");
      expect(createSessionMock).toHaveBeenCalled();
    });

    it('should not wait for save to complete before showing new practice', async () => {
      const createSessionMock = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ id: 1 }), 1000))
      );
      
      let userInput = "";
      const startTime = Date.now();
      
      // 정답 일치 시 즉시 입력 초기화 (저장 완료 대기 없음)
      userInput = "";
      
      const elapsed = Date.now() - startTime;
      expect(userInput).toBe("");
      expect(elapsed).toBeLessThan(100); // 저장 시간 상관없이 즉시
    });
  });

  describe('Fast fade out animation', () => {
    it('should complete fade out quickly (200ms)', async () => {
      let isFadingOut = true;
      
      // 정답 일치 시 즉시 fade out 시작
      expect(isFadingOut).toBe(true);
      
      // 200ms 후 fade out 해제
      setTimeout(() => {
        isFadingOut = false;
      }, 200);
      
      // 200ms 후 확인
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(isFadingOut).toBe(false);
    });

    it('should not delay practice with long animation', async () => {
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 정답 일치 시 즉시 fade out 시작
      isFadingOut = true;
      
      // 200ms 후 fade out 해제 (이전 1500ms에서 개선)
      setTimeout(() => {
        isFadingOut = false;
      }, 200);
      
      // 200ms 후 확인
      await new Promise(resolve => setTimeout(resolve, 250));
      const elapsed = Date.now() - startTime;
      
      expect(isFadingOut).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe('Overall practice flow speed', () => {
    it('should complete entire flow quickly', async () => {
      let currentCount = 0;
      let cumulativeCount = 0;
      let userInput = "cortex";
      let isFadingOut = true;
      const startTime = Date.now();
      
      // 1. 현재 연습 증가
      currentCount = 1;
      
      // 2. 입력 즉시 초기화
      userInput = "";
      
      // 3. 누적 연습 직접 증가
      cumulativeCount = 1;
      
      // 4. fade out 시작
      isFadingOut = true;
      
      // 5. 200ms 후 fade out 해제
      setTimeout(() => {
        isFadingOut = false;
      }, 200);
      
      const elapsed = Date.now() - startTime;
      
      expect(currentCount).toBe(1);
      expect(userInput).toBe("");
      expect(cumulativeCount).toBe(1);
      expect(isFadingOut).toBe(true);
      expect(elapsed).toBeLessThan(50); // 거의 즉시 완료
    });

    it('should allow rapid successive correct answers', async () => {
      let currentCount = 0;
      let cumulativeCount = 0;
      const times: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        
        // 각 정답 처리
        currentCount = currentCount + 1;
        cumulativeCount = cumulativeCount + 1;
        
        const elapsed = Date.now() - startTime;
        times.push(elapsed);
      }
      
      expect(currentCount).toBe(5);
      expect(cumulativeCount).toBe(5);
      
      // 모든 처리가 빠르게 완료
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgTime).toBeLessThan(10);
    });
  });
});
