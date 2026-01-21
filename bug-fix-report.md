# 이미지 업로드 무한 루프 버그 수정 완료

## 문제 상황
- 이미지 문제 생성 시 이미지 업로드 후 "Maximum update depth exceeded" 오류 발생
- 무한 루프로 인해 이미지 라벨 편집기 사용 불가

## 원인 분석
1. **ImageLabelEditor.tsx**: useEffect에서 labels 변경 시 onChange 호출
2. **Questions.tsx**: onChange 콜백에서 formData 상태 업데이트
3. **순환 참조**: formData 업데이트 → ImageLabelEditor 리렌더링 → useEffect 실행 → onChange 호출 → formData 업데이트 → 무한 반복

## 해결 방법
### 1차 시도 (실패)
- useCallback으로 onChange 함수 메모이제이션
- 문제: dependency array 설정이 복잡하고 근본적 해결 아님

### 2차 시도 (성공)
- **ImageLabelEditor.tsx**: useEffect 완전 제거
- **onChange 호출 시점 변경**: 사용자 액션(드래그 완료, 입력 변경, 삭제) 시에만 직접 호출
- **Questions.tsx**: useCallback 제거, 일반 함수로 변경

## 수정 내용

### ImageLabelEditor.tsx
```typescript
// Before
import { useState, useRef, useEffect } from "react";

useEffect(() => {
  onChange(labels);
}, [labels, onChange]);

// After
import { useState, useRef } from "react";

// useEffect 제거, onChange는 사용자 액션 시에만 호출:
// - handleMouseUp (드래그 완료)
// - handleLabelUpdate (정답 입력)
// - handleLabelDelete (라벨 삭제)
```

### Questions.tsx
```typescript
// Before
import { useState, useRef, useCallback } from "react";

onChange={useCallback((labels: ImageLabel[]) => {
  setFormData(prev => ({ ...prev, imageLabels: labels }));
}, [])}

// After
import { useState, useRef } from "react";

onChange={(labels: ImageLabel[]) => {
  setFormData(prev => ({ ...prev, imageLabels: labels }));
}}
```

## 테스트 결과
✅ 이미지 업로드 성공
✅ 이미지 라벨 편집기 정상 렌더링
✅ 드래그로 영역 선택 가능
✅ 콘솔 오류 없음
✅ 무한 루프 완전 해결

## 다음 단계
- [ ] 이미지 라벨 표시 기능 구현 (Practice/Exam 모드)
- [ ] 이미지 문제 엔드투엔드 테스트
- [ ] OCR 자동 감지 기능 (향후)
- [ ] AI 기반 이미지 라벨 감지 (향후)
