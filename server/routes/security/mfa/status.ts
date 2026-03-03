import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { getUserMfaRow, isMfaEnabledRow, isUserVerified } from './_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/status', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res, { allowPendingMfa: true });
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const [verified, userMfa] = await Promise.all([
      isUserVerified(auth.user.id),
      getUserMfaRow(auth.user.id),
    ]);

    const enabled = isMfaEnabledRow(userMfa);
    const sessionPassed = Boolean(!auth.session?.mfa_required || auth.session?.mfa_passed);

    ok(res, 200, {
      mfa: {
        enabled,
        verified,
        session_passed: sessionPassed,
        sessionPassed,
        requires_challenge: enabled && !sessionPassed,
        requiresChallenge: enabled && !sessionPassed,
        enabled_at: userMfa?.enabledAt || null,
        enabledAt: userMfa?.enabledAt || null,
      },
    });
  });
}
