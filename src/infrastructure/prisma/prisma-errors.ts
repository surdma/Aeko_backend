import { Prisma } from '@prisma/client';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export function isPrismaUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    /Can't reach database server/iu.test(messageOf(error))
  );
}

export function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
