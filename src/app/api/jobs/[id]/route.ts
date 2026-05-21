import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const maxDuration = 300;

/**
 * GET /api/jobs/[id] — fetch a single GenerationJob owned by the current
 * tenant. Includes the per-item details + the metadata JSON (which carries
 * search results, automation outcomes, etc. for completed jobs).
 *
 * Distinct from /api/jobs/active in that it returns ONE job regardless of
 * status or age — useful when the frontend wants to poll a specific job
 * (e.g. an AI search) until it completes, then read the result.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const job = await prisma.generationJob.findFirst({
      where: { id, userId: user.id },
      include: {
        details: {
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    let metadata: unknown = null;
    if (job.metadataJson) {
      try {
        metadata = JSON.parse(job.metadataJson);
      } catch {
        metadata = null;
      }
    }

    return NextResponse.json({ job: { ...job, metadata } });
  } catch (error) {
    console.error("GET /api/jobs/[id] error:", error);
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
