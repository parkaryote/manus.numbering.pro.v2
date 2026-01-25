import { describe, it, expect } from 'vitest';
import { isPartialMatch, decomposeHangul, isHangul, isJamo, splitGraphemes } from '@/lib/hangul';

describe('isPartialMatch', () => {
  describe('완전 일치', () => {
    it('동일한 글자는 complete 반환', () => {
      expect(isPartialMatch('동', '동')).toBe('complete');
      expect(isPartialMatch('해', '해')).toBe('complete');
      expect(isPartialMatch('물', '물')).toBe('complete');
      expect(isPartialMatch('과', '과')).toBe('complete');
    });

    it('비한글 문자도 동일하면 complete 반환', () => {
      expect(isPartialMatch('a', 'a')).toBe('complete');
      expect(isPartialMatch('1', '1')).toBe('complete');
      expect(isPartialMatch('.', '.')).toBe('complete');
    });
  });

  describe('초성만 입력 (조합 중)', () => {
    it('초성만 입력하면 partial 반환', () => {
      expect(isPartialMatch('ㄷ', '동')).toBe('partial');
      expect(isPartialMatch('ㅎ', '해')).toBe('partial');
      expect(isPartialMatch('ㅁ', '물')).toBe('partial');
    });

    it('다른 초성이면 wrong 반환', () => {
      expect(isPartialMatch('ㄱ', '동')).toBe('wrong');
      expect(isPartialMatch('ㅂ', '해')).toBe('wrong');
    });
  });

  describe('초성+중성 입력 (종성 없음)', () => {
    it('정답에 종성이 있으면 partial 반환', () => {
      expect(isPartialMatch('도', '동')).toBe('partial');
      expect(isPartialMatch('무', '물')).toBe('partial');
      expect(isPartialMatch('과', '관')).toBe('partial');
    });

    it('정답에 종성이 없으면 complete 반환', () => {
      expect(isPartialMatch('해', '해')).toBe('complete');
      expect(isPartialMatch('과', '과')).toBe('complete');
    });
  });

  describe('복합 모음 조합 중', () => {
    it('"고"는 "과"의 조합 중 (ㅗ -> ㅘ)', () => {
      expect(isPartialMatch('고', '과')).toBe('partial');
    });

    it('"구"는 "궈"의 조합 중 (ㅜ -> ㅝ)', () => {
      expect(isPartialMatch('구', '궈')).toBe('partial');
    });

    it('"그"는 "긔"의 조합 중 (ㅡ -> ㅢ)', () => {
      expect(isPartialMatch('그', '긔')).toBe('partial');
    });

    it('복합 모음 조합 중에 종성이 있으면 wrong', () => {
      expect(isPartialMatch('곡', '과')).toBe('wrong');
    });
  });

  describe('종성 예약 (다음 글자 초성과 일치)', () => {
    it('"햄"은 "해"+"물" 조합에서 complete (ㅁ이 물의 초성)', () => {
      expect(isPartialMatch('햄', '해', '물')).toBe('complete');
    });

    it('"묽"은 "물"+"과" 조합에서 partial_complete (ㄱ이 과의 초성)', () => {
      expect(isPartialMatch('묽', '물', '과')).toBe('partial_complete');
    });

    it('다음 글자 초성과 일치하지 않으면 wrong', () => {
      expect(isPartialMatch('햄', '해', '과')).toBe('wrong'); // ㅁ ≠ ㄱ
    });
  });

  describe('겹받침 조합 중', () => {
    it('"묽"(ㄺ)은 "물"(ㄹ)의 조합 중 -> partial_complete', () => {
      expect(isPartialMatch('묽', '물', '과')).toBe('partial_complete');
    });

    it('"달"(ㄹ)은 "닳"(ㅀ)의 조합 중 -> partial', () => {
      expect(isPartialMatch('달', '닳')).toBe('partial');
    });

    it('"갈"(ㄹ)은 "갈"(ㄹ)과 완전 일치 -> complete', () => {
      expect(isPartialMatch('갈', '갈')).toBe('complete');
    });

    it('"갈"(ㄹ)은 "갈"(ㄹ)+"ㄱ" 다음 글자가 있어도 complete', () => {
      expect(isPartialMatch('갈', '갈', '기')).toBe('complete');
    });
  });

  describe('오답 케이스', () => {
    it('초성이 다르면 wrong', () => {
      expect(isPartialMatch('강', '동')).toBe('wrong');
    });

    it('중성이 다르면 wrong', () => {
      expect(isPartialMatch('당', '동')).toBe('wrong');
    });

    it('종성이 다르고 예약도 아니면 wrong', () => {
      expect(isPartialMatch('돈', '동')).toBe('wrong');
    });

    it('빈 문자열은 wrong', () => {
      expect(isPartialMatch('', '동')).toBe('wrong');
    });
  });

  describe('실제 사용 시나리오: "동해물과"', () => {
    it('"동" 입력 -> complete', () => {
      expect(isPartialMatch('동', '동', '해')).toBe('complete');
    });

    it('"동햄" 입력 중 "햄" -> complete (종성 예약)', () => {
      expect(isPartialMatch('햄', '해', '물')).toBe('complete');
    });

    it('"동해물" 입력 -> complete', () => {
      expect(isPartialMatch('물', '물', '과')).toBe('complete');
    });

    it('"동해묽" 입력 중 "묽" -> partial_complete (겹받침 조합)', () => {
      expect(isPartialMatch('묽', '물', '과')).toBe('partial_complete');
    });

    it('"동해물과" 입력 -> complete', () => {
      expect(isPartialMatch('과', '과')).toBe('complete');
    });

    it('"동해물고" 입력 중 "고" -> partial (복합 모음 조합)', () => {
      expect(isPartialMatch('고', '과')).toBe('partial');
    });
  });

  describe('실제 사용 시나리오: "닳"', () => {
    it('"달" 입력 -> partial (겹받침 ㅀ의 첫 번째 자음 ㄹ)', () => {
      expect(isPartialMatch('달', '닳')).toBe('partial');
    });

    it('"닳" 입력 -> complete', () => {
      expect(isPartialMatch('닳', '닳')).toBe('complete');
    });

    it('"다" 입력 -> partial (종성 조합 중)', () => {
      expect(isPartialMatch('다', '닳')).toBe('partial');
    });
  });
});

describe('decomposeHangul', () => {
  it('한글 음절을 초성, 중성, 종성으로 분해', () => {
    expect(decomposeHangul('동')).toEqual({ cho: 'ㄷ', jung: 'ㅗ', jong: 'ㅇ' });
    expect(decomposeHangul('해')).toEqual({ cho: 'ㅎ', jung: 'ㅐ', jong: '' });
    expect(decomposeHangul('물')).toEqual({ cho: 'ㅁ', jung: 'ㅜ', jong: 'ㄹ' });
    expect(decomposeHangul('과')).toEqual({ cho: 'ㄱ', jung: 'ㅘ', jong: '' });
    expect(decomposeHangul('닳')).toEqual({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㅀ' });
  });

  it('한글이 아닌 문자는 null 반환', () => {
    expect(decomposeHangul('a')).toBeNull();
    expect(decomposeHangul('1')).toBeNull();
    expect(decomposeHangul('ㄱ')).toBeNull();
  });
});

describe('isHangul', () => {
  it('한글 음절이면 true', () => {
    expect(isHangul('가')).toBe(true);
    expect(isHangul('힣')).toBe(true);
    expect(isHangul('동')).toBe(true);
  });

  it('한글 자모는 false', () => {
    expect(isHangul('ㄱ')).toBe(false);
    expect(isHangul('ㅏ')).toBe(false);
  });

  it('비한글 문자는 false', () => {
    expect(isHangul('a')).toBe(false);
    expect(isHangul('1')).toBe(false);
  });
});

describe('isJamo', () => {
  it('한글 자모면 true', () => {
    expect(isJamo('ㄱ')).toBe(true);
    expect(isJamo('ㅏ')).toBe(true);
    expect(isJamo('ㅎ')).toBe(true);
    expect(isJamo('ㅣ')).toBe(true);
  });

  it('한글 음절이면 false', () => {
    expect(isJamo('가')).toBe(false);
    expect(isJamo('동')).toBe(false);
  });

  it('비한글 문자는 false', () => {
    expect(isJamo('a')).toBe(false);
    expect(isJamo('1')).toBe(false);
  });
});

describe('splitGraphemes', () => {
  it('문자열을 글자 배열로 분해', () => {
    expect(splitGraphemes('동해물과')).toEqual(['동', '해', '물', '과']);
    expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
    expect(splitGraphemes('')).toEqual([]);
  });
});


describe('영어 대소문자 무시', () => {
  it('대문자를 소문자로 동일하게 처리', () => {
    expect(isPartialMatch('A', 'a')).toBe('complete');
    expect(isPartialMatch('a', 'A')).toBe('complete');
    expect(isPartialMatch('H', 'h')).toBe('complete');
    expect(isPartialMatch('Z', 'z')).toBe('complete');
  });

  it('영문자 대소문자 불일치는 wrong', () => {
    expect(isPartialMatch('A', 'b')).toBe('wrong');
    expect(isPartialMatch('a', 'B')).toBe('wrong');
  });

  it('비영문자는 대소문자 무시 미적용', () => {
    expect(isPartialMatch('1', '1')).toBe('complete');
    expect(isPartialMatch('1', '2')).toBe('wrong');
    expect(isPartialMatch('!', '!')).toBe('complete');
    expect(isPartialMatch('!', '@')).toBe('wrong');
  });
});
