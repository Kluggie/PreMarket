# Code Diff Inventory (`e0d6d19..153d0ae`)

## Scope summary
- Total changed files: `123`
- Renames detected: none
- Dominant pattern: legacy platform pages replaced by DB-minimal pages (`src/pages/db/*`) or `Phase2Placeholder` stubs.

## Routing/navigation
### Added
- none

### Removed
- none

### Modified/replaced
- `src/App.jsx`
- `src/Layout.jsx`
- `src/pages.config.js`
- `src/lib/NavigationTracker.jsx`
- `src/lib/PageNotFound.jsx`
- `src/components/NotificationDropdown.jsx`

### High-impact replacements
- `src/pages.config.js` rewired core routes from legacy pages to DB migration pages:
  - `Billing` -> `src/pages/db/BillingDb.jsx`
  - `CreateProposal` -> `src/pages/db/CreateProposalDb.jsx`
  - `Dashboard` -> `src/pages/db/DashboardDb.jsx`
  - `ProposalDetail` -> `src/pages/db/ProposalDetailDb.jsx`
  - `Proposals` -> `src/pages/db/ProposalsDb.jsx`
  - `SharedReport` -> `src/pages/db/SharedReportDb.jsx`

### Likely user-visible impact
- Navigation targets still resolve, but destination behavior changed from production workflow screens to migration scaffolds/placeholders.

## Auth/session
### Added
- `src/api/authClient.js`
- `src/components/auth/GoogleSignInButton.jsx`
- `src/components/auth/LoginDialog.jsx`
- `server/routes/auth/csrf.ts`
- `server/routes/auth/google/verify.ts`
- `server/routes/auth/logout.ts`
- `server/routes/auth/me.ts`
- `server/_lib/auth.js`
- `server/_lib/session.ts`
- `server/_lib/csrf.ts`

### Removed
- none

### Modified/replaced
- `src/lib/AuthContext.jsx`

### High-impact replacements
- Legacy token/auth flow replaced with cookie + CSRF + Google token verification flow.

### Likely user-visible impact
- Sign-in flow is different but generally present; auth no longer drives legacy app-level public settings checks.

## Dashboard
### Added
- `src/pages/db/DashboardDb.jsx`

### Removed
- none

### Modified/replaced
- `src/pages/Dashboard.jsx`
- `src/components/dashboard/ProposalsChart.jsx`

### High-impact replacements
- `src/pages/Dashboard.jsx` replaced with a 3-line wrapper to `DashboardDb`.
- Legacy 817-line dashboard (metrics cards, tabs, chart inputs, shared context handling) removed from active route.

### Likely user-visible impact
- Dashboard now only shows migration entry cards; no real sent/received metrics, no chart parity.

## Proposals
### Added
- `src/api/proposalsClient.js`
- `src/pages/db/CreateProposalDb.jsx`
- `src/pages/db/ProposalDetailDb.jsx`
- `src/pages/db/ProposalsDb.jsx`
- `server/routes/proposals/index.ts`
- `server/routes/proposals/[id].ts`

### Removed
- none

### Modified/replaced
- `src/pages/CreateProposalWithDrafts.jsx`
- `src/pages/Proposals.jsx`
- `src/pages/ProposalDetail.jsx`
- `src/components/proposal/GuestProposalBanner.jsx`
- `src/components/proposal/VerificationView.jsx`

### High-impact replacements
- `src/pages/Proposals.jsx` replaced with a wrapper to minimal DB list page.
- `src/pages/ProposalDetail.jsx` replaced with a wrapper to minimal CRUD/detail + shared-link create page.
- `src/pages/CreateProposalWithDrafts.jsx` replaced by placeholder stub.

### Likely user-visible impact
- Missing tabs/filters/status logic, recipient workspace handling, evaluation/report actions, draft workflow, and delete cascade behavior.

## Templates
### Added
- none

### Removed
- none

### Modified/replaced
- `src/pages/Templates.jsx`
- `src/pages/TemplateBuilder.jsx`
- `src/pages/TemplateDedupe.jsx`

### High-impact replacements
- All three templates pages replaced with `Phase2Placeholder` stubs.

### Likely user-visible impact
- No templates catalog, no “Use Template” path, no admin template editing/dedupe tooling.

## Billing/Stripe
### Added
- `src/api/billingClient.js`
- `src/pages/db/BillingDb.jsx`
- `server/routes/billing/index.ts`
- `server/routes/stripeWebhook.ts`

### Removed
- none

### Modified/replaced
- `src/pages/Billing.jsx`

### High-impact replacements
- `src/pages/Billing.jsx` is now a placeholder, while route points to `BillingDb` reference editor.
- Legacy checkout/cancel workflow (`createCheckoutSession`, `cancelSubscription`) is not mapped to first-class API endpoints.

### Likely user-visible impact
- Billing page no longer matches production UX; stripe references can be edited, but checkout/cancel flow parity is missing.

## Shared report/document comparison
### Added
- `src/api/sharedLinksClient.js`
- `src/pages/db/SharedReportDb.jsx`
- `server/routes/shared-links/index.ts`
- `server/routes/shared-links/[token].ts`

### Removed
- none

### Modified/replaced
- `src/pages/SharedReport.jsx`
- `src/pages/DocumentComparisonCreate.jsx`
- `src/pages/DocumentComparisonDetail.jsx`
- `src/pages/RecipientEditStep2.jsx`
- `src/pages/RecipientEditStep3.jsx`
- `src/pages/ReportViewer.jsx`
- `functions/GetSharedReportData.ts`
- `functions/SaveDocumentComparisonDraft.ts`
- `functions/SaveRecipientEditHighlights.ts`

### High-impact replacements
- `src/pages/SharedReport.jsx` replaced with wrapper to minimal token-metadata viewer.
- Document comparison create/detail and recipient-edit flows replaced by placeholders.

### Likely user-visible impact
- Shared workspace, recipient edit/re-eval/send-back, and document-comparison workflows are missing.

## API/server functions
### Added
- `api/index.ts`
- `server/_lib/*` migration support modules (`api-response`, `auth`, `db`, `env`, `errors`, `http`, `ids`, `integrations`, `observability`, `route`, `session`)
- Route handlers:
  - `server/routes/health.ts`
  - `server/routes/email/send.ts`
  - `server/routes/vertex/smoke.ts`
  - `server/routes/notifications/index.ts`
  - `server/routes/notifications/[id].ts`
  - `server/routes/app-logs/index.ts`
  - `server/routes/verification-items/index.ts`

### Removed
- Legacy API client module (deprecated app-platform client) removed.

### Modified/replaced
- `functions/CreateProposalSnapshot.ts`
- `functions/GetSharedReportData.ts`
- `functions/SaveDocumentComparisonDraft.ts`
- `functions/SaveRecipientEditHighlights.ts`
- `src/api/httpClient.js`
- `src/api/notificationsClient.js`
- `src/api/appLogsClient.js`
- `src/api/verificationItemsClient.js`

### High-impact replacements
- Legacy `functions.invoke` and `entities.*` frontend integration removed from current clients.
- Stub endpoints introduced for notifications/app-logs/verification-items.

### Likely user-visible impact
- Core workflow APIs are only partially recreated; many legacy contracts are absent.

## Data layer/entities/db
### Added
- `drizzle.config.js`
- `drizzle/0000_phase2_init.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`
- `server/_lib/db/client.js`
- `server/_lib/db/schema.js`
- DB scripts:
  - `scripts/db-migrate.mjs`
  - `scripts/db-smoke.mjs`
  - `scripts/backfill-legacy-export.mjs`
  - `scripts/guard-no-legacy.mjs`
  - `scripts/guard-db-safety.mjs`

### Removed
- `src/lib/app-params.js`
- Legacy API client module (deprecated app-platform client) removed.

### Modified/replaced
- none beyond migration additions

### High-impact replacements
- Current SQL schema only contains `users`, `proposals`, `shared_links`, `billing_references`.
- No SQL parity for most legacy entities used by baseline UI.

### Likely user-visible impact
- Large portions of UI render empty/no-op states because required tables and joins do not exist.
