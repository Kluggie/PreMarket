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

## Docs
- Auth migration: `docs/auth-migration.md`
- Data migration + schema + backfill: `docs/data-migration.md`
- Env setup details: `docs/env.md`
