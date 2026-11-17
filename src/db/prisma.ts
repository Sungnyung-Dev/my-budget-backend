import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.ts';
import { PrismaClient } from '../generated/prisma/client.ts';
import { databaseConnectionOptions } from './connection-options.ts';

const adapter = new PrismaMariaDb(databaseConnectionOptions(env.DATABASE_URL, process.env));
export const prisma = new PrismaClient({ adapter });
