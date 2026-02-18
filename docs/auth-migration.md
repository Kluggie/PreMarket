# Auth Migration (Phase 1)

## Scope
Phase 1 removes Base44 auth and replaces it with:
- Google Identity Services (GIS) client login
- Server-side Google ID token verification
- Signed HTTP-only cookie sessions (`pm_session`)
- CSRF protection for login verification

## Flow
1. Client requests CSRF token from `GET /api/auth/csrf`.
2. Client renders GIS button using `VITE_GOOGLE_CLIENT_ID`.
3. GIS returns an ID token to the browser.
4. Client posts token to `POST /api/auth/google/verify` with CSRF token.
5. Server verifies token with Google, sets `pm_session`, and returns user JSON.
6. Client checks session via `GET /api/auth/me` (this now upserts the user row in Postgres).
7. Logout clears cookies via `POST /api/auth/logout`.

## CSRF Pattern
- Double-submit cookie pattern.
- `GET /api/auth/csrf` sets `pm_csrf` and returns `{ csrfToken }`.
- `POST /api/auth/google/verify` requires a matching CSRF token in cookie + request (`X-CSRF-Token` and body).
- Missing/invalid token returns `403`.

## Cookie Policy
- Session cookie: `pm_session`
- Flags: `HttpOnly`, `SameSite=Lax`, `Path=/`
- `Secure` is enabled whenever `APP_BASE_URL` uses `https`.

## Canonical Domain Policy
- Production canonical domain: `https://www.getpremarket.com`
- Set `APP_BASE_URL=https://www.getpremarket.com` in production.
- Canonical-host redirects are enforced only when `VERCEL_ENV=production`.
- Local development should use `APP_BASE_URL=http://localhost:3000` and should not redirect to production.

## Local Development
- Primary mode: `vercel dev` at `http://localhost:3000`
- Optional frontend mode: `vite` at `http://localhost:5173` (with `/api` proxy to `:3000`)

## Health Endpoint
`GET /api/health` returns:
- deployment metadata
- version/commit when available
- required env readiness booleans only (`true/false`, no secret values)

Returns:
- `200` when all required env vars are present
- `500` when required env vars are missing

## Required Vercel Env Vars
Set for Production, Preview, and Development:
- `APP_BASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID` (recommended)
- `VITE_GOOGLE_CLIENT_ID`

## Google Console Checklist
Authorized JavaScript origins:
- `https://www.getpremarket.com`
- `https://getpremarket.com`
- `https://pre-market.vercel.app`
- `http://localhost:3000` (vercel dev)
- `http://localhost:5173` (if GIS is rendered directly in Vite dev)

For GIS ID-token flow, no OAuth redirect URI is required for login.

## Quick Verification
1. `GET /api/auth/csrf` returns `{ csrfToken }` and sets `pm_csrf`.
2. `POST /api/auth/google/verify` without CSRF returns `403`.
3. `POST /api/auth/google/verify` with valid CSRF + Google token returns `200` and sets `pm_session`.
4. `GET /api/auth/me` returns `200` after login and `401` after logout, and upserts `users` in DB.
5. `GET /api/health` reports env readiness without leaking values.
