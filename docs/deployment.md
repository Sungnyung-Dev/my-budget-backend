> 이 문서는 최초 내부 HTTP 설치 절차입니다. 현재 운영 서비스의 쿠키 로그인 전환은 [서버 세션 전환 계획](persistent-sessions-rollout.ko.md)을 따르세요. 운영에서 아래 seed·초기화 절차를 재실행하지 않습니다.

# Ubuntu 내부 HTTP 배포 절차

이 문서는 운영 서버에서 사람이 실행할 절차입니다. 이번 구현 작업에서는 서버 접속·배포·운영 DB 변경을 수행하지 않았습니다. 대상 서버에는 이미 MySQL `my_budget`, 앱 계정, 마이그레이션 계정, Nginx·PM2 및 다른 앱이 있습니다. 실제 사용자·경로·권한·포트는 확인 후 사용합니다.

현재 API에는 인증이 없습니다. **HOST=127.0.0.1을 유지하며 Nginx 라우팅, 방화벽·Oracle 보안 목록 포트 개방은 하지 않습니다.** HTTPS·VPN·인증 설정도 이 문서에서 변경하지 않습니다. 점검 HTTP 요청은 서버 내부에서만 보냅니다.

명령은 Ubuntu의 Bash, 프로젝트 루트에서 실행합니다. 각 단계의 종료 코드와 출력을 확인하고 실패하면 다음 쓰기 단계로 넘어가지 않습니다. 예시 사용자명·경로는 실제 준비된 값으로 바꾸며 비밀번호는 파일에서만 편집합니다.

## 1. 기존 환경 확인

기존 앱을 관리하는 배포 사용자와 PM2 daemon을 확인합니다. 임의로 root PM2를 시작하거나 Node·PM2를 전역 업그레이드하지 않습니다.

```sh
whoami
node --version
npm --version
command -v node
command -v pm2
pm2 --version
pm2 list
systemctl list-unit-files 'pm2-*'
mysql --version
ss -ltnp '( sport = :3004 )'
```

Node.js는 `.nvmrc`의 24.x 또는 `package.json`의 지원 버전을 사용합니다. 기존 버전이 맞지 않으면 별도 Node 설치·사용 경로를 결정하고 이 앱에만 적용합니다. 이미 실행 중인 다른 앱의 interpreter·startup unit을 바꾸지 않습니다. `pm2 list`에서 동일한 `my-budget-backend` 이름이 있으면 신규 실행 대신 해당 프로세스의 경로·소유자를 먼저 확인합니다.

3004가 사용 중이면 비어 있는 다른 포트를 선택하여 운영 `.env`의 PORT와 점검 명령을 함께 바꿉니다. Nginx 설정 변경이나 서비스 재시작은 필요하지 않습니다.

## 2. 저장소 준비

아래는 경로 예시입니다. 이 배포 준비 파일들이 포함된 검토된 커밋을 사용합니다. 실제 commit·push는 별도 작업입니다.

```sh
mkdir -p "$HOME/apps"
git clone https://github.com/Sungnyung-Dev/my-budget-backend.git "$HOME/apps/my-budget-backend"
cd "$HOME/apps/my-budget-backend"
git status --short
git rev-parse HEAD
```

이미 clone되어 있으면 새로 덮어쓰지 않습니다. 업데이트는 9절을 따릅니다. 저장소 토큰은 URL에 넣지 말고 기존 서버의 인증 방식을 사용합니다.

## 3. 운영 환경변수와 DB 계정 분리

```sh
umask 077
cp -n .env.production.example .env
cp -n .env.migration.example .env.migration
chmod 600 .env .env.migration
```

기존 파일이 있으면 보존합니다. 편집기에서 예시 비밀번호·계정명을 실제 준비된 값으로 바꾸고 같은 MySQL 호스트·포트와 `my_budget` DB를 가리키는지 확인합니다. URL 비밀번호의 `@`, `#`, `/`, `%` 등은 URL 인코딩합니다. 파일 내용이나 URL을 터미널 로그·티켓·셸 이력에 출력하지 않습니다.

| 설정 | 앱 `.env` | 관리 명령용 `.env.migration` |
| --- | --- | --- |
| NODE_ENV | production | production |
| HOST | 127.0.0.1 | 127.0.0.1 |
| PORT | 3004 또는 확인한 빈 포트 | 같은 값; CLI는 HTTP 서버를 열지 않음 |
| DATABASE_URL | 준비된 최소 권한 앱 계정 | 준비된 마이그레이션 계정, 같은 DB |

`ENV_FILE`은 선택 사항입니다. 생략 시 `.env`, `ENV_FILE=.env.migration`이면 해당 파일만 로딩합니다. 명시한 파일이 없으면 오류로 종료합니다. 이미 주입한 네 환경변수가 파일보다 우선하므로 관리 명령 전 셸의 이전 값을 제거합니다.

```sh
unset NODE_ENV HOST PORT DATABASE_URL ENV_FILE
```

ENV_FILE을 `.env` 안에 넣지 않습니다. `.env.migration`을 `.env`로 덮어쓰거나 마이그레이션 URL을 PM2의 환경으로 export하지 않습니다. 실제 `.env*`는 Git에서 제외되며 세 가지 `.example`만 추적합니다.

앱 계정은 두 업무 테이블에 필요한 SELECT·INSERT·UPDATE·DELETE만 사용하고 DDL·TRIGGER·다른 DB 권한은 부여하지 않는 구성이 적절합니다. 마이그레이션 계정은 검토한 DDL, 인덱스·외래키, CHECK·트리거 생성, `_prisma_migrations` 관리와 초기 카테고리 INSERT·SELECT 권한이 필요합니다. 현재 두 계정은 이미 준비되어 있으므로 여기서는 생성·GRANT를 실행하지 않습니다. 별도의 백업 계정 권한도 5절에서 확인합니다.

## 4. 의존성 설치·빌드·접속 대상 확인

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
npm run db:check
ENV_FILE=.env.migration npm run db:check
```

Prisma CLI·TypeScript·tsx는 devDependencies이므로 이 절차에서는 devDependencies도 유지합니다. `npm ci --omit=dev`나 배포 후 `npm prune --omit=dev`는 사용하지 않습니다. `npm ci` 자체는 DB를 변경하지 않고, build의 Client 생성에도 DB 접속은 필요하지 않습니다.

`db:check`는 읽기 전용 SELECT로 설정 환경·호스트·포트·DB·계정과 실제 `DATABASE()`, `CURRENT_USER()`, 서버 hostname·port·버전을 표시합니다. 비밀번호·원본 URL은 출력하지 않습니다. 두 파일의 DB·서버가 같고 계정이 다르며, 실제 DB가 `my_budget`인지 확인합니다. mysql의 서버 hostname은 접속 URL의 `127.0.0.1`과 다를 수 있습니다.

이 서버의 DB에는 `npm run test:db`를 실행하지 않습니다. 통합 테스트는 별도 로컬 개발·테스트 DB 전용입니다.

## 5. 마이그레이션 전 백업

초기 배포라도 DB가 비어 있다고 가정하지 않습니다. 준비된 DB 접속 정보로 다음 읽기 명령을 먼저 실행합니다. 비밀번호는 `--password` 프롬프트에서 입력하며 예시 사용자명은 실제 계정으로 바꿉니다.

```sh
mysql --protocol=TCP --host=127.0.0.1 --port=3306 --user=budget_migrate --password my_budget
```

```sql
SELECT DATABASE(), CURRENT_USER(), @@hostname, @@port, VERSION();
SHOW GRANTS FOR CURRENT_USER;
SHOW TABLES;
SHOW VARIABLES WHERE Variable_name IN ('log_bin', 'log_bin_trust_function_creators');
```

이미 업무 테이블이 있는데 마이그레이션 이력이 없다면 바로 초기 마이그레이션을 적용하지 않습니다. 기존 DDL과 마이그레이션을 대조한 뒤 별도의 baseline 계획이 필요합니다. 초기 마이그레이션은 비어 있는 DB에 테이블을 생성합니다. CHECK·`utf8mb4_0900_*`를 지원하는 MySQL 버전인지 확인합니다. binary logging 정책에 따라 CREATE TRIGGER에 추가 권한이 필요하면 DBA가 검토해야 하며 공유 서버의 전역 설정을 임의로 바꾸지 않습니다.

현재 스키마의 모든 테이블(InnoDB)·데이터·트리거를 백업하는 예시입니다. 예시의 budget_backup은 전용 백업 계정 또는 필요한 권한이 있는 기존 관리 계정으로 바꿉니다. SELECT, 필요 시 SHOW VIEW, 트리거 백업을 위한 TRIGGER 권한을 확인합니다. `--no-tablespaces`로 PROCESS 요구를 피하고 GTID 변경을 포함하지 않습니다. 백업 도중 해당 DB에 DDL을 실행하지 않습니다. [mysqldump 공식 설명](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)

```sh
(
  set -euo pipefail
  umask 077
  backup_dir="$HOME/backups/my-budget"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="$backup_dir/my_budget-$(date -u +%Y%m%dT%H%M%SZ).sql"
  set -o noclobber
  mysqldump --protocol=TCP --host=127.0.0.1 --port=3306 \
    --user=budget_backup --password --single-transaction --quick \
    --triggers --hex-blob --no-tablespaces --set-gtid-purged=OFF \
    --skip-add-drop-table --skip-add-locks my_budget > "$backup_file"
  test -s "$backup_file"
  sha256sum "$backup_file" > "$backup_file.sha256"
)
```

종료 코드가 0인지 확인합니다. 실패한 부분 파일은 유효한 백업으로 취급하지 않습니다. `--databases`를 쓰지 않아 CREATE DATABASE/USE를 포함하지 않고, 테이블 삭제 구문도 제외합니다. 현재 없는 routine·event는 범위에 포함하지 않으므로 향후 추가 시 백업 정책·권한도 갱신합니다. 개인정보가 있는 백업은 저장소 밖에서 접근을 제한하고 암호화한 별도 보관본과 보존·복원 일정을 관리합니다.

## 6. 마이그레이션·기본 카테고리 초기화

백업 검증 후 프로젝트 루트에서 실행합니다.

```sh
ENV_FILE=.env.migration npm run db:status
ENV_FILE=.env.migration npm run db:deploy
ENV_FILE=.env.migration npm run db:status
```

첫 status의 pending 결과는 적용할 마이그레이션을 확인하는 용도이며 미적용 파일이 있으면 종료 코드가 1일 수 있습니다. 출력이 단순 pending인지 확인하고, 실패한 마이그레이션이나 이력 불일치라면 배포를 중단합니다. deploy는 기존 `prisma/migrations`만 적용하며 shadow DB와 개발용 reset을 사용하지 않습니다. 적용된 migration.sql은 수정하지 않습니다. MySQL DDL은 여러 문장을 한꺼번에 롤백할 수 없으므로 실패 시 일부 DDL이 적용됐을 수 있습니다. 임의로 이력만 성공 처리하거나 같은 SQL을 반복하지 않습니다. [Prisma 운영 마이그레이션](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)

관리자 또는 필요한 메타데이터 조회 권한이 있는 계정으로 읽기 전용 SQL을 실행합니다.

```sh
mysql --protocol=TCP --host=127.0.0.1 --port=3306 --user=budget_migrate --password \
  my_budget < deploy/verify-database.sql
```

초기화 전에는 기본 카테고리 조회가 0개일 수 있습니다. 다음 항목을 확인합니다.

- `_prisma_migrations`의 기대한 커밋에 포함된 마이그레이션이 finished 상태이며 rolled_back_at이 NULL.
- 두 테이블은 InnoDB, `utf8mb4_0900_bin`; Category.name은 `utf8mb4_0900_as_ci`.
- Transaction.amount는 BIGINT, date는 DATE. CHECK 5개가 ENFORCED=YES.
- Category `(type,name)`·`(id,type)` UNIQUE, 거래 날짜 및 `(categoryId,type)` 인덱스.
- 복합 외래키의 UPDATE_RULE·DELETE_RULE은 RESTRICT.
- `Category_type_immutable`은 BEFORE UPDATE이며 유형 변경 시 SIGNAL을 발생시킴. DEFINER 계정의 존재·권한을 유지.
- 고아·유형 불일치 거래 0개, total_is_safe=1.

기본 카테고리는 서버 시작 시 자동 생성되지 않습니다. 먼저 조회만 하는 명령으로 환경·대상을 확인한 다음, 표시된 대상 문자열을 직접 확인하여 초기화합니다.

```sh
ENV_FILE=.env.migration npm run db:init:production
# 위 출력의 호스트·포트·DB를 확인한 뒤 실행합니다.
ENV_FILE=.env.migration npm run db:init:production -- --confirm-target '127.0.0.1:3306/my_budget'
```

`NODE_ENV=production`과 정확한 `host:port/database` 확인값이 모두 필요합니다. 인자 없는 명령은 DB 식별 정보만 조회하고 INSERT하지 않습니다. 초기화는 공유 Seed 로직의 strict 모드와 단일 Serializable 트랜잭션을 사용합니다.

- 없는 기본 ID는 iOS와 같은 ID·이름·유형·symbol로 생성합니다.
- 같은 ID·같은 유형은 기존 이름·symbol·타임스탬프까지 그대로 보존합니다.
- 다른 ID가 동일 유형·이름을 사용하면 DB collation 기준으로 충돌을 보고합니다. 같은 ID의 다른 유형도 거부합니다.
- 충돌·동시 실행 경합 등 트랜잭션 내 실패 시 이번 초기화의 전체 변경이 롤백됩니다. 커밋 응답 중 연결이 끊어져 결과가 불명확하면 현재 카테고리를 조회한 뒤 재실행합니다. 중복 생성 방지 정책은 그대로 적용됩니다.
- 기존 거래를 변경·삭제하지 않고, 카테고리 UPDATE·DELETE도 하지 않습니다. 여러 번 실행해도 중복 생성되지 않습니다.

충돌을 해결하려고 기존 ID·이름을 자동 변경하거나 데이터를 삭제하지 않습니다. 기존 사용자 데이터와 기본 ID 계약을 검토하는 별도 결정이 필요합니다. 개발용 `db:seed`는 계속 development·loopback 전용이며 운영에서는 거부됩니다.

## 7. PM2 실행·로그·자동 실행

프로젝트 `.env`의 HOST=127.0.0.1, 선택한 PORT 및 앱 계정을 재확인합니다. 기존 PM2 목록에 같은 이름이 없는 최초 배포에서만 실행합니다.

```sh
unset NODE_ENV HOST PORT DATABASE_URL ENV_FILE
pm2 start ecosystem.config.cjs --only my-budget-backend
pm2 describe my-budget-backend
pm2 logs my-budget-backend --lines 100 --nostream
```

설정은 CommonJS `.cjs`이며 ESM 프로젝트에서도 로드됩니다. 기존 PM2 버전이 `.config.cjs`와 filter_env를 지원하는지 확인합니다. cwd는 프로젝트 루트, 실행 파일은 `dist/server.js`, interpreter는 설정을 실행한 Node의 절대 경로입니다. 단일 fork 프로세스, watch 없음, 3초 재시작 지연을 사용합니다. 초기 불안정 재시작은 10회로 제한하며 종료 대기는 서버의 최대 10초보다 긴 12초입니다. PM2 online 표시만으로 DB·HTTP 정상 여부를 판단하지 말고 8절을 수행합니다.

NODE_ENV=production을 지정하고 HOST·PORT·DATABASE_URL·ENV_FILE의 셸 상속을 필터링합니다. 자식 앱이 `.env`를 직접 읽으므로 마이그레이션 계정이 PM2에 들어가지 않습니다. HOST·PORT는 `.env.production.example`의 127.0.0.1·3004를 기본 제안값으로 사용합니다. PM2 daemon 환경·dump에도 비밀을 남기지 않도록 위 unset을 유지하고 URL을 export하지 않습니다. `.env`를 변경하면 해당 앱을 restart하여 다시 읽습니다. [PM2 설정](https://pm2.keymetrics.io/docs/usage/application-declaration/)

로그는 기본 PM2_HOME의 logs 아래 이 앱 이름의 out/error 파일에 기록됩니다. `pm2 describe`에서 실제 경로를 확인합니다. 다른 앱 로그를 지우는 전체 flush·글로벌 로그 모듈 설정은 사용하지 않습니다. `deploy/logrotate.my-budget-backend.example`의 두 경로·사용자·그룹을 확인한 값으로 치환하고 기존 회전 정책과 중복되지 않는지 검토합니다. `logrotate --debug /검토한/파일`로 먼저 확인한 후 이 앱 파일만 관리하도록 등록합니다. copytruncate는 회전 순간 일부 로그를 잃을 수 있습니다. [PM2 로그](https://pm2.keymetrics.io/docs/usage/log-management/)

재부팅 자동 실행은 기존 배포 사용자에 대한 systemd PM2 unit을 먼저 확인합니다. 이미 설정되어 있으면 재생성·재시작하지 않습니다. 현재 목록에 이 앱과 기존 앱이 올바르게 있는지 확인한 뒤 저장합니다.

```sh
pm2 list
pm2 save
```

`pm2 save`는 같은 사용자의 **전체 현재 목록**을 영속화하므로 기존 앱 목록과 다르면 먼저 원인을 확인합니다. 프로세스를 재시작하는 명령은 아닙니다. 해당 사용자의 startup unit이 전혀 없을 때만 `pm2 startup`을 실행하여 제안된 사용자·home·Node 경로를 검토한 뒤 출력된 명령을 사용합니다. 기존 PM2 서비스에 `unstartup`, `kill`, `update`, 전체 restart/reload를 실행하지 않습니다. Node 경로 변경은 기존 앱 자동 실행에도 영향을 줄 수 있어 별도로 검토합니다. [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/)

이 작업을 검증하기 위해 운영 서버를 임의로 재부팅하지 않습니다. 향후 계획된 재부팅 후 같은 사용자로 `pm2 describe my-budget-backend`, 실제 확인한 `pm2-사용자` unit 상태와 8절을 확인합니다.

## 8. 읽기 전용 운영 점검

```sh
ss -ltnp '( sport = :3004 )'
curl --fail --silent --show-error http://127.0.0.1:3004/health
curl --fail --silent --show-error http://127.0.0.1:3004/api/v1/ledger \
  | node --input-type=module -e 'let text=""; for await (const chunk of process.stdin) text+=chunk; const data=JSON.parse(text); if(data.version!==1 || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) process.exit(1); console.log({version:data.version, categories:data.categories.length, transactions:data.transactions.length});'
npm run db:check
pm2 describe my-budget-backend
pm2 logs my-budget-backend --lines 100 --nostream
```

수신 주소는 127.0.0.1이어야 하며 `0.0.0.0`·`[::]`이면 이 앱만 중지하고 HOST 설정을 확인합니다. health는 `{"status":"ok"}`를 반환하지만 매번 DB를 조회하지 않습니다. 실제 DB 확인은 Ledger 또는 db:check로 수행합니다. Ledger 점검은 개인정보 전체를 로그로 남기지 않고 개수만 출력합니다.

초기화 후 `deploy/verify-database.sql`을 다시 실행하여 기본 ID 10개를 확인합니다. 새 DB라면 지출 7개·수입 3개이며 이름·symbol은 README Seed 목록과 같습니다. 기존에 바뀐 이름·symbol은 보존되므로 기본값으로 덮어쓰기 위해 재실행하지 않습니다. 전체 카테고리 수는 사용자 추가분 때문에 10개보다 많을 수 있습니다. 상태 점검에 거래·카테고리 POST·PATCH·DELETE는 사용하지 않습니다.

## 9. 업데이트와 해당 앱만 재시작

현재 커밋을 기록하고, 짧은 점검 중단 시간을 잡습니다. 이 단순 절차는 단일 fork 앱의 무중단 배포를 보장하지 않습니다. 실행 중 npm ci나 dist 덮어쓰기를 피하기 위해 이 앱만 중지한 후 설치·빌드합니다.

```sh
cd "$HOME/apps/my-budget-backend"
git status --short
previous_commit="$(git rev-parse HEAD)"
printf '%s\n' "$previous_commit"
pm2 stop my-budget-backend
# 5절의 새 백업을 완료하고 검증한 뒤 계속합니다.
git pull --ff-only
npm ci --include=dev
npm run typecheck
npm test
npm run build
ENV_FILE=.env.migration npm run db:check
ENV_FILE=.env.migration npm run db:status
ENV_FILE=.env.migration npm run db:deploy
ENV_FILE=.env.migration npm run db:status
```

새 마이그레이션 SQL은 적용 전에 검토합니다. 실패하면 재시작 단계로 넘어가지 않습니다. 새 기본 카테고리 초기화가 필요한 릴리스일 때만 6절을 별도로 수행합니다. 초기화 명령은 PM2 시작·재시작에 포함하지 않습니다.

```sh
unset NODE_ENV HOST PORT DATABASE_URL ENV_FILE
pm2 restart ecosystem.config.cjs --only my-budget-backend --update-env
# 8절의 모든 점검을 마친 뒤
pm2 save
```

환경변수 파일만 바꾼 경우에도 위 해당 앱 restart를 사용합니다. ecosystem 설정을 다시 읽으며 새 자식 프로세스가 `.env`를 로딩합니다. `restart all`, `reload all` 또는 다른 앱의 설정 변경은 필요하지 않습니다.

## 10. 장애 복구와 복원 연습

시작 실패는 이 앱의 로그·Node 경로·.env 권한·포트 충돌·앱 DB 계정을 확인합니다. 마이그레이션 계정으로는 연결되지만 앱 계정으로 실패할 수 있으므로 둘 다 db:check를 수행합니다. 오류 응답의 X-Request-Id와 해당 앱 로그를 대조하며 URL·비밀번호·전체 Ledger를 공유 로그에 붙이지 않습니다.

코드 문제이고 현재 DB 스키마가 이전 코드와 호환됨을 확인했다면 기록한 커밋으로 복귀하여 빌드하고 이 앱만 재시작합니다. 기존 .env는 유지합니다.

```sh
pm2 stop my-budget-backend
git switch --detach "$previous_commit"
npm ci --include=dev
npm run build
unset NODE_ENV HOST PORT DATABASE_URL ENV_FILE
pm2 restart ecosystem.config.cjs --only my-budget-backend --update-env
```

이후 8절을 확인하고 pm2 save를 수행합니다. detach 상태이므로 다음 업데이트는 검토한 브랜치로 돌아온 뒤 진행합니다. 코드 복귀는 이미 적용된 DB 마이그레이션을 되돌리지 않습니다. 스키마 호환성이 없으면 forward fix 또는 별도 승인한 복원 계획이 필요합니다. 실패한 MySQL DDL은 실제 적용 상태·백업·Prisma 이력을 검토하여 복구하며, 초기화·reset·업무 테이블 삭제·강제 baseline으로 해결하지 않습니다.

백업 복원 연습은 **운영과 분리된 MySQL 테스트 인스턴스**에서 합니다. 아래 13306은 예시이며 실제 분리된 서버·포트를 확인합니다. 운영 3306이나 `my_budget`을 대상으로 아래 restore를 실행하지 않습니다.

1. DBA가 고유한 빈 `my_budget_restore_test_YYYYMMDD` DB와 필요한 권한을 테스트 인스턴스에 준비합니다. 이미 데이터가 있으면 다른 새 이름을 사용합니다.
2. 백업 `.sha256`을 `sha256sum -c 백업파일.sql.sha256`으로 확인합니다. dump의 DEFINER 계정·권한과 서버 버전을 검토하고 필요 계정을 테스트 인스턴스에 준비합니다. 원본 SQL을 임의로 치환해 트리거를 누락하지 않습니다.
3. 다음 명령으로 대상 DB·계정·포트를 확인하고 빈 DB에만 복원합니다.

```sh
mysql --protocol=TCP --host=127.0.0.1 --port=13306 --user=restore_operator --password \
  my_budget_restore_test_YYYYMMDD \
  -e 'SELECT DATABASE(), CURRENT_USER(), @@hostname, @@port; SHOW TABLES;'
mysql --protocol=TCP --host=127.0.0.1 --port=13306 --user=restore_operator --password \
  my_budget_restore_test_YYYYMMDD < /안전한/백업파일.sql
mysql --protocol=TCP --host=127.0.0.1 --port=13306 --user=restore_operator --password \
  my_budget_restore_test_YYYYMMDD < deploy/verify-database.sql
```

복원 명령의 모든 오류를 확인합니다. 백업 당시 행 수·금액 합계·카테고리, 마이그레이션 이력, CHECK·외래키·인덱스·collation·트리거를 비교합니다. 별도 백엔드 테스트 프로세스에 복원 DB URL과 다른 loopback HTTP 포트를 주입하여 health·Ledger 읽기를 확인합니다. 운영 PM2의 .env를 복원 테스트용으로 바꾸지 않습니다. 복원에 걸린 시간·백업 시점과 복구 가능한 범위를 기록합니다.

운영 복원은 최신 데이터 손실 범위와 원인을 검토하는 별도 작업입니다. 이 문서에는 운영 DB를 비우거나 덮어쓰는 명령을 포함하지 않습니다.

## 이 변경의 검증 범위

로컬 MySQL 9.6.0에서 기본 테스트 28개, DB 테스트 19개가 통과했습니다. 운영 초기화의 중복 방지·기존 행 보존·이름/유형 충돌·전체 롤백, 읽기 전용 CLI 및 기존 API를 검증했고 기존 데이터 전체 해시가 일치했습니다. 타입 검사·빌드·Prisma 스키마 검증, 점검 SQL의 SELECT 11개와 운영 설정 형식의 임시 파일을 사용한 loopback 서버 실행도 통과했습니다. 실제 Ubuntu·PM2 버전·systemd·계정 권한·백업 복원은 대상 환경에서 아직 실행 검증하지 않았습니다.
