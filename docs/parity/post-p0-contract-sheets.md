# Post-P0 Workflow Contract Sheets (Baseline: Recipient Side5 `b4a0fd12f13573c9a4273df59723c6480e824bc2`)

This file records the extracted legacy contracts for the workflow parity scope:
- A) Proposal workflows
- B) Billing/subscriptions
- C) Shared report/shared links
- D) Document comparison

Source extraction was performed from baseline page/function callsites in:
- `src/pages/CreateProposalWithDrafts.jsx`
- `src/pages/Proposals.jsx`
- `src/pages/ProposalDetail.jsx`
- `src/pages/Pricing.jsx`
- `src/pages/Billing.jsx`
- `src/pages/SharedReport.jsx`
- `src/pages/ReportViewer.jsx`
- `src/pages/DocumentComparisonCreate.jsx`
- `src/pages/DocumentComparisonDetail.jsx`
- `src/pages/RecipientEditStep2.jsx`
- `src/pages/RecipientEditStep3.jsx`
- related legacy `functions/*.ts`

## A) Proposal Workflow

### Frontend routes
- `/CreateProposal?template=<id>&draft=<id>&step=<1..4>`
- `/Proposals`
- `/ProposalDetail?id=<proposalId>`
- `/proposals/:proposalId/recipient-edit`
- `/proposals/:proposalId/recipient-edit/highlighting`

### Legacy API/function contracts used by UI
- Proposal CRUD + responses persisted through entity access.
- Wizard flow contract:
  - Step 1 create/select draft
  - Step 2 party A data
  - Step 3 party B data
  - Step 4 run evaluation
- Evaluation dispatch functions (template-dependent): proposal evaluate + fit-card evaluate + document comparison evaluate.
- Status transitions: `draft -> sent/received/under_verification/re_evaluated/mutual_interest/revealed/closed/withdrawn`.

### Required Vercel API contracts
- `GET /api/proposals?tab=&status=&query=&limit=&cursor=`
- `POST /api/proposals`
- `GET /api/proposals/:id`
- `PATCH /api/proposals/:id`
- `DELETE /api/proposals/:id`
- `GET /api/proposals/:id/responses`
- `PUT /api/proposals/:id/responses`
- `POST /api/proposals/:id/send`
- `POST /api/proposals/:id/evaluate`
- `GET /api/proposals/:id/evaluations`

### DB dependencies
- `proposals`
- `proposal_responses`
- `proposal_snapshots`
- `snapshot_access`
- new parity additions for workflow state and eval history (proposal eval runs/results)

## B) Billing Workflow

### Frontend routes
- `/Pricing`
- `/Billing`

### Legacy API/function contracts used by UI
- `createCheckoutSession`
- `cancelSubscription`
- user fields reflected in UI:
  - `plan_tier`
  - `subscription_status`
  - `cancel_at_period_end`
  - `current_period_end`
  - `stripe_customer_id`
  - `stripe_subscription_id`

### Required Vercel API contracts
- `GET /api/billing/status`
- `POST /api/billing/checkout`
- `POST /api/billing/cancel`
- `POST /api/stripeWebhook` (already present; side effects must persist)

### DB dependencies
- `billing_references`
- link to `users`
- webhook side-effect writes must keep status/tier/period-end in sync

## C) Shared Report / Shared Link Workflow

### Frontend routes
- `/SharedReport?token=<token>`
- `/shared-report?token=<token>` (alias -> `/SharedReport`)
- `/ReportViewer` (token-based report view path in legacy flows)
- recipient edit routes under `/proposals/:proposalId/recipient-edit*`

### Legacy API/function contracts used by UI
- resolve/open by token (validation + permissions)
- consume token/view accounting
- get shared report data
- submit/upsert recipient responses
- run shared report re-evaluation
- optional recipient draft creation for document comparison

### Required Vercel API contracts
- `POST /api/shared-links` (owner creates)
- `GET /api/shared-links/:token` (public token resolve)
- `POST /api/shared-links/:token/consume` (explicit consume semantics)
- `POST /api/shared-links/:token/respond` (recipient responses + optional reevaluate trigger)

### DB dependencies
- `shared_links`
- `proposal_snapshots`
- `snapshot_access`
- new recipient response persistence for token workflows

## D) Document Comparison Workflow

### Frontend routes
- `/DocumentComparisonCreate`
- `/DocumentComparisonDetail?id=<id>`
- recipient edits:
  - `/proposals/:proposalId/recipient-edit`
  - `/proposals/:proposalId/recipient-edit/highlighting`

### Legacy API/function contracts used by UI
- create/save draft
- extract inputs (files/URLs in legacy; replace with persisted text input contracts)
- evaluate/generate report
- save redaction/highlight spans with absolute offsets
- download outputs (JSON/PDF/inputs)

### Required Vercel API contracts
- `GET /api/document-comparisons?status=&limit=`
- `POST /api/document-comparisons`
- `GET /api/document-comparisons/:id`
- `PATCH /api/document-comparisons/:id`
- `POST /api/document-comparisons/:id/evaluate`
- `GET /api/document-comparisons/:id/download/json`
- `GET /api/document-comparisons/:id/download/inputs`
- `GET /api/document-comparisons/:id/download/pdf` (501 `not_configured` acceptable when renderer unavailable)

### DB dependencies
- new `document_comparisons` persistence table
- proposal linkage for comparison-backed proposals
- persisted spans/highlights and evaluation outputs

## Assumptions noted
- Legacy AI-specific extraction/evaluation providers are not required for local deterministic parity; API contracts and persisted state are the parity-critical target.
- Where provider configuration is missing, endpoint behavior must be normalized `501` with `{ ok:false, error:{ code:'not_configured', message } }`.
- `APP_BASE_URL` is canonical for generated links in shared-link and billing redirects.
