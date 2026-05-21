import { NextRequest, NextResponse } from "next/server";
import { type ApolloCompany } from "@/lib/services/apollo";
import { getCurrentUser } from "@/lib/auth";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { blockIfJobActive } from "@/lib/active-job-guard";
import { createJob } from "@/lib/services/jobs";

export const maxDuration = 300;

/**
 * POST /api/companies/import — dispatches a background job to import the
 * supplied Apollo companies. The import service (`importCompaniesForUser`)
 * creates and manages its own GenerationJob, which appears in the jobs
 * widget moments after this returns.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.apolloApiKey) {
      return NextResponse.json(
        {
          error: "Apollo API key is not configured. Please add it in Settings.",
        },
        { status: 400 }
      );
    }
    if (!user.geminiApiKey) {
      return NextResponse.json(
        {
          error: "Gemini API key is not configured. Please add it in Settings.",
        },
        { status: 400 }
      );
    }

    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = await request.json();
    const companies = body.companies as ApolloCompany[] | undefined;
    const channel: "email" | "linkedin" = body.channel === "linkedin" ? "linkedin" : "email";
    if (!companies || companies.length === 0) {
      return NextResponse.json(
        { error: "No companies provided." },
        { status: 400 }
      );
    }

    const itemLabel = channel === "linkedin" ? "LinkedIn message" : "email";

    // Create the job here (not inside the Inngest fn) so we can hand the
    // id back — the client polls it and only navigates once it's done.
    const jobId = await createJob({
      userId: user.id,
      kind: "company_import",
      totalItems: companies.length,
      currentLabel: `Generating ${companies.length} ${itemLabel}${
        companies.length === 1 ? "" : "s"
      }…`,
      metadata: { channel },
    });
    if (!jobId) {
      return NextResponse.json(
        { error: "Failed to create job" },
        { status: 500 }
      );
    }

    await inngest.send({
      name: EVENTS.companiesImportBatch,
      data: {
        userId: user.id,
        companies,
        customPrompt: body.customPrompt,
        jobId,
        channel,
      },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      total: companies.length,
      jobId,
      message: `Generating ${companies.length} ${itemLabel}${
        companies.length === 1 ? "" : "s"
      } in the background.`,
    });
  } catch (error) {
    console.error("Error dispatching companies/import:", error);
    return NextResponse.json(
      {
        error: "Failed to queue import",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
