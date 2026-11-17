// 평문은 표준입력으로만 받습니다. 명령행 인수·환경변수로 전달하지 마세요.
import { hashPassword } from '../src/modules/auth/password.ts';
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (Buffer.byteLength(input) > 2048) throw new Error('입력이 너무 깁니다.');
}
console.log(await hashPassword(input.replace(/\r?\n$/, '')));
