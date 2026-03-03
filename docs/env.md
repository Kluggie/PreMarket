# Environment Setup

## Required Vars

Set these in Vercel for **Development**, **Preview**, and **Production**:

- `APP_BASE_URL`
- `SESSION_SECRET`
- `SESSION_IP_SALT`
- `GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_CLIENT_ID`
- `DATABASE_URL`
- `MFA_ENCRYPTION_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `EMAIL_MODE` (`contact_only` | `transactional` | `disabled`; default `contact_only`)
- `SUPPORT_INBOX_EMAIL`
- `SALES_INBOX_EMAIL`

Optional:
- `RESEND_FROM_NAME`
- `RESEND_REPLY_TO` (must be an email address, never an API key)
- `DEV_EMAIL_SINK` (non-production safety sink in `EMAIL_MODE=transactional`)

## Contact + Sales Email Mapping

```bash
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=reports@mail.getpremarket.com
RESEND_FROM_NAME=PreMarket
RESEND_REPLY_TO=support@getpremarket.com
EMAIL_MODE=contact_only
SUPPORT_INBOX_EMAIL=support@getpremarket.com
SALES_INBOX_EMAIL=sales@getpremarket.com
DEV_EMAIL_SINK=dev-sink@getpremarket.com
```

## Environment-Specific Values

### Production
- `APP_BASE_URL=https://www.getpremarket.com`
- `DATABASE_URL=<Neon production connection string>`

### Preview
- `APP_BASE_URL=https://<preview-domain>`
- `DATABASE_URL=<Neon preview/staging connection string>`

### Development (Vercel)
- `APP_BASE_URL=http://localhost:3000`
- `DATABASE_URL=<Neon development connection string>`

### Local `.env.local`
Use development values while running `vercel dev`.

## Serverless DB Strategy

This project uses Neon HTTP + Drizzle (`drizzle-orm/neon-http` + `@neondatabase/serverless`).

- Runtime DB access is stateless HTTP-based.
- No long-lived client pools are created per request.
- DB client is memoized in `api/_lib/db/client.js` to avoid unnecessary re-instantiation during hot reload.
