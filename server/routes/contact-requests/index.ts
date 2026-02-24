import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { resolveSupportInboxEmail, sendCategorizedEmail } from '../../_lib/email-delivery.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/contact-requests', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const name = asText(body.name || auth.user.name || auth.user.full_name || '');
    const email = asText(body.email || auth.user.email || '');
    const message = asText(body.message || body.details || '');

    if (!name) {
      throw new ApiError(400, 'invalid_input', 'Name is required');
    }

    if (!email || !isLikelyEmail(email)) {
      throw new ApiError(400, 'invalid_input', 'A valid email is required');
    }

    if (!message) {
      throw new ApiError(400, 'invalid_input', 'Message is required');
    }

    const db = getDb();
    const now = new Date();
    const requestId = newId('contact_request');

    let emailAttempted = false;
    let emailSent = false;

    try {
      const targetEmail = resolveSupportInboxEmail();
      const delivery = await sendCategorizedEmail({
        category: 'contact_support',
        to: targetEmail,
        replyTo: email,
        subject: `Custom template request from ${name}`,
        text: [
          'New custom template request',
          '',
          `Name: ${name}`,
          `Email: ${email}`,
          '',
          'Message:',
          message,
        ].join('\n'),
      });
      emailAttempted = delivery.status !== 'not_configured';
      emailSent = delivery.status === 'sent';
    } catch {
      emailAttempted = true;
      emailSent = false;
    }

    await db.insert(schema.contactRequests).values({
      id: requestId,
      userId: auth.user.id,
      name,
      email,
      reason: 'request',
      type: 'general',
      status: 'new',
      message,
      emailAttempted,
      emailSent,
      metadata: {
        source: 'templates_custom_request',
      },
      createdAt: now,
      updatedAt: now,
    });

    const [saved] = await db
      .select({
        id: schema.contactRequests.id,
      })
      .from(schema.contactRequests)
      .where(and(eq(schema.contactRequests.id, requestId), eq(schema.contactRequests.userId, auth.user.id)))
      .limit(1);

    ok(res, 201, {
      request: {
        id: saved?.id || requestId,
        status: 'new',
      },
      delivery: emailSent ? 'email' : 'db',
    });
  });
}
