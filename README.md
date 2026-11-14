# my-budget-backend

개인용 iOS 가계부 앱을 위한 독립적인 Node.js + Express + TypeScript 백엔드입니다. 현재 범위는 `/health`, 환경변수 검증, Prisma ORM 7 + MySQL 스키마, 초기 마이그레이션 및 기본 카테고리 Seed입니다.

## 요구사항

- Node.js 24 LTS 권장 (`.nvmrc`), 또는 Node.js 22.12 이상 22.x
- npm, MySQL 8.4 LTS 권장 (최소 8.0.16: CHECK 제약조건 사용)
- 패키지 버전은 `package-lock.json`에 고정되어 있습니다.

Prisma CLI·Client·MySQL 어댑터는 **7.10.1**로 통일했습니다. ESM, `prisma-client` 생성기, 명시적 출력 경로, `prisma.config.ts`의 datasource URL 및 `@prisma/adapter-mariadb`를 사용합니다. MariaDB 드라이버는 어댑터의 의존성으로 설치되며 MySQL에 연결합니다.

공식 문서: [Prisma 7 설정](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [MySQL 연결](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql), [사용자 정의 마이그레이션](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/unsupported-database-features).

## 프로젝트 구조

```text
prisma/
  schema.prisma
  migrations/                  # 초기 DDL, CHECK, 유형 변경 금지 트리거
  seed-categories.ts           # iOS와 같은 기본 카테고리 10개
  seed.ts
src/
  config/env.ts                # dotenv 로딩 및 환경변수 검증
  db/prisma.ts                 # MySQL 어댑터 및 단일 Prisma Client
  domain/ledger.ts             # 금액·날짜 변환, 정규화, 프론트엔드 DTO
  generated/prisma/            # 자동 생성, Git 제외
  app.ts                       # GET /health
  server.ts                    # DB 연결 후 서버 시작, 종료 처리
tests/
  *.test.ts                    # 환경변수, DTO·검증, HTTP 테스트
  db/schema.test.ts            # 로컬 DB 통합 검증, 검증 데이터 롤백
prisma.config.ts
tsconfig.json
tsconfig.build.json
```

CRUD 모듈과 빈 디렉터리는 아직 만들지 않았습니다.

## 설치 및 환경변수

프로젝트 루트에서 실행합니다.

```sh
nvm use
cp .env.example .env
# 아래 설명에 따라 .env의 로컬 DB 계정을 설정합니다.
npm ci
npm run db:generate
```

| 변수 | 예시 | 검증 |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` 중 하나 |
| `HOST` | `127.0.0.1` | IP 또는 호스트 이름 |
| `PORT` | `3000` | 1~65535 정수 |
| `DATABASE_URL` | `mysql://budget_dev:password@127.0.0.1:3306/my_budget_dev` | MySQL URL, 사용자·호스트·DB 필수 |

네 변수 모두 필수입니다. 누락되거나 잘못되면 시작 단계에서 변수 이름과 오류를 표시합니다. 비밀번호 등 인증정보는 오류 메시지에 출력하지 않습니다. 비밀번호의 `@`, `#`, `/`, `%` 등은 URL 인코딩해야 합니다. DB 이름은 영문·숫자·밑줄을 지원하며, 빈 비밀번호는 로컬 개발 계정에서 사용할 수 있습니다.

개발 실행, 빌드 시 Client 생성, 빌드된 서버, Prisma CLI 및 Seed 모두 `src/config/env.ts`로 루트의 `.env`를 로딩합니다. 이미 주입된 환경변수가 `.env`보다 우선합니다. `npm ci`는 DB 연결이나 Client 생성을 실행하지 않습니다. 이후 `db:generate` 또는 `build`를 실행하세요. 빌드에도 네 환경변수가 필요하지만 실제 DB 접속은 필요하지 않습니다.

현재 URL의 쿼리 옵션은 지원하지 않고 명확한 오류로 거부합니다. Prisma CLI와 런타임 어댑터가 같은 연결 정보를 사용하도록 하기 위함입니다. 연결 풀 5개, 연결·획득 제한시간 5초, UTC는 `src/db/prisma.ts`에 설정되어 있습니다. 운영용 TLS·연결 풀 조정은 배포 단계에서 CLI와 어댑터 양쪽에 맞춰 추가해야 합니다.

`.env`, `.env.*`, 개인 인증서·키, `.aws`, `node_modules`, `dist`, 생성 Client는 Git에서 제외됩니다. `.env.example`과 `package-lock.json`, 마이그레이션은 버전 관리합니다.

## 로컬 MySQL 준비 및 마이그레이션

MySQL을 설치·실행한 뒤 로컬 관리자 계정으로 아래 SQL을 실행합니다. 비밀번호는 예시를 실제 로컬 개발용 값으로 바꾸세요. 기존 데이터베이스를 초기화하거나 덮어쓰지 마세요.

```sql
CREATE DATABASE my_budget_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'budget_dev'@'localhost' IDENTIFIED BY 'replace_with_local_password';
GRANT ALL PRIVILEGES ON my_budget_dev.* TO 'budget_dev'@'localhost';
```

이미 포함된 초기 마이그레이션은 아래 명령으로 적용합니다. `db:deploy`는 이름과 관계없이 로컬 개발 DB에도 사용할 수 있으며, 설정한 `DATABASE_URL`에만 적용합니다. shadow DB 생성 권한 없이도 실행할 수 있습니다.

```sh
# 로컬 DB URL인지 확인한 후 실행
npm run db:deploy
npm run db:generate
npm run db:seed
npm run db:status
```

새 스키마 변경을 만들 때는 `npm run db:migrate -- --name 변경이름`을 사용합니다. `migrate dev`는 변경 감지를 위한 shadow DB가 필요하므로 자동 생성·삭제 권한이 있는 로컬 개발 계정을 사용하거나, 별도 shadow DB를 만들고 `prisma.config.ts`의 `datasource.shadowDatabaseUrl`에 환경변수로 URL을 전달해야 합니다. shadow DB와 개발 DB는 반드시 서로 달라야 합니다. 이번 검증은 기존 로컬 관리자 계정으로 `db:migrate`를 실행했습니다.

트리거·CHECK·collation을 수정할 때는 `--create-only`로 SQL을 생성한 뒤 필요한 SQL을 검토하여 적용하세요. 적용된 마이그레이션을 나중에 수정하지 마세요.

**`prisma db push`로 초기화하지 마세요.** Prisma 스키마가 표현하지 못하는 CHECK, collation과 트리거가 초기 `migration.sql`에 포함되어 있습니다. 마이그레이션 파일을 함께 관리해야 모든 규칙을 복원할 수 있습니다. Prisma 7에서는 마이그레이션 후 Client 생성과 Seed가 자동 실행되지 않으므로 위처럼 명시적으로 실행합니다.

MySQL이 없거나 연결되지 않으면 설치·서비스 상태·계정 권한을 확인한 후 같은 명령을 실행하세요. 원격 서버로 자동 전환하지 않습니다.

## 실행

```sh
npm run dev
```

```sh
npm run build
npm start
```

```sh
curl http://127.0.0.1:3000/health
# {"status":"ok"}
```

서버는 DB 연결을 확인한 뒤 포트를 엽니다. 연결 실패 또는 포트 사용 중이면 오류를 표시하며 종료합니다. `SIGINT`/`SIGTERM` 시 HTTP 요청을 마무리하고 DB 연결을 해제합니다.

`/health`는 HTTP 200을 반환하는 프로세스 상태 확인용이며, 요청마다 DB를 조회하지 않습니다. 실행 이후의 DB 장애까지 확인하는 readiness 검사는 후속 작업입니다.

## 데이터 모델 및 프론트엔드 계약

| 모델 | 필드 및 제약 |
| --- | --- |
| `Category` | 문자열 `id`, `name VARCHAR(20)`, `type`, `symbol`, `createdAt`, `updatedAt` |
| `Transaction` | 문자열 `id`·`categoryId`, `type`, `amount BIGINT`, `date DATE`, `memo VARCHAR(100)` 기본 빈 문자열, 타임스탬프 |

- ID는 `VARCHAR(191)`, 새 ID의 기본값은 UUID입니다. iOS의 `food`, `salary`, 임의 문자열 ID도 그대로 보존할 수 있고 UUID 형식으로 제한하지 않습니다. ID는 대소문자를 구분합니다. 191자를 넘는 기존 ID는 향후 이전 시 확인해야 합니다.
- `type`은 `expense`/`income` enum입니다. `symbol`은 `food`, `coffee`, `transport`, `shopping`, `living`, `home`, `income`, `other` enum입니다.
- `(categoryId, type)` → `Category(id, type)` 복합 외래키로 참조와 유형 일치를 함께 보장합니다. 삭제·참조 키 변경은 `RESTRICT`입니다.
- `(type, name)` UNIQUE로 유형별 중복 이름을 막습니다. 이름에는 대소문자를 구분하지 않고 악센트는 구분하는 `utf8mb4_0900_as_ci`를 사용합니다. MySQL collation과 JS `toLocaleLowerCase()`의 특수 유니코드 비교가 완전히 같지는 않으므로 향후 API에서는 이름 정규화 및 DB 중복 오류 처리가 필요합니다.
- 거래 `date`와 `(categoryId, type)`에 인덱스를 둡니다.
- 카테고리 유형은 사용 여부와 관계없이 `BEFORE UPDATE` 트리거로 변경을 거부합니다.
- 금액 `1~999,999,999,999`와 날짜 `1900-01-01~9999-12-31`은 DB CHECK로도 제한합니다. 빈 ID와 빈 이름도 거부합니다.
- `createdAt`/`updatedAt`은 `DATETIME(3)`이며 `updatedAt`은 Prisma가 갱신합니다. 원시 SQL로 수정할 경우 호출자가 갱신해야 합니다.

`src/domain/ledger.ts`는 향후 API에서 사용할 작은 변환 함수들입니다. 입력 금액에 `Number.isSafeInteger`와 허용 범위를 검사한 후 `bigint`로 바꾸고, 출력은 범위 확인 후 `number`로 바꿉니다. `bigint`를 그대로 `res.json`에 넘기지 마세요. 날짜는 UTC 자정의 `Date`로 저장하고 `YYYY-MM-DD`로 반환하여 한국 시간대에서도 날짜가 밀리지 않게 합니다.

DTO는 iOS와 같은 `Category`, `Transaction`, `LedgerData(version: 1)` 필드만 반환합니다. DB 타임스탬프는 포함하지 않습니다. `toLedgerDto`는 전체 거래 금액의 합에 대해서도 안전한 정수 범위를 확인합니다. 향후 쓰기 API에서 전체 합 제한을 동시 요청에도 어떻게 보장할지 결정해야 합니다.

`normalizeCategoryName`, `normalizeMemo`는 iOS처럼 trim 후 JS UTF-16 길이를 검사합니다. MySQL `VARCHAR`는 유니코드 문자 개수를 세므로, 향후 쓰기 API는 이 함수로 검증해야 이모지 등의 길이 제한도 iOS와 일치합니다.

읽기 전용으로 확인한 프론트엔드 파일은 `../my-budget-ios/src/domain/{types,ledger,dates}.ts`, `src/data/{mockData,ledgerRepository}.ts`입니다. 해당 레포지토리는 수정하지 않았고 백엔드에서 참조하거나 import하지 않습니다.

## Seed

기본 지출 7개(식비·카페·교통·쇼핑·생활·주거·기타), 수입 3개(급여·용돈·기타)의 ID·이름·symbol을 iOS와 동일하게 넣습니다. 기존 ID가 있으면 보존하고, 동일 유형·이름이 다른 ID로 존재하면 upsert로 중복 생성을 피합니다. 기존 카테고리 이름이나 symbol을 덮어쓰지 않습니다. 전체 Seed는 트랜잭션이며 데모 거래는 생성하지 않습니다.

개발 Seed는 `NODE_ENV=development`이고 DB 호스트가 loopback인 경우만 실행됩니다. SSH 포트 전달이 있다면 로컬 주소도 원격 DB를 가리킬 수 있으므로 실제 접속 대상을 확인하세요.

## 검증

```sh
npm run db:validate
npm run typecheck
npm test
npm run build
# 실제 로컬 개발/테스트 DB에 마이그레이션을 적용한 뒤
TZ=Asia/Seoul npm run test:db
```

기본 테스트는 실제 DB 없이 동작합니다. 통합 테스트는 `development`/`test`, loopback 호스트, `_dev`/`_test` 접미사가 있는 DB만 허용하고, 검증용 데이터는 마지막에 모두 롤백합니다.

초기 구축 시 Node.js 24.11.0 / 로컬 MySQL 9.6.0에서 마이그레이션 적용, Seed 2회, 기본 테스트 9개, DB 통합 테스트 1개, 타입 검사와 빌드를 검증했습니다. TypeScript 실행과 빌드된 서버 각각에서 DB 연결, `/health` HTTP 200, `SIGTERM` 정상 종료를 확인했고, 잘못된 환경변수의 조기 종료와 인증정보 비노출도 확인했습니다. MySQL 8.4에서의 실행 검증은 아직 수행하지 않았습니다. 검증 후 카테고리 10개, 거래 0개만 유지합니다.

## 후속 작업 및 배포 설정

거래·카테고리 CRUD, 입력 스키마 검증과 오류 응답, 프론트엔드 API 연결, AsyncStorage 이전, 인증·접근 제어, 운영 배포는 이번 범위에서 제외했습니다.

향후 서버에서는 `NODE_ENV=production`, 적절한 `HOST`·`PORT`, 별도 운영 `DATABASE_URL`을 환경변수로 주입합니다. 호스트 주소나 자격증명은 소스에 넣지 않습니다. `npm run build` 후 `npm start`, 검토된 마이그레이션은 `npm run db:deploy`를 사용합니다. 초기 개발 Seed는 운영 실행을 거부합니다. 운영 서버·DB에는 이번 작업에서 접속하거나 설정을 변경하지 않았습니다.

로컬 Git 저장소는 `main` 브랜치로 초기화했습니다. GitHub 원격 생성, commit, push는 수행하지 않았습니다. Git 상태를 검토한 뒤 사용자가 별도로 진행할 수 있습니다.
