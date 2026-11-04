import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return NextResponse.json({
      status: 'ok',
      db: true,
      migration: rows[0]?.migration_name ?? null,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'health',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
    return NextResponse.json({ status: 'error', db: false }, { status: 503 });
  }
}
