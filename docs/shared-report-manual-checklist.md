# Shared Report Manual Test Checklist

## Preconditions
- Create a proposal with an evaluation report.
- Use `Send AI Report` to generate and email a shared link.
- Copy the generated URL in the format `/SharedReport?token=...`.

## 1) Create share link
- Trigger `Send AI Report` from `ProposalDetail`.
- Confirm function response includes:
  - `shareUrl`
  - `token`
  - `proposalId`
  - `viewCount` and `maxViews`
- Confirm link query includes `token` and `app_id`.
- In `ShareLink` storage, verify proposal linkage is present (`proposal_id` or `proposalId`) for the created token.
- Open the shared URL and verify the shared report resolves without `MISSING_PROPOSAL_ID`.

## 2) Open link while logged out
- Open the shared URL in an incognito window.
- If `ShareLink.recipient_email` is set (recipient-pinned):
  - Expect HTTP `401`
  - Response code `AUTH_REQUIRED`
  - UI shows: `Please sign in to continue`
  - Shared workspace view/edit should not render.
- If link is not recipient-pinned:
  - Expect the link to resolve and render the shared report landing page.
  - Click `Open Shared Workspace`.
  - Expect:
    - AI report is visible.
    - Party A section is redacted for confidential values.
    - Party B editable fields are present.
    - Re-evaluation button is disabled with sign-in hint.

## 3) Open link while logged in as recipient
- Sign in as the invited recipient account and open the same URL.
- Expect:
  - Shared report resolves with no 404.
  - Party B fields can be edited and saved.
  - Save action returns `RESPONSES_UPDATED`.
  - Re-evaluate action works and decrements remaining quota.
  - Send-back action returns `SEND_BACK_RECORDED`.

## 3b) Open link while logged in as non-recipient (recipient-pinned)
- Sign in as an account different from `ShareLink.recipient_email`.
- Open the same URL.
- Expect:
  - HTTP `403`
  - Response code `RECIPIENT_MISMATCH`
  - View/edit UI is blocked.

## 4) Expired token behavior
- Manually set `expires_at` in `ShareLink` to a past date.
- Open the link again.
- Expect:
  - HTTP `410`
  - Response code `TOKEN_EXPIRED`
  - UI shows expiration-specific message.

## 5) View limit behavior
- Set `uses = max_uses` for the link token.
- Open the link.
- Expect:
  - HTTP `410`
  - Response code `MAX_VIEWS_REACHED`
  - UI shows view-limit-specific message.

## 6) Recipient mismatch behavior
- Covered in section `3b`; keep as a regression check in CI/manual smoke.
