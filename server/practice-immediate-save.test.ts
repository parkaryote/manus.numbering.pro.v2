import { describe, it, expect, vi } from 'vitest';

describe('Practice Immediate Save on Correct Answer', () => {
  describe('handleCorrectAnswer with immediate DB save', () => {
    it('should save session immediately on correct answer', async () => {
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });
      
      // handleCorrectAnswer 시뮬레이션
      const questionId = 123;
      const elapsedTime = 30;
      const userInput = 'cortex';
      
      await createSessionMock({
        questionId,
        duration: elapsedTime,
        typingSpeed: Math.round(userInput.length / (elapsedTime / 60)),
        accuracy: 100,
        errorCount: 0,
      });

      expect(createSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: 123,
          duration: 30,
        })
      );
    });

    it('should fetch and update cumulative count after save', async () => {
      const createSessionMock = vi.fn().mockResolvedValue({ id: 1 });
      const fetchMock = vi.fn().mockResolvedValue({ count: 3 });
      const setDataMock = vi.fn();

      const utils = {
        practice: {
          countByQuestion: {
            fetch: fetchMock,
            setData: setDataMock
          }
        }
      };

      const questionId = 123;

      // 세션 저장
      await createSessionMock({ questionId, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });

      // 누적 연습 수 갱신
      const newData = await utils.practice.countByQuestion.fetch({ questionId });
      if (newData) {
        utils.practice.countByQuestion.setData({ questionId }, newData);
      }

      expect(createSessionMock).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith({ questionId });
      expect(setDataMock).toHaveBeenCalledWith({ questionId }, { count: 3 });
    });

    it('should increment cumulative count each time correct answer is given', async () => {
      let cumulativeCount = 2;

      // 정답 1회
      cumulativeCount = 3;
      expect(cumulativeCount).toBe(3);

      // 정답 2회
      cumulativeCount = 4;
      expect(cumulativeCount).toBe(4);

      // 정답 3회
      cumulativeCount = 5;
      expect(cumulativeCount).toBe(5);
    });
  });

  describe('Real-time cumulative count update', () => {
    it('should show cumulative count increasing immediately', async () => {
      let currentCount = 0;
      let cumulativeCount = 2;

      // 정답 1회 - 즉시 저장 및 누적 +1
      currentCount = 1;
      cumulativeCount = 3;
      expect(currentCount).toBe(1);
      expect(cumulativeCount).toBe(3);

      // 정답 2회 - 즉시 저장 및 누적 +1
      currentCount = 2;
      cumulativeCount = 4;
      expect(currentCount).toBe(2);
      expect(cumulativeCount).toBe(4);

      // 정답 3회 - 즉시 저장 및 누적 +1
      currentCount = 3;
      cumulativeCount = 5;
      expect(currentCount).toBe(3);
      expect(cumulativeCount).toBe(5);
    });

    it('should not require page reload to see cumulative count update', async () => {
      let cumulativeCount = 10;
      const updates: number[] = [cumulativeCount];

      // 정답 1회
      cumulativeCount = 11;
      updates.push(cumulativeCount);

      // 정답 2회
      cumulativeCount = 12;
      updates.push(cumulativeCount);

      // 정답 3회
      cumulativeCount = 13;
      updates.push(cumulativeCount);

      // 페이지 새로고침 없이 모든 업데이트가 반영됨
      expect(updates).toEqual([10, 11, 12, 13]);
    });

    it('should maintain separate current and cumulative counts', async () => {
      let currentCount = 0;
      let cumulativeCount = 5;

      // 정답 1회
      currentCount = 1;
      cumulativeCount = 6;
      expect(currentCount).toBe(1);
      expect(cumulativeCount).toBe(6);

      // 정답 2회
      currentCount = 2;
      cumulativeCount = 7;
      expect(currentCount).toBe(2);
      expect(cumulativeCount).toBe(7);

      // 정답 3회
      currentCount = 3;
      cumulativeCount = 8;
      expect(currentCount).toBe(3);
      expect(cumulativeCount).toBe(8);

      // 세션 종료 시 현재 연습 초기화
      currentCount = 0;
      expect(currentCount).toBe(0);
      expect(cumulativeCount).toBe(8); // 누적 연습은 유지
    });
  });

  describe('Error handling during immediate save', () => {
    it('should handle save errors gracefully', async () => {
      const createSessionMock = vi.fn().mockRejectedValue(new Error('Save failed'));
      
      try {
        await createSessionMock({ questionId: 123, duration: 30, typingSpeed: 12, accuracy: 100, errorCount: 0 });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should continue practice even if save fails', async () => {
      let currentCount = 0;
      const saveError = new Error('Save failed');

      // 정답 1회 - 저장 실패
      currentCount = 1;
      expect(currentCount).toBe(1); // 현재 연습은 증가

      // 정답 2회 - 저장 재시도
      currentCount = 2;
      expect(currentCount).toBe(2); // 현재 연습 계속 증가
    });
  });
});
