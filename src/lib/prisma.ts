import { PrismaClient } from '@/generated/prisma';
import { PrismaLibSql } from '@prisma/adapter-libsql';

// Create Prisma adapter for Turso
const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Create global reference for Prisma client. The cache key is bumped any time
// the schema changes — keeping the dev server from holding onto a stale client
// after `prisma generate`. Increment manually when adding/removing models.
const PRISMA_SCHEMA_REV = 'v10-user-role';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaRev: string | undefined;
};

// Drop the cached instance if it predates the current schema rev.
if (
  process.env.NODE_ENV !== 'production' &&
  globalForPrisma.prismaRev !== PRISMA_SCHEMA_REV
) {
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaRev = PRISMA_SCHEMA_REV;
}

// Create PrismaClient with libSQL adapter
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
