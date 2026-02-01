import { describe, it, expect, beforeEach } from 'vitest';

describe('Keyboard Shortcuts - Shift+Backspace and Ctrl+Z', () => {
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

    it('should work immediately without decomposing Korean characters', () => {
      const deleteLine = (value: string) => {
        const lines = value.split("\n");
        if (lines.length > 1) {
          lines.pop();
          return lines.join("\n");
        } else {
          return "";
        }
      };

      const input = "보전하는의\n전을구성하는";
      const result = deleteLine(input);
      expect(result).toBe("보전하는의");
      expect(result.length).toBe(5);
    });
  });

  describe('Ctrl+Z - Undo functionality', () => {
    it('should restore previous state when Ctrl+Z is pressed', () => {
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

      updateHistory("h");
      updateHistory("he");
      updateHistory("hel");
      
      expect(inputHistory).toEqual(["", "h", "he", "hel"]);
      expect(historyIndex).toBe(3);

      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("he");
    });

    it('should record Alt+Backspace deletions in history', () => {
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

      updateHistory("hello world");
      expect(inputHistory).toEqual(["", "hello world"]);

      updateHistory("hello ");
      expect(inputHistory).toEqual(["", "hello world", "hello "]);

      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("hello world");
    });

    it('should record Shift+Backspace deletions in history', () => {
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

      updateHistory("line1\nline2\nline3");
      expect(inputHistory).toEqual(["", "line1\nline2\nline3"]);

      const deleted = deleteLine(inputHistory[historyIndex]);
      updateHistory(deleted);
      expect(inputHistory).toEqual(["", "line1\nline2\nline3", "line1\nline2"]);

      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("line1\nline2\nline3");
    });

    it('should handle Redo (Ctrl+Shift+Z) functionality', () => {
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

      updateHistory("hello");
      updateHistory("hello world");
      expect(historyIndex).toBe(2);

      // Undo
      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      expect(inputHistory[historyIndex]).toBe("hello");

      // Redo
      if (historyIndex < inputHistory.length - 1) {
        historyIndex = historyIndex + 1;
      }
      expect(inputHistory[historyIndex]).toBe("hello world");
    });

    it('should handle Korean text with Shift+Backspace and Ctrl+Z', () => {
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

      updateHistory("보전하는\n전을\n구성");
      expect(inputHistory).toEqual(["", "보전하는\n전을\n구성"]);

      const deleted = deleteLine(inputHistory[historyIndex]);
      updateHistory(deleted);
      expect(inputHistory).toEqual(["", "보전하는\n전을\n구성", "보전하는\n전을"]);

      // Undo (Ctrl+Z)
      if (historyIndex > 0) {
        historyIndex = historyIndex - 1;
      }
      
      expect(inputHistory[historyIndex]).toBe("보전하는\n전을\n구성");
    });
  });
});
