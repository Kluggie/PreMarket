import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { getVertexConfigSnapshot } from '../../_lib/integrations.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/debug/vertex', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    if (auth.user.role !== 'admin') {
      throw new ApiError(403, 'forbidden', 'Admin access required');
    }

    ok(res, 200, {
      ...getVertexConfigSnapshot(),
      runtime: 'nodejs',
    });
  });
}
