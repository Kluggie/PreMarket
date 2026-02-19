import { ok } from '../_lib/api-response.js';
import { requireUser } from '../_lib/auth.js';
import { ApiError } from '../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../_lib/route.js';

function getNotificationId(req: any) {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/notifications/[id]', async (context) => {
    ensureMethod(req, ['PATCH']);
    const notificationId = getNotificationId(req);

    if (!notificationId) {
      throw new ApiError(400, 'invalid_input', 'Notification id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;

    ok(res, 200, {});
  });
}
