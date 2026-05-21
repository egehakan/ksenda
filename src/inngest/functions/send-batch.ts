import prisma from "@/lib/prisma";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { sendApprovedEmail } from "@/lib/services/email-sender";
import {
  appendJobDetail,
  completeJob,
  failJob,
  updateJob,
} from "@/lib/services/jobs";

/**
 * Send batch — one SMTP send per step.run(). Each send is a fresh Vercel
 * invocation, so per-tenant SMTP throttling / rate limits surface as
 * per-step failures without poisoning the rest of the batch.
 */
export const sendBatch = inngest.createFunction(
  {
    id: "pipeline-send-batch",
    concurrency: [
      // Hard-cap to 1 concurrent send-batch per user. Two parallel send-batches
      // for the same tenant would race on the SMTP server's per-account rate
      // limit and burn deliverability.
      { limit: 1, key: "event.data.userId" },
      { limit: 5 }, // global ceiling — matches Inngest free-tier cap
    ],
    retries: 1,
    triggers: [{ event: EVENTS.pipelineSendBatch }],
  },
  async ({ event, step }) => {
    const { userId, jobId, companyIds } = event.data as {
      userId: string;
      jobId: string;
      companyIds: string[];
    };

    const user = await step.run("load-user", async () => {
      return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
    });
    if (!user) {
      await failJob(jobId, "User not found");
      return;
    }

    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      for (const companyId of companyIds) {
        const result = await step.run(`send-${companyId}`, async () => {
          const company = await prisma.company.findFirst({
            where: { id: companyId, userId },
            include: { email: true },
          });
          if (!company || !company.email || !company.targetContactEmail) {
            await appendJobDetail(jobId, {
              name: companyId,
              status: "failed",
              detail: "missing email or recipient",
            });
            return { success: false, error: "missing email or recipient" };
          }
          const r = await sendApprovedEmail(
            userId,
            companyId,
            company.targetContactEmail,
            user.email
          );
          await appendJobDetail(jobId, {
            name: company.name,
            status: r.success ? "sent" : "failed",
            detail: r.success ? undefined : r.error,
          });
          return r;
        });

        processed++;
        if (result.success) sent++;
        else failed++;

        await step.run(`progress-${processed}`, async () => {
          await updateJob(jobId, {
            processedItems: processed,
            currentLabel: `Sent ${sent}/${companyIds.length}${
              failed > 0 ? ` (${failed} failed)` : ""
            }`,
          });
        });
      }

      await step.run("complete", async () => {
        await completeJob(jobId, {
          processedItems: processed,
          metadata: { sent, failed, total: companyIds.length },
        });
      });
    } catch (e) {
      await step.run("fail", async () => {
        await failJob(jobId, e instanceof Error ? e.message : "unknown");
      });
      throw e;
    }
  }
);
