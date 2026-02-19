import { ok } from '../_lib/api-response.js';
import { requireUser } from '../_lib/auth.js';
import { readJsonBody } from '../_lib/http.js';
import { newId } from '../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/verification-items', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;

    const payload = await readJsonBody(req);

    ok(res, 200, {
      item: {
        ...payload,
        id: newId('verification'),
        created_date: new Date().toISOString(),
      },
    });
  });
}
