/**
 * POST /api/ai-detection/companies
 *
 * Run AI-presence detection on already-imported Company rows. Persists the
 * result on each Company (aiHasAi, aiStatusJson, aiCheckedAt). Used by:
 *   - Pipeline tab: "Check AI status" batch action
 *   - Automation page: "Detect AI on pending companies" button
 *   - Per-row action in Pipeline cards
 *
 * Body:
 *   {
 *     companyIds?: string[],      // explicit list
 *     onlyPending?: boolean,      // alternative: scan all companies without
 *                                 //   a checkedAt (i.e. never scanned)
 *     limit?: number,             // safety cap when onlyPending=true (default 50)
 *     force?: boolean             // ignore cache, re-run detection
 *   }
 *
 * Returns: { scanned: number, results: { companyId, hasAi, confidence, summary }[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { detectAiForTarget } from '@/lib/services/ai-detector';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.geminiApiKey) {
      return NextResponse.json(
        { error: 'Gemini API key is not configured.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const companyIds: string[] = Array.isArray(body.companyIds) ? body.companyIds : [];
    const onlyPending = body.onlyPending === true;
    const limit = typeof body.limit === 'number' ? Math.max(1, Math.min(100, body.limit)) : 50;
    const force = body.force === true;

    let companies: Array<{ id: string; name: string; domain: string; website: string | null }> = [];
    if (companyIds.length > 0) {
      const rows = await prisma.company.findMany({
        where: { userId: user.id, id: { in: companyIds } },
        select: { id: true, name: true, domain: true, website: true },
      });
      companies = rows;
    } else if (onlyPending) {
      const rows = await prisma.company.findMany({
        where: { userId: user.id, aiCheckedAt: null },
        select: { id: true, name: true, domain: true, website: true },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
      companies = rows;
    } else {
      return NextResponse.json(
        { error: 'Provide companyIds or set onlyPending: true' },
        { status: 400 }
      );
    }

    if (companies.length === 0) {
      return NextResponse.json({ scanned: 0, results: [] });
    }

    const results: Array<{
      companyId: string;
      hasAi: boolean;
      confidence: string;
      summary: string;
    }> = [];

    const concurrency = 5;
    let i = 0;
    async function worker() {
      while (i < companies.length) {
        const idx = i++;
        const c = companies[idx];
        try {
          const r = await detectAiForTarget(
            { name: c.name, domain: c.domain, website: c.website || undefined },
            { geminiApiKey: user!.geminiApiKey!, userId: user!.id, force }
          );
          await prisma.company.update({
            where: { id: c.id },
            data: {
              aiHasAi: r.hasAi,
              aiStatusJson: JSON.stringify(r),
              aiCheckedAt: new Date(),
            },
          });
          results.push({
            companyId: c.id,
            hasAi: r.hasAi,
            confidence: r.confidence,
            summary: r.summary,
          });
        } catch (err) {
          console.error('[ai-detection/companies] error for', c.id, err);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, companies.length) }, () => worker())
    );

    return NextResponse.json({ scanned: results.length, results });
  } catch (error) {
    console.error('[ai-detection/companies] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
