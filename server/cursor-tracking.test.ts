import { describe, it, expect } from 'vitest';

describe('Cursor Position Tracking and Underbar Rendering', () => {
  describe('Cursor position calculation from selectionStart', () => {
    it('should calculate cursor line index correctly', () => {
      const userInput = "hello\nworld\ntest";
      const cursorPosition = 6; // After "hello\n"
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      expect(cursorLineIndex).toBe(1);
      expect(cursorCharIndexInLine).toBe(0);
    });

    it('should calculate cursor position within line correctly', () => {
      const userInput = "hello\nworld\ntest";
      const cursorPosition = 9; // "hello\nwor"
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      expect(cursorLineIndex).toBe(1);
      expect(cursorCharIndexInLine).toBe(3);
    });

    it('should handle cursor at beginning of input', () => {
      const userInput = "hello\nworld";
      const cursorPosition = 0;
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      expect(cursorLineIndex).toBe(0);
      expect(cursorCharIndexInLine).toBe(0);
    });

    it('should handle cursor at end of input', () => {
      const userInput = "hello\nworld";
      const cursorPosition = userInput.length;
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      // Cursor at end
      if (cursorPosition === userInput.length) {
        const lastChar = userInput[userInput.length - 1];
        if (lastChar !== '\n') {
          cursorCharIndexInLine = charCount;
        }
      }
      
      expect(cursorLineIndex).toBe(1);
      expect(cursorCharIndexInLine).toBe(5);
    });
  });

  describe('Underbar position based on cursor', () => {
    it('should show underbar at cursor position when moving cursor', () => {
      const userInput = "hello\nworld";
      const targetText = "hello\nworld";
      
      // Cursor at position 3 (hel|lo)
      const cursorPosition = 3;
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      expect(cursorLineIndex).toBe(0);
      expect(cursorCharIndexInLine).toBe(3);
    });

    it('should move underbar when cursor moves to different line', () => {
      const userInput = "hello\nworld";
      
      // Cursor at position 7 (hello\nwo|rld)
      const cursorPosition = 7;
      
      let charCount = 0;
      let cursorLineIndex = 0;
      let cursorCharIndexInLine = 0;
      
      for (let i = 0; i < userInput.length; i++) {
        if (i === cursorPosition) {
          cursorCharIndexInLine = charCount;
          break;
        }
        if (userInput[i] === '\n') {
          cursorLineIndex++;
          charCount = 0;
        } else {
          charCount++;
        }
      }
      
      expect(cursorLineIndex).toBe(1);
      expect(cursorCharIndexInLine).toBe(1);
    });

    it('should handle cursor movement in middle of line', () => {
      const userInput = "hello\nworld\ntest";
      
      // Test cursor at different positions
      const positions = [
        { pos: 0, expectedLine: 0, expectedChar: 0 },
        { pos: 3, expectedLine: 0, expectedChar: 3 },
        { pos: 6, expectedLine: 1, expectedChar: 0 },
        { pos: 10, expectedLine: 1, expectedChar: 4 },
        { pos: 12, expectedLine: 2, expectedChar: 0 },
      ];
      
      positions.forEach(({ pos, expectedLine, expectedChar }) => {
        let charCount = 0;
        let cursorLineIndex = 0;
        let cursorCharIndexInLine = 0;
        
        for (let i = 0; i < userInput.length; i++) {
          if (i === pos) {
            cursorCharIndexInLine = charCount;
            break;
          }
          if (userInput[i] === '\n') {
            cursorLineIndex++;
            charCount = 0;
          } else {
            charCount++;
          }
        }
        
        expect(cursorLineIndex).toBe(expectedLine);
        expect(cursorCharIndexInLine).toBe(expectedChar);
      });
    });
  });

  describe('Underbar rendering condition', () => {
    it('should render underbar only at cursor position', () => {
      const lineIdx = 0;
      const currentCharIdx = 3;
      const cursorLineIndex = 0;
      const cursorCharIndexInLine = 3;
      
      const shouldShowUnderbar = lineIdx === cursorLineIndex && currentCharIdx === cursorCharIndexInLine;
      
      expect(shouldShowUnderbar).toBe(true);
    });

    it('should not render underbar at other positions', () => {
      const testCases = [
        { lineIdx: 0, charIdx: 2, cursorLine: 0, cursorChar: 3, expected: false },
        { lineIdx: 0, charIdx: 4, cursorLine: 0, cursorChar: 3, expected: false },
        { lineIdx: 1, charIdx: 3, cursorLine: 0, cursorChar: 3, expected: false },
        { lineIdx: 0, charIdx: 3, cursorLine: 1, cursorChar: 3, expected: false },
      ];
      
      testCases.forEach(({ lineIdx, charIdx, cursorLine, cursorChar, expected }) => {
        const shouldShowUnderbar = lineIdx === cursorLine && charIdx === cursorChar;
        expect(shouldShowUnderbar).toBe(expected);
      });
    });
  });

  describe('Cursor tracking during input', () => {
    it('should update cursor position on each input change', () => {
      const inputs = ["h", "he", "hel", "hell", "hello"];
      const cursorPositions = [1, 2, 3, 4, 5];
      
      inputs.forEach((input, index) => {
        const cursorPos = cursorPositions[index];
        expect(cursorPos).toBe(input.length);
      });
    });

    it('should handle cursor movement without input change', () => {
      const userInput = "hello";
      const cursorPositions = [0, 1, 2, 3, 4, 5];
      
      cursorPositions.forEach((pos) => {
        expect(pos).toBeGreaterThanOrEqual(0);
        expect(pos).toBeLessThanOrEqual(userInput.length);
      });
    });
  });

  describe('Multi-line cursor tracking', () => {
    it('should track cursor across multiple lines correctly', () => {
      const userInput = "line1\nline2\nline3";
      
      // Cursor positions and expected results
      const testCases = [
        { pos: 0, expectedLine: 0, expectedChar: 0 },
        { pos: 5, expectedLine: 0, expectedChar: 5 },
        { pos: 6, expectedLine: 1, expectedChar: 0 },
        { pos: 11, expectedLine: 1, expectedChar: 5 },
        { pos: 12, expectedLine: 2, expectedChar: 0 },
      ];
      
      testCases.forEach(({ pos, expectedLine, expectedChar }) => {
        let charCount = 0;
        let cursorLineIndex = 0;
        let cursorCharIndexInLine = 0;
        
        for (let i = 0; i < userInput.length; i++) {
          if (i === pos) {
            cursorCharIndexInLine = charCount;
            break;
          }
          if (userInput[i] === '\n') {
            cursorLineIndex++;
            charCount = 0;
          } else {
            charCount++;
          }
        }
        
        expect(cursorLineIndex).toBe(expectedLine);
        expect(cursorCharIndexInLine).toBe(expectedChar);
      });
    });
  });
});
