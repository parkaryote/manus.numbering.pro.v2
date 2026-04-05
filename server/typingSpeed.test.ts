import { describe, it, expect } from "vitest";
import {
  getLengthBucket,
  calculateEffectiveSpeed,
  calculateSpeedBonus,
  computeBlendedBaseline,
  computeExpectedSpeed,
  computeP60,
  shouldUpdateBaseline,
  speedToInt,
  intToSpeed,
  type TypingAttemptInput,
} from "./typingSpeed";

const makeAttempt = (overrides: Partial<TypingAttemptInput> = {}): TypingAttemptInput => ({
  answerLength: 10,
  inputChars: 10,
  timeToFirstKey: 500,
  typingStartTime: 1000,
  typingEndTime: 6000, // 5초 → 2 chars/sec
  backspaceCount: 0,
  pasteDetected: false,
  mode: "exam",
  ...overrides,
});

describe("getLengthBucket", () => {
  it("returns bucket 1 for 1-3 chars", () => {
    expect(getLengthBucket(1)).toBe(1);
    expect(getLengthBucket(3)).toBe(1);
  });
  it("returns bucket 2 for 4-6 chars", () => {
    expect(getLengthBucket(4)).toBe(2);
    expect(getLengthBucket(6)).toBe(2);
  });
  it("returns bucket 3 for 7-10 chars", () => {
    expect(getLengthBucket(7)).toBe(3);
    expect(getLengthBucket(10)).toBe(3);
  });
  it("returns bucket 4 for 11+ chars", () => {
    expect(getLengthBucket(11)).toBe(4);
    expect(getLengthBucket(100)).toBe(4);
  });
});

describe("calculateEffectiveSpeed", () => {
  it("calculates basic speed correctly", () => {
    const attempt = makeAttempt({ inputChars: 10, typingStartTime: 0, typingEndTime: 5000 });
    const result = calculateEffectiveSpeed(attempt);
    expect(result.charsPerSec).toBeCloseTo(2.0, 1);
    expect(result.efficiency).toBe(1.0);
    expect(result.effectiveSpeed).toBeCloseTo(2.0, 1);
  });

  it("applies efficiency penalty for backspaces", () => {
    const attempt = makeAttempt({
      inputChars: 10,
      backspaceCount: 3,
      typingStartTime: 0,
      typingEndTime: 5000,
    });
    const result = calculateEffectiveSpeed(attempt);
    // efficiency = clamp(1 - 3/10, 0.75, 1.0) = 0.7 → clamped to 0.75
    expect(result.efficiency).toBe(0.75);
    expect(result.effectiveSpeed).toBeCloseTo(2.0 * 0.75, 1);
  });

  it("clamps efficiency minimum to 0.75", () => {
    const attempt = makeAttempt({ inputChars: 10, backspaceCount: 10 });
    const result = calculateEffectiveSpeed(attempt);
    expect(result.efficiency).toBe(0.75);
  });

  it("assigns correct length bucket", () => {
    expect(calculateEffectiveSpeed(makeAttempt({ answerLength: 5 })).lengthBucket).toBe(2);
    expect(calculateEffectiveSpeed(makeAttempt({ answerLength: 15 })).lengthBucket).toBe(4);
  });
});

describe("calculateSpeedBonus", () => {
  it("returns bonus 2 and label great when ratio >= 1.15", () => {
    const result = calculateSpeedBonus(2.3, 2.0); // ratio = 1.15
    expect(result.bonus).toBe(2);
    expect(result.label).toBe("great");
  });

  it("returns bonus 1 and label fast when ratio >= 0.95", () => {
    const result = calculateSpeedBonus(1.9, 2.0); // ratio = 0.95
    expect(result.bonus).toBe(1);
    expect(result.label).toBe("fast");
  });

  it("returns bonus 0 and label normal when ratio >= 0.80", () => {
    const result = calculateSpeedBonus(1.6, 2.0); // ratio = 0.80
    expect(result.bonus).toBe(0);
    expect(result.label).toBe("normal");
  });

  it("returns bonus 0 and label slow when ratio < 0.80", () => {
    const result = calculateSpeedBonus(1.0, 2.0); // ratio = 0.50
    expect(result.bonus).toBe(0);
    expect(result.label).toBe("slow");
  });

  it("handles zero expectedSpeed gracefully", () => {
    const result = calculateSpeedBonus(2.0, 0);
    expect(result.bonus).toBe(0);
    expect(result.label).toBe("normal");
  });
});

describe("computeBlendedBaseline", () => {
  it("returns global baseline when no personal data", () => {
    expect(computeBlendedBaseline(null, 0, 2.0)).toBe(2.0);
  });

  it("blends personal and global when sampleCount < 30", () => {
    // personalWeight = 15/30 = 0.5
    const result = computeBlendedBaseline(3.0, 15, 2.0);
    expect(result).toBeCloseTo(2.5, 2); // 0.5 * 3.0 + 0.5 * 2.0
  });

  it("uses full personal baseline when sampleCount >= 30", () => {
    const result = computeBlendedBaseline(3.0, 30, 2.0);
    expect(result).toBe(3.0);
  });
});

describe("computeExpectedSpeed", () => {
  it("uses examBaseline when available", () => {
    expect(computeExpectedSpeed(2.5, 3.0)).toBe(2.5);
  });

  it("falls back to practiceBaseline * 0.8 when no exam baseline", () => {
    expect(computeExpectedSpeed(null, 3.0)).toBeCloseTo(2.4, 2);
  });
});

describe("computeP60", () => {
  it("returns 0 for empty array", () => {
    expect(computeP60([])).toBe(0);
  });

  it("computes p60 correctly", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = computeP60(values);
    // sorted: [1..10], idx = floor(10 * 0.6) = 6 → value at index 6 = 7
    expect(result).toBe(7);
  });
});

describe("shouldUpdateBaseline", () => {
  it("returns false when pasteDetected", () => {
    expect(shouldUpdateBaseline(makeAttempt({ pasteDetected: true }))).toBe(false);
  });

  it("returns false when inputChars < 2", () => {
    expect(shouldUpdateBaseline(makeAttempt({ inputChars: 1 }))).toBe(false);
  });

  it("returns false when typingDuration < 300ms", () => {
    expect(shouldUpdateBaseline(makeAttempt({ typingStartTime: 0, typingEndTime: 200 }))).toBe(false);
  });

  it("returns true for valid attempt", () => {
    expect(shouldUpdateBaseline(makeAttempt())).toBe(true);
  });
});

describe("speedToInt / intToSpeed", () => {
  it("converts speed to int and back", () => {
    const speed = 2.345;
    const asInt = speedToInt(speed);
    expect(asInt).toBe(2345);
    expect(intToSpeed(asInt)).toBeCloseTo(speed, 2);
  });
});
