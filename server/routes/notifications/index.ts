import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/notifications', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;

    ok(res, 200, {
      notifications: [],
    });
  });
}
