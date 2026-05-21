import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { findBestContact } from '@/lib/services/apollo';
import { getCurrentUser } from '@/lib/auth';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user.apolloApiKey) {
      return NextResponse.json(
        { error: 'Apollo API key is not configured. Please add it in Settings.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({} as { channel?: string }));
    const channel: 'email' | 'linkedin' = body?.channel === 'linkedin' ? 'linkedin' : 'email';

    const company = await prisma.company.findFirst({ where: { id, userId: user.id } });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (!company.apolloId) {
      return NextResponse.json(
        { error: 'Company has no Apollo ID (organization_id)' },
        { status: 400 }
      );
    }

    const bestContact = await findBestContact(
      user.apolloApiKey,
      company.name,
      company.apolloId,
      user.id,
      channel
    );

    if (!bestContact.person) {
      return NextResponse.json(
        {
          success: false,
          error: 'No contacts found for this company with target titles',
        },
        { status: 200 }
      );
    }

    const contactData = {
      firstName: bestContact.person.first_name || null,
      lastName: bestContact.person.last_name || null,
      email: bestContact.enrichedEmail || null,
      title: bestContact.title || bestContact.person.title || null,
      linkedinUrl: bestContact.person.linkedin_url || null,
    };

    if (!contactData.firstName) {
      console.error('[Find Contact] Invalid contact data - no first name:', bestContact);
      return NextResponse.json(
        { success: false, error: 'Contact found but missing required information' },
        { status: 500 }
      );
    }

    await prisma.company.update({
      where: { id },
      data: {
        targetContactFirstName: contactData.firstName,
        targetContactLastName: contactData.lastName,
        targetContactEmail: contactData.email,
        targetContactTitle: contactData.title,
        targetContactLinkedinUrl: contactData.linkedinUrl,
        contactFoundAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      contact: contactData,
      hasEmail: !!contactData.email,
      hasLinkedIn: !!contactData.linkedinUrl,
    });
  } catch (error) {
    console.error('Error finding contact:', error);
    return NextResponse.json({ error: 'Failed to find contact' }, { status: 500 });
  }
}
