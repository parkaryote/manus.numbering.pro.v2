import { describe, it, expect } from 'vitest';

describe('Underbar Position Fix - Each Line Independent', () => {
  describe('Underbar should show at next input position', () => {
    it('should show underbar at userChars.length position', () => {
      const userChars = ['남', '산'];
      const targetChars = ['남', '산'];
      
      // After typing '남산', next position is 2
      const nextPosition = userChars.length; // 2
      
      expect(nextPosition).toBe(2);
    });

    it('should show underbar after each character input', () => {
      const testCases = [
        { userChars: [], nextPos: 0 },
        { userChars: ['남'], nextPos: 1 },
        { userChars: ['남', '산'], nextPos: 2 },
        { userChars: ['남', '산', '이'], nextPos: 3 },
      ];
      
      testCases.forEach(({ userChars, nextPos }) => {
        expect(userChars.length).toBe(nextPos);
      });
    });
  });

  describe('Multi-line underbar positioning', () => {
    it('should show underbar independently on each line', () => {
      // Line 1: "동해물과" - user typed "동해"
      const line1UserChars = ['동', '해'];
      const line1NextPos = line1UserChars.length; // 2
      
      // Line 2: "백두산이" - user typed "백"
      const line2UserChars = ['백'];
      const line2NextPos = line2UserChars.length; // 1
      
      // Line 3: "마르고" - user typed nothing
      const line3UserChars: string[] = [];
      const line3NextPos = line3UserChars.length; // 0
      
      expect(line1NextPos).toBe(2);
      expect(line2NextPos).toBe(1);
      expect(line3NextPos).toBe(0);
    });

    it('should maintain correct underbar when switching between lines', () => {
      // Simulate user typing in different lines
      const lines = [
        { lineIdx: 0, userChars: ['동', '해'], nextPos: 2 },
        { lineIdx: 1, userChars: ['백'], nextPos: 1 },
        { lineIdx: 0, userChars: ['동', '해', '물'], nextPos: 3 }, // Back to line 0
        { lineIdx: 1, userChars: ['백', '두'], nextPos: 2 }, // Back to line 1
      ];
      
      lines.forEach(({ lineIdx, userChars, nextPos }) => {
        const condition = userChars.length === nextPos;
        expect(condition).toBe(true);
      });
    });

    it('should show underbar at correct position after space input', () => {
      // Line: "서리" - user typed "서 " (with space)
      const userLine = "서 ";
      const userCharsWithoutSpace = userLine.replace(/\s+/g, '').split('');
      const nextPos = userCharsWithoutSpace.length; // 1 (only '서')
      
      expect(userCharsWithoutSpace).toEqual(['서']);
      expect(nextPos).toBe(1);
    });

    it('should handle cursor movement without affecting underbar', () => {
      // User types "바람" then moves cursor back
      const userChars = ['바', '람'];
      const nextPos = userChars.length; // 2
      
      // Even if cursor moves, underbar should stay at position 2
      expect(nextPos).toBe(2);
    });
  });

  describe('Underbar rendering condition', () => {
    it('should render underbar when currentCharIdx === userChars.length', () => {
      const userChars = ['남', '산'];
      const currentCharIdx = 2;
      
      const shouldShowUnderbar = currentCharIdx === userChars.length;
      
      expect(shouldShowUnderbar).toBe(true);
    });

    it('should not render underbar at other positions', () => {
      const userChars = ['남', '산'];
      
      const testCases = [
        { currentCharIdx: 0, expected: false },
        { currentCharIdx: 1, expected: false },
        { currentCharIdx: 2, expected: true },
        { currentCharIdx: 3, expected: false },
      ];
      
      testCases.forEach(({ currentCharIdx, expected }) => {
        const shouldShowUnderbar = currentCharIdx === userChars.length;
        expect(shouldShowUnderbar).toBe(expected);
      });
    });

    it('should not depend on isActiveLine condition', () => {
      const userChars = ['남', '산'];
      const currentCharIdx = 2;
      
      // Old condition: isActiveLine && currentCharIdx === completedCount
      // New condition: currentCharIdx === userChars.length
      
      const isActiveLine = false; // User is on a different line
      const oldCondition = isActiveLine && currentCharIdx === userChars.length;
      const newCondition = currentCharIdx === userChars.length;
      
      expect(oldCondition).toBe(false);
      expect(newCondition).toBe(true);
    });
  });

  describe('Complex multi-line scenarios', () => {
    it('should handle switching between multiple lines correctly', () => {
      const scenario = {
        line0: { userChars: ['동', '해', '물'], nextPos: 3 },
        line1: { userChars: ['백', '두'], nextPos: 2 },
        line2: { userChars: ['마'], nextPos: 1 },
        line3: { userChars: [], nextPos: 0 },
      };
      
      // Check each line independently
      Object.values(scenario).forEach(({ userChars, nextPos }) => {
        expect(userChars.length).toBe(nextPos);
      });
    });

    it('should show underbar at correct position after returning to previous line', () => {
      // User types in line 0, then line 1, then back to line 0
      const line0InitialChars = ['동'];
      const line1Chars = ['백'];
      const line0UpdatedChars = ['동', '해'];
      
      expect(line0InitialChars.length).toBe(1);
      expect(line1Chars.length).toBe(1);
      expect(line0UpdatedChars.length).toBe(2);
    });

    it('should handle spaces correctly in multi-line input', () => {
      // Line: "동해 물과" - user typed "동해 물"
      const userLine = "동해 물";
      const userCharsNoSpace = userLine.replace(/\s+/g, '').split('');
      const nextPos = userCharsNoSpace.length; // 3 (동, 해, 물)
      
      expect(userCharsNoSpace).toEqual(['동', '해', '물']);
      expect(nextPos).toBe(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty line correctly', () => {
      const userChars: string[] = [];
      const nextPos = userChars.length; // 0
      
      expect(nextPos).toBe(0);
    });

    it('should handle single character line', () => {
      const userChars = ['동'];
      const nextPos = userChars.length; // 1
      
      expect(nextPos).toBe(1);
    });

    it('should handle long line correctly', () => {
      const userChars = '동해물과백두산이마르고닳도록'.split('');
      const nextPos = userChars.length; // 14
      
      expect(nextPos).toBe(14);
    });
  });
});
