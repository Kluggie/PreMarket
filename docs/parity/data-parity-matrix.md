# Data Model Parity Matrix

## Current SQL schema (HEAD)
Defined in `server/_lib/db/schema.js` and `drizzle/0000_phase2_init.sql`.

### Present tables
- `users`
- `proposals`
- `shared_links`
- `billing_references`

### Legacy entities used by baseline UI/server but absent from current SQL
- `Template`
- `ProposalResponse`
- `DocumentComparison`
- `EvaluationItem`
- `EvaluationRun`
- `EvaluationReport`
- `EvaluationReportShared`
- `FitCardReportShared`
- `ProposalSnapshot`
- `SnapshotAccess`
- `Notification`
- `UserProfile`
- `Organization`
- `Membership`
- `ContactRequest`
- `AuditLog`
- `ProposalComment`
- `Attachment`
- `RevealEvent`
- `GuestProposal`
- `VerificationItem` (endpoint exists but no backing table)
- `EvaluationAccessToken`
- `EmailSendLog`

## Entity-to-schema parity

| Baseline entity / field usage | Current SQL mapping | Gap | User-visible impact |
|---|---|---|---|
| `Proposal` queried by `party_a_email` and `party_b_email` for sent/received views (`Dashboard`, `Proposals`) | `proposals` table exists | Query path in current APIs is owner `user_id` only; missing parity query mode for recipient-by-email and workspace merges | Sent/received counts, tabs, and recipient workspace list are incomplete/empty. |
| `Proposal` fields: `proposal_type`, `template_id`, `document_comparison_id`, `latest_score`, `latest_evaluation_id`, reveal flags/levels, `draft_step`, `source_proposal_id` | `proposals` has `id,user_id,title,status,template_name,party_a_email,party_b_email,summary,payload,created_at,updated_at` | Multiple workflow-critical columns missing | Proposal detail cannot render evaluation/reveal/document-comparison lifecycle states. |
| `Template` catalog with `status`, `category`, `name`, `description`, `party_a_label`, `party_b_label`, modules | no table | Entire table missing | Templates page/tooling is placeholder; no template-driven proposal flow. |
| `ProposalResponse` stores structured answers including visibility/range/claim_type | no table | Entire table missing | Proposal overview details and recipient send-back history unavailable. |
| `DocumentComparison` stores doc text/spans/evaluation JSON/draft state | no table | Entire table missing | Document comparison create/detail/report views removed. |
| `EvaluationRun`, `EvaluationReport`, `EvaluationReportShared`, `FitCardReportShared`, `EvaluationItem` | no tables | Entire evaluation/report storage layer missing | Dashboard charts and Proposal Detail report tabs have no backing data. |
| `ShareLink` baseline semantics include recipient lookup + snapshot metadata/versioning | `shared_links` exists with token/proposal/user/recipient/status/maxUses/uses/expires/idempotency/reportMetadata | Missing snapshot-related fields and recipient-lookup API contract parity | Recipient workspace open-path often fails or lacks version context. |
| `ProposalSnapshot` + `SnapshotAccess` used to build received workspace rows | no tables | Entire snapshot/access model missing | Received workspace reconciliation falls back to empty state. |
| `Notification` with read state, type, action URL | no table; `/api/notifications` returns `[]` | Data store and persistence missing | Notification dropdown always empty/non-functional. |
| `VerificationItem` records | no table; `/api/verification-items` is echo-only | No persistence/query path | Verification flows do not survive refresh/navigation. |
| `UserProfile`, `Organization`, `Membership` | no tables | Profile/org graph missing | Profile/organization/settings pages reduced to placeholders. |
| `ContactRequest` for pricing/custom template requests | no table | Intake persistence missing | Pricing/contact/custom-template actions removed. |
| `AuditLog`, `ProposalComment`, `Attachment`, `RevealEvent`, `GuestProposal` | no tables | Workflow event/comment/attachment/guest access layers missing | Proposal collaboration, reveal tracking, and guest-link scenarios are unavailable. |

## Missing columns in existing tables

| Table | Missing columns needed for parity | Where baseline used | Impact |
|---|---|---|---|
| `proposals` | `template_id`, `proposal_type`, `document_comparison_id`, `latest_score`, `latest_evaluation_id`, `reveal_requested_by_a`, `reveal_requested_by_b`, `mutual_reveal`, `reveal_level_a`, `reveal_level_b`, `draft_step`, `source_proposal_id` | `src/pages/Proposals.jsx`, `src/pages/ProposalDetail.jsx`, `src/pages/CreateProposalWithDrafts.jsx` | Proposal rows cannot drive detail actions/status chips/workspace transitions. |
| `shared_links` | snapshot metadata columns (`snapshot_id`, `snapshot_version`, sender/recipient audit fields) | `src/pages/Proposals.jsx` and `src/pages/SharedReport.jsx` recipient workspace logic | Cannot recreate latest-share/version-aware recipient routing semantics. |
| `users` | profile/business fields currently expected in legacy `UserProfile` context | `src/pages/Profile.jsx`, `src/pages/Settings.jsx`, `src/pages/Verification.jsx` | Auth user exists but profile UX has no parity schema. |
| `billing_references` | checkout/cancel lifecycle linkage fields beyond references (if kept in this table) | `src/pages/Billing.jsx` expected cancellation and period-end transitions | Billing page parity blocked without checkout/cancel state transitions. |

## Missing joins/relations

| Needed relation | Current state | Impacted screens |
|---|---|---|
| `proposals` -> `proposal_responses` (1:N) | missing | `Dashboard`, `Proposals`, `ProposalDetail`, `SharedReport` |
| `proposals` -> `templates` (N:1) | missing | `CreateProposalWithDrafts`, `Templates`, `ProposalDetail` |
| `proposals` -> `document_comparisons` (1:1 or 1:N) | missing | `DocumentComparisonCreate`, `DocumentComparisonDetail`, `ProposalDetail` |
| `proposals` -> `evaluation_reports` / `evaluation_runs` / `evaluation_items` | missing | `Dashboard` charts, `ProposalDetail` evaluation tabs/actions |
| `proposals` -> `shared_links` with recipient and status semantics | partial | `Dashboard`, `Proposals`, `ProposalDetail`, `SharedReport` |
| `snapshot_access` -> `proposal_snapshots` -> `proposals` | missing | Recipient workspace reconstruction in `Proposals` and `SharedReport` |
| `users` -> `notifications` | missing | `NotificationDropdown` |
| `users` -> `user_profiles` / `memberships` / `organizations` | missing | `Profile`, `Organization`, `Settings`, `Verification` |

## Missing indexes for parity workloads

| Index needed | Why | Current state |
|---|---|---|
| `proposals(party_a_email, created_at desc)` | Baseline sent list queries by sender email | missing |
| `proposals(party_b_email, created_at desc)` | Baseline received list queries by recipient email | missing |
| `shared_links(proposal_id, recipient_email, status, created_at desc)` | Recipient active-link resolution by proposal+recipient | partial (no recipient/status composite index) |
| `shared_links(proposal_id, snapshot_version desc)` | Latest share version resolution | missing |
| `proposal_responses(proposal_id, created_at desc)` | Proposal details and response timeline | missing (table absent) |
| `proposal_responses(claim_type, created_at desc)` | Send-back/reviewed counters | missing (table absent) |
| `evaluation_reports(proposal_id, created_at desc)` | Fast latest report retrieval | missing (table absent) |
| `notifications(user_email/read/created_at)` | Notification dropdown polling | missing (table absent) |

## Empty-state root causes by product area

| Screen area | Empty/partial state root cause |
|---|---|
| Dashboard cards/charts | Missing `proposal_responses`, evaluation/report tables, and recipient/workspace joins; active route now `DashboardDb` scaffold. |
| Proposals list | Missing snapshot/access model and recipient-link lookup parity; active route now minimal owner-only `/api/proposals` list. |
| Proposal detail | Missing response/evaluation/document-comparison/comment/attachment/reveal data model and APIs; active route is reduced CRUD page. |
| Templates catalog/tools | `Template` table/API missing and pages are placeholders. |
| Shared report/workspace | Missing shared-report resolver contract + recipient response persistence + re-eval/send-back tables/APIs. |
| Billing | Checkout/cancel function contracts not migrated; route replaced by reference record editor. |
