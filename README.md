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

Recommended values:
- Production: `APP_BASE_URL=https://www.getpremarket.com`
- Local (`vercel dev`): `APP_BASE_URL=http://localhost:3000`

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
