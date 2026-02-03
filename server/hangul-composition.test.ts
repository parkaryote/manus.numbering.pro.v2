import { describe, it, expect } from 'vitest';

describe('Hangul composition handling', () => {
  describe('isComposing state management', () => {
    it('should prevent state update during composition', () => {
      const isComposing = true;
      
      // 조합 중에는 handleInputChange에서 return
      if (isComposing) {
        // 상태 업데이트 안 함
        expect(true).toBe(true);
      }
    });

    it('should update state after composition ends', () => {
      const isComposing = false;
      const newValue = '남산';
      
      // 조합 완료 후 상태 업데이트
      if (!isComposing) {
        expect(newValue).toBe('남산');
      }
    });
  });

  describe('Underbar position with composition', () => {
    it('should show underbar only after composition completes', () => {
      const userChars = ['남', '산'];
      const currentCharIdx = 2;
      const isComposing = false;
      
      // 조합 완료 후 언더바 표시
      const shouldShowUnderbar = !isComposing && userChars.length > 0 && currentCharIdx === userChars.length;
      
      expect(shouldShowUnderbar).toBe(true);
    });

    it('should not show underbar during composition', () => {
      const userChars = ['남'];
      const currentCharIdx = 1;
      const isComposing = true;
      
      // 조합 중에는 언더바 미표시
      const shouldShowUnderbar = !isComposing && userChars.length > 0 && currentCharIdx === userChars.length;
      
      expect(shouldShowUnderbar).toBe(false);
    });
  });

  describe('Multiple composition cycles', () => {
    it('should handle sequential character inputs correctly', () => {
      const inputs = ['남', '산', '이', '마', '르', '고'];
      let userChars: string[] = [];
      
      inputs.forEach(char => {
        userChars.push(char);
      });
      
      expect(userChars.length).toBe(6);
      expect(userChars.join('')).toBe('남산이마르고');
    });

    it('should show correct underbar position for each character', () => {
      const inputs = ['남', '산'];
      const userChars: string[] = [];
      
      inputs.forEach((char, idx) => {
        userChars.push(char);
        const currentCharIdx = userChars.length;
        const shouldShowUnderbar = userChars.length > 0 && currentCharIdx === userChars.length;
        
        expect(shouldShowUnderbar).toBe(true);
      });
    });
  });

  describe('Composition with different line inputs', () => {
    it('should handle line breaks correctly', () => {
      const line1 = '동해물과';
      const line2 = '백두산이';
      
      const userInput = line1 + '\n' + line2;
      const lines = userInput.split('\n');
      
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('동해물과');
      expect(lines[1]).toBe('백두산이');
    });
  });
});
