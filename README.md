# my-budget-backend

개인용 iOS 가계부 앱을 위한 독립적인 Node.js + Express + TypeScript 백엔드입니다. `/health`, 환경변수 검증, Prisma ORM 7 + MySQL 스키마·Seed, 카테고리·거래 CRUD와 전체 Ledger 조회 API 및 공통 입력 검증·오류 처리를 제공합니다. Ubuntu 내부 HTTP 배포용 PM2 설정과 운영 초기화 절차가 준비되어 있으며 실제 운영 배포는 아직 수행하지 않았습니다.

## 요구사항

- Node.js 24 LTS 권장 (`.nvmrc`), 또는 Node.js 22.12 이상 22.x
- npm, MySQL 8.4 LTS 권장 (최소 8.0.16: CHECK 제약조건 사용)
- 패키지 버전은 `package-lock.json`에 고정되어 있습니다.

Prisma CLI·Client·MySQL 어댑터는 **7.10.1**로 통일했습니다. ESM, `prisma-client` 생성기, 명시적 출력 경로, `prisma.config.ts`의 datasource URL 및 `@prisma/adapter-mariadb`를 사용합니다. MariaDB 드라이버는 어댑터의 의존성으로 설치되며 MySQL에 연결합니다.

요청 검증은 **Zod 4.6.7**을 사용합니다. HTTP 테스트는 기존 Node.js 테스트 러너와 `fetch`를 사용하며 추가 테스트 패키지는 설치하지 않습니다.

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
  middleware/errorHandler.ts  # 공통 오류 응답, 요청 ID, 안전한 오류 로그
  validation/request.ts       # 공통 ID·type·본문 검증, 도메인 검증과 Zod 연결
  modules/categories/
    categories.routes.ts       # /api/v1/categories
    categories.service.ts      # Prisma 조회·변경 및 DB 오류 변환
    categories.validation.ts   # 파라미터·쿼리·본문 Zod 스키마
  modules/transactions/
    transactions.routes.ts     # /api/v1/transactions
    transactions.service.ts    # 조회·변경, 합계·참조 무결성 트랜잭션
    transactions.validation.ts # 거래 입력·부분 수정·기간 검증
  modules/ledger/
    ledger.routes.ts           # GET /api/v1/ledger, 쿼리·본문 거부
    ledger.service.ts          # 동일 스냅샷 조회 및 기존 Ledger DTO 변환
  app.ts                       # Express 앱 구성, GET /health
  server.ts                    # DB 연결 후 서버 시작, 종료 처리
tests/
  *.test.ts                    # 환경변수, DTO, 요청 검증·오류·HTTP 테스트
  helpers/http.ts              # loopback 임시 HTTP 서버
  helpers/database.ts          # 로컬 DB 보호, 기존 데이터 해시 계산
  db/categories.test.ts        # 실제 DB API·경합 검증, 기존 데이터 해시 비교
  db/transactions.test.ts      # 거래 API·동시 요청·실제 금액 한도 검증
  db/ledger.test.ts            # 전체 조회·CRUD 반영·스냅샷·합계 경계 검증
  db/production-seed.test.ts   # 운영 초기화 생성·보존·충돌 롤백, 로컬 DB 전용
  db/schema.test.ts            # 로컬 DB 통합 검증, 검증 데이터 롤백
scripts/
  database-target.ts          # 비밀번호 없는 대상 표시, 운영 확인 인자 검증
  check-database.ts           # 읽기 전용 DB 연결·계정 확인
  init-production-categories.ts # 명시적 확인 후 운영 기본 카테고리 초기화
deploy/
  verify-database.sql         # 적용 결과·제약조건·기본 ID 읽기 전용 점검
  logrotate.my-budget-backend.example # 이 앱의 로그만 회전하는 예시
docs/deployment.md            # Ubuntu 준비·배포·백업·복구 순서
ecosystem.config.cjs          # 기존 PM2와 함께 사용할 단일 앱 설정
prisma.config.ts
tsconfig.json
tsconfig.build.json
```

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
| `ENV_FILE` (선택) | `.env.migration` | 생략 시 `.env`, 명시하면 해당 파일을 읽어야 함 |

NODE_ENV·HOST·PORT·DATABASE_URL은 모두 필수입니다. 누락되거나 잘못되면 시작 단계에서 변수 이름과 오류를 표시합니다. 비밀번호 등 인증정보는 오류 메시지에 출력하지 않습니다. 비밀번호의 `@`, `#`, `/`, `%` 등은 URL 인코딩해야 합니다. DB 이름은 영문·숫자·밑줄을 지원하며, 빈 비밀번호는 로컬 개발 계정에서 사용할 수 있습니다.

개발 실행, 빌드 시 Client 생성, 빌드된 서버, Prisma CLI 및 Seed 모두 `src/config/env.ts`로 선택한 파일을 로딩합니다. 기본은 프로젝트 루트의 `.env`이고 `ENV_FILE=.env.migration`처럼 명령에만 지정하면 별도 계정을 사용할 수 있습니다. 명시한 파일이 없거나 경로가 비어 있으면 실행 초기에 오류가 납니다. 이미 주입된 네 환경변수가 파일보다 우선하므로 관리 명령 전 이전 셸 값을 확인하세요. ENV_FILE을 `.env` 파일 안에 넣지 않습니다. `npm ci`는 DB 연결이나 Client 생성을 실행하지 않습니다. 이후 `db:generate` 또는 `build`를 실행하세요. 빌드에도 네 필수 환경변수가 필요하지만 실제 DB 접속은 필요하지 않습니다.

현재 URL의 쿼리 옵션은 지원하지 않고 명확한 오류로 거부합니다. Prisma CLI와 런타임 어댑터가 같은 연결 정보를 사용하도록 하기 위함입니다. 연결 풀 5개, 연결·획득 제한시간 5초, UTC는 `src/db/prisma.ts`에 설정되어 있습니다. 운영용 TLS·연결 풀 조정은 배포 단계에서 CLI와 어댑터 양쪽에 맞춰 추가해야 합니다.

`.env`, `.env.*`, 개인 인증서·키, `.aws`, `node_modules`, `dist`, 생성 Client, backups 디렉터리는 Git에서 제외됩니다. `.env.example`·`.env.production.example`·`.env.migration.example`, `package-lock.json`, 마이그레이션은 버전 관리합니다. 실제 비밀번호나 인증정보는 예시 파일에 넣지 않습니다.

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

새 스키마 변경을 만들 때는 `npm run db:migrate -- --name 변경이름`을 사용합니다. `migrate dev`는 변경 감지를 위한 shadow DB가 필요하므로 자동 생성·삭제 권한이 있는 로컬 개발 계정을 사용하거나, 별도 shadow DB를 만들고 `prisma.config.ts`의 `datasource.shadowDatabaseUrl`에 환경변수로 URL을 전달해야 합니다. shadow DB와 개발 DB는 반드시 서로 달라야 합니다. 초기 구축 당시 기존 로컬 관리자 계정으로 `db:migrate`를 실행했으며, 카테고리·거래 API 작업에서는 스키마 변경이나 마이그레이션 추가 없이 기존 제약조건을 사용합니다.

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

## 카테고리 API

개발 기본 주소는 `http://127.0.0.1:3000`입니다. `.env`의 `HOST=127.0.0.1`을 유지하며 외부에 공개하지 않습니다. 운영 내부 HTTP의 제안 포트는 3004이고, 다른 서비스의 사용 여부를 먼저 확인합니다.

| 메서드·경로 | 동작 | 성공 응답 |
| --- | --- | --- |
| `GET /api/v1/categories` | 전체 목록, `?type=expense` 또는 `?type=income` 필터 | 200, Category DTO 배열 |
| `POST /api/v1/categories` | `name`, `type`, `symbol`으로 생성, ID는 서버 UUID | 201, Category DTO |
| `PATCH /api/v1/categories/:id` | `name`만 변경, ID·유형·symbol 유지 | 200, Category DTO |
| `DELETE /api/v1/categories/:id` | 사용하지 않는 카테고리 삭제 | 204, 본문 없음 |

목록은 유형(`expense` → `income`), DB collation 기준 이름 오름차순, ID 오름차순으로 정렬합니다. DTO에는 `id`, `name`, `type`, `symbol`만 포함합니다. 단건 GET은 아직 제공하지 않습니다.

POST·PATCH는 `Content-Type: application/json`을 사용합니다. JSON 본문은 최대 16 KiB이며 압축 본문은 지원하지 않습니다. 이름은 기존 `normalizeCategoryName`을 통해 공백 제거 후 1~20자(JS UTF-16 길이)로 검증합니다. type·symbol은 Prisma에서 생성한 enum으로 검증하여 DB와 기준을 공유합니다.

알 수 없는 필드·쿼리, 중복 type 쿼리, 클라이언트가 지정한 생성 ID, PATCH의 type·symbol 변경, DELETE의 본문은 400입니다. ID는 비어 있지 않은 191자 이하 문자열로 검증하며 UUID로 제한하지 않으므로 기존 iOS 문자열 ID도 사용할 수 있습니다. 생성·변경·삭제에는 쿼리 옵션이 없습니다.

```sh
curl 'http://127.0.0.1:3000/api/v1/categories?type=expense'
# [{"id":"food","name":"식비","type":"expense","symbol":"food"}, ...]

curl -i -X POST http://127.0.0.1:3000/api/v1/categories \
  -H 'Content-Type: application/json' \
  -d '{"name":"  운동  ","type":"expense","symbol":"other"}'
# HTTP 201
# {"id":"<서버가 생성한 UUID>","name":"운동","type":"expense","symbol":"other"}

# 아래 ID는 생성 응답에서 받은 실제 문자열로 바꾸세요.
curl -X PATCH http://127.0.0.1:3000/api/v1/categories/생성된-ID \
  -H 'Content-Type: application/json' -d '{"name":"체육"}'
# {"id":"<동일한 UUID>","name":"체육","type":"expense","symbol":"other"}

curl -i -X DELETE http://127.0.0.1:3000/api/v1/categories/생성된-ID
# HTTP 204, 본문 없음
```

같은 유형의 이름 중복은 대소문자를 구분하지 않고 409를 반환합니다. 다른 유형에는 동일 이름을 사용할 수 있습니다. 현재 이름으로 다시 PATCH하는 요청은 성공합니다. 사용 중인 카테고리는 이름을 바꿀 수 있고 기존 거래 연결도 유지되지만, 삭제는 409로 거부합니다.

사전 조회에 의존하지 않고 DB의 UNIQUE·외래키 RESTRICT 제약을 최종 판단으로 사용합니다. 동시 생성·이름 변경 충돌도 같은 409로 변환합니다. 삭제는 `deleteMany({ where: { id } })`의 삭제 건수를 확인하여 동시 삭제 중 한 요청은 204, 나머지는 404를 반환합니다. 이 Prisma 버전과 MySQL 조합의 `delete()`에서는 경합 시 두 요청 모두 이전 행을 반환하는 경우가 실제 테스트에서 확인되어 삭제 건수 확인 방식으로 처리했습니다.

## 거래 API

| 메서드·경로 | 동작 | 성공 응답 |
| --- | --- | --- |
| `GET /api/v1/transactions` | 전체 또는 기간별 목록 | 200, Transaction DTO 배열 |
| `GET /api/v1/transactions/:id` | 문자열 ID로 단건 조회 | 200, Transaction DTO |
| `POST /api/v1/transactions` | 거래 생성, ID는 서버 UUID | 201, Transaction DTO |
| `PATCH /api/v1/transactions/:id` | 제공한 필드만 부분 수정 | 200, 최종 Transaction DTO |
| `DELETE /api/v1/transactions/:id` | 삭제 건수로 성공·대상 없음 구분 | 204, 본문 없음 |

목록은 **날짜 내림차순, ID 오름차순**으로 정렬합니다. `from`, `to`는 각각 생략할 수 있고, 시작일은 포함·종료일은 제외합니다. `from=to`이면 빈 배열을 반환하고 `from>to`이면 400입니다. 날짜는 1900~9999년의 실제 존재하는 `YYYY-MM-DD`여야 하며 날짜·시간 문자열은 받지 않습니다. 목록 외 경로에는 쿼리 옵션이 없고, 목록에서도 `from`, `to` 외의 쿼리와 중복 쿼리는 거부합니다.

POST의 `type`, `amount`, `categoryId`, `date`, `memo`는 모두 필수입니다. `memo`가 없으면 빈 문자열 `""`을 보내세요. 금액은 숫자형 안전 정수 1~999,999,999,999원이며 숫자 문자열·소수는 받지 않습니다. 메모는 기존 `normalizeMemo`로 trim 후 최대 100자(JS UTF-16 길이)를 검사합니다. 카테고리는 존재해야 하며 거래와 유형이 같아야 합니다.

PATCH는 위 다섯 필드 중 하나 이상을 보내야 합니다. 생략한 필드는 유지하며 `null`, 빈 객체, ID·타임스탬프 등의 추가 필드는 400입니다. 현재 거래와 수정값을 합쳐 최종 `(categoryId, type)`을 검사하므로 유형만 변경하거나 카테고리만 변경하는 요청도 정합성을 지켜야 합니다. 다른 유형으로 변경하려면 해당 유형의 카테고리를 함께 보내야 합니다.

```sh
curl 'http://127.0.0.1:3000/api/v1/transactions?from=2026-11-01&to=2026-12-01'
# 11월 1일 포함 ~ 12월 1일 제외

curl -i -X POST http://127.0.0.1:3000/api/v1/transactions \
  -H 'Content-Type: application/json' \
  -d '{"type":"expense","amount":9000,"categoryId":"food","date":"2026-11-14","memo":" 점심 식사 "}'
# HTTP 201
# {"id":"<생성된 ID>","date":"2026-11-14","type":"expense","amount":9000,"categoryId":"food","memo":"점심 식사"}

# 생성 응답의 실제 ID로 바꾸세요.
curl http://127.0.0.1:3000/api/v1/transactions/생성된-ID
curl -X PATCH http://127.0.0.1:3000/api/v1/transactions/생성된-ID \
  -H 'Content-Type: application/json' -d '{"amount":10000,"memo":"점심 식사 수정"}'
curl -i -X DELETE http://127.0.0.1:3000/api/v1/transactions/생성된-ID
# HTTP 204, 본문 없음
```

생성·변경은 카테고리 API와 동일하게 JSON 본문 최대 16 KiB, 압축 불가 정책을 사용합니다. 삭제 요청에는 본문을 포함하지 않습니다. 응답의 amount는 검증 후 JavaScript number로, date는 UTC 기준 `YYYY-MM-DD`로 변환하며 BigInt·DB 타임스탬프는 JSON에 직접 반환하지 않습니다.

## 전체 Ledger API

`GET /api/v1/ledger`는 현재 DB의 **모든 카테고리와 거래**를 HTTP 200, `LedgerData(version: 1)` 형식으로 반환합니다. 필터·페이지네이션이 없으며 프론트엔드는 전체 거래 배열로 통계를 계산할 수 있습니다. 쿼리 파라미터와 요청 본문(JSON, 텍스트, chunked 포함)은 400 `INVALID_REQUEST`로 거부합니다.

```sh
curl http://127.0.0.1:3000/api/v1/ledger
```

```json
{
  "version": 1,
  "transactions": [
    {
      "id": "example-id",
      "date": "2026-11-14",
      "type": "expense",
      "amount": 9000,
      "categoryId": "food",
      "memo": "점심 식사"
    }
  ],
  "categories": [
    { "id": "food", "name": "식비", "type": "expense", "symbol": "food" }
  ]
}
```

카테고리는 기존 목록 API와 동일하게 **유형 → 이름 → ID 오름차순**, 거래는 **날짜 내림차순 → ID 오름차순**입니다. 이름 비교에는 DB collation을 사용합니다. 해당 데이터가 없으면 빈 배열이며, 두 테이블 모두 비어 있으면 `{"version":1,"transactions":[],"categories":[]}`입니다. Seed 적용 후 거래가 없는 DB에서는 기본 카테고리 10개와 빈 거래 배열을 반환합니다. 조회 요청이 Seed를 생성하지는 않습니다.

두 `findMany`는 하나의 Prisma 트랜잭션에서 `RepeatableRead`를 명시하여 실행합니다. MySQL InnoDB의 첫 일반 SELECT가 만든 스냅샷을 두 조회가 공유하므로, 그 사이 다른 연결이 카테고리·거래를 생성·수정·삭제하고 커밋해도 이전 시점의 서로 일치하는 데이터를 반환합니다. 일반 SELECT만 사용하며 `FOR UPDATE`·`FOR SHARE` 같은 행 잠금이나 쓰기 SQL은 추가하지 않았습니다. 기존 거래 쓰기의 `Serializable`·충돌 재시도 정책은 유지합니다. 참고: [Prisma 격리 수준](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#transaction-isolation-level), [MySQL 일관된 비잠금 읽기](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html).

같은 트랜잭션에서 기존 `toLedgerDto`를 호출합니다. 이 함수가 `toCategoryDto`·`toTransactionDto`와 전체 합계 검증을 재사용하므로 `createdAt`·`updatedAt` 등은 응답에 포함하지 않습니다. 금액은 bigint 합계·개별 범위를 검사한 뒤 number로, 날짜는 UTC 기준 `YYYY-MM-DD`로 반환합니다. 외부 쓰기로 합계를 초과한 데이터나 잘못된 저장 값이 발견되면 응답 전체를 공통 **500 `INTERNAL_SERVER_ERROR`**로 처리하며 원본 오류·데이터·접속 정보는 노출하지 않습니다. 쓰기 요청의 합계 초과에 사용하는 409와 구분합니다.

전체 조회는 데이터 수에 비례하는 메모리와 응답 크기를 사용합니다. 데이터가 커지면 전체 배열을 사용하는 프론트엔드 계약과 함께 동기화 방식을 검토해야 합니다.

## 거래 금액 합계와 동시 요청

개별 금액 외에 **수입·지출 모든 거래 금액의 합**을 `Number.MAX_SAFE_INTEGER`(9,007,199,254,740,991) 이하로 유지합니다. 수입에서 지출을 뺀 잔액 기준이 아닙니다. `toLedgerDto`와 쓰기 API는 동일한 `assertLedgerTotal`을 사용합니다.

POST·PATCH는 `Serializable` 트랜잭션 안에서 카테고리·현재 거래 확인, DB 합계 조회, 변경 후 합계 검사, 쓰기 및 DTO 변환을 수행한 후 커밋합니다. PATCH는 `현재 합계 - 이전 금액 + 수정 금액`으로 검사합니다. DB 합계와 계산 모두 bigint로 처리하며 JavaScript number로 중간 변환하지 않습니다. 합계가 한도를 넘으면 **409 `LEDGER_TOTAL_LIMIT_EXCEEDED`**로 거부하고 롤백합니다.

MySQL의 Serializable 읽기는 삽입·변경과 충돌하는 읽기 잠금을 사용하므로 여러 서버 프로세스에서도 합계 검사와 쓰기를 함께 보호합니다. 전체 거래 합계 조회는 O(n)이며 DB가 넓은 범위에 읽기 잠금을 잡을 수 있습니다. 현재 개인용 앱 규모에서는 짧은 트랜잭션으로 처리하고, 별도 테이블·명시적 전역 잠금·프로세스 내부 mutex는 추가하지 않았습니다. 데이터나 동시 쓰기가 크게 늘면 합계 관리 방식을 재검토해야 합니다. 참고: [Prisma 트랜잭션](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), [MySQL 격리 수준](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html).

교착·직렬화 충돌인 P2034는 실패한 트랜잭션 전체를 최대 3회 시도하며, 짧은 지연을 두고 현재 거래와 합계를 다시 읽습니다. 재시도 후에도 충돌하면 **409 `TRANSACTION_WRITE_CONFLICT`**입니다. 그 밖의 오류는 자동 재시도하지 않습니다. DELETE도 같은 트랜잭션·충돌 재시도를 사용하며 원자적 삭제 건수로 동시 삭제의 204·404를 구분합니다. 금액 감소·삭제는 이후 요청이 사용할 한도를 다시 확보합니다.

카테고리 확인과 쓰기는 같은 트랜잭션이며 DB의 복합 외래키도 유지합니다. 카테고리 삭제가 먼저 완료되면 거래 입력을 400으로 거부하고, 거래 생성이 먼저 완료되면 카테고리 삭제를 RESTRICT로 막습니다. PATCH는 최종 유형·카테고리를 현재 행과 함께 검증하고, 제공된 필드만 변경하여 동시 요청에서 생략한 필드를 덮어쓰지 않습니다. 수정·삭제 경합은 DB 순서에 따라 수정 성공 후 삭제되거나, 삭제 이후 수정이 404가 됩니다.

이 합계 정책은 API를 통한 쓰기를 보호합니다. Prisma 스키마만으로 여러 행의 합계를 제한할 수 없으므로 원시 SQL·직접 Prisma 쓰기·미래의 가져오기 작업도 같은 정책을 따라야 합니다. 기존에 외부 쓰기로 한도를 넘은 DB는 개별 거래 목록 조회·삭제로 정리할 수 있으며 POST·PATCH는 변경 후 합계가 한도 이하일 때만 허용합니다. 전체 Ledger 조회는 합계 검증에 실패하므로 500을 반환합니다.

## 공통 오류 응답

오류는 개발 모드에서도 다음 JSON 형식을 사용합니다.

```json
{
  "error": {
    "code": "CATEGORY_NAME_CONFLICT",
    "message": "이미 존재하는 카테고리 이름입니다."
  }
}
```

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 입력 검증, JSON 형식·헤더·크기·인코딩 오류 |
| 404 | `CATEGORY_NOT_FOUND` | 수정·삭제 대상 없음, Prisma P2025 |
| 404 | `API_NOT_FOUND` | 존재하지 않는 경로 또는 지원하지 않는 메서드 |
| 409 | `CATEGORY_NAME_CONFLICT` | 유형별 이름 중복, Prisma P2002 |
| 409 | `CATEGORY_IN_USE` | 거래가 참조하는 카테고리 삭제, Prisma P2003 |
| 400 | `INVALID_CATEGORY` | 거래 생성·수정의 카테고리 없음 또는 복합 외래키 충돌 |
| 400 | `CATEGORY_TYPE_MISMATCH` | 거래 유형과 카테고리 유형 불일치 |
| 404 | `TRANSACTION_NOT_FOUND` | 조회·수정·삭제 거래 없음, 거래 Prisma P2025 |
| 409 | `LEDGER_TOTAL_LIMIT_EXCEEDED` | 변경 후 전체 거래 금액 합계가 안전 정수 한도 초과 |
| 409 | `TRANSACTION_WRITE_CONFLICT` | P2034 충돌 재시도 소진 |
| 409 | `TRANSACTION_CONFLICT` | 거래 고유 키 충돌, Prisma P2002 |
| 500 | `INTERNAL_SERVER_ERROR` | 예상하지 못한 오류 또는 Ledger의 저장 값·전체 합계 검증 실패, 메시지는 `서버 오류가 발생했습니다.` |

Express 5가 async 라우트의 오류를 공통 미들웨어에 전달하므로 별도 async 래퍼는 사용하지 않습니다. Prisma 오류는 각 서비스에서 의미에 맞게 변환합니다. 카테고리 삭제의 외래키 충돌은 409, 거래 입력의 카테고리 참조 오류는 400입니다. 거래의 P2000·P2004 길이·CHECK 제약 오류도 원문 없이 400 `INVALID_REQUEST`로 변환합니다. 참고: [Express 오류 처리](https://expressjs.com/en/5x/guide/error-handling/), [Prisma 7 오류 코드](https://www.prisma.io/docs/orm/v7/reference/error-reference), [Zod 스키마·변환](https://zod.dev/api).

모든 응답의 `X-Request-Id`는 서버가 생성하며, 클라이언트가 준 값을 신뢰하지 않습니다. 500 오류 로그에는 요청 ID, HTTP 메서드, ID 값이 없는 경로 템플릿, 오류 종류, Prisma 코드, 스택에서 추출한 소스 상대 위치만 기록합니다. 원본 오류 메시지·전체 스택·Prisma meta·SQL·접속 URL·요청 본문·인증 헤더·쿠키는 기록하거나 응답에 포함하지 않습니다.

## 데이터 모델 및 프론트엔드 계약

| 모델 | 필드 및 제약 |
| --- | --- |
| `Category` | 문자열 `id`, `name VARCHAR(20)`, `type`, `symbol`, `createdAt`, `updatedAt` |
| `Transaction` | 문자열 `id`·`categoryId`, `type`, `amount BIGINT`, `date DATE`, `memo VARCHAR(100)` 기본 빈 문자열, 타임스탬프 |

- ID는 `VARCHAR(191)`, 새 ID의 기본값은 UUID입니다. iOS의 `food`, `salary`, 임의 문자열 ID도 그대로 보존할 수 있고 UUID 형식으로 제한하지 않습니다. ID는 대소문자를 구분합니다. 191자를 넘는 기존 ID는 향후 이전 시 확인해야 합니다.
- `type`은 `expense`/`income` enum입니다. `symbol`은 `food`, `coffee`, `transport`, `shopping`, `living`, `home`, `income`, `other` enum입니다.
- `(categoryId, type)` → `Category(id, type)` 복합 외래키로 참조와 유형 일치를 함께 보장합니다. 삭제·참조 키 변경은 `RESTRICT`입니다.
- `(type, name)` UNIQUE로 유형별 중복 이름을 막습니다. 이름에는 대소문자를 구분하지 않고 악센트는 구분하는 `utf8mb4_0900_as_ci`를 사용합니다. MySQL collation과 JS `toLocaleLowerCase()`의 특수 유니코드 비교가 완전히 같지는 않으므로 API는 이름 정규화 후 DB 제약조건을 기준으로 중복 오류를 반환합니다.
- 거래 `date`와 `(categoryId, type)`에 인덱스를 둡니다.
- 카테고리 유형은 사용 여부와 관계없이 `BEFORE UPDATE` 트리거로 변경을 거부합니다.
- 금액 `1~999,999,999,999`와 날짜 `1900-01-01~9999-12-31`은 DB CHECK로도 제한합니다. 빈 ID와 빈 이름도 거부합니다.
- `createdAt`/`updatedAt`은 `DATETIME(3)`이며 `updatedAt`은 Prisma가 갱신합니다. 원시 SQL로 수정할 경우 호출자가 갱신해야 합니다.

`src/domain/ledger.ts`의 카테고리·거래 정규화와 DTO 함수를 API에서 재사용합니다. 입력 금액에 `Number.isSafeInteger`와 허용 범위를 검사한 후 `bigint`로 바꾸고, 출력은 범위 확인 후 `number`로 바꿉니다. `bigint`를 그대로 `res.json`에 넘기지 마세요. 날짜는 UTC 자정의 `Date`로 저장하고 `YYYY-MM-DD`로 반환하여 한국 시간대에서도 날짜가 밀리지 않게 합니다.

DTO는 iOS와 같은 `Category`, `Transaction`, `LedgerData(version: 1)` 필드만 반환합니다. DB 타임스탬프는 포함하지 않습니다. 전체 Ledger 조회와 거래 쓰기 API는 동일한 전체 합계 제한을 검증합니다.

`normalizeCategoryName`, `normalizeMemo`는 iOS처럼 trim 후 JS UTF-16 길이를 검사합니다. MySQL `VARCHAR`는 유니코드 문자 개수를 세므로, 두 API 모두 기존 함수로 검증하여 이모지 등의 길이 제한을 iOS와 맞춥니다.

읽기 전용으로 확인한 프론트엔드 파일은 `../my-budget-ios/src/domain/{types,ledger,dates}.ts`, `src/data/{mockData,ledgerRepository}.ts`입니다. 해당 레포지토리는 수정하지 않았고 백엔드에서 참조하거나 import하지 않습니다.

## Seed

기본 지출 7개(식비·카페·교통·쇼핑·생활·주거·기타), 수입 3개(급여·용돈·기타)의 ID·이름·symbol을 iOS와 동일하게 넣습니다. 개발 `db:seed`는 기존 ID를 보존하고, 동일 유형·이름이 다른 ID로 존재하면 upsert로 중복 생성을 피합니다. 기존 카테고리 이름이나 symbol을 덮어쓰지 않습니다. 전체 Seed는 트랜잭션이며 데모 거래는 생성하지 않습니다.

개발 Seed는 `NODE_ENV=development`이고 DB 호스트가 loopback인 경우만 실행됩니다. SSH 포트 전달이 있다면 로컬 주소도 원격 DB를 가리킬 수 있으므로 실제 접속 대상을 확인하세요.

운영용 `db:init:production`은 공유 로직의 strict 모드를 사용합니다. NODE_ENV=production에서 대상 정보를 먼저 표시하고, 정확한 `--confirm-target host:port/database`가 있어야 생성합니다. 같은 ID·유형의 기존 이름·symbol·타임스탬프는 보존하지만, 다른 ID의 같은 유형·이름 또는 동일 ID의 다른 유형은 충돌로 보고하며 이번 생성 전체를 롤백합니다. 서버 시작 시 자동 실행하지 않습니다. 명령과 DB 백업·검증 순서는 [운영 배포 문서](docs/deployment.md)에 있습니다.

## 검증

```sh
npm run db:validate
npm run typecheck
npm test
npm run build
# 실제 로컬 개발/테스트 DB에 마이그레이션을 적용한 뒤
TZ=Asia/Seoul npm run test:db
```

기본 테스트는 실제 DB 없이 동작합니다. 통합 테스트는 `development`/`test`, loopback 호스트, `_dev`/`_test` 접미사가 있는 DB만 허용합니다. 임시 HTTP 서버도 loopback에만 바인딩합니다. DB 테스트 파일은 순차 실행합니다.

Ledger 테스트만 실행하려면 다음 명령을 사용합니다. `tests/ledger.test.ts`는 기존 도메인 함수 테스트이며 새 HTTP 테스트는 `tests/ledger-api.test.ts`입니다.

```sh
node --import tsx --import ./tests/setup.ts --test tests/ledger-api.test.ts
TZ=Asia/Seoul node --import tsx --test tests/db/ledger.test.ts
```

카테고리의 기본 API 검증은 트랜잭션으로 롤백합니다. 거래 API 및 실제 동시 요청 검증은 테스트 전용 카테고리·거래를 만들고 `finally`에서 해당 행만 정리합니다. 기존 Seed나 거래는 수정·삭제하지 않으며, 검증 전후 모든 기존 행(타임스탬프 포함)의 SHA-256 해시가 같은지 확인합니다. 테스트 중 프로세스를 강제 종료하면 테스트 전용 행이 남을 수 있으므로 전용 테스트 DB 사용을 권장합니다.

합계 한도 테스트는 약 9천 개의 테스트 전용 거래를 배치 삽입하고, 실제 합계를 안전 정수 한도 바로 아래까지 채운 뒤 두 앱 인스턴스의 동시 POST·PATCH를 검증합니다. 이후 테스트 전용 거래를 모두 제거합니다. 현재 DB에 여유가 없으면 별도의 개발·테스트 DB를 준비해야 합니다.

Ledger 통합 테스트는 기존 목록과의 정렬 일치, 기본 카테고리 10개, 거래 추가·수정·삭제 및 카테고리 이름 변경 반영, DTO와 참조 무결성을 확인합니다. 스냅샷 테스트는 실제 카테고리 SELECT 이후 거래 SELECT 전에 읽기만 대기시킨 뒤, 별도 연결의 기존 CRUD 요청을 모두 커밋하고 읽기를 재개합니다. 쓰기가 읽기에 막히지 않고, 전체 응답이 변경 전 스냅샷과 정확히 일치하는지 확인합니다. 합계 검증은 롤백 트랜잭션 안에서 전용 거래를 삽입하여 정확히 `MAX_SAFE_INTEGER`일 때 200, 1원 초과 시 안전한 500인지 검사합니다.

Node.js 24.11.0 / 로컬 MySQL 9.6.0에서 기본 테스트 **28개**, DB 테스트 **19개(하위 테스트 14개 포함)**가 통과했습니다. PM2 설정, ENV_FILE 선택·오류·주입 우선순위, 운영 초기화의 확인 인자·생성·보존·충돌 롤백, 기존 거래·카테고리·Ledger API·health를 함께 검증했습니다. 검증 전후 기존 카테고리 10개·거래 0개의 해시가 일치했습니다. 타입 검사·빌드·Prisma 스키마 검증과 배포 점검 SQL의 SELECT 11개도 통과했습니다. 운영 설정 형식의 임시 파일로 빌드된 서버를 loopback에서 실행하여 기존 조회 API와 정상 종료를 확인했습니다. 실제 PM2·Ubuntu·운영 계정 권한과 MySQL 8.4 실행·백업 복원은 아직 실행 검증하지 않았습니다.

## 후속 작업 및 배포 설정

이 절은 초기 API 개발 단계의 후속 계획입니다. 현재 단일 사용자 서버 세션 인증과 React 연동은 구현했으며 운영 적용은 대기 중입니다. 기존 운영 서비스의 전환은 [서버 세션 전환 계획](docs/persistent-sessions-rollout.ko.md)을 따릅니다.

후속 작업에서는 인증 후 사용자별 Ledger 범위와 생성 요청의 멱등성 정책을 검토할 수 있습니다. 사용자별 데이터로 확장하면 Ledger의 두 SELECT와 현재 DB 전체에 적용하는 합계 정책을 모두 사용자별로 분리해야 합니다. 프론트엔드 연동 시 서버 URL을 별도 설정으로 주입하고 `version: 1`, 문자열 ID, 날짜 문자열·숫자 금액, 공통 오류 및 요청 ID를 처리해야 합니다. 거래 부분 조회를 전체 Ledger로 취급하면 통계가 달라지므로 전체 배열 계약을 유지합니다.

실제 서버에서 따라 할 전체 순서는 **[Ubuntu 배포 문서](docs/deployment.md)**에 정리했습니다. 운영 `.env`는 앱 계정, `.env.migration`은 마이그레이션 계정을 사용합니다. 새 라이브러리 없이 선택적 ENV_FILE만 추가했습니다. PM2는 `my-budget-backend` 단일 프로세스를 실행하며 비밀정보는 설정에 저장하지 않습니다. HOST=127.0.0.1, 기본 제안 PORT=3004이고 포트 충돌을 확인한 뒤 결정합니다. 기존 서비스·Nginx·방화벽은 변경하지 않습니다.

다음은 문서의 사전 점검·백업을 완료한 후 **서버에서 별도로 실행할 명령의 요약**입니다. 아직 이 명령들을 운영에서 실행하지 않았습니다.

```sh
# .env.production.example → .env, .env.migration.example → .env.migration
# 실제 계정 설정·chmod 600·백업·DB 접속 대상 확인 후
unset NODE_ENV HOST PORT DATABASE_URL ENV_FILE
npm ci --include=dev
npm run build
ENV_FILE=.env.migration npm run db:check
ENV_FILE=.env.migration npm run db:deploy
ENV_FILE=.env.migration npm run db:status
ENV_FILE=.env.migration npm run db:init:production
ENV_FILE=.env.migration npm run db:init:production -- --confirm-target '127.0.0.1:3306/my_budget'
pm2 start ecosystem.config.cjs --only my-budget-backend
curl --fail http://127.0.0.1:3004/health
pm2 logs my-budget-backend --lines 100 --nostream
```

운영 서버 접속·운영 DB 변경·외부 공개·배포·프론트엔드 수정·Git commit/push는 수행하지 않았습니다. Prisma 스키마·마이그레이션과 기존 API는 유지합니다.


## 서버 세션 인증 — 구현 완료, 운영 반영 전

금융 `/api`는 쿠키 기반 서버 세션 인증 후에만 호출됩니다. `/health`는 금융 데이터 없는 기존 상태 확인 경로입니다. JWT·회원가입·다중 사용자 관리·인증 해제 환경변수는 없습니다. `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, HTTPS `AUTH_ORIGIN`을 설정하지 않으면 기본 앱 생성이 실패합니다.

- `POST /api/v1/auth/login`: JSON `{ username, password }`, 정확한 Origin 및 `X-Budget-Request: 1`, HTTPS 필요. 성공 200 `{ authenticated: true, csrfToken, expiresAt }`와 HttpOnly 쿠키 발급.
- `GET /api/v1/auth/session`: 유효한 쿠키일 때 같은 응답, 미인증 401.
- `POST /api/v1/auth/logout`: 본문 없음. 정확한 Origin, `X-Budget-Request: 1`, 유효 세션이면 `X-CSRF-Token` 필요. 세션 삭제 후 204 및 쿠키 만료. 이미 폐기·만료된 경우에도 204.
- 금융 POST·PATCH·DELETE: 유효한 세션, 정확한 Origin, 세션과 일치하는 `X-CSRF-Token` 필요. 기존 CRUD 상태 코드·DTO는 유지.
- 로그인 시도는 성공·실패를 모두 IP당 15분 5회, 프로세스 전체 15분 100회로 제한합니다. 한도는 메모리에만 있어 재시작하면 초기화됩니다. 세션은 MySQL에 있어 재시작해도 유지됩니다.
- 세션은 최초 로그인부터 30일 고정이며 연장하지 않습니다. 원본 세션 토큰은 쿠키에만 있고 DB에는 SHA-256 해시만 저장합니다. CSRF 토큰은 별도 값으로 서버 및 클라이언트 메모리에서 사용합니다.
- 비밀번호 해시 또는 사용자명 변경은 기존 세션을 모두 무효화합니다. 긴급 폐기는 승인된 DB 관리 절차에서 `Session` 행을 삭제합니다.
- 새 migration은 Session 테이블만 추가합니다. 운영에서는 별도 승인 전 적용하지 않습니다.

비밀번호 해시는 대화형 터미널에서 숨김 입력으로 생성합니다. 출력 해시는 서버 전용 `.env`의 `AUTH_PASSWORD_HASH`에 작은따옴표로 감싸 저장하고 파일 권한을 0600으로 유지합니다. 해시도 공유하거나 프론트 환경변수에 넣지 마세요.

```sh
python3 -c 'import getpass; print(getpass.getpass("새 비밀번호: "))' | node --import tsx scripts/hash-password.ts
```

운영 전환 전 검증 도구는 금융 데이터를 읽기만 하며 인증 세션만 생성·폐기합니다. 반드시 새로운 세션 인증 백엔드를 연결하되 웹 Basic은 유지한 상태에서 먼저 실행합니다. Basic 인증 401이 아닌 Express의 JSON `UNAUTHENTICATED` 401인지 검사합니다.

```sh
python3 scripts/verify-session-input.py | node --import tsx scripts/verify-session-auth.ts   --base-url https://budget.ecoma.kro.kr   --legacy-api-url https://budget-api.ecoma.kro.kr
```

이 명령은 운영 적용 승인 이후의 절차 예시입니다. 운영에서 이번 작업 중 실행하지 않았습니다. 상세 변경·검증·전환 기준은 작업 디렉터리의 `IMPLEMENTATION-REPORT.ko.md`를 참조하세요.


## MySQL SHA-2 콜드 인증과 안전한 연결 설정

현재 드라이버는 `@prisma/adapter-mariadb` 7.10.1 / MariaDB Connector 3.5.4입니다. MySQL 8의 `caching_sha2_password`는 캐시가 비었을 때 전체 인증을 수행합니다. 기존 TCP 설정에는 TLS와 RSA 공개키가 없어 재기동 직후 `ER_CANNOT_RETRIEVE_RSA_KEY`(45044)가 발생했습니다. 인증 캐시를 미리 채우는 방식은 해결책으로 사용하지 않습니다.

애플리케이션 어댑터는 다음 **두 환경변수 중 하나**를 선택할 수 있습니다. 미지정 시 기존 연결 옵션을 유지하므로 SHA-2 계정은 배포 전에 반드시 구성해야 합니다. 두 항목 동시 지정, 빈 값, 잘못된 파일은 시작 시 실패합니다.

- 같은 서버의 루프백 DB: `DATABASE_RSA_PUBLIC_KEY_FILE=/etc/my-budget/mysql-public.pem`. 서버 관리자가 **신뢰한 SSH/관리 경로**로 확인한 MySQL `caching_sha2_password` RSA 공개키(2048비트 이상)를 고정합니다. 파일의 지문을 서버 원본과 대조하고 일반 사용자가 교체하지 못하도록 소유자·권한을 설정합니다. 개인키는 복사하지 않습니다. 이 옵션은 `127.0.0.1`, `::1`, `localhost`에만 허용되며 **비밀번호 교환만 암호화**합니다. 서버 키 교체 시 파일도 승인된 절차로 갱신해야 합니다.
- 원격 DB 또는 전체 통신 암호화: `DATABASE_TLS_CA_FILE=/etc/my-budget/mysql-ca.pem`. 신뢰한 CA를 별도 확보하고 `DATABASE_URL`의 호스트가 서버 인증서 SAN과 일치해야 합니다. TLS 1.2 이상, 인증서 체인·호스트 검증을 강제합니다. 호스트 검증 생략 옵션은 제공하지 않습니다. CA 갱신도 관리 절차에 포함합니다.

공개키 자동 수신(`allowPublicKeyRetrieval`), 인증서 검증 해제, SHA-2 플러그인 다운그레이드, 평문 비밀번호 설정 파일의 Git 추가는 하지 않습니다. 환경변수 값·URL·키 본문은 연결 오류 로그에 출력하지 않습니다. 선택한 파일은 새 프로세스 시작 때 읽으므로 배포 전 존재·권한을 확인해야 합니다.

위 환경변수는 **Node 애플리케이션 어댑터와 이를 사용하는 관리 스크립트**에 적용됩니다. Prisma CLI의 마이그레이션 엔진은 별도 연결 경로이므로 이 설정을 자동 적용한다고 가정하지 않습니다. 마이그레이션 계정·도구의 연결 보안과 접속 대상은 운영 적용 시 별도로 확인합니다. 운영 DB 초기화/인증 플러그인 변경은 필요하지 않습니다. Session 추가 마이그레이션만 검토 후 적용하고 `seed`, `reset`, 운영 `test:db`는 실행하지 않습니다.

격리 검증에서는 기존 콜드 실패를 먼저 재현한 뒤 고정 RSA와 검증 TLS의 최초 연결, 틀린 RSA/CA/인증서 호스트 거절, 연결 강제 종료·MySQL 재기동·백엔드 프로세스 재시작 뒤 세션 유지를 확인했습니다. 실제 운영 DB의 계정·인증서·키 구성 및 iPhone 홈 화면 PWA는 아직 검증하지 않았습니다.

전환 전에는 **웹 Basic을 유지한 채** 새 API에 `scripts/verify-session-auth.ts`를 실행합니다. Basic 헤더는 보내되 Cookie를 뺀 금융 요청이 Express JSON `401 / UNAUTHENTICATED`, `WWW-Authenticate` 없음, `no-store`인지 확인해야 합니다. 외곽 Nginx Basic 401은 성공으로 인정하지 않습니다. 로그인·세션·금융 GET·CSRF 거절·로그아웃·기존 쿠키 재사용 거절까지 통과한 뒤 별도 운영 승인 범위에서 웹 Basic만 조정합니다. 기존 API 호스트의 Basic은 유지합니다.

[공식 드라이버 연결 옵션](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options), [MySQL SHA-2 인증](https://dev.mysql.com/doc/refman/8.0/en/caching-sha2-pluggable-authentication.html)
