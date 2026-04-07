# Debug Notes

## 현재 확인된 상태

- 애국가 2절 연습 페이지 로드됨
- 정답 4줄이 연한 회색으로 표시됨
- 첫 글자에 언더바가 보이지 않음 (completedCount > 0 조건 제거했는데 반영 안 됨?)
- 입력창은 정상 표시

## 문제 1: 초기화 지연

- handleCorrectAnswer에서 setTimeout 2500ms → 1000ms로 변경했는데 반영 안 됨
- 배포 서버에서 확인 필요

## 문제 2: 채점 대상 표시

- 엔터/스페이스 없이 다음 글자 채점 대상 처리
- completionInfo에서 normalizeText가 공백을 제거하므로 이미 공백 무시 채점은 됨
- 문제는 "시각적 표시"가 안 되는 것
