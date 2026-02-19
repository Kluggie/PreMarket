# Data Migration (Phase 2)

## Scope
Phase 2 migrates core durable state from legacy entities to Neon Postgres + Drizzle for these flows:

- Auth user upsert on `GET /api/auth/me`
- Proposals: create/list/view/update/delete
- Shared links: create token + token-based read
- Billing references: store/read stripe/customer/subscription/plan/status fields

## Stack (Single Decision)
- DB: Neon Postgres
- ORM/migrations: Drizzle ORM + Drizzle SQL migrations
- Runtime client: Neon HTTP driver (`@neondatabase/serverless`) via `drizzle-orm/neon-http`

## Schema
Implemented in `api/_lib/db/schema.js` and migrated via `drizzle/0000_phase2_init.sql`:

- `users`
  - `email` unique
- `proposals`
  - ownership FK: `proposals.user_id -> users.id`
  - indexes on `(user_id, created_at)`
- `shared_links`
  - `token` unique + indexed
  - idempotency unique key: `(user_id, idempotency_key)`
- `billing_references`
  - one row per user (`user_id` PK)

## Authorization and Tenancy
Implemented in `api/_lib/auth.js`:

- `requireUser()` validates session cookie and upserts user row.
- Private data routes always filter by signed-in `user.id`.
- Shared link read (`GET /api/shared-links/[token]`) is token-based and does not require auth.
- Shared link creation still requires auth and proposal ownership.

## API Routes (DB-backed)

- `GET|POST /api/proposals`
- `GET|PATCH|DELETE /api/proposals/[id]`
- `POST /api/shared-links`
- `GET /api/shared-links/[token]`
- `GET|PATCH /api/billing`
- `GET /api/auth/me` (DB upsert)

Errors use normalized shape:

```json
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

## Frontend Migration

Critical routes now use DB-backed clients:

- `src/pages/db/CreateProposalDb.jsx`
- `src/pages/db/ProposalsDb.jsx`
- `src/pages/db/ProposalDetailDb.jsx`
- `src/pages/db/SharedReportDb.jsx`
- `src/pages/db/BillingDb.jsx`

Route wiring updated in `src/pages.config.js`.

## Backfill Strategy

### Idempotent Backfill Script
- Script: `scripts/backfill-legacy-export.mjs`
- Input: JSON export (`data/legacy-export.json` by default)
- Behavior: upsert into `users`, `proposals`, `shared_links`, `billing_references`
- Safe to re-run due conflict upserts.

### If Export Is Unavailable
Use **start fresh** strategy and onboard new data through live app usage.
Optional import hooks can be added later via admin-only scripts using the same upsert pattern.

## Rollout Steps
1. Set env vars in Vercel (Development/Preview/Production).
2. Run migrations (`npm run db:migrate`).
3. Deploy.
4. Verify critical flows and health.

## Rollback Steps
1. Revert app routes to previous page wiring if needed.
2. Revert API route changes for proposals/shared-links/billing.
3. Keep DB tables (non-destructive rollback); deploy previous app version.
4. If needed, restore previous data path while retaining migrated tables for retry.

## Verification Commands

```bash
npm run db:migrate
npm run db:smoke
npm run test:api
npm run guard:no-legacy
```
