# numbering.pro

서술형·표·그림 문제를 직접 타이핑하면서 외우는 암기 학습 플랫폼입니다.
과목과 문제를 만들고, 연습 모드로 반복 입력한 뒤 시험 모드로 회상해 채점하며, 학습 통계와 암기 자신감 지표로 복습 시점을 확인합니다.

## 기술 스택

- 클라이언트: React 19, Vite 7, Tailwind CSS 4, wouter, TanStack Query
- 서버: Express, tRPC 11, Drizzle ORM (MySQL)
- 배포: Vercel (`api/[...path].ts` 서버리스 함수 + 정적 빌드)
- 테스트: Vitest

## 폴더 구조

```txt
client/    React 앱 (pages, components, lib)
server/    Express + tRPC 라우터, OCR, 업로드, 이미지 프록시
shared/    클라이언트·서버 공용 로직 (채점, 자신감 계산 등)
drizzle/   DB 스키마와 마이그레이션
api/       Vercel 서버리스 진입점
scripts/   로컬 DB, 백업, 데모 데이터 관리 스크립트
```

## 로컬 실행

Node.js 22 이상과 pnpm 11이 필요합니다. `corepack enable` 을 실행하면 `package.json` 의 `packageManager` 에 맞는 pnpm 이 자동으로 쓰입니다.

```bash
corepack enable
pnpm install
cp .env.example .env    # 값 채우기 (최소 DATABASE_URL, JWT_SECRET)
pnpm dev                # 로컬 MySQL 을 띄우고 http://localhost:3000 에서 실행
```

`pnpm dev` 는 `.env` 가 운영 DB 를 가리키더라도 항상 로컬 MySQL(`LOCAL_DATABASE_URL`, 기본값 `mysql://app:app_pw@127.0.0.1:3306/typing_quiz_app`)을 사용합니다. MySQL 바이너리가 없으면 `scripts/start-local-mysql.sh` 가 설치 방법을 안내합니다.

스키마를 로컬 DB 에 반영하려면:

```bash
pnpm local:db:push
```

## 주요 명령

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | 로컬 개발 서버 |
| `pnpm check` | 타입 검사 (`tsc --noEmit`) |
| `pnpm test` | 단위 테스트 |
| `pnpm build` | 클라이언트·서버 프로덕션 빌드 |
| `pnpm start` | 빌드 결과 실행 |
| `pnpm db:push` | `DATABASE_URL` 대상 DB 에 스키마 반영 |
| `pnpm local:backup` / `pnpm local:restore` | 로컬 데이터 백업·복원 |
| `pnpm deploy` | Vercel 프로덕션 배포 |

## 환경 변수

전체 목록과 설명은 [`.env.example`](.env.example) 에 있습니다. 실제 값은 `.env` 나 호스팅 환경 변수에만 두고 저장소에는 올리지 않습니다.

- 필수: `DATABASE_URL`, `JWT_SECRET` (운영에서는 32자 이상)
- 로그인: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- 선택: OCR(`GCP_*`, `TESSERACT_*`), 업로드 저장소, 분석 도구

## CI

`main` 푸시와 PR 마다 GitHub Actions 가 타입 검사, 테스트, 빌드를 실행합니다 (`.github/workflows/ci.yml`). 배포는 `vercel-deploy.yml` 이 담당합니다.
