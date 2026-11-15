import { config } from 'dotenv';
import { isIP } from 'node:net';

const envFile = process.env.ENV_FILE?.trim();
if (process.env.ENV_FILE !== undefined && !envFile) {
  throw new Error('ENV_FILE: 비어 있지 않은 환경변수 파일 경로가 필요합니다.');
}
const loaded = config({ path: envFile ?? '.env', quiet: true });
if (envFile && loaded.error) {
  throw new Error('ENV_FILE: 지정한 환경변수 파일을 읽을 수 없습니다.');
}

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
}

export function parseEnv(source: NodeJS.ProcessEnv): Environment {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = source[name]?.trim() ?? '';
    if (!value) errors.push(`${name}: 필수 환경변수가 누락되었습니다.`);
    return value;
  };

  const nodeEnv = required('NODE_ENV');
  const host = required('HOST');
  const portText = required('PORT');
  const databaseUrl = required('DATABASE_URL');

  if (nodeEnv && !['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV: development, test, production 중 하나여야 합니다.');
  }
  const validHostname = host.length <= 253 && host.split('.').every(
    label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
  );
  if (host && !isIP(host) && !validHostname) {
    errors.push('HOST: 올바른 IP 주소 또는 호스트 이름이어야 합니다.');
  }
  const port = Number(portText);
  if (portText && (!/^\d+$/.test(portText) || port < 1 || port > 65535)) {
    errors.push('PORT: 1~65535 사이 정수여야 합니다.');
  }
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      const database = decodeURIComponent(url.pathname.slice(1));
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      if (url.protocol !== 'mysql:' || !url.hostname || !url.username ||
          !/^[a-zA-Z0-9_]+$/.test(database) || (url.port && Number(url.port) < 1) ||
          url.search || url.hash) {
        throw new Error('invalid');
      }
    } catch {
      errors.push('DATABASE_URL: mysql://user:password@host:3306/database 형식이어야 합니다. 쿼리 옵션은 지원하지 않습니다.');
    }
  }
  if (errors.length) {
    throw new Error(`환경변수 설정 오류:\n${errors.map(error => `- ${error}`).join('\n')}`);
  }
  return { NODE_ENV: nodeEnv as Environment['NODE_ENV'], HOST: host, PORT: port, DATABASE_URL: databaseUrl };
}

export const env = Object.freeze(parseEnv(process.env));
