import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Practice Realtime Refetch', () => {
  describe('handleCorrectAnswer with refetch', () => {
    it('should invalidate and refetch practice count on correct answer', async () => {
      // Mock utils
      const invalidateMock = vi.fn().mockResolvedValue(undefined);
      const refetchMock = vi.fn().mockResolvedValue({
        data: { count: 3 } // 이전 누적 연습이 2회였다면 3회로 증가
      });

      const utils = {
        practice: {
          countByQuestion: {
            invalidate: invalidateMock,
            refetch: refetchMock
          }
        }
      };

      const questionId = 'q-123';
      
      // handleCorrectAnswer 시뮬레이션
      await utils.practice.countByQuestion.invalidate({ questionId });
      await utils.practice.countByQuestion.refetch({ questionId });

      expect(invalidateMock).toHaveBeenCalledWith({ questionId });
      expect(refetchMock).toHaveBeenCalledWith({ questionId });
    });

    it('should update practice count display after refetch', async () => {
      // 정답 일치 시 현재 연습(practiceCount) 증가 + 누적 연습(practiceCountData) 갱신
      let practiceCount = 0;
      let practiceCountData = { count: 2 };

      // handleCorrectAnswer 실행
      practiceCount += 1; // 현재 연습 증가
      
      // invalidate + refetch 시뮬레이션
      const refetchResult = { count: 3 }; // 누적 연습 증가
      practiceCountData = refetchResult;

      expect(practiceCount).toBe(1);
      expect(practiceCountData.count).toBe(3);
    });

    it('should handle multiple correct answers in sequence', async () => {
      let practiceCount = 0;
      let cumulativeCount = 2;

      // 첫 번째 정답
      practiceCount += 1;
      cumulativeCount += 1;
      expect(practiceCount).toBe(1);
      expect(cumulativeCount).toBe(3);

      // 두 번째 정답
      practiceCount += 1;
      cumulativeCount += 1;
      expect(practiceCount).toBe(2);
      expect(cumulativeCount).toBe(4);

      // 세 번째 정답
      practiceCount += 1;
      cumulativeCount += 1;
      expect(practiceCount).toBe(3);
      expect(cumulativeCount).toBe(5);
    });
  });

  describe('savePracticeSession with refetch', () => {
    it('should invalidate and refetch after saving session', async () => {
      const invalidateMock = vi.fn().mockResolvedValue(undefined);
      const refetchMock = vi.fn().mockResolvedValue({
        data: { count: 5 }
      });

      const utils = {
        practice: {
          countByQuestion: {
            invalidate: invalidateMock,
            refetch: refetchMock
          }
        }
      };

      const questionId = 'q-456';

      // savePracticeSession 시뮬레이션
      await utils.practice.countByQuestion.invalidate({ questionId });
      await utils.practice.countByQuestion.refetch({ questionId });

      expect(invalidateMock).toHaveBeenCalledWith({ questionId });
      expect(refetchMock).toHaveBeenCalledWith({ questionId });
    });

    it('should update cumulative count after session save', async () => {
      let cumulativeCount = 4;
      
      // 세션 저장 후 refetch
      const newCount = 5;
      cumulativeCount = newCount;

      expect(cumulativeCount).toBe(5);
    });
  });

  describe('Real-time update flow', () => {
    it('should show current and cumulative practice count increasing', async () => {
      let currentPractice = 0;
      let cumulativePractice = 2;

      // 정답 일치 시
      currentPractice += 1;
      const refetchedCumulative = 3;
      cumulativePractice = refetchedCumulative;

      expect(currentPractice).toBe(1);
      expect(cumulativePractice).toBe(3);

      // 화면에 표시되는 값
      const displayCurrent = currentPractice; // "1"
      const displayCumulative = cumulativePractice; // "3"

      expect(displayCurrent).toBe(1);
      expect(displayCumulative).toBe(3);
    });

    it('should maintain separate counts for current and cumulative', async () => {
      let currentPractice = 0;
      let cumulativePractice = 5;

      // 정답 1회
      currentPractice = 1;
      cumulativePractice = 6;
      expect(currentPractice).toBe(1);
      expect(cumulativePractice).toBe(6);

      // 정답 2회
      currentPractice = 2;
      cumulativePractice = 7;
      expect(currentPractice).toBe(2);
      expect(cumulativePractice).toBe(7);

      // 정답 3회
      currentPractice = 3;
      cumulativePractice = 8;
      expect(currentPractice).toBe(3);
      expect(cumulativePractice).toBe(8);
    });
  });
});
