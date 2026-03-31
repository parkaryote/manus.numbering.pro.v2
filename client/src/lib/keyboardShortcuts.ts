/**
 * 크로스 플랫폼 키보드 단축키 시스템
 * Windows/macOS 네이티브 동작과 VSCode, Google Docs 컨벤션 준수
 */

// 플랫폼 감지
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * 단어 삭제 헬퍼 함수
 * @param value 전체 텍스트
 * @param cursorPos 커서 위치
 * @param direction 삭제 방향 ('backward' | 'forward')
 */
export const deleteWord = (value: string, cursorPos: number, direction: 'backward' | 'forward' = 'backward'): string => {
  if (direction === 'backward') {
    // 커서 앞의 단어 삭제 (공백 기준)
    const beforeCursor = value.substring(0, cursorPos);
    const afterCursor = value.substring(cursorPos);
    const trimmed = beforeCursor.trimEnd();
    const lastSpaceIndex = trimmed.lastIndexOf(' ');
    
    if (lastSpaceIndex === -1) {
      // 공백이 없으면 모두 삭제
      return afterCursor;
    } else {
      // 마지막 공백 다음부터 커서까지 삭제 (공백 유지)
      return beforeCursor.substring(0, lastSpaceIndex + 1) + afterCursor;
    }
  } else {
    // 커서 뒤의 단어 삭제
    const beforeCursor = value.substring(0, cursorPos);
    const afterCursor = value.substring(cursorPos);
    const trimmedAfter = afterCursor.trimStart();
    const nextSpaceIndex = trimmedAfter.indexOf(' ');
    const spaceOffset = afterCursor.length - trimmedAfter.length;
    
    if (nextSpaceIndex === -1) {
      // 공백이 없으면 커서 뒤 모두 삭제
      return beforeCursor;
    } else {
      // 커서부터 다음 공백까지 삭제
      return beforeCursor + afterCursor.substring(0, spaceOffset + nextSpaceIndex);
    }
  }
};

/**
 * 줄 삭제 헬퍼 함수
 * 커서가 있는 줄 전체를 삭제
 */
export const deleteLine = (value: string, cursorPos: number): string => {
  const lines = value.split('\n');
  let currentPos = 0;
  let lineIndex = 0;

  // 커서가 있는 줄 찾기
  for (let i = 0; i < lines.length; i++) {
    if (currentPos + lines[i].length >= cursorPos) {
      lineIndex = i;
      break;
    }
    currentPos += lines[i].length + 1; // +1 for newline
  }

  // 해당 줄 삭제
  lines.splice(lineIndex, 1);
  return lines.join('\n');
};

/**
 * 단축키 매핑 함수들
 * 각 함수는 KeyboardEvent를 받아 해당 단축키가 눌렸는지 판단
 */
export const shortcuts = {
  // Undo: Ctrl+Z (모든 플랫폼)
  undo: (e: KeyboardEvent) => e.ctrlKey && e.key === 'z' && !e.shiftKey && !e.altKey && !e.metaKey,
  
  // Redo: Ctrl+Shift+Z (모든 플랫폼)
  redo: (e: KeyboardEvent) => e.ctrlKey && e.shiftKey && e.key === 'z' && !e.altKey && !e.metaKey,
  
  // Complete: Ctrl+Enter 또는 Esc (모든 플랫폼)
  complete: (e: KeyboardEvent) => (e.ctrlKey && e.key === 'Enter') || e.key === 'Escape',
  
  // 단어 삭제 (뒤로): Ctrl+Backspace (Windows) / Option+Backspace (Mac)
  deleteWordBackward: (e: KeyboardEvent) => 
    ((!isMac && e.ctrlKey && e.key === 'Backspace' && !e.shiftKey && !e.altKey && !e.metaKey) || 
     (isMac && e.altKey && e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey && !e.metaKey)),
  
  // 단어 삭제 (앞으로): Ctrl+Delete (Windows) / Option+Delete (Mac)
  deleteWordForward: (e: KeyboardEvent) => 
    ((!isMac && e.ctrlKey && e.key === 'Delete' && !e.shiftKey && !e.altKey && !e.metaKey) || 
     (isMac && e.altKey && e.key === 'Delete' && !e.ctrlKey && !e.shiftKey && !e.metaKey)),
  
  // 줄 삭제: Ctrl+Shift+Backspace (Windows) / Cmd+Shift+Backspace (Mac)
  deleteLine: (e: KeyboardEvent) => 
    ((!isMac && e.ctrlKey && e.shiftKey && e.key === 'Backspace' && !e.altKey && !e.metaKey) || 
     (isMac && e.metaKey && e.shiftKey && e.key === 'Backspace' && !e.ctrlKey && !e.altKey)),
};

/**
 * 단축키 설명 (UI에 표시)
 * OS별로 다른 설명 제공
 */
export const shortcutDescriptions = isMac ? {
  undo: 'Cmd+Z',
  redo: 'Cmd+Shift+Z',
  complete: 'Cmd+Enter 또는 Esc',
  deleteWordBackward: 'Option+Backspace',
  deleteWordForward: 'Option+Delete',
  deleteLine: 'Cmd+Shift+Backspace',
} : {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  complete: 'Ctrl+Enter 또는 Esc',
  deleteWordBackward: 'Ctrl+Backspace',
  deleteWordForward: 'Ctrl+Delete',
  deleteLine: 'Ctrl+Shift+Backspace',
};
