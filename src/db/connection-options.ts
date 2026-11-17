import { createPublicKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { checkServerIdentity, type ConnectionOptions } from 'node:tls';

// MySQL SHA-2 전체 인증에는 검증한 TLS 또는 사전에 고정한 RSA 공개키가 필요합니다.
// 파일 내용·경로·연결 URL은 설정 오류에 포함하지 않습니다.
export function databaseConnectionOptions(databaseUrl: string, source: NodeJS.ProcessEnv) {
  const url = new URL(databaseUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const caFile = source.DATABASE_TLS_CA_FILE;
  const rsaFile = source.DATABASE_RSA_PUBLIC_KEY_FILE;
  let ssl: ConnectionOptions | undefined;
  let cachingRsaPublicKey: string | undefined;
  if (caFile !== undefined && rsaFile !== undefined) {
    throw new Error('DB 보안 설정 오류: DATABASE_TLS_CA_FILE과 DATABASE_RSA_PUBLIC_KEY_FILE 중 하나만 지정하세요.');
  }
  if (caFile !== undefined) {
    try {
      if (!caFile.trim()) throw new Error();
      const ca = readFileSync(caFile, 'utf8');
      new X509Certificate(ca);
      ssl = {
        ca, minVersion: 'TLSv1.2', rejectUnauthorized: true,
        ...(isIP(host) ? {} : { servername: host }),
        // 드라이버가 기존 TCP 소켓을 넘기므로 DB URL의 호스트를 명시적으로 검증합니다.
        checkServerIdentity: (_servername, cert) => checkServerIdentity(host, cert),
      };
    } catch {
      throw new Error('DB 보안 설정 오류: DATABASE_TLS_CA_FILE의 CA 인증서를 읽거나 해석할 수 없습니다.');
    }
  }
  if (rsaFile !== undefined) {
    try {
      // RSA는 비밀번호 교환만 보호합니다. 원격 DB 연결에는 TLS를 사용합니다.
      if (!['127.0.0.1', '::1', 'localhost'].includes(host) || !rsaFile.trim()) throw new Error();
      const pem = readFileSync(rsaFile, 'utf8');
      if (!/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(pem.trim())) throw new Error();
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
      cachingRsaPublicKey = key.export({ type: 'spki', format: 'pem' }).toString();
    } catch {
      throw new Error('DB 보안 설정 오류: DATABASE_RSA_PUBLIC_KEY_FILE에는 루프백 DB의 검증된 2048비트 이상 RSA 공개키가 필요합니다.');
    }
  }
  return {
    host, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    timezone: '+00:00', connectionLimit: 5, connectTimeout: 5_000, acquireTimeout: 5_000,
    allowPublicKeyRetrieval: false,
    ...(ssl ? { ssl } : {}), ...(cachingRsaPublicKey ? { cachingRsaPublicKey } : {}),
  };
}
