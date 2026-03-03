# PreMarket (Vite + React Router on Vercel)

This repository now runs with:
- GIS login + server-verified cookie sessions (Phase 1)
- Neon Postgres + Drizzle for core durable state (Phase 2)

## Stack Decision (Phase 2)
- **Chosen stack**: Neon Postgres + Drizzle ORM
- **Why**: Neon HTTP driver is serverless-friendly on Vercel and avoids connection exhaustion from per-invocation TCP clients.

## Required Environment Variables

Set in **Development**, **Preview**, and **Production**:
- `APP_BASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_CLIENT_ID`
- `DATABASE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `EMAIL_MODE` (`contact_only` by default)
- `SUPPORT_INBOX_EMAIL`
- `SALES_INBOX_EMAIL`

Recommended values:
- Production: `APP_BASE_URL=https://www.getpremarket.com`
- Local (`vercel dev`): `APP_BASE_URL=http://localhost:3000`

Email mapping:
```bash
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=reports@mail.getpremarket.com
RESEND_FROM_NAME=PreMarket
RESEND_REPLY_TO=support@getpremarket.com
EMAIL_MODE=contact_only # contact_only | transactional | disabled
SUPPORT_INBOX_EMAIL=support@getpremarket.com
SALES_INBOX_EMAIL=sales@getpremarket.com
DEV_EMAIL_SINK=dev-sink@getpremarket.com # optional; non-production transactional mode only
```

## Local Setup

1. Install deps:
```bash
npm install
```

2. Configure `.env.local` with required env vars.

3. Run migrations:
```bash
npm run db:migrate
```

4. Start app locally (primary runtime):
```bash
vercel dev
```

Optional frontend-only loop:
```bash
npm run dev
```
(`vite` proxies `/api/*` to `http://localhost:3000`.)

## Useful Commands

```bash
npm run db:migrate
npm run db:smoke
npm run test:api
npm run guard:no-legacy
```

## Recipient Auth Deploy Runbook

The invited-recipient + alias verification flow depends on migration
`drizzle/0015_shared_link_recipient_authorization.sql` and the matching journal entry in
`drizzle/meta/_journal.json` (`tag: 0015_shared_link_recipient_authorization`).

Local:
```bash
npm run db:migrate
npm run db:smoke
curl -s http://localhost:3000/api/health
```

Preview:
```bash
vercel env pull .env.preview --environment=preview
set -a; source .env.preview; set +a
npm run db:migrate
npm run db:smoke
```

Production:
```bash
vercel env pull .env.production --environment=production
set -a; source .env.production; set +a
npm run db:migrate
npm run db:smoke
```

Schema verification query:
```sql
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_links' and column_name = 'authorized_user_id'
  ) as has_authorized_user_id,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_links' and column_name = 'authorized_email'
  ) as has_authorized_email,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_links' and column_name = 'authorized_at'
  ) as has_authorized_at,
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'shared_link_verifications'
  ) as has_shared_link_verifications_table;
```

`/api/health` now returns `500` with `internalError: "schema_missing"` when these schema requirements are missing.

## Docs
- Auth migration: `docs/auth-migration.md`
- Data migration + schema + backfill: `docs/data-migration.md`
- Env setup details: `docs/env.md`
