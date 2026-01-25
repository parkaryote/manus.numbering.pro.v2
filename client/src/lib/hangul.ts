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
 * nextTargetChar: 다음 정답 글자
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
  
  // 2. 사용자가 종성을 입력했고, 다음 글자의 초성과 일치하면 일단 정답 인정
  if (userJamo.jong && nextTargetChar && targetJamo.jong === '') {
    const nextTargetJamo = decomposeHangul(nextTargetChar);
    if (nextTargetJamo && userJamo.jong === nextTargetJamo.cho) {
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
 * 조합 중인 글자가 정답의 일부인지 확인
 * 예: "ㄷ", "도"가 "동"의 일부인지 확인
 */
export function isPartialMatch(
  userChar: string,
  targetChar: string,
  nextTargetChar?: string
): 'complete' | 'partial' | 'wrong' {
  // 비어있으면 아직 입력 안 함
  if (!userChar) return 'wrong';
  
  // 완전 일치
  if (userChar === targetChar) return 'complete';
  
  // 한글이 아닌 경우 단순 비교
  if (!isHangul(targetChar)) {
    return userChar === targetChar ? 'complete' : 'wrong';
  }
  
  const targetJamo = decomposeHangul(targetChar);
  if (!targetJamo) return userChar === targetChar ? 'complete' : 'wrong';
  
  // 사용자 입력이 자음/모음인 경우 (조합 중)
  if (isJamo(userChar)) {
    // 초성만 입력한 경우
    if (userChar === targetJamo.cho) return 'partial';
    // 중성만 입력한 경우 (일반적으로 발생하지 않음)
    if (userChar === targetJamo.jung) return 'partial';
    return 'wrong';
  }
  
  // 사용자 입력이 한글 음절인 경우
  if (isHangul(userChar)) {
    const userJamo = decomposeHangul(userChar);
    if (!userJamo) return 'wrong';
    
    // 초성이 다르면 오답
    if (userJamo.cho !== targetJamo.cho) return 'wrong';
    
    // 초성만 일치 (중성 없음) - 일반적으로 발생하지 않음
    // 초성 + 중성 일치 (종성 없음)
    if (userJamo.jung === targetJamo.jung) {
      // 종성이 없는 경우
      if (!userJamo.jong) {
        // 정답도 종성이 없으면 완전 일치
        if (!targetJamo.jong) return 'complete';
        // 정답에 종성이 있으면 조합 중
        return 'partial';
      }
      
      // 종성이 있는 경우
      if (userJamo.jong === targetJamo.jong) return 'complete';
      
      // 종성 예약: 사용자가 입력한 종성이 다음 글자의 초성과 일치하는 경우
      if (nextTargetChar && !targetJamo.jong) {
        const nextTargetJamo = decomposeHangul(nextTargetChar);
        if (nextTargetJamo && userJamo.jong === nextTargetJamo.cho) {
          return 'complete'; // 종성 예약 성공
        }
      }
      
      // 종성이 다르면 오답
      return 'wrong';
    }
    
    // 중성이 다르면 오답
    return 'wrong';
  }
  
  return 'wrong';
}

/**
 * 자음/모음(자모) 여부 확인
 */
export function isJamo(char: string): boolean {
  const code = char.charCodeAt(0);
  // 한글 자모 영역: 0x3131 ~ 0x3163
  return code >= 0x3131 && code <= 0x3163;
}

/**
 * 문자열을 글자 배열로 분해 (이모지 등 고려)
 */
export function splitGraphemes(text: string): string[] {
  return Array.from(text);
}
