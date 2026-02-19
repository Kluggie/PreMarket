import { ok } from '../_lib/api-response.js';
import { requireUser } from '../_lib/auth.js';
import { readJsonBody } from '../_lib/http.js';
import { ensureMethod, withApiRoute } from '../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/app-logs', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;
    await readJsonBody(req);

    ok(res, 200, {});
  });
}
