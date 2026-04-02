import { describe, it, expect } from 'vitest';
import { splitGraphemes, isPartialMatch } from '../client/src/lib/hangul';

/**
 * completionInfo 로직을 순수 함수로 추출하여 테스트
 * - 줄 단위 채점 후 현재 활성 줄 인덱스(currentLineIndex) 계산
 * - 엔터 없이도 현재 줄 완료 시 다음 줄로 자동 이동
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

  for (let lineIdx = 0; lineIdx < targetLines.length; lineIdx++) {
    const userLine = userLines[lineIdx] || '';
    const targetLine = targetLines[lineIdx] || '';

    const userChars = splitGraphemes(userLine.replace(/\s+/g, ''));
    const targetChars = splitGraphemes(targetLine.replace(/\s+/g, ''));

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
    // activeLineIdx = 1이고, 두 번째 줄의 completedCount = 0이므로
    // 두 번째 줄 첫 글자(charIdx=0)에서 0 === 0 조건 만족 → 언더바 표시
    expect(result.currentLineIndex).toBe(1);
    expect(result.lineResults[1].completedCount).toBe(0);
    expect(result.lineResults[1].userChars.length).toBe(0);
  });

  it('엔터로 줄바꿈한 경우에도 정상 동작', () => {
    const result = computeCompletionInfo('동해물과\n', '동해물과\n백두록', 1);
    // 커서가 이미 1번 줄에 있으므로 activeLineIdx = 1
    expect(result.currentLineIndex).toBe(1);
  });

  it('한 줄짜리 정답에서는 줄 이동 없음', () => {
    const result = computeCompletionInfo('동해물과', '동해물과', 0);
    // 마지막 줄이므로 이동 없음
    expect(result.currentLineIndex).toBe(0);
  });

  it('3줄 정답에서 첫 줄 완료 시 두 번째 줄로 이동', () => {
    const result = computeCompletionInfo(
      '첫째줄',
      '첫째줄\n둘째줄\n셋째줄',
      0
    );
    expect(result.currentLineIndex).toBe(1);
  });

  it('3줄 정답에서 두 번째 줄까지 완료 시 세 번째 줄로 이동', () => {
    const result = computeCompletionInfo(
      '첫째줄\n둘째줄',
      '첫째줄\n둘째줄\n셋째줄',
      1
    );
    expect(result.currentLineIndex).toBe(2);
  });

  it('부분 입력 중에는 줄 이동하지 않음', () => {
    const result = computeCompletionInfo('동해물', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(0);
  });

  it('오답이 포함된 경우에도 completedCount가 targetChars.length에 도달하면 이동', () => {
    // "동해물X" → completedCount는 3(동해물)이 아니라 4(wrong도 count됨)
    // isPartialMatch에서 wrong은 completedCount = i + 1이므로
    const result = computeCompletionInfo('동해물X', '동해물과\n백두록', 0);
    // completedCount = 4 (wrong도 카운트), targetChars.length = 4
    // → 다음 줄로 이동
    expect(result.currentLineIndex).toBe(1);
  });

  it('띄어쓰기가 있는 정답에서도 정상 동작', () => {
    const result = computeCompletionInfo(
      '동해 물과',
      '동해 물과\n백두록',
      0
    );
    // 공백 제거 후 비교: "동해물과" vs "동해물과" → 완료
    expect(result.currentLineIndex).toBe(1);
  });

  it('빈 입력에서는 첫 줄 유지', () => {
    const result = computeCompletionInfo('', '동해물과\n백두록', 0);
    expect(result.currentLineIndex).toBe(0);
  });
});
