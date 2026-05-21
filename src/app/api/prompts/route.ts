import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const prompts = await prisma.prompt.findMany({
      where: { userId: user.id },
      orderBy: [
        { isSystem: 'desc' },
        { isActive: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    const hasSystemDefault = prompts.some((p) => p.name === 'system_default');
    if (!hasSystemDefault) {
      prompts.unshift({
        id: 'system_default',
        userId: user.id,
        name: 'system_default',
        content: DEFAULT_SYSTEM_PROMPT,
        description: 'Default system prompt for email generation',
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { name, content, description } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    const prompt = await prisma.prompt.create({
      data: {
        userId: user.id,
        name,
        content,
        description,
        isSystem: false,
        isActive: true,
      },
    });

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
  }
}
