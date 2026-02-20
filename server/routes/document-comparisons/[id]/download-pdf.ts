import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/download/pdf', async () => {
    ensureMethod(req, ['GET']);
    throw new ApiError(501, 'not_configured', 'PDF renderer is not configured');
  });
}
