/**
 * 한글 자모 분해 및 조합 유틸리티
 */

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];

const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

const HANGUL_START = 0xAC00;
const HANGUL_END = 0xD7A3;

/**
 * 한글 음절을 초성, 중성, 종성으로 분해
 */
export function decomposeHangul(char: string): { cho: string; jung: string; jong: string } | null {
  const code = char.charCodeAt(0);
  
  if (code < HANGUL_START || code > HANGUL_END) {
    return null;
  }
  
  const index = code - HANGUL_START;
  const choIndex = Math.floor(index / 588);
  const jungIndex = Math.floor((index % 588) / 28);
  const jongIndex = index % 28;
  
  return {
    cho: CHO[choIndex],
    jung: JUNG[jungIndex],
    jong: JONG[jongIndex]
  };
}

/**
 * 두 글자의 자모를 비교하여 일치 여부 확인
 * nextCharCho: 다음 글자의 초성 (현재 글자 종성과 비교용)
 */
export function compareJamo(
  userChar: string,
  targetChar: string,
  nextTargetChar?: string
): boolean {
  // 한글이 아닌 경우 단순 비교
  if (!isHangul(userChar) || !isHangul(targetChar)) {
    return userChar === targetChar;
  }
  
  const userJamo = decomposeHangul(userChar);
  const targetJamo = decomposeHangul(targetChar);
  
  if (!userJamo || !targetJamo) {
    return userChar === targetChar;
  }
  
  // 초성, 중성이 일치해야 함
  if (userJamo.cho !== targetJamo.cho || userJamo.jung !== targetJamo.jung) {
    return false;
  }
  
  // 종성 비교
  // 1. 정답과 완전 일치
  if (userJamo.jong === targetJamo.jong) {
    return true;
  }
  
  // 2. 사용자가 종성을 입력했고, 다음 글자의 초성과 일치하는 경우
  if (userJamo.jong && nextTargetChar) {
    const nextJamo = decomposeHangul(nextTargetChar);
    if (nextJamo && userJamo.jong === nextJamo.cho && targetJamo.jong === '') {
      return true;
    }
  }
  
  return false;
}

/**
 * 한글 음절인지 확인
 */
export function isHangul(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= HANGUL_START && code <= HANGUL_END;
}

/**
 * 문자열을 글자 배열로 분해 (이모지 등 고려)
 */
export function splitGraphemes(text: string): string[] {
  return Array.from(text);
}
