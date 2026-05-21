import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import prisma from "@/lib/prisma";

export const maxDuration = 300;

/**
 * Hard-delete a tenant and all their data. Relies on the schema's onDelete:
 * Cascade relations to wipe Companies, Emails, FollowUpEmails, AuditLog,
 * GenerationJobs, etc. The action is written to the admin's audit history
 * BEFORE the delete so the trail survives the cascade.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    if (id === admin.id) {
      return NextResponse.json(
        { error: "Cannot delete the admin account" },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (target.role !== "USER") {
      return NextResponse.json(
        { error: "Cannot delete non-tenant accounts" },
        { status: 400 }
      );
    }

    // Log against the admin's id so the entry survives the cascade.
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        entityType: "user",
        entityId: target.id,
        action: "admin_delete_user",
        performedBy: admin.email,
        metadata: { email: target.email, name: target.name } as unknown as object,
      },
    });

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete user error:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
