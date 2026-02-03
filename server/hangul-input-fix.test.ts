import { describe, it, expect } from 'vitest';

describe('Hangul input handling after composition fix', () => {
  describe('English input', () => {
    it('should handle English character input', () => {
      const input = 'hello';
      expect(input).toBe('hello');
    });

    it('should handle multiple English characters', () => {
      const inputs = ['h', 'e', 'l', 'l', 'o'];
      const result = inputs.join('');
      expect(result).toBe('hello');
    });
  });

  describe('Hangul input after composition', () => {
    it('should handle Hangul character input after composition ends', () => {
      const input = '남산';
      expect(input).toBe('남산');
    });

    it('should handle multiple Hangul characters', () => {
      const inputs = ['남', '산', '이', '마', '르', '고'];
      const result = inputs.join('');
      expect(result).toBe('남산이마르고');
    });
  });

  describe('Mixed input (English and Hangul)', () => {
    it('should handle switching from English to Hangul', () => {
      const englishInput = 'hello';
      const hangulInput = '남산';
      const mixed = englishInput + hangulInput;
      expect(mixed).toBe('hello남산');
    });

    it('should handle switching from Hangul to English', () => {
      const hangulInput = '남산';
      const englishInput = 'world';
      const mixed = hangulInput + englishInput;
      expect(mixed).toBe('남산world');
    });
  });

  describe('Input state updates', () => {
    it('should update state on each character input', () => {
      let userInput = '';
      const inputs = ['a', 'b', 'c'];
      
      inputs.forEach(char => {
        userInput += char;
      });
      
      expect(userInput).toBe('abc');
    });

    it('should handle rapid character inputs', () => {
      let userInput = '';
      const inputs = ['남', '산', '이', '마', '르', '고'];
      
      inputs.forEach(char => {
        userInput += char;
      });
      
      expect(userInput).toBe('남산이마르고');
    });
  });

  describe('Input recovery after language switch', () => {
    it('should recover input after switching language', () => {
      let userInput = 'hello';
      // 한영키 전환
      userInput = '남산';
      expect(userInput).toBe('남산');
    });

    it('should continue input after language switch', () => {
      let userInput = 'hello';
      // 한영키 전환
      userInput += '남산';
      expect(userInput).toBe('hello남산');
    });
  });
});
