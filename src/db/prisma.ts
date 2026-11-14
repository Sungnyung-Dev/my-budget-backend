import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.ts';
import { PrismaClient } from '../generated/prisma/client.ts';

const url = new URL(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  host: url.hostname.replace(/^\[|\]$/g, ''),
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  timezone: '+00:00',
  connectionLimit: 5,
  connectTimeout: 5_000,
  acquireTimeout: 5_000,
});

export const prisma = new PrismaClient({ adapter });
