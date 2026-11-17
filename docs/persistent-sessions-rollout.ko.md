# 30일 서버 세션 운영 전환 계획

이 문서는 승인 후 실행할 절차입니다. 코드 push는 운영 적용이 아닙니다. 운영 DB migration·Nginx 변경·PM2 시작/재시작·Basic 해제는 별도 승인이 필요합니다. 기존 내부 HTTP 최초 설치 문서의 seed·초기화 절차를 운영 전환에 재사용하지 않습니다.

## 커밋만으로 재현

지원 Node 버전과 npm으로 새 clone에서 실행합니다. 실제 .env는 저장소에 없으므로 빌드에는 테스트 전용 환경을 준비합니다. Prisma Client는 생성 코드여서 커밋하지 않습니다.

```sh
npm ci --include=dev --no-audit --no-fund
npm run db:generate
npm run typecheck
npm test
npm run build
npm run db:validate
```

`test:db`와 `db:deploy` 검증은 별도 MySQL의 루프백 포트와 `_test` DB에서만 수행합니다. 운영 주소를 테스트 환경에 복사하지 않습니다. 격리 검증에서는 SHA-2 계정에 신뢰한 테스트 RSA 공개키를 지정합니다. 프론트도 새 clone에서 `npm ci`, typecheck, lint, test, build를 수행합니다.

## 사전 점검 결과와 배포 조건

2026-11-17 읽기 전용 점검 기준입니다. 실제 적용 직전에 다시 확인합니다.

- 기존 백엔드는 PM2 단일 fork, watch=false, 루프백 3004에서 정상 실행 중입니다. Nginx·MySQL도 정상이고 웹/API Basic이 유지됩니다. 신규 내부 포트 후보 3005는 점검 시 비어 있었습니다.
- 운영 MySQL 8.0.46, 루프백 3306, 앱·마이그레이션 계정은 `caching_sha2_password`입니다. 신뢰한 서버 RSA 공개키를 고정한 새 드라이버의 **읽기 전용 신규 연결**은 성공했습니다. 운영 인증 캐시를 비우거나 서버를 재시작하지 않았으므로 운영 콜드 인증 성공을 증명한 것은 아닙니다. 같은 버전·플러그인의 격리 DB에서는 콜드·재연결·재시작을 검증했습니다.
- 현재 자동 생성 DB 인증서는 URL의 호스트와 일치하는 SAN이 없어 검증 TLS에 그대로 사용할 수 없습니다. 현 루프백 구성에서는 root가 신뢰한 서버 공개키를 배포용 경로에 고정하는 방식을 우선 검토합니다. RSA는 비밀번호 교환만 보호합니다. 원격 연결이나 전체 통신 암호화에는 적절한 SAN 인증서를 준비하고 CA·호스트 검증 TLS를 사용합니다.
- 운영 AUTH_USERNAME/AUTH_PASSWORD_HASH/AUTH_ORIGIN과 새 DB 키 경로 설정은 아직 준비되지 않았습니다. 앱 계정의 DB 전체 CRUD 권한은 Session의 SELECT·INSERT·DELETE도 포함합니다. 관리 계정은 해당 DB의 DDL 권한이 있습니다.
- Session 테이블은 아직 없고 초기 migration 완료 이력은 있습니다. 새 migration은 Session 테이블과 expiresAt 인덱스만 생성합니다. 기존 Category·Transaction·트리거·데이터의 ALTER/UPDATE/DELETE는 없습니다. DDL은 자동 커밋이므로 트랜잭션 rollback으로 취소된다고 가정하지 않습니다.
- 확인한 백업 위치와 예약 작업에서 운영 DB 복구용 백업을 확인하지 못했습니다. Nginx 백업은 DB 백업이 아닙니다. binlog 활성화도 독립 복구 기준점을 대신하지 않습니다. 새 DB 백업과 격리 복원 확인 전에는 배포하지 않습니다.

## 1. 백업과 복구 기준점

현재 Basic이 적용된 웹/API 가상 호스트·공용 snippet, 현재 frontend symlink·릴리스 자산, 기존 backend dist·환경파일·PM2 실행 정보를 비공개 위치에 보존합니다. 최초 무인증 nginx 전체 백업과 HTTPS 활성화 전 HTTP bootstrap은 이번 롤백 기준으로 쓰지 않습니다.

승인 후 관리자가 로컬 MySQL 소켓 또는 검증 TLS 관리 경로로 `mysqldump --single-transaction --quick --routines --triggers --events --hex-blob --no-tablespaces --set-gtid-purged=OFF my_budget`를 수행합니다. 명령행에 비밀번호를 넣지 않고, dump는 0600·디렉터리는 0700으로 관리합니다. 백업 중 해당 DB에 DDL을 실행하지 않습니다. 실제 백업을 별도 MySQL에 복원해 스키마·트리거·제약·migration 이력·행 수 및 데이터 해시를 확인하고 복구 소요 시간을 기록합니다. 운영 금융 데이터를 공개 로그·Git·일반 테스트 DB에 복사하지 않습니다.

실패 시 우선 앱과 라우팅을 복구하고 금융 데이터는 그대로 유지합니다. 승인 이후 생긴 금융 기록이 있을 수 있으므로 과거 DB dump를 운영에 덮어쓰는 것은 일반 앱 롤백 절차가 아닙니다. DB 복구는 별도 장애 판단·승인 아래 수행합니다.

## 2. 별도 릴리스와 서버 전용 설정

실행 중인 저장소에서 npm ci/build를 하지 않습니다. 검토한 커밋을 새 불변 릴리스 디렉터리에 checkout하여 build합니다. frontend도 새 `/var/www/my-budget-web/releases/<release>`에 준비하고 현재 릴리스와 이전 해시 자산을 보존합니다.

root가 서버 RSA 공개키 원본과 지문을 대조한 뒤 `/etc/my-budget/mysql-public.pem` 같은 저장소 밖의 root 소유 파일에 고정하고 앱 사용자에게 읽기 권한만 줍니다. 개인키는 복사하지 않습니다. 키 교체 시 갱신 절차를 정합니다. `DATABASE_RSA_PUBLIC_KEY_FILE`과 `DATABASE_TLS_CA_FILE`은 하나만 설정합니다.

새 backend의 서버 전용 파일에 기존 앱 DB URL, `HOST=127.0.0.1`, `PORT=3005`, production 환경, 단일 사용자명, stdin으로 생성한 scrypt 해시, `AUTH_ORIGIN=https://budget.ecoma.kro.kr`을 설정합니다. .env는 0600이며 Git과 PM2 설정 파일에 비밀값을 쓰지 않습니다. 기존 운영 .env를 덮어쓰지 않습니다.

## 3. Session migration

검토 SQL은 `prisma/migrations/20261117120000_add_session/migration.sql`입니다. 관리 연결의 실제 DB·호스트·포트·계정을 먼저 확인합니다. **Node의 RSA/TLS 옵션은 Prisma CLI에 자동 적용되지 않습니다.** CLI 관리 연결의 검증 TLS 또는 신뢰한 로컬 관리 경로를 별도로 확정하고 격리 환경에서 확인한 후 실행합니다. 현재 앱 env 검증은 DATABASE_URL 쿼리 옵션을 허용하지 않으므로 임의로 TLS URL 쿼리를 넣지 않습니다. 이 관리 연결이 미확정이면 migration 단계에서 중단합니다.

승인한 관리 환경과 릴리스에서만 다음을 실행하며 출력에 인증정보를 넣지 않습니다.

```sh
ENV_FILE=/승인한/관리환경파일 npm run db:status
ENV_FILE=/승인한/관리환경파일 npm run db:deploy
ENV_FILE=/승인한/관리환경파일 npm run db:status
```

초기 migration 재실행, migrate dev/reset, db push, seed, db:init:production, 운영 test:db는 실행하지 않습니다. 새 Session DDL만 pending인지 확인하고 기존 업무 테이블을 바꾸는 예상 밖 SQL이면 중단합니다. 부분 실패 시 blind 재시도하거나 이력을 임의 수정하지 않습니다.

## 4. 새 backend 병행 실행

직전에 3005가 비었는지 재확인합니다. 새 릴리스·서버 전용 환경파일로 별도 PM2 이름 `my-budget-backend-session`을 사용해 루프백 3005에서 시작합니다. 기존 3004 프로세스는 종료/재시작하지 않습니다. 예시는 실제 interpreter·경로를 확인한 후 사용합니다.

```sh
ENV_FILE=/승인한/새앱환경파일 pm2 start /새릴리스/dist/server.js \
  --name my-budget-backend-session --cwd /새릴리스 --interpreter /확인한/node
curl --fail http://127.0.0.1:3005/health
```

health 성공만으로 준비 완료로 판정하지 않습니다. 실제 DB 신규 연결, Session 접근, 무쿠키 금융 JSON 401을 확인해야 합니다. 로그에 DB URL·쿠키·토큰·비밀번호를 출력하지 않습니다. 3005를 외부에 개방하지 않습니다.

## 5. Basic을 유지한 HTTPS 검증

현재 공용 proxy snippet과 Basic snippet을 바로 수정하지 않습니다. 공용 proxy snippet을 복사한 후보 전용 snippet에서 upstream만 `127.0.0.1:3005`로 바꾸고, 웹/API 가상 호스트 후보 파일에서 이 snippet을 참조하도록 준비합니다. API의 Basic include는 유지합니다. Host 제한, Authorization 제거, HTTPS 전달, API no-store, proxy cache off는 유지합니다. 다른 사이트는 건드리지 않습니다.

새 frontend와 후보 라우팅을 배포할 때 양쪽 Basic을 유지합니다. Nginx 구문 확인 후 승인 범위에서 reload합니다. 기존 프론트가 새 API의 401을 받으면 업데이트/재실행으로 새 SPA를 받아야 하며, 무인증 데이터 호환 우회는 만들지 않습니다. 앱 전환 직후 검증 실패 시 즉시 아래 rollback을 실행합니다.

아래 도구에 기존 Basic과 새 앱 계정을 숨김 입력으로 전달합니다.

```sh
python3 scripts/verify-session-input.py | node --import tsx scripts/verify-session-auth.ts \
  --base-url https://budget.ecoma.kro.kr \
  --legacy-api-url https://budget-api.ecoma.kro.kr
```

필수 성공 조건:

1. 올바른 Basic Authorization을 보내고 **세션 Cookie만 생략**한 모든 금융 GET/POST/PATCH/DELETE와 세션 조회가 Express JSON 401 / UNAUTHENTICATED, WWW-Authenticate 없음, no-store입니다. Nginx Basic challenge 401은 실패입니다.
2. 로그인·보안 쿠키·세션 조회·금융 GET·CSRF 없는 쓰기 거절·로그아웃·이전 쿠키 재사용 거절이 통과합니다. 금융 데이터를 변경하지 않고 인증 세션만 생성·폐기합니다.
3. 기존 API 호스트는 Basic 없이 401 challenge를 유지합니다. 인증 후 API 호스트도 새 backend를 사용한다면 Basic만으로 금융 조회가 허용되지 않아야 합니다. 도구 기본 30개 검사는 API 호스트의 Basic 유지만 확인하므로, API 전용 hostname에서 Basic 통과·무쿠키 금융 JSON 401도 추가로 점검합니다. API 도메인을 사용하는 외부 도구는 서버 세션도 필요합니다.

이 도구는 배포 시 인증 세션을 생성하므로 이번 읽기 전용 운영 점검에서는 운영 주소에 실행하지 않았습니다.

## 6. 웹 Basic만 조정

앞 단계의 모든 검증 후 별도 승인 범위에서 **웹 가상 호스트의 Basic include만** 제거합니다. 기존 API Basic·공용 인증 snippet·htpasswd는 유지합니다. 새 정적 앱 셸에는 개인정보·인증정보가 없고 금융 API는 새 backend 세션 인증으로 보호됩니다. 공개 앱 셸 예시는 frontend `deploy/ubuntu/budget-web.session.example`이며, 실제 적용에서는 후보 전용 3005 snippet을 참조해야 합니다. 이 예시를 그대로 복사해 기존 3004로 되돌리지 않습니다.

nginx -t 후 reload하고 공개 웹 200, 쿠키 없는 금융 JSON 401, 정상 로그인·읽기·로그아웃, API Basic 401을 다시 검사합니다. 동일 도구를 웹 Basic 입력 없이 재실행할 수 있습니다. 성공 뒤에도 기존 backend·frontend 릴리스와 Basic 복구 파일을 보존합니다. 이전 프로세스 정리·PM2 save는 별도 승인한 최종 단계에서 수행합니다.

실제 iPhone 기존 설치 PWA의 업데이트·로그인·강제 종료·재부팅·다음 날 실행, PC 종료/재실행·로그아웃, 오프라인 잠금·복구를 확인합니다. 실제 30일 경과는 운영 관찰 항목입니다.

## 7. 실패 시 전체 앱 rollback

새 frontend 또는 backend 문제가 있으면 기존 Basic 보호와 이전 전체 앱 조합을 복원합니다.

1. 웹 Basic을 먼저 복구하거나, **현재 보호된 백업의 웹/API Basic 설정 + 3004 proxy + 이전 frontend symlink**를 한 번에 복원합니다. 구문 검사 실패 시 reload하지 않습니다. 다른 사이트·API Basic은 계속 보호합니다.
2. nginx -t 후 승인된 reload를 수행하고 기존 앱·기존 API가 Basic 없이 401인지 확인합니다. 기존 계정의 읽기 전용 정상 조회도 확인합니다. frontend만 되돌리고 신 API를 남기거나, 공개 웹을 구 API에 연결하지 않습니다.
3. 3004 기존 PM2 프로세스는 계속 실행 중이므로 원복 후 새 candidate만 종료합니다. 기존 것을 restart하지 않습니다. candidate가 실제 사용 중인지 확인하지 않고 종료하지 않습니다.
4. 추가 Session 테이블은 남깁니다. 기존 API에 영향이 없으며 금융 테이블 역마이그레이션·전체 dump 덮어쓰기를 피합니다. 새 세션 폐기는 별도 관리 절차로 수행할 수 있습니다.

DB 손상 같은 별도 사고가 있으면 앱 rollback과 구분하여, 승인된 백업·binlog 복구 계획을 사용합니다. 무인증 최초 Nginx 전체 백업이나 API Basic 제거로 문제를 해결하지 않습니다.

## 미완료 승인 조건

운영 DB 백업·격리 복원, 서버 전용 계정/해시/Origin·고정 키 파일 배치, migration 관리 연결 보안 확정, 새 병행 프로세스·마이그레이션·Nginx 전환 승인, 실제 HTTPS 전환 검사와 iPhone/PC 확인이 필요합니다. 읽기 전용 사전 점검만으로 실제 배포 준비 완료를 선언하지 않습니다.
