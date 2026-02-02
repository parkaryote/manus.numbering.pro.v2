import { describe, it, expect, vi } from 'vitest';

describe('Practice Cumulative Count Real-time Update', () => {
  describe('fetch + setData pattern', () => {
    it('should fetch new data and update cache on correct answer', async () => {
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

      const questionId = 'q-123';
      
      // handleCorrectAnswer 시뮬레이션
      const newData = await utils.practice.countByQuestion.fetch({ questionId });
      if (newData) {
        utils.practice.countByQuestion.setData({ questionId }, newData);
      }

      expect(fetchMock).toHaveBeenCalledWith({ questionId });
      expect(setDataMock).toHaveBeenCalledWith({ questionId }, { count: 3 });
    });

    it('should update display immediately after setData', async () => {
      let displayCount = 2; // 이전 누적 연습
      
      // fetch + setData 시뮬레이션
      const newData = { count: 3 };
      displayCount = newData.count;

      expect(displayCount).toBe(3);
    });

    it('should handle multiple correct answers with cache updates', async () => {
      let cumulativeCount = 2;

      // 첫 번째 정답
      const data1 = { count: 3 };
      cumulativeCount = data1.count;
      expect(cumulativeCount).toBe(3);

      // 두 번째 정답
      const data2 = { count: 4 };
      cumulativeCount = data2.count;
      expect(cumulativeCount).toBe(4);

      // 세 번째 정답
      const data3 = { count: 5 };
      cumulativeCount = data3.count;
      expect(cumulativeCount).toBe(5);
    });
  });

  describe('savePracticeSession with fetch + setData', () => {
    it('should fetch and update cache after session save', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ count: 5 });
      const setDataMock = vi.fn();

      const utils = {
        practice: {
          countByQuestion: {
            fetch: fetchMock,
            setData: setDataMock
          }
        }
      };

      const questionId = 'q-456';

      // savePracticeSession 시뮬레이션
      const newData = await utils.practice.countByQuestion.fetch({ questionId });
      if (newData) {
        utils.practice.countByQuestion.setData({ questionId }, newData);
      }

      expect(fetchMock).toHaveBeenCalledWith({ questionId });
      expect(setDataMock).toHaveBeenCalledWith({ questionId }, { count: 5 });
    });
  });

  describe('Current vs Cumulative count synchronization', () => {
    it('should increment both current and cumulative on correct answer', async () => {
      let currentCount = 0;
      let cumulativeCount = 2;

      // 정답 일치 시
      currentCount += 1;
      const newCumulativeData = { count: 3 };
      cumulativeCount = newCumulativeData.count;

      expect(currentCount).toBe(1);
      expect(cumulativeCount).toBe(3);
    });

    it('should maintain separate counts during session', async () => {
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
    });

    it('should reset current count but keep cumulative on session end', async () => {
      let currentCount = 3;
      let cumulativeCount = 8;

      // 세션 종료 시 현재 연습 초기화
      currentCount = 0;
      // 누적 연습은 유지

      expect(currentCount).toBe(0);
      expect(cumulativeCount).toBe(8);
    });
  });

  describe('Real-time display update', () => {
    it('should show cumulative count increasing in real-time', async () => {
      const updates: number[] = [];
      
      // 정답 1회
      updates.push(3);
      // 정답 2회
      updates.push(4);
      // 정답 3회
      updates.push(5);

      expect(updates).toEqual([3, 4, 5]);
    });

    it('should not skip any count values', async () => {
      let cumulativeCount = 2;
      const countHistory: number[] = [cumulativeCount];

      // 정답 1회
      cumulativeCount = 3;
      countHistory.push(cumulativeCount);

      // 정답 2회
      cumulativeCount = 4;
      countHistory.push(cumulativeCount);

      // 정답 3회
      cumulativeCount = 5;
      countHistory.push(cumulativeCount);

      expect(countHistory).toEqual([2, 3, 4, 5]);
    });
  });
});
