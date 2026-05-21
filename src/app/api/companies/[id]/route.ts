import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { transitionState } from '@/lib/services/pipeline';
import { PIPELINE_STATES } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const company = await prisma.company.findFirst({
      where: { id, userId: user.id },
      include: { email: true },
    });

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    return NextResponse.json({ company });
  } catch (error) {
    console.error('Error fetching company:', error);
    return NextResponse.json({ error: 'Failed to fetch company' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { pipelineState, notGeneratedReason } = body;

    const company = await prisma.company.findFirst({
      where: { id, userId: user.id },
    });

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (pipelineState && pipelineState !== company.pipelineState) {
      const result = await transitionState(
        user.id,
        id,
        pipelineState as typeof PIPELINE_STATES[keyof typeof PIPELINE_STATES]
      );
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (notGeneratedReason !== undefined) {
      updateData.notGeneratedReason = notGeneratedReason;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.company.update({ where: { id }, data: updateData });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating company:', error);
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const company = await prisma.company.findFirst({ where: { id, userId: user.id } });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    await prisma.company.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting company:', error);
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 });
  }
}
