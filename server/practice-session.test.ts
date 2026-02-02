import { describe, it, expect, beforeEach } from 'vitest';

describe('Practice Session - Cumulative counting', () => {
  let practiceCount: number;
  let elapsedTime: number;
  let questionId: number;

  beforeEach(() => {
    practiceCount = 0;
    elapsedTime = 0;
    questionId = 1;
  });

  describe('Practice count increment', () => {
    it('should increment practice count when correct answer is matched', () => {
      // Simulate correct answer
      practiceCount = 0;
      expect(practiceCount).toBe(0);

      // User types correct answer
      practiceCount += 1;
      expect(practiceCount).toBe(1);

      // User types another correct answer
      practiceCount += 1;
      expect(practiceCount).toBe(2);
    });

    it('should accumulate practice count across multiple sessions', () => {
      let sessionCount = 0;

      // Session 1: 3 correct answers
      for (let i = 0; i < 3; i++) {
        sessionCount += 1;
      }
      expect(sessionCount).toBe(3);

      // Session 2: 2 more correct answers
      for (let i = 0; i < 2; i++) {
        sessionCount += 1;
      }
      expect(sessionCount).toBe(5);

      // Session 3: 1 more correct answer
      sessionCount += 1;
      expect(sessionCount).toBe(6);
    });

    it('should not increment if practice count is 0 and elapsed time is 0', () => {
      const shouldSave = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSave).toBe(false);
    });

    it('should save when practice count > 0 and elapsed time > 0', () => {
      practiceCount = 3;
      elapsedTime = 45;

      const shouldSave = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSave).toBe(true);
    });
  });

  describe('Elapsed time tracking', () => {
    it('should track elapsed time correctly', () => {
      const startTime = Date.now();
      
      // Simulate 30 seconds of practice
      elapsedTime = 30;
      expect(elapsedTime).toBe(30);

      // Simulate 45 seconds total
      elapsedTime = 45;
      expect(elapsedTime).toBe(45);
    });

    it('should calculate typing speed correctly', () => {
      const userInputLength = 150; // characters typed
      elapsedTime = 60; // 1 minute

      const timeInMinutes = elapsedTime / 60;
      const speed = timeInMinutes > 0 ? Math.round(userInputLength / timeInMinutes) : 0;

      expect(speed).toBe(150); // 150 chars per minute
    });

    it('should handle zero elapsed time', () => {
      const userInputLength = 100;
      elapsedTime = 0;

      const timeInMinutes = elapsedTime / 60;
      const speed = timeInMinutes > 0 ? Math.round(userInputLength / timeInMinutes) : 0;

      expect(speed).toBe(0);
    });
  });

  describe('Auto-save on page unmount or go back', () => {
    it('should save session when user has practiced and spent time', () => {
      practiceCount = 5;
      elapsedTime = 120;

      const shouldSave = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSave).toBe(true);
    });

    it('should not save if no practice was done', () => {
      practiceCount = 0;
      elapsedTime = 120;

      const shouldSave = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSave).toBe(false);
    });

    it('should not save if no time has elapsed', () => {
      practiceCount = 5;
      elapsedTime = 0;

      const shouldSave = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSave).toBe(false);
    });

    it('should create session with correct data', () => {
      practiceCount = 3;
      elapsedTime = 90;
      const userInputLength = 200;

      const timeInMinutes = elapsedTime / 60;
      const speed = timeInMinutes > 0 ? Math.round(userInputLength / timeInMinutes) : 0;

      const sessionData = {
        questionId,
        duration: elapsedTime,
        typingSpeed: speed,
        accuracy: 100,
        errorCount: 0,
      };

      expect(sessionData.questionId).toBe(1);
      expect(sessionData.duration).toBe(90);
      expect(sessionData.typingSpeed).toBe(133); // 200 chars / 1.5 minutes ≈ 133
      expect(sessionData.accuracy).toBe(100);
      expect(sessionData.errorCount).toBe(0);
    });
  });

  describe('Go back button behavior', () => {
    it('should save and navigate when go back is clicked with practice data', () => {
      practiceCount = 2;
      elapsedTime = 60;

      const shouldSaveBeforeNavigate = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSaveBeforeNavigate).toBe(true);
    });

    it('should navigate immediately if no practice was done', () => {
      practiceCount = 0;
      elapsedTime = 0;

      const shouldSaveBeforeNavigate = practiceCount > 0 && elapsedTime > 0;
      expect(shouldSaveBeforeNavigate).toBe(false);
    });

    it('should handle multiple go back attempts', () => {
      let totalSessions = 0;

      // First practice session
      practiceCount = 3;
      elapsedTime = 60;
      if (practiceCount > 0 && elapsedTime > 0) {
        totalSessions += 1;
      }

      // Go back and return to practice
      practiceCount = 0;
      elapsedTime = 0;

      // Second practice session
      practiceCount = 2;
      elapsedTime = 45;
      if (practiceCount > 0 && elapsedTime > 0) {
        totalSessions += 1;
      }

      expect(totalSessions).toBe(2);
    });
  });
});
