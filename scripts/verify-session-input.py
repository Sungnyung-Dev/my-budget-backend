#!/usr/bin/env python3
"""검증 도구용 숨김 입력. 셸 파이프로 verify-session-auth.ts에 전달하세요."""
import getpass
import json
import sys
if not sys.stdin.isatty():
    raise SystemExit('대화형 터미널에서 실행하세요.')
print('앱 사용자명: ', end='', file=sys.stderr, flush=True)
username = input().strip()
password = getpass.getpass('앱 비밀번호 (숨김): ')
print('웹 Basic 사용자명 (해제 후 검증이면 Enter): ', end='', file=sys.stderr, flush=True)
basic_username = input().strip()
credentials = {'username': username, 'password': password}
if basic_username:
    credentials.update(basicUsername=basic_username, basicPassword=getpass.getpass('Basic 비밀번호 (숨김): '))
print(json.dumps(credentials))
