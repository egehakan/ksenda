import prisma from "@/lib/prisma";
import { inngest, EVENTS } from "@/lib/inngest/client";
import {
  buildContext,
  walkAndImportCompanies,
  walkAndImportPeople,
  type AiFilter,
} from "@/lib/services/company-import";
import { loadConfig, isInSendWindow } from "@/lib/services/automation";
import { getTodaysCampaignDays } from "@/lib/services/campaign";
import { transitionState } from "@/lib/services/pipeline";
import { generateNextFollowUp, sendApprovedFollowUp } from "@/lib/services/followup";
import { sendApprovedEmail } from "@/lib/services/email-sender";
import {
  completeJob,
  createJob,
  failJob,
  updateJob,
} from "@/lib/services/jobs";
import { PIPELINE_STATES } from "@/lib/constants";
import { type ApolloFilters, type ApolloPeopleFilters } from "@/lib/services/apollo";

/**
 * Automation orchestration — per-stage + per-item Inngest steps.
 *
 * Replicates the high-level shape of `orchestrateRun` (5 stages: import,
 * approve, send, generate follow-ups, send follow-ups) but every
 * per-row operation is its own `step.run()`. Each step is a fresh Vercel
 * function invocation, so a tenant running a full daily plan with 25
 * imports + 25 sends + 10 follow-ups can occupy 40+ minutes wall-clock
 * without ever hitting a per-step timeout.
 *
 * `retries: 0` — Inngest's step-level retries cover per-item failures;
 * we never want the whole run to restart and double-import.
 */
export const automationRun = inngest.createFunction(
  {
    id: "automation-run",
    concurrency: [
      { limit: 1, key: "event.data.userId" },
      { limit: 5 },
    ],
    retries: 0,
    triggers: [{ event: EVENTS.automationRun }],
  },
  async ({ event, step }) => {
    const { userId, channels: requestedChannels } = event.data as {
      userId: string;
      channels?: Array<"email" | "linkedin">;
    };
    // When the caller (e.g. the Today card's channel toggle) specifies
    // which channels to run, restrict stage 1 to that set. Absent or empty
    // means "run all of today's rows".
    const channelFilter =
      Array.isArray(requestedChannels) && requestedChannels.length > 0
        ? new Set<"email" | "linkedin">(requestedChannels)
        : null;

    // Loaded inline (not via step.run) so Date fields stay as Date objects.
    // step.run JSON-serializes its return value, which would convert Dates to
    // strings and break loadConfig/buildContext type expectations. The fetch
    // is cheap (~10ms) so re-running on re-invocation is acceptable.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User not found: ${userId}`);
    const config = loadConfig(user);

    const parentJobId = await step.run("create-parent-job", async () => {
      const id = await createJob({
        userId,
        kind: "automation_run",
        totalItems: 5,
        currentLabel: "Starting automation run…",
      });
      if (!id) throw new Error("Failed to create parent job");
      return id;
    });

    let importedCount = 0;
    let approvedCount = 0;
    let sentInitial = 0;
    let generatedFollowUpCount = 0;
    let sentFollowUp = 0;
    const errors: Array<{ stage: string; detail: string }> = [];

    // Progress-bar scale for the parent job. The run is dominated by the
    // Stage 1 import, so when an import runs we scale the bar to the daily
    // cap and let the pipeline drive `processedItems = emails generated`
    // (so 5/25 reads ~20%, not 100%). The quick post-import stages then
    // hold the bar full while their labels narrate the wrap-up. When no
    // import runs, we keep the original 5-stage scale.
    let importRan = false;
    let progressTotal = 5;

    try {
      // ─── STAGE 1 — IMPORT ──────────────────────────────────────────────
      await step.run("stage1-update", async () => {
        await updateJob(parentJobId, {
          processedItems: 0,
          currentLabel: "Stage 1 / 5 · Importing today's recipe…",
        });
      });

      const todayDays = await step.run("stage1-get-today", () =>
        getTodaysCampaignDays(userId)
      );

      // Determine if stage 1 has any work. We run the import either when at
      // least one CampaignDay row exists for today AND has a usable recipe,
      // OR when the user has autoImportEnabled and is relying on the legacy
      // single-saved-search fallback (no recipe rows for today).
      const usableDays = todayDays.filter(
        (d) =>
          (d.status === "scheduled" || d.status === "completed") &&
          !!d.savedSearch &&
          // Honour the per-run channel toggle from the Today card. When
          // no filter was supplied, every channel passes.
          (channelFilter === null ||
            channelFilter.has(
              d.channel === "linkedin" ? "linkedin" : "email"
            ))
      );
      const shouldRunImport =
        usableDays.length > 0 ? true : config.autoImportEnabled;

      if (shouldRunImport && usableDays.length > 0) {
        // Sum each row's daily cap so the parent progress bar reflects the
        // combined import target across all channels for today.
        progressTotal = usableDays.reduce((s, d) => s + d.dailyImportCap, 0);
        if (progressTotal === 0) {
          errors.push({ stage: "import", detail: "daily_import_cap_reached" });
        } else {
          await step.run("stage1-prep-progress", async () => {
            await updateJob(parentJobId, {
              totalItems: progressTotal,
              processedItems: 0,
            });
          });

          // One sub-step per CampaignDay row (1 for single-channel days,
          // 2 for "both" days). Each sub-step runs the import scoped to
          // that row's channel — buildContext stamps the channel onto ctx
          // so processCompanyRowPhaseA routes to email or LinkedIn
          // generation. Sequential (not parallel) so Apollo + Gemini
          // calls don't compete for the user's per-key rate limit.
          //
          // `progressOffset` accumulates across passes so the parent job's
          // processedItems / currentLabel reflect COMBINED progress instead
          // of resetting to 0/passCap when the second channel starts. The
          // walker receives progressOffset + progressTotal so its onTick
          // writes the cumulative numerator + total denominator directly.
          let progressOffset = 0;
          for (const day of usableDays) {
            const dayCap = day.dailyImportCap;
            if (dayCap === 0) continue;

            let filters: Record<string, unknown> = {};
            try {
              filters = JSON.parse(day.savedSearch!.filtersJson);
            } catch {
              /* invalid JSON → empty filters */
            }
            const recipeAiFilter: AiFilter =
              day.savedSearch!.aiFilter === "no_ai" ||
              day.savedSearch!.aiFilter === "has_ai"
                ? (day.savedSearch!.aiFilter as AiFilter)
                : "any";
            const channel: "email" | "linkedin" =
              day.channel === "linkedin" ? "linkedin" : "email";
            const recipeKind: "companies" | "people" =
              day.savedSearch!.kind === "people" ? "people" : "companies";

            const ctx = buildContext(user, undefined, channel);
            ctx.jobId = parentJobId;

            const passOffset = progressOffset;
            const imported = await step.run(
              `stage1-pipeline-${day.id}`,
              async () => {
                // Dispatch on recipe kind. People-kind recipes (common for
                // LinkedIn) walk Apollo's /people endpoint and bulk-enrich,
                // which is way more efficient than walking companies and
                // then doing per-org findBestContact lookups.
                const result =
                  recipeKind === "people"
                    ? await walkAndImportPeople(
                        user,
                        ctx,
                        filters as ApolloPeopleFilters,
                        dayCap,
                        recipeAiFilter,
                        parentJobId,
                        undefined,
                        passOffset,
                        progressTotal
                      )
                    : await walkAndImportCompanies(
                        user,
                        ctx,
                        filters as ApolloFilters,
                        dayCap,
                        recipeAiFilter,
                        parentJobId,
                        undefined,
                        undefined,
                        passOffset,
                        progressTotal
                      );
                return {
                  emailsGenerated: result.summary.emailsGenerated,
                  errorDetails: result.summary.errorDetails,
                };
              }
            );
            importedCount += imported.emailsGenerated;
            progressOffset += imported.emailsGenerated;
            importRan = true;
            for (const ed of imported.errorDetails) {
              errors.push({ stage: "import", detail: ed.error });
            }

            await step.run(`stage1-mark-day-${day.id}`, async () => {
              await prisma.campaignDay.update({
                where: { id: day.id },
                data: {
                  ranAt: new Date(),
                  status: "completed",
                  outcomeSummary: `imported ${imported.emailsGenerated}${
                    recipeAiFilter !== "any" ? ` (gated: ${recipeAiFilter})` : ""
                  } [${channel}]`,
                },
              });
            });
          }
        }
      }

      // ─── STAGE 2 — APPROVE PENDING REVIEW ──────────────────────────────
      await step.run("stage2-update", async () => {
        await updateJob(parentJobId, {
          processedItems: importRan ? undefined : 1,
          currentLabel: "Stage 2 / 5 · Approving pending drafts…",
        });
      });

      if (config.autoApproveInitialDrafts) {
        const toApprove = await step.run("stage2-find", () =>
          prisma.company
            .findMany({
              where: {
                userId,
                pipelineState: PIPELINE_STATES.PENDING_REVIEW,
              },
              select: { id: true },
            })
            .then((rs) => rs.map((r) => r.id))
        );

        for (const id of toApprove) {
          try {
            await step.run(`stage2-approve-${id}`, async () => {
              await transitionState(
                userId,
                id,
                PIPELINE_STATES.APPROVED_TO_SEND,
                `auto:${userId}`
              );
            });
            approvedCount++;
          } catch (e) {
            errors.push({
              stage: "approve_initials",
              detail: e instanceof Error ? e.message : "unknown",
            });
          }
        }
      }

      // ─── STAGE 3 — SEND APPROVED INITIALS ──────────────────────────────
      await step.run("stage3-update", async () => {
        await updateJob(parentJobId, {
          processedItems: importRan ? undefined : 2,
          currentLabel: "Stage 3 / 5 · Sending approved emails…",
        });
      });

      if (config.autoSendApprovedEmails) {
        if (!isInSendWindow(config)) {
          errors.push({ stage: "send_initials", detail: "outside_send_window" });
        } else {
          // Compute remaining send budget for today.
          const initialBudget = await step.run("stage3-budget", async () => {
            const since = new Date();
            since.setUTCHours(0, 0, 0, 0);
            const [a, b] = await Promise.all([
              prisma.email.count({
                where: { company: { userId }, sentAt: { gte: since } },
              }),
              prisma.followUpEmail.count({
                where: { company: { userId }, sentAt: { gte: since } },
              }),
            ]);
            return Math.max(0, config.dailySendCap - a - b);
          });

          const toSend = await step.run("stage3-find", () =>
            prisma.company.findMany({
              where: {
                userId,
                pipelineState: PIPELINE_STATES.APPROVED_TO_SEND,
                targetContactEmail: { not: null },
                // Auto-send is email-only. LinkedIn rows are excluded at the
                // query level so we don't burn iterations on rows that the
                // sendApprovedEmail() guard would refuse anyway.
                email: { channel: "email" },
              },
              orderBy: { updatedAt: "asc" },
              take: initialBudget,
              select: { id: true, targetContactEmail: true },
            })
          );

          for (const c of toSend) {
            if (!c.targetContactEmail) continue;
            try {
              const result = await step.run(`stage3-send-${c.id}`, () =>
                sendApprovedEmail(userId, c.id, c.targetContactEmail!, user.email)
              );
              if (result.success) sentInitial++;
            } catch (e) {
              errors.push({
                stage: "send_initials",
                detail: e instanceof Error ? e.message : "unknown",
              });
            }
          }
        }
      }

      // ─── STAGE 4 — GENERATE FOLLOW-UPS ─────────────────────────────────
      await step.run("stage4-update", async () => {
        await updateJob(parentJobId, {
          processedItems: importRan ? undefined : 3,
          currentLabel: "Stage 4 / 5 · Generating follow-ups…",
        });
      });

      if (config.autoGenerateFollowUps) {
        const due = await step.run("stage4-find", () =>
          prisma.company.findMany({
            where: {
              userId,
              clientStatus: "contacted",
              nextFollowUpAt: { lte: new Date() },
              followUpStep: { lt: 3 },
            },
            orderBy: { nextFollowUpAt: "asc" },
            take: 100,
            select: { id: true },
          })
        );

        for (const c of due) {
          try {
            const r = await step.run(`stage4-followup-${c.id}`, () =>
              generateNextFollowUp(userId, c.id)
            );
            if (r.success) generatedFollowUpCount++;
          } catch (e) {
            errors.push({
              stage: "generate_followups",
              detail: e instanceof Error ? e.message : "unknown",
            });
          }
        }
      }

      // ─── STAGE 5 — SEND APPROVED FOLLOW-UPS ────────────────────────────
      await step.run("stage5-update", async () => {
        await updateJob(parentJobId, {
          processedItems: importRan ? undefined : 4,
          currentLabel: "Stage 5 / 5 · Sending follow-ups…",
        });
      });

      if (config.autoApproveFollowUps) {
        if (!isInSendWindow(config)) {
          errors.push({ stage: "send_followups", detail: "outside_send_window" });
        } else {
          const followUpBudget = await step.run("stage5-budget", async () => {
            const since = new Date();
            since.setUTCHours(0, 0, 0, 0);
            const [a, b] = await Promise.all([
              prisma.email.count({
                where: { company: { userId }, sentAt: { gte: since } },
              }),
              prisma.followUpEmail.count({
                where: { company: { userId }, sentAt: { gte: since } },
              }),
            ]);
            return Math.max(0, config.dailySendCap - a - b);
          });

          const pending = await step.run("stage5-find", () =>
            prisma.followUpEmail.findMany({
              where: {
                sentAt: null,
                channel: "email", // LinkedIn follow-ups are manual-paste.
                company: { userId, clientStatus: "contacted" },
              },
              include: { company: { select: { targetContactEmail: true } } },
              orderBy: { generatedAt: "asc" },
              take: followUpBudget,
            })
          );

          for (const fu of pending) {
            if (!fu.company.targetContactEmail) continue;
            try {
              const result = await step.run(`stage5-send-${fu.id}`, async () => {
                // Approve in place if not yet approved.
                if (!fu.approvedAt) {
                  await prisma.followUpEmail.update({
                    where: { id: fu.id },
                    data: {
                      approvedAt: new Date(),
                      approvedBy: `auto:${userId}`,
                      reviewedAt: new Date(),
                      reviewedBy: `auto:${userId}`,
                      finalSubject: fu.editedSubject || fu.subject,
                      finalBody: fu.editedBody || fu.body,
                    },
                  });
                }
                return sendApprovedFollowUp(
                  userId,
                  fu.id,
                  fu.company.targetContactEmail!,
                  `auto:${userId}`
                );
              });
              if (result.success) sentFollowUp++;
            } catch (e) {
              errors.push({
                stage: "send_followups",
                detail: e instanceof Error ? e.message : "unknown",
              });
            }
          }
        }
      }

      // ─── COMPLETE ──────────────────────────────────────────────────────
      await step.run("complete-parent", async () => {
        await completeJob(parentJobId, {
          // When an import ran, the bar is scaled to dayCap and counts
          // emails actually generated — finalize at the truthful number
          // (4/25, not 25/25). When no import ran, the bar is the 5-stage
          // scale and ends full (5/5).
          processedItems: importRan ? importedCount : progressTotal,
          metadata: {
            importedCount,
            approvedCount,
            sentInitial,
            generatedFollowUpCount,
            sentFollowUp,
            errors,
          },
        });
      });
    } catch (e) {
      await step.run("fail-parent", async () => {
        await failJob(
          parentJobId,
          e instanceof Error ? e.message : "automation_failed"
        );
      });
      throw e;
    }
  }
);
