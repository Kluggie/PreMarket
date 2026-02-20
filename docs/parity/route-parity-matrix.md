# Route Parity Matrix

Source of truth compared:
- Baseline: `e0d6d192577b35ef19c1d8d4c7235caa9977c86e:src/App.jsx` and `src/pages.config.js`
- Current: `HEAD:src/App.jsx` and `src/pages.config.js`

## Explicit routes from `src/App.jsx`

| Route | Baseline component/page | Current component/page | Status | Notes |
|---|---|---|---|---|
| `/` | `mainPage=Landing` -> `src/pages/Landing.jsx` | same | same | Root still lands on `Landing`. |
| `/directory` | `src/pages/Directory.jsx` | `src/pages/Directory.jsx` (now placeholder) | missing | Public directory search/list behavior removed. |
| `/directory/people/:id` | `src/pages/DirectoryPersonDetail.jsx` | `src/pages/DirectoryPersonDetail.jsx` (now placeholder) | missing | Public person detail workflow removed. |
| `/directory/orgs/:id` | `src/pages/DirectoryOrgDetail.jsx` | `src/pages/DirectoryOrgDetail.jsx` (now placeholder) | missing | Public org detail workflow removed. |
| `/SharedReport` | `Pages.SharedReport` -> `src/pages/SharedReport.jsx` | `Pages.SharedReport` -> `src/pages/db/SharedReportDb.jsx` | changed behavior | Full shared workspace replaced by token metadata viewer. |
| `/shared-report` | Redirect alias to `/SharedReport` | same | partial | Alias works, but destination behavior regressed with `/SharedReport`. |
| `/proposals/:proposalId/recipient-edit` | `src/pages/RecipientEditStep2.jsx` | `src/pages/RecipientEditStep2.jsx` (now placeholder) | missing | Recipient edit step 2 removed. |
| `/proposals/:proposalId/recipient-edit/highlighting` | `src/pages/RecipientEditStep3.jsx` | `src/pages/RecipientEditStep3.jsx` (now placeholder) | missing | Recipient edit highlighting step removed. |

## Generated routes from `PAGES` in `src/pages.config.js`

Generated pattern is `/${PageName}`.

| Route | Baseline component/page | Current component/page | Status | Notes |
|---|---|---|---|---|
| `/About` | `src/pages/About.jsx` | `src/pages/About.jsx` | same | Marketing content retained. |
| `/Admin` | `src/pages/Admin.jsx` | `src/pages/Admin.jsx` (placeholder) | missing | Admin operations removed. |
| `/Billing` | `src/pages/Billing.jsx` | `src/pages/db/BillingDb.jsx` | changed behavior | Subscription UX replaced by billing reference editor. |
| `/Contact` | `src/pages/Contact.jsx` | `src/pages/Contact.jsx` (placeholder) | missing | Contact request flow removed. |
| `/CreateProposal` | `src/pages/CreateProposal.jsx` -> legacy draft wizard | `src/pages/db/CreateProposalDb.jsx` | changed behavior | Simple CRUD form; no multi-step template workflow. |
| `/CreateProposalWithDrafts` | `src/pages/CreateProposalWithDrafts.jsx` | `src/pages/CreateProposalWithDrafts.jsx` (placeholder) | missing | Full draft/template/evaluation composer removed. |
| `/Dashboard` | `src/pages/Dashboard.jsx` | `src/pages/db/DashboardDb.jsx` | changed behavior | Stats/charts/recent proposals removed. |
| `/Directory` | `src/pages/Directory.jsx` | `src/pages/Directory.jsx` (placeholder) | missing | Same regression as lowercase custom route. |
| `/DirectoryOrgDetail` | `src/pages/DirectoryOrgDetail.jsx` | `src/pages/DirectoryOrgDetail.jsx` (placeholder) | missing | Detail screen removed. |
| `/DirectoryPersonDetail` | `src/pages/DirectoryPersonDetail.jsx` | `src/pages/DirectoryPersonDetail.jsx` (placeholder) | missing | Detail screen removed. |
| `/DocumentComparisonCreate` | `src/pages/DocumentComparisonCreate.jsx` | `src/pages/DocumentComparisonCreate.jsx` (placeholder) | missing | Document comparison create flow removed. |
| `/DocumentComparisonDetail` | `src/pages/DocumentComparisonDetail.jsx` | `src/pages/DocumentComparisonDetail.jsx` (placeholder) | missing | Document comparison detail/report actions removed. |
| `/Documentation` | `src/pages/Documentation.jsx` | `src/pages/Documentation.jsx` | same | Documentation content retained. |
| `/GeminiTest` | `src/pages/GeminiTest.jsx` | `src/pages/GeminiTest.jsx` (placeholder) | missing | Dev/test LLM page removed. |
| `/Landing` | `src/pages/Landing.jsx` | `src/pages/Landing.jsx` | same | Landing retained. |
| `/Organization` | `src/pages/Organization.jsx` | `src/pages/Organization.jsx` (placeholder) | missing | Organization/membership management removed. |
| `/Pricing` | `src/pages/Pricing.jsx` | `src/pages/Pricing.jsx` (placeholder) | missing | Pricing CTA and contact flow removed. |
| `/Privacy` | `src/pages/Privacy.jsx` | `src/pages/Privacy.jsx` | same | Static legal page retained. |
| `/Profile` | `src/pages/Profile.jsx` | `src/pages/Profile.jsx` (placeholder) | missing | Profile persistence flow removed. |
| `/ProposalDetail` | `src/pages/ProposalDetail.jsx` | `src/pages/db/ProposalDetailDb.jsx` | changed behavior | Evaluation/report/share/reveal workflows removed. |
| `/Proposals` | `src/pages/Proposals.jsx` | `src/pages/db/ProposalsDb.jsx` | changed behavior | Tabs, filters, workspace, draft handling removed. |
| `/ReportViewer` | `src/pages/ReportViewer.jsx` | `src/pages/ReportViewer.jsx` (placeholder) | missing | Access-token report viewer removed. |
| `/Settings` | `src/pages/Settings.jsx` | `src/pages/Settings.jsx` (placeholder) | missing | Settings and email config status UX removed. |
| `/SharedReport` | `src/pages/SharedReport.jsx` | `src/pages/db/SharedReportDb.jsx` | changed behavior | Full shared-report resolver/edit/re-evaluate/send-back removed. |
| `/TemplateBuilder` | `src/pages/TemplateBuilder.jsx` | `src/pages/TemplateBuilder.jsx` (placeholder) | missing | Template authoring tooling removed. |
| `/TemplateDedupe` | `src/pages/TemplateDedupe.jsx` | `src/pages/TemplateDedupe.jsx` (placeholder) | missing | Template dedupe tooling removed. |
| `/Templates` | `src/pages/Templates.jsx` | `src/pages/Templates.jsx` (placeholder) | missing | Template catalog and use-template flow removed. |
| `/Terms` | `src/pages/Terms.jsx` | `src/pages/Terms.jsx` | same | Static legal page retained. |
| `/Verification` | `src/pages/Verification.jsx` | `src/pages/Verification.jsx` (placeholder) | missing | Verification intake flow removed. |

## Route-level parity summary
- Same behavior: primarily static content pages (`Landing`, `About`, `Documentation`, `Privacy`, `Terms`).
- Changed behavior: `Dashboard`, `CreateProposal`, `Proposals`, `ProposalDetail`, `SharedReport`, `Billing`.
- Missing behavior: directory, templates, document comparison, recipient-edit, report viewer, profile/settings/org/admin/verification/contact/pricing and related tooling.
