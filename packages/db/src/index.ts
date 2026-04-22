import { PrismaClient } from './generated/index.js';

declare global {
  // allow global var during dev hot-reload without re-instantiating the client
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export * from './generated/index.js';
export * from './queries.js';
