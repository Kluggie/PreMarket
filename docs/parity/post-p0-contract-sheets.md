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
- The requested source file `/mnt/data/EvaluateProposal.ts` is not available in this workspace; contract extraction below uses the equivalent repo source `functions/EvaluateProposal.ts`.

## Evaluation Contract (From EvaluateProposal.ts)

### Instruction rules that must be enforced
- Evidence-only: every finding, blocker, flag, recommendation, and follow-up must cite evidence IDs.
- No hallucinations: never claim controls, certifications, pricing/revenue, or document facts not present in input responses/signals.
- Visibility enforcement:
  - `hidden`: never reveal value; only redacted generic statements, `detail_level="redacted"`.
  - `partial`: summarize without exact sensitive specifics, `detail_level="partial"`.
  - `full`: normal detail allowed.
- Use `computedSignals` when present for gates/overlaps/contradictions.
- Strict JSON output only, no prose/markdown outside JSON.
- Missing/ambiguous data must be represented as unknown, not guessed.
- Completeness and confidence must drop when required fields are missing/disputed/unverified.

### Canonical output schema (required fields)
- Root:
  - `template_id: string`
  - `template_name: string`
  - `generated_at_iso: string`
  - `parties: { a_label: string, b_label: string }`
  - `quality: { completeness_a: number, completeness_b: number, confidence_overall: number, confidence_reasoning: string[], missing_high_impact_question_ids: string[], disputed_question_ids: string[] }`
  - `summary: { overall_score_0_100: number|null, fit_level: "high"|"medium"|"low"|"unknown", top_fit_reasons: { text: string, evidence_question_ids: string[] }[], top_blockers: { text: string, evidence_question_ids: string[] }[], next_actions: string[] }`
  - `category_breakdown: { category_key: string, name: string, weight: number, score_0_100: number|null, confidence_0_1: number, notes: string[], evidence_question_ids: string[] }[]`
  - `gates: { gate_key: string, outcome: "pass"|"fail"|"unknown", message: string, evidence_question_ids: string[] }[]`
  - `overlaps_and_constraints: { key: string, outcome: "pass"|"fail"|"unknown", short_explanation: string, evidence_question_ids: string[] }[]`
  - `contradictions: { key: string, severity: "low"|"med"|"high", description: string, evidence_question_ids: string[] }[]`
  - `flags: { severity: "low"|"med"|"high", type: "security"|"privacy"|"ops"|"commercial"|"integrity"|"other", title: string, detail: string, detail_level: "full"|"partial"|"redacted", evidence_question_ids: string[] }[]`
  - `verification: { summary: { self_declared_count: number, evidence_attached_count: number, tier1_verified_count: number, disputed_count: number }, evidence_requested: { item: string, reason: string, related_question_ids: string[] }[] }`
  - `followup_questions: { priority: "high"|"med"|"low", to_party: "a"|"b"|"both", question_text: string, why_this_matters: string, targets: { category_key: string, question_ids: string[] } }[]`
  - `appendix: { field_digest: { question_id: string, label: string, party: "a"|"b", value_summary: string, visibility: "full"|"partial"|"hidden", verified_status: "self_declared"|"evidence_attached"|"tier1_verified"|"disputed"|"unknown", last_updated_by: "proposer"|"recipient"|"system" }[] }`

### Minimal extension for document-comparison mode
- Keep canonical structure and semantics.
- Add optional evidence anchor format for non-question sources:
  - `evidence_anchors?: { doc: "A"|"B", start: number, end: number }[]`
- Anchor constraints:
  - offsets must be within source document bounds.
  - anchors must not overlap hidden/confidential spans.
  - hidden source text must never be quoted verbatim in report payload.

### Completeness / confidence semantics
- Completeness is required-answer coverage per party (`answered_required / total_required`).
- Confidence must be low when required coverage is poor, evidence is thin, or disputes/high-impact missing fields exist.
- Numeric score fields can remain `null` when rubric cannot support scoring; confidence/completeness are still mandatory.

### Post-model normalization and validation required
- Parse JSON with fenced-markdown stripping fallback.
- Validate required root keys and nested field types/enums.
- Clamp numeric confidence/completeness to `[0,1]`.
- Normalize/clean arrays and enums (`fit_level`, `severity`, `detail_level`, outcomes).
- Reject or fail evaluation when schema is invalid; persist failure state/row.
- Redaction enforcement pass: ensure hidden response values or hidden span snippets are absent from serialized output.

## Document Comparison Contract (Detailed Baseline Extraction - Recipient Side5)

### Frontend route + query contracts (baseline)
- `GET /DocumentComparisonCreate`
- `GET /DocumentComparisonCreate?draft=<comparisonId>`
- `GET /DocumentComparisonCreate?proposalId=<proposalId>`
- `GET /DocumentComparisonCreate?draft=<comparisonId>&proposalId=<proposalId>&step=<1..4>`
- `GET /DocumentComparisonDetail?id=<comparisonId>`
- Linked navigation from proposals list/detail:
  - `DocumentComparisonCreate?draft=<document_comparison_id>&proposalId=<proposal.id>&step=<proposal.draft_step || 1>`
  - `DocumentComparisonDetail?id=<document_comparison_id>`

### Baseline wizard steps + expected behavior
- Step 1: Source Selection
  - title, party labels, per-document source selector.
  - save draft + continue.
- Step 2: Input
  - side-by-side document input panes.
  - source helpers (typed/upload/url/profile/org in baseline; parity scope requires typed/upload/url).
  - persist `doc_a_plaintext`, `doc_b_plaintext`, source metadata.
- Step 3: Highlighting
  - mouse text selection -> mark hidden.
  - only one editable side based on party context.
  - instruction banner explicitly states editable side + locked side.
  - applied highlights list with remove action.
  - optional sync scrolling toggle.
- Step 4: Review & Evaluate
  - title + doc lengths + total hidden spans + confidentiality guarantee text.
  - save draft and run evaluation.
  - navigate to linked proposal detail when linked.

### Baseline detail view structure
- Header summary:
  - title, status badge, created date, updated date, hidden span count.
- Top action row:
  - Run Evaluation
  - Download report JSON
  - Download inputs JSON
  - Open linked proposal detail
  - Share updated version action in proposal-linked contexts.
- Tabs:
  - `Overview`
  - `AI Report`
- Overview tab:
  - Parties card
  - complete details with read-only Doc A/Doc B previews and hidden highlights rendered
  - activity timeline card.
- AI Report tab:
  - evaluation history
  - report summary/sections using stored report payload.

### Baseline API/function call contracts used by UI (pre-migration names)
- `SaveDocumentComparisonDraft`
  - input used by page:
    - `comparisonId`, `proposalId`, `stepToSave`
    - `title`, `partyALabel`, `partyBLabel`
    - `docAText`, `docBText`
    - `docASource`, `docBSource`
    - `docAFiles`, `docBFiles`
    - `docASpans` or `docBSpans` (only editable side allowed).
  - output used by page:
    - `ok`, `comparisonId`, `proposalId`, `editableHighlightSide`.
- `EvaluateDocumentComparison`
  - input: `comparison_id`, `trigger: "user_click"`.
  - output consumed by UI: `{ ok, ...report payload ... }` and status transitions.
- download helpers:
  - report JSON and inputs JSON download contract.

### Vercel parity endpoint contracts required for current UI
- `GET /api/document-comparisons/:id`
  - returns:
    - `comparison` with draft fields + spans + report fields
    - `proposal` linkage summary when linked
    - `permissions` (editable-side + locked-side booleans) for highlight controls.
- `POST /api/document-comparisons`
- `PATCH /api/document-comparisons/:id`
  - must enforce editable-side permissions server-side for span writes.
- `POST /api/document-comparisons/:id/evaluate`
- `POST /api/document-comparisons/extract-url`
  - request: `{ url }`
  - success: `{ ok: true, text, title? }`
  - unconfigured mode: `501` with normalized `not_configured` error.
- `GET /api/document-comparisons/:id/download/json`
- `GET /api/document-comparisons/:id/download/inputs`
- `GET /api/document-comparisons/:id/download/pdf` (501 allowed when renderer unavailable)

### DB fields required by baseline behavior
- Draft metadata:
  - `title`, `status`, `draft_step`
  - `party_a_label`, `party_b_label`
  - linkage: `proposal_id`, `user_id`
- Inputs:
  - `doc_a_text`, `doc_b_text`
  - `inputs` JSON for source/method metadata (typed/upload/url and file/url metadata).
- Confidentiality highlights:
  - `doc_a_spans`, `doc_b_spans` as `[start,end)` offsets + level.
- Evaluation outputs:
  - `evaluation_result`, `public_report`
- Proposal linkage:
  - `proposal.document_comparison_id`, `proposal.proposal_type="document_comparison"`, draft/status timestamps.

### Baseline component/file mapping (source-of-truth)
- Wizard shell + step indicator/progress:
  - `src/pages/DocumentComparisonCreate.jsx`
- Side-by-side inputs:
  - Step 2 block in `src/pages/DocumentComparisonCreate.jsx`
- Mouse highlight flow + locked-side controls + applied highlights:
  - Step 3 block in `src/pages/DocumentComparisonCreate.jsx`
- Review screen:
  - Step 4 block in `src/pages/DocumentComparisonCreate.jsx`
- Detail tabs (Overview / AI Report):
  - `src/pages/DocumentComparisonDetail.jsx`
