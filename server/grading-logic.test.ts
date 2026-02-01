import { describe, it, expect, beforeEach } from 'vitest';

describe('Test Grading Logic - Line-by-line comparison and similarity', () => {
  describe('Line-by-line exact matching (isCorrect)', () => {
    it('should return true when all lines match exactly (ignoring spaces)', () => {
      const userAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      expect(isCorrect).toBe(true);
    });

    it('should return false when one line differs', () => {
      const userAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산ㅋㅋ\n대한민국 만세";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      expect(isCorrect).toBe(false);
    });

    it('should return false when line count differs', () => {
      const userAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      expect(isCorrect).toBe(false);
    });

    it('should ignore spacing differences', () => {
      const userAnswer = "동해물과  백두산이   마르고 닳도록\n무궁화삼천리화려강산\n대한민국만세";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      expect(isCorrect).toBe(true);
    });
  });

  describe('Character-level similarity score (유사도)', () => {
    it('should calculate 100% similarity for exact match', () => {
      const userAnswer = "동해물과백두산이마르고닳도록무궁화삼천리화려강산대한민국만세";
      const correctAnswer = "동해물과백두산이마르고닳도록무궁화삼천리화려강산대한민국만세";
      
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      expect(similarityScore).toBe(100);
    });

    it('should calculate 68% similarity for partial match', () => {
      const userAnswer = "동해물과백두산이마르고닳도록무궁화삼천리화려강산대한사람대한으로길이보전하세";
      const correctAnswer = "동해물과백두산이마르고닳도록무궁화삼천리화려강산대한민국만세";
      
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      expect(similarityScore).toBe(68);
    });

    it('should calculate 0% similarity for completely different text', () => {
      const userAnswer = "aaaaaaaaaa";
      const correctAnswer = "bbbbbbbbbb";
      
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      expect(similarityScore).toBe(0);
    });

    it('should handle different length strings correctly', () => {
      const userAnswer = "abc";
      const correctAnswer = "abcdef";
      
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      // 3 matching out of 6 total = 50%
      expect(similarityScore).toBe(50);
    });
  });

  describe('Integration: isCorrect and similarityScore together', () => {
    it('should have isCorrect=true and similarityScore=100 for perfect match', () => {
      const userAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      // Check isCorrect
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      // Check similarityScore
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      expect(isCorrect).toBe(true);
      expect(similarityScore).toBe(100);
    });

    it('should have isCorrect=false and similarityScore=60 for partial match', () => {
      const userAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산ㅋㅋ\n대한사람 대한으로 길이 보전하세";
      const correctAnswer = "동해물과 백두산이 마르고 닳도록\n무궁화 삼천리 화려강산\n대한민국 만세";
      
      // Check isCorrect
      const userLines = userAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      const correctLines = correctAnswer.split('\n').map(line => line.trim().toLowerCase().replace(/\s+/g, ""));
      
      let isCorrect = true;
      if (userLines.length !== correctLines.length) {
        isCorrect = false;
      } else {
        for (let i = 0; i < correctLines.length; i++) {
          if (userLines[i] !== correctLines[i]) {
            isCorrect = false;
            break;
          }
        }
      }
      
      // Check similarityScore
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, "");
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/\s+/g, "");
      let matchCount = 0;
      const maxLength = Math.max(normalizedUser.length, normalizedCorrect.length);
      for (let i = 0; i < Math.min(normalizedUser.length, normalizedCorrect.length); i++) {
        if (normalizedUser[i] === normalizedCorrect[i]) {
          matchCount++;
        }
      }
      const similarityScore = maxLength > 0 ? Math.round((matchCount / maxLength) * 100) : 0;
      
      expect(isCorrect).toBe(false);
      expect(similarityScore).toBe(60);
    });
  });
});
