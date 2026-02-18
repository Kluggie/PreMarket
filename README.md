# PreMarket (Vite + React Router)

Phase 1 of the Base44 -> Vercel migration introduces Google Identity Services login, server-verified sessions, CSRF protection, and Vercel API routes.

## Runtime
- Frontend: Vite + React Router (SPA)
- Backend: Vercel Node serverless routes in `api/`
- Primary local source of truth: `vercel dev` on `http://localhost:3000`

## Environment Variables

### Required (all environments)
- `APP_BASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID` (or `VITE_GOOGLE_CLIENT_ID`)
- `VITE_GOOGLE_CLIENT_ID`

### Recommended values
- Production: `APP_BASE_URL=https://www.getpremarket.com`
- Local (`vercel dev`): `APP_BASE_URL=http://localhost:3000`

`SESSION_SECRET` must be set in Vercel for Production, Preview, and Development, and in local `.env.local` for `vercel dev`.

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Set env vars in `.env.local`.

3. Run serverless + SPA together (primary):
```bash
vercel dev
```

Optional: run Vite on `:5173` for frontend-only iteration. `/api/*` is proxied to `http://localhost:3000` by `vite.config.js`.

## Auth/API Endpoints

- `GET /api/auth/csrf`
- `POST /api/auth/google/verify`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/health`

See `docs/auth-migration.md` for flow and verification details.
