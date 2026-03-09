# Backend Contract Parity Matrix

Compared against baseline UI callsites in `e0d6d192577b35ef19c1d8d4c7235caa9977c86e`.

Current `/api/*` routes implemented in `api/index.ts`:
- `/api/health` GET
- `/api/stripeWebhook` POST
- `/api/auth/me` GET
- `/api/auth/logout` POST
- `/api/auth/csrf` GET
- `/api/auth/google/verify` POST
- `/api/email/send` POST
- `/api/vertex/smoke` POST
- `/api/proposals` GET/POST
- `/api/proposals/:id` GET/PATCH/DELETE
- `/api/shared-links` POST (router allows GET but handler only supports POST)
- `/api/shared-links/:token` GET
- `/api/billing` GET/PATCH
- `/api/notifications` GET (stub)
- `/api/notifications/:id` PATCH (stub)
- `/api/app-logs` POST (stub)
- `/api/verification-items` POST (non-persistent stub)

## Legacy `functions.invoke` call parity

| Legacy callsite (file + function) | Legacy function/entity | Current replacement endpoint/module | Status | Expected request/response shape gaps |
|---|---|---|---|---|
| `src/pages/Billing.jsx:handleUpgrade` | `createCheckoutSession` | none | missing | Baseline expected `{ url }` redirect target; no checkout-session endpoint exists. |
| `src/pages/Billing.jsx:cancelMutation` | `cancelSubscription` | none | missing | Baseline expected cancellation update + period-end semantics; no cancel endpoint exists. |
| `src/pages/CreateProposalWithDrafts.jsx:createProposalMutation` | `checkProposalLimit` | none | missing | Baseline expected limit gate response (`ok`, `remaining`, `plan`); no equivalent contract. |
| `src/pages/CreateProposalWithDrafts.jsx:onSuccess` and `src/pages/ProposalDetail.jsx:runNewEvaluationMutation` | `EvaluateProposal`, `EvaluateProposalShared`, `EvaluateFitCardShared`, `EvaluateDocumentComparison` | `/api/vertex/smoke` (diagnostic only) | partial | Baseline expected async eval object (`status`, `output_report_json`, `correlation_id`); smoke route returns `{ result: { text } }` only. |
| `src/pages/CreateProposalWithDrafts.jsx:handleExtractFromUrl` | `ExtractRequirementsFromUrl` | none | missing | Baseline expected `inferred_fields[]`; no extraction API. |
| `src/pages/CreateProposalWithDrafts.jsx` | `ExtractProfileFromUrl`, `ExtractJobRequirementsFromUrl` | none | missing | Baseline expected parsed profile/requirements payloads; no mapping. |
| `src/pages/DocumentComparisonCreate.jsx` | `ExtractTextFromUploads`, `ExtractFromUrls` | none | missing | No upload/url extraction contracts exposed in `/api/*`. |
| `src/pages/DocumentComparisonCreate.jsx:saveDraft` | `SaveDocumentComparisonDraft` | none | missing | Baseline expected draft persistence with comparison ID/version; no endpoint. |
| `src/pages/DocumentComparisonDetail.jsx` | `DownloadComparisonPDF`, `DownloadComparisonJSON`, `DownloadComparisonInputs` | none | missing | No download endpoints returning file payloads. |
| `src/pages/ProposalDetail.jsx:handleDownloadAIReportPdf` | `DownloadReportPDF` | none | missing | Baseline expected `{ ok, pdfBase64, filename, correlationId }`; not available. |
| `src/pages/ProposalDetail.jsx:sendReportMutation` and `src/pages/DocumentComparisonDetail.jsx` | `SendReportEmailSafe` | `/api/email/send` | partial | Baseline expected share-link creation + optional PDF + delivery log. Current route is raw email send only. Integration test currently fails with HTTP 500 in authenticated flow. |
| `src/pages/ProposalDetail.jsx` and `src/pages/Settings.jsx` | `EmailConfigStatus` | none | missing | Baseline expected provider readiness flags (`hasResendKey`, `hasFromEmail`); no endpoint. |
| `src/pages/Dashboard.jsx`, `src/pages/Proposals.jsx`, `src/pages/ProposalDetail.jsx` | `GetActiveShareLinkForRecipient` | `/api/shared-links` + `/api/shared-links/:token` | partial | Baseline expected lookup by `proposalId` + recipient + latest snapshot version; current API has create + token fetch only. |
| `src/pages/SharedReport.jsx` and `src/pages/ProposalDetail.jsx` | `ResolveSharedReport`, `GetSharedReportData` | `/api/shared-links/:token` | partial | Baseline expected merged payload: `permissions`, `partyAView`, `partyBEditableSchema`, `responsesView`, `reportData`. Current returns link + proposal metadata only. |
| `src/pages/SharedReport.jsx` and `src/pages/ProposalDetail.jsx` | `UpsertSharedRecipientResponses` | none | missing | No endpoint to persist recipient edits (`responses[]`, visibility, ranges). |
| `src/pages/SharedReport.jsx` and `src/pages/ProposalDetail.jsx` | `RunSharedReportReevaluation` | none | missing | No endpoint returning `reevaluation.remaining` and updated report payload. |
| `src/pages/SharedReport.jsx` and `src/pages/ProposalDetail.jsx` | `SubmitSharedReportResponse` | none | missing | No send-back endpoint for message/counterproposal payload. |
| `src/pages/SharedReport.jsx` | `EnsureSnapshotAccess` | none | missing | No endpoint to create/update snapshot access rows from token. |
| `src/pages/SharedReport.jsx` | `CreateRecipientEditDraft` | none | missing | No endpoint to clone draft proposal/comparison for recipient edit route. |
| `src/pages/RecipientEditStep3.jsx` | `SaveRecipientEditHighlights` | none | missing | No endpoint to persist hidden span highlights. |
| `src/pages/ReportViewer.jsx` | `ResolveAccessToken`, `ConsumeAccessToken` | none | missing | No tokenized report-view access flow endpoint pair. |
| `src/pages/ReportViewer.jsx` | `SendEvaluationReportEmail` | `/api/email/send` | partial | Baseline expected report-specific email orchestration; current endpoint is generic email send. |
| `src/pages/Directory.jsx` and detail pages | `PublicDirectorySearch`, `PublicDirectoryGetDetail` | none | missing | No public directory search/detail endpoints. |
| `src/pages/GeminiTest.jsx` | `GenerateContent` | `/api/vertex/smoke` | partial | Baseline expected generic content generation API with structured prompt/output. Current route is a smoke test only. |
| `src/pages/TemplateBuilder.jsx` | `fixUniversalTemplateModules` | none | missing | No maintenance endpoint for template module normalization. |

## Legacy entity CRUD call parity

| Legacy callsite (file + usage) | Legacy function/entity | Current replacement endpoint/module | Status | Expected request/response shape gaps |
|---|---|---|---|---|
| `src/pages/Proposals.jsx`, `src/pages/ProposalDetail.jsx`, `src/pages/CreateProposalWithDrafts.jsx` | `legacy.entities.Proposal.*` | `/api/proposals`, `/api/proposals/:id` via `src/api/proposalsClient.js` | partial | Current schema lacks many baseline fields (`proposal_type`, `template_id`, `document_comparison_id`, reveal fields, latest score/run refs, draft metadata). |
| `src/pages/Proposals.jsx`, `src/pages/ProposalDetail.jsx` | `legacy.entities.ProposalResponse.*` | none | missing | Baseline expected per-question response rows (`question_id`, `value_type`, `visibility`, `claim_type`, range fields). |
| `src/pages/Templates.jsx`, `src/pages/TemplateBuilder.jsx`, `src/pages/TemplateDedupe.jsx` | `legacy.entities.Template.*` | none | missing | No template catalog CRUD endpoint (`status`, `category`, labels, modules, `view_count`). |
| `src/pages/Dashboard.jsx`, `src/pages/Proposals.jsx`, `src/pages/ProposalDetail.jsx` | `legacy.entities.ShareLink.*` | `/api/shared-links`, `/api/shared-links/:token` via `sharedLinksClient` | partial | No list/filter/update endpoints by proposal+recipient; no snapshot version semantics. |
| `src/pages/Proposals.jsx` | `legacy.entities.SnapshotAccess.*` | none | missing | No recipient workspace snapshot access table/API. |
| `src/pages/Proposals.jsx` | `legacy.entities.ProposalSnapshot.*` | none | missing | No snapshot history API for proposal versions. |
| `src/pages/DocumentComparisonCreate.jsx`, `src/pages/DocumentComparisonDetail.jsx`, `src/pages/ProposalDetail.jsx` | `legacy.entities.DocumentComparison.*` | none | missing | No comparison CRUD endpoint for doc text, spans, evaluation artifacts. |
| `src/pages/ProposalDetail.jsx`, `src/pages/ReportViewer.jsx` | `legacy.entities.EvaluationItem.*` | none | missing | Missing eval item linking and access-token relationship. |
| `src/pages/ProposalDetail.jsx` | `legacy.entities.EvaluationRun.*` | none | missing | Missing eval run timeline/status records. |
| `src/pages/ProposalDetail.jsx` | `legacy.entities.EvaluationReport.*` | none | missing | Missing canonical report storage (`output_report_json`, status, error details). |
| `src/pages/ProposalDetail.jsx` | `legacy.entities.EvaluationReportShared.*`, `FitCardReportShared.*` | none | missing | Missing shared/fit report stores and retrieval APIs. |
| `src/components/NotificationDropdown.jsx` | `legacy.entities.Notification.*` | `/api/notifications`, `/api/notifications/:id` via `notificationsClient` | partial | Current list always returns `[]`; mark-read PATCH does not persist state. |
| `src/pages/Verification.jsx`, `src/pages/ProposalDetail.jsx` | `legacy.entities.VerificationItem.*` | `/api/verification-items` via `verificationItemsClient` | partial | Current endpoint echoes payload + generated id/date, but no DB persistence/query endpoint. |
| `src/pages/Pricing.jsx`, `src/pages/Templates.jsx` | `legacy.entities.ContactRequest.create` | none | missing | No contact request intake API/table. |
| `src/pages/Profile.jsx`, `src/pages/Settings.jsx`, `src/pages/Verification.jsx` | `legacy.entities.UserProfile.*` | none | missing | Missing profile CRUD for org/professional metadata fields used by UI. |
| `src/pages/Organization.jsx` | `legacy.entities.Organization.*`, `Membership.*` | none | missing | Missing org/membership management APIs. |
| `src/pages/Dashboard.jsx`, `src/pages/Profile.jsx` | `legacy.entities.AuditLog.*` | none | missing | Missing received-record tracking and audit query pipeline. |
| `src/pages/ProposalDetail.jsx` | `legacy.entities.ProposalComment.*`, `Attachment.*`, `RevealEvent.*` | none | missing | Missing comments/attachments/reveal-event persistence and retrieval APIs. |
| `src/pages/CreateProposalWithDrafts.jsx` | `legacy.entities.GuestProposal.create` | none | missing | Missing guest magic-link persistence for recipient access. |
| `src/pages/Billing.jsx` | `legacy.entities.User.filter` for plan status | `/api/auth/me` + `/api/billing` | partial | Billing now split across `users` + `billing_references`; no checkout/cancel API to move status through billing lifecycle. |

## Current route quality notes (mapped but degraded)
- `/api/notifications` and `/api/notifications/:id` are implemented as non-persistent stubs.
- `/api/shared-links` router allows `GET`, but handler enforces `POST` only.
- `/api/app-logs` accepts payload but does not persist logs.
- `/api/verification-items` returns generated item object but does not persist.
- Test evidence on current branch:
  - `npm run test:api` fails (`POST /api/stripeWebhook invalid signature: expected 400, got 200`).
  - `npm run test:api:integration` has one failing suite (`/api/email/send` authenticated smoke test returned `500`).
