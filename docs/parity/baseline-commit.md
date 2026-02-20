# Baseline Commit Selection

## Search result
- Exact commit message search for `Synced "Recipient Side6"` returned no matches:
  - `git log --all --grep='Synced "Recipient Side6"'`
- Nearest matching commit message search for `Recipient Side6` returned one match:
  - `e0d6d192577b35ef19c1d8d4c7235caa9977c86e | 2026-02-13 15:30:40 +1100 | Recipient Side6`

## Selected baseline
- Baseline SHA: `e0d6d192577b35ef19c1d8d4c7235caa9977c86e`
- Commit subject: `Recipient Side6`
- Author: `Greg Klugman`
- Commit date: `2026-02-13 15:30:40 +1100`

## Branch/tag context
- Branches containing baseline commit:
  - `backup/before-revert-2026-02-13`
  - `backup/worse-redaction-2026-02-13`
  - `origin/backup/before-revert-2026-02-13`
  - `origin/backup/worse-redaction-2026-02-13`
- Tags containing baseline commit: none

## Diff comparison target
- Current HEAD SHA: `153d0ae59fed3f381a18529de96f2ba5895e3099`
- Current branch: `migrate/phase1-auth`
- Parity diff scope used in this audit: `e0d6d192577b35ef19c1d8d4c7235caa9977c86e..HEAD`
