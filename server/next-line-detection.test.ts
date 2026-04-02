import { describe, it, expect } from 'vitest';
import { splitGraphemes, isPartialMatch } from '../client/src/lib/hangul';

/**
 * completionInfo 로직을 순수 함수로 추출하여 테스트
 * - 줄 단위 채점 후 현재 활성 줄 인덱스(currentLineIndex) 계산
 * - 엔터 없이도 현재 줄 완료 시 다음 줄로 자동 이동
 * - 초과 입력을 다음 줄로 이월(carry-over)
 */
function computeCompletionInfo(
  userInput: string,
  targetText: string,
  cursorLineIndex: number
) {
  const userLines = userInput.split('\n');
  const targetLines = targetText.split('\n');

  const lineResults: Array<{
    userChars: string[];
    targetChars: string[];
    completedCount: number;
    isLastCharPartial: boolean;
    lastCharMatchResult: string | null;
  }> = [];

  let carryOverChars: string[] = [];

  for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
    const userLine = userLines[lineIdx] || '';
    const targetLine = targetLines[lineIdx] || '';

    let userChars = splitGraphemes(userLine.replace(/\s+/g, ''));
    const targetChars = splitGraphemes(targetLine.replace(/\s+/g, ''));

    // 이전 줄에서 이월된 초과 입력을 현재 줄 앞에 추가
    if (carryOverChars.length > 0) {
      userChars = [...carryOverChars, ...userChars];
      carryOverChars = [];
    }

    let completedCount = 0;

    for (let i = 0; i < userChars.length && i < targetChars.length; i++) {
      const userChar = userChars[i];
      const targetChar = targetChars[i];
      const nextTargetChar = targetChars[i + 1];

      const matchResult = isPartialMatch(userChar, targetChar, nextTargetChar);

      if (matchResult === 'complete' || matchResult === 'partial_complete') {
        completedCount = i + 1;
      } else if (matchResult === 'partial') {
        completedCount = i;
        break;
      } else {
        completedCount = i + 1;
      }
    }

    if (userChars.length > targetChars.length) {
      completedCount = targetChars.length;
      // 초과 입력을 다음 줄로 이월
      if (lineIdx < targetLines.length - 1) {
        carryOverChars = userChars.slice(targetChars.length);
        userChars = userChars.slice(0, targetChars.length);
      }
    }

    const lastUserChar = userChars[userChars.length - 1];
    const lastTargetChar = targetChars[userChars.length - 1];
    const nextTargetChar = targetChars[userChars.length];
    const lastMatchResult =
      lastUserChar && lastTargetChar
        ? isPartialMatch(lastUserChar, lastTargetChar, nextTargetChar)
        : null;
    const isLastCharPartial =
      lastMatchResult === 'partial' || lastMatchResult === 'partial_complete';

    lineResults.push({
      userChars,
      targetChars,
      completedCount,
      isLastCharPartial,
      lastCharMatchResult: lastMatchResult,
    });
  }

  // 현재 활성 줄 계산 (엔터 없이도 다음 줄 자동 인식)
  let currentLineIndex = cursorLineIndex;
  if (currentLineIndex < targetLines.length - 1) {
    const currentResult = lineResults[currentLineIndex];
    if (
      currentResult &&
      currentResult.completedCount >= currentResult.targetChars.length &&
      currentResult.targetChars.length > 0
    ) {
      currentLineIndex = currentLineIndex + 1;
    }
  }

  return { lineResults, currentLineIndex, userLines, targetLines };
}

describe('다음 줄 자동 인식 (엔터 없이)', () => {
  it('첫 줄 완료 전에는 activeLineIdx가 0이어야 함', () => {
    const result = computeCompletionInfo('동해', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(0);
  });

  it('첫 줄 완료 시 엔터 없이도 activeLineIdx가 1로 이동', () => {
    const result = computeCompletionInfo('동해물과', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(1);
  });

  it('첫 줄 완료 후 두 번째 줄 첫 글자에 언더바 표시 가능', () => {
    const result = computeCompletionInfo('동해물과', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(1);
    expect(result.lineResults[1].completedCount).toBe(0);
    expect(result.lineResults[1].userChars.length).toBe(0);
  });

  it('엔터로 줄바꿈한 경우에도 정상 동작', () => {
    const result = computeCompletionInfo('동해물과\n', '동해물과\n백두록', 1);
    expect(result.currentLineIndex).toBe(1);
  });

  it('한 줄짜리 정답에서는 줄 이동 없음', () => {
    const result = computeCompletionInfo('동해물과', '동해물과', 0);
    expect(result.currentLineIndex).toBe(0);
  });

  it('3줄 정답에서 첫 줄 완료 시 두 번째 줄로 이동', () => {
    const result = computeCompletionInfo('첫째줄', '첫째줄\n둘째줄\n셋째줄', 0);
    expect(result.currentLineIndex).toBe(1);
  });

  it('3줄 정답에서 두 번째 줄까지 완료 시 세 번째 줄로 이동', () => {
    const result = computeCompletionInfo('첫째줄\n둘째줄', '첫째줄\n둘째줄\n셋째줄', 1);
    expect(result.currentLineIndex).toBe(2);
  });

  it('부분 입력 중에는 줄 이동하지 않음', () => {
    const result = computeCompletionInfo('동해물', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(0);
  });

  it('빈 입력에서는 첫 줄 유지', () => {
    const result = computeCompletionInfo('', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(0);
  });
});

describe('초과 입력 이월 (carry-over)', () => {
  it('엔터 없이 첫 줄 초과 입력 시 초과분이 두 번째 줄에 매핑됨', () => {
    // "동해물과백" → 첫 줄 target "동해물과"(4글자), 초과 "백" → 두 번째 줄로 이월
    const result = computeCompletionInfo('동해물과백', '동해물과\n백두록', 0);
    
    // 첫 줄: userChars = ["동","해","물","과"] (초과분 잘림)
    expect(result.lineResults[0].userChars).toEqual(['동', '해', '물', '과']);
    expect(result.lineResults[0].completedCount).toBe(4);
    
    // 두 번째 줄: userChars = ["백"] (이월됨)
    expect(result.lineResults[1].userChars).toEqual(['백']);
    expect(result.lineResults[1].completedCount).toBe(1); // "백" === "백" → complete
  });

  it('엔터 없이 두 줄 모두 입력 시 정상 채점', () => {
    const result = computeCompletionInfo('동해물과백두록', '동해물과\n백두록', 0);
    
    // 첫 줄: 4글자 완료
    expect(result.lineResults[0].completedCount).toBe(4);
    
    // 두 번째 줄: 3글자 이월 → 완료
    expect(result.lineResults[1].userChars).toEqual(['백', '두', '록']);
    expect(result.lineResults[1].completedCount).toBe(3);
  });

  it('이월된 글자가 틀린 경우에도 채점됨', () => {
    // "동해물과X" → 초과 "X"가 두 번째 줄 "백"과 비교
    const result = computeCompletionInfo('동해물과X', '동해물과\n백두록', 0);
    
    expect(result.lineResults[1].userChars).toEqual(['X']);
    // "X" vs "백" → wrong → completedCount = 1
    expect(result.lineResults[1].completedCount).toBe(1);
  });

  it('3줄 정답에서 연속 이월', () => {
    const result = computeCompletionInfo('가나다라마바', '가나\n다라\n마바', 0);
    
    // 첫 줄: "가나" → 완료, 초과 "다라마바" 이월
    expect(result.lineResults[0].userChars).toEqual(['가', '나']);
    expect(result.lineResults[0].completedCount).toBe(2);
    
    // 두 번째 줄: "다라" → 완료, 초과 "마바" 이월
    expect(result.lineResults[1].userChars).toEqual(['다', '라']);
    expect(result.lineResults[1].completedCount).toBe(2);
    
    // 세 번째 줄: "마바" → 완료
    expect(result.lineResults[2].userChars).toEqual(['마', '바']);
    expect(result.lineResults[2].completedCount).toBe(2);
  });

  it('activeLineIdx가 이월 후 올바르게 계산됨', () => {
    // "동해물과백" → 첫 줄 완료, 두 번째 줄에 "백" 이월
    const result = computeCompletionInfo('동해물과백', '동해물과\n백두록', 0);
    
    // 첫 줄 완료 → activeLineIdx = 1
    expect(result.currentLineIndex).toBe(1);
    
    // 두 번째 줄 completedCount = 1, targetChars.length = 3 → 아직 미완료
    expect(result.lineResults[1].completedCount).toBe(1);
  });

  it('이월과 엔터 입력이 혼합된 경우', () => {
    // 엔터로 줄바꿈 + 정상 입력
    const result = computeCompletionInfo('동해물과\n백두록', '동해물과\n백두록', 1);
    
    expect(result.lineResults[0].completedCount).toBe(4);
    expect(result.lineResults[1].completedCount).toBe(3);
  });
});
