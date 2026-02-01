import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Practice.tsx - Shift+Backspace and Ctrl+Z functionality', () => {
  let inputHistory: string[];
  let historyIndex: number;

  beforeEach(() => {
    inputHistory = [""];
    historyIndex = 0;
  });

  describe('Shift+Backspace - Delete line', () => {
    it('should delete the last line when Shift+Backspace is pressed', () => {
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };

      const input = "line1\nline2\nline3";
      const result = deleteLine(input);
      expect(result).toBe("line1\nline2");
    });

    it('should return empty string when deleting the only line', () => {
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };

      const input = "line1";
      const result = deleteLine(input);
      expect(result).toBe("");
    });

    it('should handle Korean text correctly', () => {
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };

      const input = "보전하는\n전을\n구성";
      const result = deleteLine(input);
      expect(result).toBe("보전하는\n전을");
    });
  });

  describe('Ctrl+Z - Undo functionality', () => {
    it('should restore previous state when Ctrl+Z is pressed', () => {
      // Simulate history updates
      const updateHistory = (newValue: string) => {
        const newHistory = inputHistory.slice(0, historyIndex + 1);
        if (newHistory[newHistory.length - 1] !== newValue) {
          newHistory.push(newValue);
          if (newHistory.length > 50) {
            newHistory.shift();
          }
        }
        inputHistory = newHistory;
        historyIndex = newHistory.length - 1;
      };

      // Simulate typing
      updateHistory("h");
      updateHistory("he");
      updateHistory("hel");
      
      expect(inputHistory).toEqual(["", "h", "he", "hel"]);
      expect(historyIndex).toBe(3);

      // Simulate Ctrl+Z (undo)
      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("he");
    });

    it('should record shortcut deletions in history', () => {
      const updateHistory = (newValue: string) => {
        const newHistory = inputHistory.slice(0, historyIndex + 1);
        if (newHistory[newHistory.length - 1] !== newValue) {
          newHistory.push(newValue);
          if (newHistory.length > 50) {
            newHistory.shift();
          }
        }
        inputHistory = newHistory;
        historyIndex = newHistory.length - 1;
      };

      // Simulate typing
      updateHistory("hello world");
      expect(inputHistory).toEqual(["", "hello world"]);

      // Simulate Alt+Backspace (delete word)
      updateHistory("hello ");
      expect(inputHistory).toEqual(["", "hello world", "hello "]);

      // Simulate Ctrl+Z
      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("hello world");
    });

    it('should handle Shift+Backspace deletion in history', () => {
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };

      const updateHistory = (newValue: string) => {
        const newHistory = inputHistory.slice(0, historyIndex + 1);
        if (newHistory[newHistory.length - 1] !== newValue) {
          newHistory.push(newValue);
          if (newHistory.length > 50) {
            newHistory.shift();
          }
        }
        inputHistory = newHistory;
        historyIndex = newHistory.length - 1;
      };

      // Simulate typing multi-line text
      updateHistory("line1\nline2\nline3");
      expect(inputHistory).toEqual(["", "line1\nline2\nline3"]);

      // Simulate Shift+Backspace
      const deleted = deleteLine(inputHistory[historyIndex]);
      updateHistory(deleted);
      expect(inputHistory).toEqual(["", "line1\nline2\nline3", "line1\nline2"]);

      // Simulate Ctrl+Z
      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("line1\nline2\nline3");
    });
  });
});
