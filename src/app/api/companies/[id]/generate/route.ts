import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  generateEmailWithRetry,
  generateLinkedInMessageWithRetry,
} from '@/lib/services/gemini';
import { transitionState } from '@/lib/services/pipeline';
import { PIPELINE_STATES, GEMINI_MODEL } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user.geminiApiKey) {
      return NextResponse.json(
        { error: 'Gemini API key is not configured. Please add it in Settings.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { customPrompt } = body;

    const company = await prisma.company.findFirst({
      where: { id, userId: user.id },
      include: { email: true },
    });

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (!company.targetContactFirstName) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No target contact found. Please click "Find Contact" first to find a person with target titles at this company.',
        },
        { status: 400 }
      );
    }

    // Channel resolution: explicit body.channel > existing email.channel > 'email'.
    const channel: 'email' | 'linkedin' =
      body.channel === 'linkedin'
        ? 'linkedin'
        : body.channel === 'email'
        ? 'email'
        : ((company.email?.channel as 'email' | 'linkedin') || 'email');

    if (channel === 'email' && !company.targetContactEmail) {
      console.warn(
        `Company ${company.name} has contact ${company.targetContactFirstName} but no email. Email generation will proceed but cannot be sent.`
      );
    }
    if (channel === 'linkedin' && !company.targetContactLinkedinUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Contact has no LinkedIn URL on file. Re-find the contact via Apollo or switch to email channel.',
        },
        { status: 400 }
      );
    }

    let promptToUse = customPrompt;
    if (!promptToUse) {
      const activePrompt = await prisma.prompt.findFirst({
        where: { userId: user.id, name: 'active_prompt', platform: channel },
      });
      promptToUse = activePrompt?.content;
    }

    const generationOpts = {
      apiKey: user.geminiApiKey,
      companyName: company.name,
      companyDomain: company.domain,
      customPrompt: promptToUse,
      companyWebsite: company.website || undefined,
      contact: {
        firstName: company.targetContactFirstName,
        lastName: company.targetContactLastName || undefined,
        title: company.targetContactTitle || undefined,
      },
      sender: {
        companyName: user.companyName,
        companyWebsite: user.companyWebsite,
        senderName: user.senderName,
      },
    };

    if (channel === 'linkedin') {
      const liResult = await generateLinkedInMessageWithRetry(generationOpts);
      if (!liResult.success) {
        return NextResponse.json({ error: liResult.error, success: false }, { status: 422 });
      }

      if (company.email) {
        await prisma.email.update({
          where: { id: company.email.id },
          data: {
            channel: 'linkedin',
            subject: null,
            body: liResult.body!,
            promptUsed: promptToUse || '',
            generatedAt: new Date(),
            geminiModelUsed: GEMINI_MODEL,
            editedSubject: null,
            editedBody: null,
            reviewedAt: null,
            approvedAt: null,
            finalSubject: null,
            finalBody: null,
          },
        });
      } else {
        await prisma.email.create({
          data: {
            companyId: id,
            channel: 'linkedin',
            subject: null,
            body: liResult.body!,
            promptUsed: promptToUse || '',
            geminiModelUsed: GEMINI_MODEL,
          },
        });
      }

      await transitionState(user.id, id, PIPELINE_STATES.PENDING_REVIEW);

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          entityType: 'email',
          entityId: id,
          action: 'linkedin_generated',
          metadata: {
            bodyLength: liResult.body?.length,
            channel: 'linkedin',
            targetContact: `${company.targetContactFirstName} ${company.targetContactLastName ?? ''}`.trim(),
          },
        },
      });

      return NextResponse.json({
        success: true,
        email: { subject: null, body: liResult.body, channel: 'linkedin' },
      });
    }

    const result = await generateEmailWithRetry(generationOpts);

    if (!result.success) {
      return NextResponse.json({ error: result.error, success: false }, { status: 422 });
    }

    if (company.email) {
      await prisma.email.update({
        where: { id: company.email.id },
        data: {
          channel: 'email',
          subject: result.subject!,
          body: result.body!,
          promptUsed: promptToUse || '',
          generatedAt: new Date(),
          geminiModelUsed: GEMINI_MODEL,
          editedSubject: null,
          editedBody: null,
          reviewedAt: null,
          approvedAt: null,
          finalSubject: null,
          finalBody: null,
        },
      });
    } else {
      await prisma.email.create({
        data: {
          companyId: id,
          channel: 'email',
          subject: result.subject!,
          body: result.body!,
          promptUsed: promptToUse || '',
          geminiModelUsed: GEMINI_MODEL,
        },
      });
    }

    await transitionState(user.id, id, PIPELINE_STATES.PENDING_REVIEW);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: 'email',
        entityId: id,
        action: 'email_generated',
        metadata: {
          subject: result.subject,
          bodyLength: result.body?.length,
          targetContact: `${company.targetContactFirstName} ${company.targetContactLastName}`,
        },
      },
    });

    return NextResponse.json({
      success: true,
      email: { subject: result.subject, body: result.body, channel: 'email' },
    });
  } catch (error) {
    console.error('Error generating email:', error);
    return NextResponse.json({ error: 'Failed to generate email' }, { status: 500 });
  }
}
