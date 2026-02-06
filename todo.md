# 타이핑 퀴즈 - 서술형 문제 암기 도우미 TODO

## Phase 1: 프로젝트 계획 수립
- [ ] TODO 리스트 작성 및 기능 명세 정리

## Phase 2: 데이터베이스 스키마 설계
- [x] 과목(Subject) 테이블 설계
- [x] 문제(Question) 테이블 설계
- [x] 연습 기록(PracticeSession) 테이블 설계
- [x] 시험 기록(TestSession) 테이블 설계
- [x] 망각 곡선 데이터(ReviewSchedule) 테이블 설계
- [x] 데이터베이스 마이그레이션 실행

## Phase 3: 디자인 시스템 및 레이아웃
- [x] Elegant 스타일 커러 팔레트 정의 (index.css)
- [x] 타이포그래피 및 폰트 설정
- [x] DashboardLayout 기반 네비게이션 구조 설정
- [x] 공통 컴포넌트 스타일 정의

## Phase 4: 과목 및 문제 관리
- [x] 과목 목록 페이지 구현
- [x] 과목 생성/수정/삭제 기능
- [x] 문제 목록 페이지 구현
- [x] 문제 생성/수정/삭제 기능 (질문 + 답안)
- [x] 과목별 문제 필터링 기능

## Phase 5: 연습 모드
- [x] 연습 모드 페이지 UI 구현
- [x] 실시간 타이핑 비교 로직 (문자 단위 비교)
- [x] 오타 하이라이트 표시
- [x] 타이핑 속도 측정 (WPM, CPM)
- [x] 연습 시간 및 반복 횟수 기록
- [x] 연습 세션 저장 기능

## Phase 6: 시험 모드
- [x] 시험 모드 페이지 UI 구현
- [x] 빈칸 답안 작성 인터페이스
- [x] 답안 제출 및 채점 로직
- [x] 자주 틀린 부분 하이라이트
- [x] 정답률 계산
- [x] 회상 소요 시간 측정
- [x] 시험 결과 저장 기능

## Phase 7: LLM 기반 답안 평가
- [x] LLM API 통합 (의미적 유사도 평가)
- [x] 키워드 누락 분석 로직
- [x] 논리적 오류 지적 기능
- [x] 개선 제안 생성 기능
- [x] 평가 결과 UI 표시

## Phase 8: 음성 입력 기능
- [x] 음성 녹음 인터페이스 구현
- [x] 음성 파일 S3 업로드
- [x] Whisper API 통합 (음성-텍스트 변환)
- [x] 변환된 텍스트 답안 입력 연동

## Phase 9: 학습 통계 및 시각화
- [x] 학습 통계 대시보드 페이지
- [x] 시간당 평균 암기량 계산
- [x] 시간당 평균 망각량 계산
- [x] 망각 곡선 그래프 (Recharts)
- [x] 예상 학점 계산 로직
- [x] 통계 데이터 시각화

## Phase 10: 망각 곡선 기반 알림
- [x] 망각 곡선 알고리즘 구현 (SM-2 알고리즘)
- [x] 복습 스케줄 자동 생성
- [x] 복습 마감 문제 알림 기능
- [x] 홈 페이지에 복습 알림 UI 표시

## Phase 11: 통합 테스트
- [x] 주요 기능 Vitest 테스트 작성
- [x] 전체 워크플로우 테스트
- [x] 체크포인트 생성

## Phase 12: 결과 전달
- [ ] 사용자에게 완성된 웹앱 전달
- [ ] 사용 가이드 제공


---

# 사용자 피드백 기반 개선 사항 (v1.1)

## Phase 1: 과목 관리 개선
- [x] 과목 순서(위치) 변경 기능 (드래그 앤 드롭)
- [x] 과목 삭제 버그 수정 (optimistic update 적용)

## Phase 2: 연습 모드 UX 개선
- [x] 정확도 측정 기능 제거
- [x] 오타 수 통계 제거
- [x] 띠어쓰기 관대 처리 (틀려도 채점에 영향 없음)
- [x] 시작 버튼 제거 - 문제 보면 바로 연습 시작
- [x] 1분간 입력 없으면 시간 측정 중단
- [x] 실시간 통계 표시 제거 (진행률, CPM, 정확도, 경과 시간, 오타 수)
- [x] 측정 상태 표시등 추가 (초록불: 측정 중, 빨간불: 중단)
- [x] 타이핑 시각 피드백 개선:
  - [x] 모범 답안 하이라이트 대신 입력할 부분에 언더바
  - [x] 입력 전: 회색 글자
  - [x] 올바르게 입력: 검정색으로 채워짐
  - [x] 틀린 입력: 빨간색 표시
  - [x] 입력 중에는 색상 변화 없이 편안하게

## Phase 3: 이미지 첨부 및 라벨링 기능
- [x] 문제에 이미지 첨부 기능 추가
- [x] 이미지 업로드 및 S3 저장
- [x] 드래그로 영역 선택 기능
- [ ] AI 기반 이미지 텍스트 인식 (OCR) - 추후 추가 예정
- [x] 수동 영역 지정 인터페이스
- [ ] 연습/시험 모드에서 이미지 라벨 표시

## Phase 4: AI 채점 선택적 옵션화
- [x] 기본 채점 방식: 문자열/규칙 기반으로 변경
- [x] AI 채점 토글 옵션 추가 (문제별 useAIGrading 필드)
- [x] AI 채점 크레딧 시스템 구현 (users.aiCreditBalance)
- [x] AI 채점 크레딧 차감 로직
- [ ] AI 채점 결과 캐싱 (같은 답안 재평가 방지) - 추후 추가
- [ ] AI 채점 사용 통계 대시보드 - 추후 추가


---

# 버그 수정 (v1.1.1)
- [x] 과목 클릭 시 404 오류 발생 문제 수정
- [x] 라우팅 설정 확인 및 수정

# UI 개선 (v1.1.2)
- [x] 연습 모드 정답 폰트 두껋게 (text-xl font-semibold)
- [x] 현재 입력 위치만 두껋운 언더바 표시 (border-b-4)
- [x] 입력 중 색상 변화 제거 (글자 완성 후에만 색상 표시)

# UI 추가 개선 (v1.1.3)
- [x] 불필요한 얗은 언더바 제거 (다음 입력 글자 외)
- [x] 한글 조합 중 색상 변화 방지 (compositionstart/end 이벤트 사용)
- [x] 키보드 단축키 추가 (Ctrl+Enter: 완료, Esc: 나가기)

# 버그 수정 (v1.1.4)
- [x] 연습 모드 채점 로직 수정
  - [x] 글자 단위로 즉시 채점 (단어 전체가 아닌)
  - [x] 이미 완성된 글자는 색상 유지 (lastCompletedLength 추적)
  - [x] 현재 입력 중인 글자만 회색 표시
  - [x] 색상이 깜박이지 않도록 안정화

# UI 추가 수정 (v1.1.5)
- [x] 입력 칸 커서 표시 (animate-pulse 적용)
- [x] 언더바가 글자 완성 후에만 다음으로 이동 (lastCompletedLength 기반)

# 로직 수정 (v1.1.6)
- [x] 언더바 이동 로직 개선 - 정답 글자 완성 시 즉시 다음으로 이동

# 버그 수정 (v1.1.7)
- [x] compositionEnd 로직 수정 - 정답 글자 완성 시 언더바 즉시 이동 (for loop로 모든 정답 글자 확인)

# 전체 재구현 (v1.2.0)
- [x] 언더바 이동 로직 완전 수정 (normalizedInput.length 기반)
- [x] 조합 중 색상 변화 완전 차단 (!isComposing 조건)
- [x] 커서 표시 수정 (textarea에 caret-foreground 클래스)
- [x] 입력/삭제 모두 정상 작동하도록 전체 로직 단순화

# 버그 수정 (v1.2.1)
- [x] 글자 단위 즉시 채점 구현 - completedLength 상태로 조합 완료된 글자만 채점

# 버그 수정 (v1.2.2)
- [x] 이미지 문제 생성 버그 수정
  - [x] 이미지 탭 선택 시 텍스트 탭으로 돌아가는 문제 (activeTab 상태 추가)
  - [x] 이미지 업로드 후 탭 상태 유지 (value/onValueChange 적용)
  - [x] 이미지 문제 질문 입력 필드 독립적으로 작동 (동일 formData.question 사용)

# 버그 수정 (v1.2.3)
- [x] 이미지 업로드 시 무한 루프 오류 수정
  - [x] ImageLabelEditor useEffect에 onChange dependency 추가
  - [x] Questions 페이지 onChange를 useCallback으로 감싸기
  - [x] setState 무한 호출 방지

# 버그 수정 (v1.2.4)
- [x] 이미지 업로드 무한 루프 오류 재수정
  - [x] ImageLabelEditor useEffect 제거
  - [x] onChange를 labels 변경 시점에만 직접 호출
  - [x] useCallback 제거 (일반 함수로 변경)

# 성능 개선 (v1.2.5)
- [x] 이미지 업로드 속도 개선
  - [x] 클라이언트 측 이미지 압축 추가 (browser-image-compression)
  - [x] 파일 크기 제한 (16MB → 2MB 압축)
  - [x] 이미지 해상도 제한 (1920px)
  - [x] Web Worker 사용으로 메인 스레드 차단 방지
- [x] 질문 입력 필드 끊김 현상 해결
  - [x] ImageLabelEditor를 React.memo로 최적화
  - [x] 불필요한 리렌더링 방지
  - [x] formData 상태 업데이트 최적화

# 버그 수정 (v1.2.6)
- [x] 이미지 문제 생성 시 answer 필드 오류 해결
  - [x] 서버 스키마에서 answer 필드를 optional로 변경
  - [x] 이미지 문제 생성 시 answer 기본값 처리
  - [x] 클라이언트에서 이미지 문제 생성 시 answer 필드 처리
  - [x] imageUrl, imageLabels 필드 스키마에 추가

# 버그 수정 (v1.2.7)
- [x] 입력 필드 끊김 현상 완전 해결
  - [x] textarea를 controlled input에서 uncontrolled로 변경 (useRef 사용)
  - [x] useCallback으로 handleCreate 메모이제이션
  - [x] 불필요한 리렌더링 방지
  - [x] resetForm에서 ref 초기화 추가

# 기능 추가 (v1.3.0)
- [x] 이미지 문제 연습/시험 모드 구현
  - [x] Practice.tsx에서 이미지 표시 및 라벨 입력 필드 렌더링
  - [x] Test.tsx에서 이미지 표시 및 라벨 입력 필드 렌더링
  - [x] 이미지 위 좌표에 번호 표시 및 영역 강조
  - [ ] 답안 채점 로직에 이미지 라벨 답안 처리 추가

# 버그 수정 및 개선 (v1.3.1)
- [x] 이미지 로딩 속도 개선
  - [x] 이미지 로딩 중 스켈레톤 UI 추가
  - [x] lazy loading 구현
  - [x] 이미지 로드 상태 표시
- [x] 연습 모드 404 에러 수정
  - [x] 완료 버튼 클릭 시 라우팅 오류 수정
  - [x] 뒤로가기 버튼 클릭 시 라우팅 오류 수정
- [x] 시험 모드 답안 노출 문제 해결
  - [x] 시험 모드에서 이미지 라벨 영역 표시 숨김
  - [x] 암기 시간에만 라벨 영역 표시
  - [x] 답안 작성 시에는 이미지만 표시

# 버그 수정 (v1.3.2)
- [x] 이미지 라벨 편집기 정답 입력 끊김 현상 해결
  - [x] ImageLabelEditor의 input을 uncontrolled로 변경 (defaultValue + onBlur)
  - [x] onChange를 onBlur로 변경하여 입력 완료 시점에만 상태 업데이트
- [x] 시험 모드 라벨 영역 표시 문제 해결
  - [x] 암기 시간(!isStarted)에는 라벨 영역 표시
  - [x] 답안 작성 시(isStarted)에는 라벨 영역 숨김
  - [x] imageLoaded 상태와 함께 체크하여 이미지 로드 후 라벨 표시

# 기능 추가 및 개선 (v1.4.0)
- [x] 시험 모드 라벨 영역 불투명 박스 처리
  - [x] 암기 시간에 불투명한 박스로 정답 영역 가리기
  - [x] 박스 중앙에 큰 흰색 번호 라벨링 추가
  - [x] 박스 색상 및 투명도 조정
- [x] 시험 모드 제출 버튼 활성화 로직
  - [x] 이미지 라벨 답안 입력 시 제출 버튼 활성화
  - [x] 텍스트 답안과 동일한 로직 적용
  - [x] 모든 라벨 영역 답안 입력 확인 후 제출 가능
- [x] 연습 모드 플래시카드 버전 구현
  - [x] 타이핑 모드: 기존 정답 입력 방식 유지
  - [x] 플래시카드 모드: 박스 클릭 시 정답 표시
  - [x] 모드 전환 UI 추가 (상단 토글 버튼)
  - [x] 플래시카드 모드에서 학습 진행 상태 표시 (n/total)

# 플래시카드 개선 및 버그 수정 (v1.4.1)
- [x] 연습 모드 플래시카드 개선
  - [x] 타이핑 모드 제거, 플래시카드 모드만 유지
  - [x] 박스를 완전 불투명(bg-black)으로 변경
  - [x] 정답 텍스트를 이미지 외부에 별도 표시
  - [x] 클릭 시 공개/가리기 토글 기능
- [x] 시험 모드 버그 수정
  - [x] 암기 시간에 라벨 영역을 완전 불투명 박스(bg-black)로 가리기
  - [x] 이미지 중복 표시는 정상 동작 (암기 시간/답안 작성 시간 별도 표시)

# 시험 모드 버그 수정 (v1.4.2)
- [x] 시험 시작 후 이미지 중복 표시 문제 해결
  - [x] 시험 시작 전에만 문제 카드 표시
  - [x] 답안 작성 시 문제 텍스트를 답안 카드 내부에 표시
- [x] 이미지 문제 채점 오류 수정
  - [x] 서버 채점 로직에서 이미지 라벨 답안 처리 추가
  - [x] imageLabels에서 정답을 추출하여 채점
  - [x] LLM 평가 프롬프트에도 correctAnswer 사용

# 버그 수정 (v1.4.3)
- [ ] 시험 모드 암기 시간에 가림막 박스가 표시되지 않는 문제 해결
  - [ ] Test.tsx에서 암기 시간(!isStarted) 조건 확인
  - [ ] 이미지 라벨 영역에 불투명 박스 렌더링 확인

# 버그 수정 및 UX 개선 (v1.4.4)
- [ ] 시험 모드 가림막 박스 미표시 문제 해결
  - [ ] Test.tsx에서 암기 시간(!isStarted)에 불투명 박스 표시 확인
  - [ ] imageLabels 파싱 및 렌더링 로직 검증
- [x] 채점 결과 표시 오류 수정
  - [x] 이미지 문제 채점 시 답안 텍스트 표시 (imageLabels.map으로 라벨별 표시)
  - [x] 모범 답안 박스 스타일 수정 (bg-green-50 → bg-muted/50 + border-green-500/30)
- [x] 문제 추가 다이얼로그 크기 확대
  - [x] 다이얼로그 최대 너비를 max-w-6xl로 증가
  - [x] 이미지 라벨 편집기 영역 확대
- [x] ImageLabelEditor Tab 키 네비게이션
  - [x] Tab 키 입력 시 다음 라벨 답안 입력 필드로 포커스 이동
  - [x] Shift+Tab으로 이전 필드 이동
  - [x] data-label-id 속성으로 필드 식별 및 포커스 이동

# 버그 수정 (v1.4.5)
- [x] 이미지 문제 채점 로직 오류 수정
  - [x] 정답 여부, 유사도, 정확도가 0%로 표시되는 문제 해결
  - [x] fallback 로직에서 question.answer 대신 correctAnswer 변수 사용
  - [x] imageLabels에서 추출한 correctAnswer가 fallback에서도 유지되도록 수정

# 버그 수정 (v1.4.6)
- [x] 이미지 문제 채점 로직 디버깅
  - [x] 서버 로그에서 correctAnswer 값 확인
  - [x] useAIGrading 플래그 확인
  - [x] 문자열 비교 로직 검증
- [x] 이미지 문제 라벨별 채점 로직 구현
  - [x] 각 라벨별로 개별 비교 (imageLabels[i].answer vs userAnswerLines[i])
  - [x] 라벨별 정답 여부 계산
  - [x] 전체 정확도 = (맞은 라벨 수 / 전체 라벨 수) * 100
  - [x] 피드백 메시지에 "맞은 개수/전체 개수" 표시

# 버그 수정 (v1.4.7)
- [x] 시험 모드 암기 시간에 불투명 박스가 표시되지 않는 문제 해결
  - [x] Test.tsx에서 !isStarted 조건 확인
  - [x] imageLabels 파싱 및 렌더링 로직 검증
  - [x] 불투명 박스 스타일 및 위치 확인
  - [x] 283번 줄에 !isStarted 조건 추가하여 암기 시간에만 박스 표시

# 버그 수정 (v1.4.8)
- [x] 시험 모드에서 시작 버튼을 눌러도 불투명 박스가 계속 유지되도록 수정
  - [x] Test.tsx에서 !isStarted 조건 제거
  - [x] 암기 시간과 답안 작성 시간 모두 불투명 박스 표시
  - [x] 답안 작성 시간에 이미지 위에 불투명 박스 추가
  - [x] 음성 입력 기능을 텍스트 문제에만 표시

# 버그 수정 (v1.4.9)
- [x] 홈 대시보드 전체 문제 수 표시 오류 수정
  - [x] 현재 22개로 표시되지만 실제로는 6개 (총의치 4개, 해부 2개)
  - [x] 홈 페이지 통계 쿼리 로직 확인
  - [x] 문제 수 카운트 로직 수정
  - [x] 데이터베이스에서 불필요한 문제 삭제
  - [x] countQuestionsByUserId 함수 추가
  - [x] questions.count 프로시저 추가

# 기능 추가 (v1.5.0)
- [x] 학습 통계 페이지 개선
  - [x] 총 연습 시간 표시
  - [x] 과목별 연습 시간 표시
  - [x] 통계 초기화 버튼 추가
  - [x] 연습 세션에 시간 기록 추가 (시작 시간, 종료 시간)
  - [x] 통계 초기화 API 구현
  - [x] 통계 페이지 UI 업데이트
  - [x] practice.deleteAll 프로시저 추가
  - [x] test.deleteAll 프로시저 추가
  - [x] deleteAllPracticeSessions 함수 추가
  - [x] deleteAllTestSessions 함수 추가
  - [x] 통계 초기화 테스트 작성 및 통과

# 기능 추가 (v1.5.1)
- [x] 이미지 문제에 타이핑 연습용 메모장 추가
  - [x] Practice 페이지에서 이미지 문제 감지
  - [x] 이미지 하단에 메모장 textarea 추가
  - [x] 메모장 내용은 저장하지 않고 연습용으로만 사용
  - [x] practiceNote state 추가
  - [x] 정답 목록 아래에 메모장 UI 배치

# 기능 개선 (v1.5.2)
- [x] Practice 페이지 이미지 문제 레이아웃 개선
  - [x] "박스를 클릭하여 정답을 확인하세요" 섹션 제거
  - [x] 이미지와 메모장을 2단 레이아웃으로 배치 (grid-cols-1 lg:grid-cols-2)
  - [x] 메모장을 보면서 이미지를 동시에 볼 수 있도록 개선
  - [x] 메모장 높이를 400px로 증가
- [x] ESC 키 동작 수정
  - [x] ESC 키를 완료 버튼과 동일하게 작동 (통계 저장 후 나가기)
  - [x] Ctrl+Enter도 완료 버튼과 동일하게 작동
  - [x] 기존 "나가기" 동작 제거
  - [x] 단축키 안내 텍스트 업데이트

# 버그 수정 (v1.5.3)
- [x] Practice 페이지 ESC 키 작동하지 않는 문제 수정
  - [x] 전역 키보드 이벤트 리스너 추가
  - [x] 이미지 문제에서도 ESC 키 감지되도록 수정
  - [x] useEffect로 window keydown 이벤트 등록
  - [x] handleGlobalKeyDown 함수 추가

# 기능 개선 (v1.6.0)
- [x] 앱 이름 및 브랜딩 변경
  - [x] 홈페이지 타이틀을 "타이핑 퀴즈"에서 "numbering.pro"로 변경
  - [x] 설명 문구를 "넘버링 달인, 그림빵 장인 되기"로 변경
  - [x] index.html title 태그 업데이트
  - [x] Home.tsx 타이틀 및 설명 업데이트

# 버그 수정 (v1.6.1)
- [x] 시험 통계 저장 및 채점 로직 수정
  - [x] 시험을 쳐도 시험 횟수가 통계에 잡히지 않는 문제
  - [x] 올바르게 입력해도 유사도 정확도가 0%로 표시되는 문제
  - [x] 정답 여부가 항상 X로 표시되는 문제
  - [x] Test.tsx의 결과 저장 로직 확인
  - [x] 서버 채점 로직 확인
  - [x] AI 채점을 사용하지 않는 경우에도 createTestSession 호출하도록 수정
  - [x] 이미지 문제 채점 후 testSession 저장 추가
  - [x] 텍스트 문제 채점 후 testSession 저장 추가

# 기능 개선 (v1.6.2)
- [x] 시험 결과 화면에 정답과 오답 비교 표시
  - [x] 서버 채점 로직에 단어별/문자별 비교 정보 추가
  - [x] 정답과 사용자 답안을 나란히 표시
  - [x] 다른 부분을 색상으로 강조 (정답: 초록색, 오답: 빠른색)
  - [x] 이미지 문제의 각 라벨별 비교 표시
  - [x] 텍스트 문제의 전체 답안 비교 표시
  - [x] labelComparisons 데이터 구조 추가
  - [x] Test.tsx 결과 화면 UI 업데이트

# 버그 수정 (v1.6.3)
- [x] 텍스트 연습에서 입력을 시작하면 언더바가 사라지는 문제 수정
  - [x] Practice 페이지 텍스트 입력 부분 확인
  - [x] 언더바 표시 조건 확인
  - [x] 입력 중에도 언더바가 유지되도록 수정
  - [x] 196번 줄에서 !isComposing 조건 제거

# 버그 수정 (v1.6.4)
- [x] 언더바가 정답 글자 일치 시에만 다음으로 이동하도록 수정
  - [x] 현재는 입력 길이만 보고 언더바가 이동
  - [x] 정답 글자와 일치할 때만 언더바 다음으로 이동
  - [x] completedLength를 정답 일치 기준으로 업데이트
  - [x] handleCompositionEnd에서 정답 글자 수만 계산
  - [x] 언더바 위치를 completedLength 기준으로 변경

# 버그 수정 (v1.6.5)
- [x] 정답에 줄바꾸기가 있을 때 채점 지연 문제 수정
  - [x] renderTextWithFeedback 함수의 성능 최적화
  - [x] 줄바꾸기 처리 로직 확인
  - [x] useMemo로 renderTextWithFeedback 메모이제이션
  - [x] 실시간 채점 반영 지연 원인 파악 및 수정

# 버그 수정 (v1.6.6)
- [x] 한 글자 틀렸을 때 이후 글자들도 채점되도록 수정
  - [x] handleCompositionEnd에서 틀린 글자 이후도 계속 채점
  - [x] completedLength 업데이트 로직 개선
  - [x] break 문 제거
  - [x] 단순 입력 길이로 completedLength 설정

# 버그 수정 (v1.6.7)
- [x] 줄바꾸기 이후 글자 채점 인덱스 밀림 문제 수정
  - [x] renderTextWithFeedback에서 줄바꾸기 처리 로직 확인
  - [x] normalizeText와 실제 targetText 인덱스 맞추기
  - [x] 줔바꾸기를 건너뛤지 않고 카운트하도록 수정
  - [x] char === "\\n" 조건 추가
  - [x] 줄바꾸기도 렌더링 시 유지
# 기능 개선 (v1.6.8)
- [ ] OAuth 로그인 페이지 앱 이름 변경
  - [ ] "타이핑 퀴즈 - 서술형 문제 암기 도우미로 계속하기" → "numbering.pro - 넘버링 달인, 그림빵 장인 되기"로 변경
  - [ ] VITE_APP_TITLE 환경 변수 확인
  - [ ] VITE_APP_TITLE 값 변경

# 버그 수정 (v1.6.9)
- [x] 모바일에서 연습 모드 채점이 작동하지 않는 문제 수정
  - [x] Practice.tsx 코드 분석
  - [x] 모바일 키보드 이벤트 처리 확인
  - [x] compositionstart/compositionend 이벤트 모바일 호환성 확인
  - [x] input 이벤트 기반으로 채점 로직 수정
  - [x] completedLength 상태 변수 제거, getCompletedLength useMemo로 대체
  - [x] compositionend 이벤트에 의존하지 않고 입력값 자체로 판단

# 버그 수정 (v1.7.0)
- [x] 연습 모드에서 글자 조합 중에는 회색으로 표시되도록 수정
  - [x] 현재 입력 중인 마지막 글자는 회색으로 유지
  - [x] 다음 글자로 넘어간 후에만 검정(정답)/빨강(오답) 표시
  - [x] getCompletedLength 로직 수정 - 항상 마지막 글자 제외

# 버그 수정 (v1.7.1)
- [x] 모바일에서 이미지 로딩 및 크기 문제 수정
  - [x] Practice.tsx 이미지 크기 확대 (w-full, min-h-[300px] md:min-h-[400px])
  - [x] Test.tsx 이미지 크기 확대 (w-full)
  - [x] 모바일에서 이미지 로딩 안되는 문제 해결 (loading="eager", fetchPriority="high")
  - [x] lazy loading 제거하고 eager loading으로 변경

# 버그 수정 (v1.7.2)
- [x] 연습 모드에서 띄어쓰기 후 즉시 채점 반영
  - [x] normalizeText에서 띄어쓰기 제거 로직 확인
  - [x] getCompletedLength 계산 로직 수정 - 띄어쓰기 시 전체 길이 반환
  - [x] 띄어쓰기 입력 시 이전 글자 채점 반영

# 기능 개선 (v1.8.0)
- [x] 연습 모드 정답 일치 시 동작 개선
  - [x] handleCorrectAnswer 함수 구현 - fade out 애니메이션 및 입력 초기화
  - [x] 정답 글자 fade out 애니메이션 (1.5초)
  - [x] 애니메이션 완료 후 입력 초기화
  - [x] 연습 횟수 증가 로직 추가
  - [x] CSS transition-colors duration-1500 적용

# 버그 수정 (v1.8.1)
- [x] 시험 모드 정확도 계산 로직 수정
  - [x] 서버 채점 로직에서 부분 점수 반영 (문자 단위 일치율)
  - [x] 하나라도 틀리면 0%로 표시되는 문제 수정
  - [x] 텍스트 문제 정확도 계산 개선 (matchCount / maxLength)
  - [x] 이미지 문제 정확도 계산은 이미 라벨별로 정상 작동 중
- [x] 유사도 항목 UI에서 제거
  - [x] Test.tsx 결과 화면에서 유사도 표시 제거
  - [x] 그리드 레이아웃 4칸럼에서 3칸럼으로 변경

# 기능 추가 (v1.8.2)
- [x] 부정행위 방지를 위한 붙여넣기 차단
  - [x] Test.tsx 입력창에서 Ctrl+V 차단
  - [x] Practice.tsx 입력창에서 Ctrl+V 차단 (텍스트 문제 및 메모장)
  - [x] onPaste 이벤트 preventDefault 적용

# 기능 추가 (v1.9.0)
- [x] 시험 모드 화면 이탈 감지 및 경고
  - [x] Test.tsx에 visibilitychange 이벤트 리스너 추가
  - [x] 화면 이탈 시 경고 메시지 표시 (toast.warning)
  - [x] 이탈 횟수 상태 변수 추가 (tabSwitchCount)
  - [x] 데이터베이스 스키마에 tabSwitchCount 필드 추가
  - [x] 서버 채점 로직에 이탈 횟수 저장 (test.evaluate input)
  - [x] 시험 결과 화면에 이탈 횟수 표시 (4칸럼 그리드)

# 버그 수정 (v1.13)
- [x] 한글 조합 중 언더바 위치 버그 수정
  - [x] 'ㄴ', '나'까지 치면 '남산'에 언더바가 쳐지는 현상 고쳐야 함
  - [x] completionInfo 함수에서 isComposing 상태 체크 제거
  - [x] 조합 중인 글자 제외 로직 제거 (isComposing 상태가 정확하지 않으므로)
  - [x] 한글 조합 완료 후 언더바 위치 정확성 검증 완료

# 기능 제거 (v1.9.1)
- [x] 화면 이탈 감지 기능 완전 제거
  - [x] Test.tsx에서 tabSwitchCount 상태 변수 제거
  - [x] Test.tsx에서 visibilitychange 이벤트 리스너 제거
  - [x] Test.tsx에서 결과 화면 이탈 횟수 표시 제거 (3칸럼 그리드로 복구)
  - [x] 데이터베이스 스키마에서 tabSwitchCount 필드 제거
  - [x] 서버 routers.ts에서 tabSwitchCount 파라미터 제거
  - [x] 서버 createTestSession 호출에서 tabSwitchCount 제거 (4곳)

# 기능 개선 (v1.10.0)
- [x] 연습 모드 실시간 채점 로직 개선
  - [x] 한글 자모 분해 유틸리티 함수 구현 (client/src/lib/hangul.ts)
  - [x] 자모 단위 비교로 정확한 일치 판정 (compareJamo)
  - [x] 다음 글자 초성과 현재 글자 종성 비교
  - [x] 실시간 언더바 위치 업데이트 (getCompletedLength)
  - [x] "동해물" 예시: "햄" 입력 시 "해" 검은색 유지

# 버그 수정 (v1.10.1) - 잘못된 수정
- [x] 자모 비교 로직 버그 수정 (잘못된 이해)
  - [x] "동해물과" → "동해묽" 입력 시 "물" 회색 변환 문제
  - [x] "마르고" → "말흐고" 입력 시 "마" 이후 채점 중단 문제
  - [x] compareJamo 함수 수정: nextUserChar 파라미터 추가
  - [x] 다음 사용자 입력 글자의 초성과 중성이 다음 정답 글자와 일치해야만 정답 처리

# 버그 수정 (v1.10.2) - 올바른 수정
- [x] 자모 비교 로직 재수정
  - [x] "동해묽" 입력 시 "물" 정답 유지 (검은색)
  - [x] "말" 입력 시 "마" 정답 유지 (검은색)
  - [x] "말흐" 입력 시 전체 오답 처리 (빨간색) - 자동으로 처리됨
  - [x] compareJamo 함수 로직 단순화: 종성이 다음 글자 초성과 일치하면 일단 정답 인정
  - [x] nextUserChar 파라미터 제거

# 버그 수정 (v1.10.3)
- [x] getCompletedLength 로직 버그 수정
  - [x] "동햄울과" 입력 시 "울" 이후 채점 안되는 문제
  - [x] break 제거하고 끝까지 순회
  - [x] 연속으로 일치하는 마지막 위치 찾기 (completedCount = i + 1)
  - [x] 오답 이후에도 계속 순회하여 빨간색 표시

# 버그 수정 (v1.10.4)
- [x] 종성으로 다음 글자 예약 후 실제 입력 시 검증
  - [x] "동햄울" 입력 시 "울" 입력 순간 "햄" 오답 처리
  - [x] 이전 글자의 종성이 다음 정답 글자 초성과 일치했지만, 실제 입력이 다음 정답 글자와 일치하지 않으면 이전 글자 오답 처리
  - [x] getCompletedLength에서 "예약된 종성" 검증 로직 추가
  - [x] decomposeHangul import 추가

# 버그 수정 (v1.10.5)
- [x] 초성 입력 단계에서도 종성 예약 검증
  - [x] "동햄" 다음 "ㅇ" 입력 순간 "햄" 오답 처리
  - [x] 글자가 완성되기 전 초성만 입력되어도 검증
  - [x] 이전 글자의 종성이 다음 정답 글자 초성과 일치했는데, 실제 입력 초성이 다르면 즉시 오답 처리
  - [x] else 블록에 초성 검증 로직 추가

# 버그 수정 (v1.10.6)
- [x] 종성 예약 실패 시 이전 글자만 빨간색 표시, 언더바는 현재 위치 유지
  - [x] "동햄" 다음 "ㅇ" 입력 시 "해" 빨간색, 언더바는 "물"에 유지
  - [x] completedCount는 그대로 유지 (언더바 위치 변경 안 함)
  - [x] renderTextWithFeedback에서 "종성 예약 실패" 상태를 별도로 표시
  - [x] failedReservationIndex 상태 변수 추가로 "예약 실패" 글자 추적
  - [x] getCompletedLength에서 setFailedReservationIndex 호출
  - [x] renderTextWithFeedback에서 isFailedReservation 조건 추가
  - [x] handleInputChange에서 failedReservationIndex 초기화

# 버그 수정 (v1.10.7)
- [x] 종성 예약 시 언더바가 다음 글자로 이동하도록 수정
  - [x] "동햨" 입력 시 언더바가 "물"에 위치해야 함 (현재 "해"에 멈춤)
  - [x] compareJamo 'partial' 반환 시에도 completedCount 증가
  - [x] 예약 실패 시 이전 글자만 빨간색 표시, 언더바는 현재 위치 유지
  - [x] completionInfo useMemo로 변경하여 completedLength와 failedIndex를 함께 반환
  - [x] renderTextWithFeedback에서 completionInfo를 직접 사용하여 동기화 문제 해결

# 버그 수정 (v1.10.8)
- [ ] 연습 모드 채점 로직 전면 재작성
  - [x] '동' 입력 시 즉시 검은색 표시 및 언더바 '해'로 이동
  - [x] '해' 입력 시 즉시 검은색 표시 및 언더바 '물'로 이동
  - [x] '햨' 입력 시 '해'가 빨간색으로 표시되고 언더바는 '물'에 유지
  - [x] '햨울' 입력 시 '해'가 빨간색, '물'은 회색, 언더바는 '물'에 유지
  - [ ] '햨울과' 입력 시 '해'가 빨간색, '물'이 빨간색, 언더바는 '과'로 이동 (사용자 요구사항 확인 필요)
  - [x] 띠어쓰기 없이도 즉시 채점되도록 수정
  - [x] effectiveUserLength 로직 제거

# 버그 수정 (v1.10.9)
- [x] 정답으로 확정된 글자는 이후 수정되어도 정답 상태 유지
  - [x] "동해물" 입력 후 "묽"으로 변경 시 "물"이 빨간색으로 표시되고, 언더바 "과"에 유지
  - [x] maxCompletedCount 상태 추가하여 최대 완료 글자 수 추적
  - [x] completedCount는 감소할 수 있지만, 렌더링은 maxCompletedCount 기준으로 수행

# 버그 수정 (v1.10.11)
- [x] 채점 로직 완전 재작성 - 정답/오답 판정 정확화
  - [x] isCompleted 조건 제거하여 모든 입력 글자를 정확하게 채점
  - [x] isError를 isCorrect보다 먼저 체크하여 오답을 정확히 표시
  - [x] "동" 입력 시 검은색 표시 ✅
  - [x] "동햄" 입력 시 "동"은 검은색, "해"는 빨간색 ✅
  - [x] "동해물" 입력 시 모두 검은색 ✅
  - [x] "동해묽" 입력 시 "동해물"은 검은색 유지 (정답 확정 상태 유지) ✅

# 한컴타자연습 채점 로직 구현 (v1.10.12)
- [x] 한컴타자연습 스타일 채점 로직 구현
  - [x] 단순 글자 비교: userChar === targetChar
  - [x] 정답: 검은색, 오답: 빨간색, 미입력: 회색
  - [x] 현재 입력 위치: 언더바 표시
  - [x] 스페이스바 채점 제외 (normalizeText로 공백 제거)
  - [x] 종성 예약 로직 완전 제거 (단순화)
  - [x] maxCompletedCount 상태 제거 (단순화)

# 한컴타자연습 채점 로직 정확히 구현 (v1.10.13)
- [x] 조합 중인 글자도 정답 처리
  - [x] "ㄷ", "도" 입력 시 "동"의 일부이므로 검은색 표시
  - [x] 정답 글자의 자모를 포함하고 있으면 정답으로 인정 (isPartialMatch 함수)
- [x] 종성 예약 로직 복원
  - [x] "햨" 입력 시 다음 글자 "물"의 초성 "ㅁ"과 일치하므로 정답 인정
- [x] 언더바는 글자 완성 후에만 이동
  - [x] 조합 중에는 언더바가 현재 위치에 유지
  - [x] 글자가 완전히 완성되면 다음 글자로 이동

# 겹받침 조합 중 정답 처리 (v1.10.14)
- [x] "묽" 입력 시 "물"의 일부로 인정 (조합 중 정답 처리)
  - [x] "묽"(ㅁ+ㅜ+ㄹㄱ)은 "물"(ㅁ+ㅜ+ㄹ)의 모든 자모를 포함
  - [x] isPartialMatch 함수에서 겹받침 처리 추가 (DOUBLE_JONG 매핑)
- [x] 조합 중에는 언더바 유지
- [x] "동해물고" 입력 시 "과"는 회색 (조합 중)

# 조합 중 글자 정답 처리 개선 (v1.10.15)
- [ ] "물" → "묽" 입력 시 언더바가 "과"에 유지 (현재는 "물"로 돌아옴)
- [ ] "동해물고" 입력 시 "과"가 검은색 (현재는 빨간색)
  - [ ] "고"는 "과"의 초성+중성이 일치하므로 정답의 일부
- [ ] "닳"에서 "달" 입력 시 검은색 (현재는 빨간색)
  - [ ] "달"은 "닳"의 초성+중성+종성(ㄹ)이 일치하므로 정답의 일부

# 조합 중 글자 정답 처리 개선 (v1.10.15)
- [x] "물" → "묽" 입력 시 언더바가 "과"에 유지 (partial_complete 반환)
- [x] "동해물고" 입력 시 "과"가 검은색 (복합 모음 조합 중 정답 처리)
  - [x] "고"는 "과"의 초성+중성이 일치하므로 정답의 일부 (partial)
- [x] "닳"에서 "달" 입력 시 검은색 (겹받침 조합 중 정답 처리)
  - [x] "달"은 "닳"의 초성+중성+종성(ㄹ)이 일치하므로 정답의 일부 (partial)
- [x] isPartialMatch 함수에 복합 모음 조합 중 처리 추가 (ㅗ→ㅘ, ㅜ→ㅝ, ㅡ→ㅢ)
- [x] isPartialMatch 함수에 겹받침 조합 중 처리 추가 (ㄹ→ㅀ 등)
- [x] partial_complete 반환 타입 추가 (겹받침 조합 중이지만 현재 글자는 완성됨)
- [x] 단위 테스트 39개 작성 및 통과 (server/hangul.test.ts)

# 영어 대소문자 구분 제거 및 문제 추가 버그 수정 (v1.10.16)
- [ ] 영어 대소문자 구분 제거 (채점 시 대소문자 무시)
  - [ ] isPartialMatch 함수에서 영문자 대소문자 무시 처리
  - [ ] 한글은 대소문자 없으므로 영문자만 처리
  - [ ] 테스트: "Hello" 입력 시 "hello" 정답 처리
- [ ] 문제 추가 시 난이도 수정 버그 수정
  - [ ] Questions.tsx에서 난이도 변경 시 formData 초기화 문제 확인
  - [ ] 난이도 변경 시 질문과 답안 유지되도록 수정
  - [ ] 테스트: 난이도 변경 후 질문/답안 입력 값 확인

# 영어 대소문자 구분 제거 및 문제 추가 버그 수정 (v1.10.16) - 완료
- [x] 영어 대소문자 구분 제거 (채점 시 대소문자 무시)
  - [x] isPartialMatch 함수에서 영문자 대소문자 무시 처리 (toLowerCase 사용)
  - [x] 한글은 대소문자 없으므로 영문자만 처리
  - [x] 테스트: "Hello" 입력 시 "hello" 정답 처리 (42개 테스트 모두 통과)
- [x] 문제 추가 시 난이도 수정 버그 수정
  - [x] Questions.tsx에서 Textarea를 controlled input으로 변경
  - [x] formData 상태로 질문/답안 관리
  - [x] 난이도 변경 시에도 질문과 답안 유지
  - [x] handleCreate 함수에서 formData 사용
  - [x] 더 이상 필요 없는 ref 제거 (fileInputRef만 유지)

# 버그 수정 (v1.10.17)
- [ ] 문제 추가 시 입력 끊김 현상 수정
  - [ ] Questions.tsx Textarea의 onChange 이벤트 최적화
  - [ ] 입력 후 포커스 유지 확인
  - [ ] 타자 하나씩 입력 가능하도록 수정
- [ ] 정답 마지막 글자 채색 오류 수정
  - [ ] Practice.tsx의 getCompletedLength 로직 확인
  - [ ] 마지막 글자도 정답 여부에 따라 검은색/빨간색 표시
  - [ ] 마지막 글자 입력 후 자동 초기화 작동 확인
- [ ] 영어 문제 자동 초기화 기능 추가
  - [ ] Practice.tsx에서 영어 문제도 정답 일치 시 자동 초기화
  - [ ] handleCorrectAnswer 함수가 영어에도 작동하도록 수정
  - [ ] 테스트: 영어 정답 입력 시 fade out 및 초기화 확인


# 버그 수정 (v1.10.17) - 완료
- [x] 문제 추가 시 입력 끊김 현상 수정
  - [x] Questions.tsx Textarea onChange를 useCallback으로 최적화
  - [x] handleQuestionChange, handleAnswerChange, handleDifficultyChange 함수 추가
  - [x] 타자 하나씩 입력 가능하도록 수정
- [x] 정답 마지막 글자 채색 오류 수정
  - [x] completionInfo에 lastCharMatchResult 추가
  - [x] 마지막 글자도 정답 여부에 따라 검은색/빨간색 표시
  - [x] 마지막 글자 입력 후 자동 초기화 작동
- [x] 영어 문제 자동 초기화 기능 확인
  - [x] Practice.tsx에서 영어 문제도 정답 일치 시 자동 초기화 (이미 구현됨)
  - [x] handleCorrectAnswer 함수가 영어에도 작동
  - [x] 정규화 로직이 영어에 제대로 작동 (공백 제거)


# 마지막 글자 채색 버그 수정 (v1.10.18)
- [x] 마지막 글자가 회색으로 유지되는 문제 수정
  - [x] renderTextWithFeedback에서 마지막 글자 감지 추가
  - [x] 마지막 글자일 때 lastCharMatchResult 사용
  - [x] 정답이면 검은색, 오답이면 빨간색으로 표시
  - [x] 자동 초기화 시에도 마지막 글자가 검은색으로 칠해짐


# 마지막 글자 채색 및 오타 시 언더바 위치 버그 수정 (v1.10.19)
- [x] 마지막 글자가 여전히 검은색으로 안 칠해지는 문제 재수정
  - [x] lastCharMatchResult 로직 재확인
  - [x] renderTextWithFeedback에서 마지막 글자 처리 로직 수정
  - [x] 정답 마지막 글자 입력 시 즉시 검은색 표시
- [x] 오타 발생 시 언더바 위치 오류 수정
  - [x] "동행" 입력 시 언더바가 "물"로 이동 (completedCount = i + 1)
  - [x] "동행물" 입력 시 언더바가 "과"로 이동
  - [x] 오타 후 글자 조합 중일 때도 언더바 위치 정확히 표시
  - [x] completionInfo의 completedCount 계산 로직 수정 (break 제거)


# Ctrl+V 기능 방지 임시 주석처리 (v1.10.20)
- [x] Practice.tsx의 onPaste 주석처리
  - [x] 연습 메모장 textarea의 onPaste 주석처리
  - [x] 사용자 입력 textarea의 onPaste 주석처리
  - [x] TODO 주석 추가: 테스트 완료 후 활성화


# Questions.tsx 입력 끊김 현상 재수정 (v1.10.21)
- [x] 문제 추가 시 타자 하나만 입력되고 끊기는 현상 수정
  - [x] QuestionForm 함수를 questionFormContent 변수로 변경
  - [x] 컴포넌트 내부 함수 정의로 인한 리렌더링 문제 해결
  - [x] Textarea 포커스 유지 확인


# 과목 내 문제 드래그 앤 드롭 순서 변경 (v1.10.22)
- [x] 데이터베이스 스키마 수정
  - [x] questions 테이블에 displayOrder 컴럼 추가
- [x] API 수정
  - [x] questions.listBySubject에서 displayOrder 기준 정렬
  - [x] questions.updateOrder 프로시저 추가
- [x] Questions.tsx UI 수정
  - [x] @dnd-kit 라이브러리 적용
  - [x] SortableQuestionCard 컴포넌트 추가
  - [x] 드래그 핸들 (GripVertical) 추가
  - [x] handleDragEnd 이벤트 처리
  - [x] 순서 변경 시 updateOrderMutation 호출


# 문제 복사/이동 및 시험기간 후 자동 삭제 기능 (v1.10.23)
- [x] 데이터베이스 스키마 수정
  - [x] subjects 테이블에 examEndDate 컴럼 추가
- [x] API 수정
  - [x] questions.copy 프로시저 추가 (문제 복사)
  - [x] questions.move 프로시저 추가 (문제 이동)
  - [x] subjects.create/update에 examEndDate 필드 추가
  - [x] expiring.getQuestions/cleanup API 추가
- [x] UI 수정
  - [x] Questions.tsx에 복사/이동 버튼 추가
  - [x] 복사/이동 다이얼로그 추가
  - [x] Subjects.tsx에 시험 종료일 입력 필드 추가
- [x] 자동 삭제 로직
  - [x] deleteExpiredQuestions 함수 구현
  - [x] getExpiringQuestions 함수 구현 (만료 예정 문제 조회)


# 과목 내 문제 난이도 필터 기능 (v1.10.24)
- [x] Questions.tsx에 난이도 필터 버튼 추가
  - [x] 전체/쉬움/보통/어려움 필터 버튼 UI
  - [x] difficultyFilter 상태 관리 (useState)
  - [x] 필터링된 문제 목록 표시
  - [x] 필터 해제 기능 (전체 버튼)


# 연습 모드 삭제 단축키 기능 (v1.10.25)
- [x] 삭제 단축키 기능 추가
  - [x] Ctrl+Backspace: 단어 삭제 (브라우저 기본 동작)
  - [x] Shift+Backspace: 문장 삭제 (마지막 줄 삭제)
  - [x] Ctrl+Shift+Backspace: 전체 삭제
- [x] 단축키 설명 UI 추가
  - [x] 화면 하단에 kbd 태그로 단축키 안내 표시


# 시험 모드 단축키 및 토글 옵션 (v1.10.26)
- [x] 시험 모드(Test.tsx)에 삭제 단축키 기능 추가
  - [x] Ctrl+Backspace: 단어 삭제 (브라우저 기본)
  - [x] Shift+Backspace: 문장 삭제
  - [x] Ctrl+Shift+Backspace: 전체 삭제
  - [x] 단축키 안내 UI 추가
- [x] 단축키 토글 옵션 구현
  - [x] localStorage에 showShortcutHelp 설정 저장
  - [x] Practice.tsx, Test.tsx에 토글 버튼 추가
  - [x] 숨기기/보기 버튼으로 단축키 안내 표시/숨김


# Ctrl+Backspace 단어 삭제 개선 (v1.10.27)
- [x] 브라우저 기본 동작 대신 띄어쓰기 단위 단어 삭제로 변경
  - [x] Practice.tsx handleKeyDown에 Ctrl+Backspace 로직 추가
  - [x] Test.tsx handleKeyDown에 Ctrl+Backspace 로직 추가
  - [x] 띄어쓰기 없으면 전체 삭제, 있으면 마지막 단어만 삭제


# 한글 조합 중 Ctrl+Backspace 수정 (v1.10.28)
- [x] 한글 조합 중에도 Ctrl+Backspace가 단어 단위로 삭제되도록 수정
  - [x] Practice.tsx: textarea.value로 현재 값 직접 가져와서 삭제
  - [x] Test.tsx: 동일하게 적용
  - [x] textarea blur/focus로 조합 강제 종료 후 삭제 처리


# Alt+Backspace로 단어 삭제 변경 (v1.10.29)
- [x] Ctrl+Backspace 대신 Alt+Backspace로 단어 삭제 기능 변경
  - [x] Practice.tsx handleKeyDown 수정 (e.altKey로 변경)
  - [x] Test.tsx handleKeyDown 수정 (e.altKey로 변경)
  - [x] 단축키 안내 UI 업데이트 (Ctrl → Alt)


# 단축키 수정 (v1.10.30)
- [x] Shift+Backspace → Alt+Shift+Backspace로 문장 삭제 변경
- [x] Ctrl+Shift+Backspace 기능 삭제
- [x] 단축키 안내 텍스트 수정 (Ctrl+A+Backspace 전체 삭제)


# Shift+Backspace 문장 삭제 복원 (v1.10.31)
- [x] Alt+Shift+Backspace → Shift+Backspace로 문장 삭제 복원
- [x] 한글 조합 중에도 Shift+Backspace가 작동하도록 blur/focus 처리
- [x] 단축키 안내 UI 업데이트


---

# 사용자 신규 요청 사항 (v1.11.0)

## Phase 1: 긴급 버그 수정
- [x] 그림 문제에서 Shift+Backspace 오류 수정
  - [x] Shift+Backspace 후 Alt+Backspace 시 Ctrl+Z 효과 발생 문제
  - [x] 텍스트 문제에서 Shift+Backspace 글자 단위 삭제 문제
- [x] 초성 입력 시 겹받침 방지 (ㅁㄹㄱ → ㄹㄱ 합쳐지는 문제)
  - [x] 마르고 입력 시 'ㅁㄹㄱ'에서 'ㄹㄱ'이 합쳐지는 현상 방지

## Phase 2: Ctrl+V 붙여넣기 방지 코드 삭제
- [x] Practice.tsx에서 onPaste 핸들러 완전 제거
- [x] Test.tsx에서 onPaste 핸들러 완전 제거
- [x] 주석 처리된 코드 삭제 (테스트 완료)

## Phase 3: 실행 취소(Undo) 기능 구현
- [x] Ctrl+Z로 삭제된 문장/단어 복원 기능
- [x] 입력 히스토리 스택 관리 (최근 10개 상태 유지)
- [x] Practice.tsx, Test.tsx 모두 적용
- [x] 단축키 안내에 Ctrl+Z 추가

## Phase 4: 누적 연습 횟수 표시
- [x] 현재 연습 횟수 외에도 총 연습 횟수(누적) 표시
- [x] Practice 페이지에 누적 횟수 UI 추가
- [x] 통계 대시보드에서도 누적 횟수 확인 가능하도록 개선

## Phase 5: 입력 시간 알림 기능
- [x] 60초 이상 키 입력이 없을 때 자동 표시
- [x] 알림 텍스트: "입력이 없어 연습 시간 기록이 일시 정지되었습니다. 입력을 시작하면 자동으로 다시 기록됩니다."
- [x] 위치: 연습 화면 우측 하단
- [x] 스타일: 작은 크기, 중립적 색상 (회색/연한 블루), 페이드 인/아웃만 허용
- [x] 입력 시작 시 자동으로 사라짐
- [x] 사용자가 직접 닫을 수 있는 UI 제공 금지

## Phase 6: 시야 제한 뷰포트 모드
- [x] 연습 모드 전용 옵션 추가 (시험 모드 제외)
- [x] 현재 입력 줄 ±1줄: opacity 1.0
- [x] 그 외 줄: opacity 0.25 ~ 0.4
- [x] blur, 애니메이션, 깜빡임 없음
- [x] 커서 이동 시 강조 영역 즉시 이동
- [x] 한글 IME 조합 중에는 스타일 변경 금지

## Phase 7: 문장 단위 답안 분할 및 번호 기반 입력
- [x] 엔터(줄 바꿈) 기준으로 답안 분할
- [x] 각 줄을 독립된 답안 단위로 취급 (1번, 2번, 3번...)
- [x] 번호 자동 부여 옵션 (문제 추가 시)
  - [x] ON (기본값): 시스템이 자동으로 번호 부여
  - [x] OFF: 출제자가 번호를 포함한 텍스트 직접 작성
- [x] 각 번호는 독립 입력 칸으로 표시
- [x] Enter 키: 현재 번호 입력 종료 → 다음 번호로 이동
- [x] 번호 건너뛰기 허용 (1번 비워둔 채 2번부터 입력 가능)
- [x] 연습 모드: 특정 번호만 선택해 집중 연습 가능
- [x] 시험 모드: 번호 순서 강제 금지, 각 번호 개별 채점
- [x] 부분 입력 정답 처리 금지 (해당 번호 전체 문장/문단이 기준에 맞아야 정답)

## Phase 8: 초성 허용 로직 버그 수정
- [x] 초성 입력 시 1 입력 = 1 정답 문자 대응 (절대 조건)
- [x] 초성 입력이 이전/이후 문자 범위로 확장되지 않도록 수정
- [x] 언더바/placeholder가 연쇄적으로 활성화되지 않도록 수정
- [x] 겹받침 방지: 'ㅁㄹㄱ'에서 'ㄹㄱ'이 합쳐지는 현상 방지
- [x] 초성 입력 시 실제 정답 문자는 즉시 노출하지 않음
- [x] 입력 실패 시 해당 위치에서만 피드백

## Phase 9: 전체 테스트 및 최종 체크포인트
- [x] 모든 기능 통합 테스트
- [x] 한글 조합 중 모든 단축키 정상 작동 확인
- [x] 최종 체크포인트 생성


---

# 기능 제거 및 재구현 (v1.11.1)

## Phase 1: 기존 기능 제거
- [ ] 시야 제한 뷰포트 모드 제거 (Shift+V 토글)
  - [ ] Practice.tsx에서 viewportMode 상태 제거
  - [ ] Practice.tsx에서 onMouseMove 이벤트 제거
  - [ ] Practice.tsx에서 Shift+V 단축키 제거
  - [ ] Practice.tsx에서 뷰포트 모드 UI 제거
- [ ] 문장 분할 모드 제거 (다음/이전 버튼)
  - [ ] Practice.tsx에서 sentenceMode 상태 제거
  - [ ] Practice.tsx에서 currentSentence 상태 제거
  - [ ] Practice.tsx에서 문장 분할 로직 제거
  - [ ] Practice.tsx에서 문장 모드 UI 제거
  - [ ] Practice.tsx에서 문장 모드 네비게이션 제거

## Phase 2: 실시간 단어 뷰 구현
- [ ] 패시브 디폴트 모드로 구현
  - [ ] 연습 모드에서 항상 활성화
  - [ ] 토글 옵션 없음
  - [ ] 다음 입력할 단어 강조 표시

## Phase 3: 문제 생성 시 번호 자동 분할 옵션
- [ ] 데이터베이스 스키마 수정
  - [ ] questions 테이블에 autoNumbering 컬럼 추가 (기본값: true)
- [ ] Questions.tsx에 체크박스 추가
  - [ ] "엔터 기준으로 답안 번호 자동 생성" 옵션
- [ ] 문제 생성/수정 API 수정
  - [ ] autoNumbering 필드 저장

## Phase 4: 연습 모드 구현
- [ ] 모든 번호를 한 화면에 표시
  - [ ] 번호별 독립 입력 칸 렌더링
  - [ ] 각 번호의 정답 상태 독립 관리
- [ ] Enter 키 동작
  - [ ] 번호 간 자유로운 이동
  - [ ] 번호 건너뛰기 허용

## Phase 5: 시험 모드 구현
- [ ] 번호별 독립 채점
  - [ ] 각 번호 개별 평가
  - [ ] 한 번호의 오답이 다른 번호에 영향 없음

## Phase 6: 전체 테스트 및 최종 체크포인트
- [ ] 모든 기능 통합 테스트
- [ ] 최종 체크포인트 생성


---

# 기능 제거 및 재구현 (v1.11.1)

## Phase 1-2: 기존 기능 제거
- [x] 시야 제한 뷰포트 모드 (Shift+V 토글) 완전 제거
- [x] 문장 분할 모드 (다음/이전 버튼) 완전 제거
- [x] 모든 관련 상태 변수, 함수, UI 제거

## Phase 3: 실시간 단어 뷰 (패시브 모드)
- [x] 완료된 줄: opacity 1.0 (선명함)
- [x] 현재 입력 중인 줄: opacity 1.0 (선명함)
- [x] 아직 입력하지 않은 줄: opacity 0.4 (희미함)
- [x] 텍스트 문제에만 적용 (이미지 문제 제외)
- [x] 패시브 모드 (항상 활성화, 토글 없음)

## Phase 4: 문제 생성 시 번호 자동 분할 옵션
- [x] 데이터베이스 스키마: autoNumbering 컬럼 추가
- [x] Questions.tsx: 체크박스 UI 추가
- [x] server/routers.ts: create/update 프로시저 수정
- [x] 문제 생성/수정 시 autoNumbering 값 저장

## Phase 5: 연습 모드 - 모든 번호 한 화면에 표시
- [ ] autoNumbering=1인 경우 답안을 엔터 기준으로 분할
- [ ] 각 번호별 독립 입력 칸 렌더링
- [ ] 각 번호 단위로 독립 채점
- [ ] 연습 시간/통계는 실제 입력이 발생한 번호에만 반영

## Phase 6: 시험 모드 - 번호별 독립 채점
- [ ] 번호 순서 입력 강제 금지
- [ ] 각 번호는 제출 시점에 개별 채점
- [ ] 한 번호의 오답이 다른 번호 채점에 영향 금지
- [ ] 부분 입력 정답 처리 금지

## Phase 7: Enter 키 동작 - 번호 간 자유로운 이동
- [ ] Enter 키로 현재 번호 입력 종료
- [ ] 다음 번호 입력 칸으로 자동 이동
- [ ] 비어 있는 번호도 Enter로 이동 가능
- [ ] 번호를 건너뛰는 입력 허용

## Phase 8: 전체 테스트 및 최종 체크포인트
- [ ] 모든 기능 통합 테스트
- [ ] 번호 기반 입력 정상 작동 확인
- [ ] 최종 체크포인트 생성


---

# 실시간 단어 뷰 버그 수정 (v1.11.2)

- [x] 줄 단위 opacity 계산 로직 수정
  - [x] 첫 번째 줄: 정상 작동 확인
  - [x] 두 번째 줄부터: 미입력 시 연한 회색 (opacity 0.4)
  - [x] 현재 입력 중인 줄: 회색 (opacity 1.0)
  - [x] 입력 완료된 줄: 검은색 (opacity 1.0)
  - [x] 오답 입력: 빨간색 (opacity 1.0)


---

# 실시간 단어 뷰 개선 (v1.11.3)

- [x] 언더바 위치 기반 opacity 계산
  - [x] 언더바가 있는 줄: opacity 1.0 (회색)
  - [x] 입력이 시작된 줄: opacity 1.0 (회색)
  - [x] 아직 입력하지 않은 줄: opacity 0.4 (연한 회색)


---

# Enter 키 버그 수정 (v1.12.3)

## 문제점
- Enter 키가 공백처럼 처리됨
- 줄바꿈이 실제로 입력되지 않음
- 뷰포트 이동이 작동하지 않음

## 수정 사항
- [ ] Enter 키 입력 시 실제 줄바꿈(\n) 입력 확인
- [ ] normalizeText 함수에서 줄바꿈 처리 확인
- [ ] 뷰포트 이동 로직 확인


---

# 줄 단위 비교 로직 재설계 (v1.12.4)

## 문제점
- 현재: 전체 텍스트를 하나의 연속된 문자열로 비교
- 1번 줄 건너뛰고 Enter 치면 2번 줄이 아닌 1번 줄 위치에서 비교 계속됨
- 사용자 입력 줄과 정답 줄이 1:1 대응되지 않음

## 수정 사항
- [ ] 사용자 입력의 N번째 줄 → 정답의 N번째 줄과 비교
- [ ] renderTextWithFeedback 함수 줄 단위로 수정
- [ ] 빈 줄로 Enter 시 해당 줄은 비어있는 상태로 다음 줄로 이동
- [ ] 정답 판정도 줄 단위로 수정


# 줄 단위 색상 개선 (v1.12.5)
- [ ] 현재 줄(입력해야 할 줄): 더 진한 회색으로 표시
- [ ] 입력 중인 줄: 검은색으로 표시
- [ ] 미입력 줄: 연한 회색(opacity 0.4)으로 표시


# 한글 조합 중 언더바 위치 버그 수정 (v1.12.29)
- [x] handleInputChange에서 isComposing 체크 추가
  - [x] 한글 조합 중에는 상태 업데이트 스킵
  - [x] handleCompositionEnd에서만 userChars 업데이트
  - [x] 조합 중인 글자가 userChars에 포함되지 않아 언더바 위치 정확함
- [x] 모든 231개 단위 테스트 통과
- [x] 브라우저 테스트: '남산' 입력 시 언더바 정확한 위치 확인


# 테스트 과목 정리 (v1.12.30)
- [x] 불필요한 테스트 과목 삭제
  - [x] 수학, 역사, 과학, 영어, 테스트 과목 등 중복 과목 삭제
  - [x] 총의치, 금관, 국소, 치주, 해부, 소아만 유지
  - [x] SQL 쿼리로 직접 정리


# 버그 수정 (v1.9.1)
- [x] 텍스트 문제 입력 불가 버그 수정
  - [x] isComposing 상태가 true로 고정되는 문제 원인 파악
  - [x] handleInputChange에서 nativeEvent.isComposing 우선 사용
  - [x] 상태 기반 체크만으로는 부족한 문제 해결
  - [x] 모든 과목의 텍스트 문제에서 입력 정상 작동 확인


# 버그 수정 (v1.9.2) - 진행 중
- [ ] 한영키 전환 시 입력 불가 버그 수정
  - [ ] 영어 입력 후 한영키 누르면 입력 안됨
  - [ ] 다시 영어로 전환해도 입력 먹통
  - [ ] isComposing 상태가 제대로 리셋되지 않는 문제
  - [ ] compositionend 이벤트가 발생하지 않는 경우 처리


# 최종 수정 (v1.14)
- [x] 언더바 위치가 정답 글자와 일치하지 않는 버그 완전 해결
  - [x] renderTextWithFeedback에서 completedCount 기준으로 언더바 위치 결정
  - [x] 정답 글자와 일치할 때만 언더바 이동
  - [x] 틀린 글자 입력 시 언더바가 정답 위치에 정확하게 표시됨 확인


# 버그 수정 (v1.15) - 진행 중
- [ ] 줄 단위 opacity 표시 버그 수정
  - [ ] 현재 입력 중인 줄만 진한 회색으로 표시되어야 함
  - [ ] 나머지 줄은 연한 회색으로 표시되어야 함
  - [ ] 엔터 후 다음 줄로 이동할 때 opacity 업데이트 안 됨
  - [ ] calculateLineOpacity 함수 로직 확인 및 수정


# 버그 수정 (v1.16) - 완료
- [x] 줄 단위 opacity 표시 버그 수정
  - [x] calculateLineOpacity 함수에서 underbarLineIndex만 기준으로 변경
  - [x] 현재 입력 중인 줄만 opacity 1 (진한 회색)
  - [x] 나머지 줄은 opacity 0.4 (연한 회색)
  - [x] 엔터 후 다음 줄로 이동할 때 opacity 정확하게 업데이트됨 확인


# 최종 수정 (v1.17) - 완료
- [x] 줄 단위 opacity 표시 버그 최종 수정
  - [x] calculateLineOpacity 함수에서 completionInfo.currentLineIndex 사용
  - [x] 현재 입력 중인 줄만 opacity 1 (진한 회색)
  - [x] 완료된 줄과 미입력 줄은 opacity 0.4 (연한 회색)
  - [x] 엔터 후 다음 줄로 이동할 때 이전 줄의 회색이 자동으로 연해짐 확인


# 버그 수정 (v1.21) - 진행 중
- [ ] 언더바가 각 줄마다 남아있는 버그 수정
  - [ ] 다른 문장으로 넘어갔을 때 이전 문장의 언더바가 남아있음
  - [ ] 언더바는 현재 커서 위치의 다음 글자에만 표시되어야 함
  - [ ] renderTextWithFeedback에서 underbarLineIndex와 completedCount 기반으로만 언더바 표시
  - [ ] 커서 위치 변경 시 underbarLineIndex 동적 업데이트


# 버그 수정 (v1.23) - 진행 중
- [ ] 영어 문제에서 정답 입력 후 연습 완료가 인식되지 않는 버그 수정
  - [ ] 정답을 다 입력해도 연습 완료가 안됨
  - [ ] 완료 버튼을 눌러도 다음 문제로 진행되지 않음
  - [ ] Ctrl+C, Ctrl+V를 해야만 연습이 인정됨
  - [ ] 한글 문제는 정상 작동하는데 영어 문제만 문제 발생


# 버그 수정 (v1.24) - 진행 중
- [ ] 영어 문제: 처음부터 직접 입력 시 정답 인식 후 초기화 안 됨
  - [ ] Ctrl+C/V 후 나머지 입력 시에는 정상 작동
  - [ ] 처음부터 직접 타이핑하면 정답 인식은 되지만 초기화 안 됨
  - [ ] handleInputChange vs handleCompositionEnd 이벤트 차이 분석
  - [ ] 입력 방식별 코드 경로 차이 파악 및 수정


# 표 문제 유형 추가 (v2.0.0)

## Phase 1: 데이터베이스 스키마 수정
- [x] questions 테이블에 tableData 컬럼 추가 (JSON 형태로 표 데이터 저장)
- [x] questionType 필드에 'table' 유형 추가 (text, image, table)
- [x] 마이그레이션 실행

## Phase 2: 서버 API 수정
- [x] questions.create 프로시저에 tableData 필드 추가
- [x] questions.update 프로시저에 tableData 필드 추가
- [x] questions.getById에서 tableData 반환

## Phase 3: 표 편집기 UI 컴포넌트
- [x] TableEditor 컴포넌트 구현
- [x] 행/열 자유 추가/삭제 기능
- [x] 셀 병합 기능
- [x] 셀별 정답 입력 기능
- [x] 셀별 가림 여부 설정 (연습/시험 시 빈칸으로 표시할 셀 지정)
- [x] 드래그로 셀 크기 조정

## Phase 4: Questions.tsx 통합
- [x] 문제 생성 다이얼로그에 '표' 탭 추가
- [x] 표 편집기 연동
- [x] 표 문제 미리보기

## Phase 5: 연습 모드 지원
- [x] Practice.tsx에서 표 문제 렌더링
- [x] 가려진 셀에 입력 필드 표시
- [x] 셀별 정답 비교 및 채점

## Phase 6: 시험 모드 지원
- [x] Test.tsx에서 표 문제 렌더링
- [x] 가려진 셀에 입력 필드 표시
- [x] 셀별 채점 로직

## Phase 7: 테스트 및 검증
- [x] 표 문제 생성/수정/삭제 테스트
- [x] 연습/시험 모드 통합 테스트
