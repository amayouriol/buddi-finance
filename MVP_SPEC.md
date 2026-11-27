# Buddi MVP: product and acceptance spec

Status: scope confirmed by the owner on 2026-11-08. This document turns that scope into implementation-ready behavior; it does not authorize a Git commit.

## Product outcome

The owner can open Buddi from a phone home-screen icon, record personal and shared money activity with few steps, and trust that the record is saved to their account in the cloud. Friends remain names in the owner's ledger and do not need to register.

## MVP scope

### Included

- Responsive web app installable from a supported phone browser's Add to Home Screen flow (PWA).
- Phone-number sign-in by one-time SMS code. Keep the session so the owner is not asked for a code on each visit.
- One owner account for the first release. Friends are local group members, not app users.
- Cloud persistence for the owner's profile, personal accounts, transactions, groups, group members, and settlement movements.
- Guided first use: configure personal accounts, create or skip a group, and record a first transaction. Help can be reopened from the app.
- Personal ledger entries: expense, income, transfers between personal accounts, and balance adjustments, with date, description, category where applicable, amount, currency, and account(s). Balance adjustments change an account balance but are excluded from income/expense reports.
- Edit personal account names and opening balances. Lock the currency after any transaction references the account so historical amounts remain consistent.
- Edit posted personal expenses, income, balance adjustments, and transfers. Shared-expense and settlement corrections need a dedicated flow to keep their linked splits and balances consistent.
- Shared expense entries: group, total, category, participants, payer, and editable owner share. Default to an equal split.
- Shared debt tracking and partial or full repayments, reflected as account movements without double-counting as income or expenses.
- Natural language voice/text and receipt-photo assistance using a free-tier AI experiment, after cloud storage and permissions are in place. AI creates a draft; the owner must review and confirm before a transaction is saved.
- Spanish and English input for the owner's natural-language descriptions.

### Later

- Friends creating accounts, shared editing, invitations, or multi-user settlement confirmation.
- Background or continuous listening at restaurants. Any future audio capture must be deliberate and visible to the owner.
- Bank connections, automatic bank-feed reconciliation, push reminders, and moving money.
- Offline transaction queue and automatic sync. The first cloud version requires an internet connection to save.
- Historical import and history migration (the app has a read-only local preview; writing rows waits until its mapping, opening balances, and duplicate-handling rules are confirmed).

## User journeys

### First use

1. Open the Buddi PWA and enter a phone number.
2. Enter the SMS code once; the verified session persists across visits.
3. Follow the short guide to set up personal accounts and optionally create a group.
4. Save a first personal or shared entry and see it in the ledger.

### Personal entry

1. Choose expense, income, or transfer.
2. Enter or dictate the description and amount; choose or confirm date, category, currency, and account(s).
3. Review and save. A transfer changes the two account balances but does not count as income or spending.

### Shared expense

1. Select an existing group or create one; add people by name as needed.
2. Enter the total, payer, category, and participants. Buddi proposes an equal split and the owner can edit their share.
3. Preview the owner's personal expense, personal-account movement, and resulting amounts owed.
4. Confirm and save.

### AI-assisted entry

1. Deliberately tap voice input or choose a receipt photo.
2. Buddi proposes fields and marks missing or uncertain values for review.
3. The owner edits and confirms. No AI result is written directly to the ledger.

## Accounting rules that must hold

| Event | Personal account movement | Personal expense/income report | Shared balance |
|---|---|---|---|
| Owner pays shared bill | Full bill leaves selected account | Only owner's share is expense | Other participants owe their shares |
| Another person pays | No movement yet | Owner's share is expense | Owner owes that share to the payer |
| Friend repays owner | Repayment enters selected account | Not new income | Reduces receivable by amount received |
| Owner repays friend | Repayment leaves selected account | Not a new expense | Reduces debt by amount paid |
| Owner transfers between own accounts | Outflow from source and inflow to destination | Neither income nor expense | No shared balance change |

Amounts must be stored in integer minor units or an exact decimal type, with currency recorded on each transaction. Split rounding must allocate all cents so the participant shares sum to the bill total.

## Proposed data ownership and architecture

- **PWA frontend:** phone web experience, install prompt, guide, manual forms, microphone/camera capture, and review screen.
- **Supabase Auth:** phone identity and verified session. SMS delivery uses a configured provider; check destination-country prices before enabling production OTP.
- **PostgreSQL:** profiles, personal accounts, transactions, groups, members, and receipt metadata. Each owner's rows carry an owner ID and are protected by Row Level Security; settlements are transaction types.
- **Private object storage:** receipt photos, associated with the owner's transaction. Do not expose public receipt URLs.
- **Server-side function:** calls Gemini with a server-held secret and returns a structured draft. Never put the Gemini API key in browser JavaScript.
- **AI boundary:** send data only after the owner taps capture/submit; do not retain raw audio by default; ask for human confirmation before persistence.

### Initial logical entities

- `profiles`: owner ID, display name, default currency, locale/time zone, onboarding progress.
- `accounts`: owner ID, account name, currency, opening balance if needed for the chosen reconciliation model.
- `groups`: owner ID, group name.
- `group_members`: group ID, display name, optional linked user ID (null in the single-owner MVP).
- `transactions`: owner ID, type, description, date, amount, currency, category, personal account, group, payer, owner's share, capture source, and confirmation status.
- Settlement movements: transaction rows with a settlement type, group/member, direction, amount, currency, date, and personal account; not classified as income or expense.
- `attachments`: transaction ID and private storage path for receipt images.

An initial local Supabase migration now exists and has been applied to the local stack. Review the currency conversion and account-balance reconciliation rules before connecting a hosted project or importing the source ledger.

## Acceptance criteria

### Core

- The owner can sign in by phone OTP and reopen the app without repeating OTP while their session remains valid.
- A transaction saved on the phone is available after refresh and sign-in from another device.
- Another authenticated user cannot read or change the owner's rows.
- The owner can create a group independently, add names, and reuse it for a later shared entry.
- The expense paid-by-owner and paid-by-friend cases produce the account movements and balances in the accounting table above.
- Partial repayment updates the remaining balance and appears in the personal account ledger without changing expense/income totals.
- Transfers change source and destination account balances without changing expense/income totals.
- Balance adjustments change the selected account balance without changing expense/income totals.
- Split shares sum exactly to the recorded total, including odd-cent cases.
- The guide can be skipped, reopened, and completed without blocking transaction entry.

### AI capture

- Text/voice and receipt-photo flows produce editable drafts, not committed transactions.
- The owner can correct every proposed field before saving.
- If amount, currency, payer, or split is ambiguous, the app asks instead of guessing silently.
- Manual entry remains usable if AI is unavailable or the free quota is exhausted.

## Provisional success measures

These are hypotheses to validate with the owner, not launch promises:

- Record a straightforward personal expense in under 15 seconds after setup.
- Record a straightforward shared expense in under 30 seconds after selecting a group.
- Reconcile all amounts for a small set of representative examples from the existing ledger.
- For AI suggestions, track correction rate by field (amount, category, account, group, payer) before deciding whether the feature saves time.

## Delivery sequence

1. Validate this behavior and the accounting examples against the owner's export, using anonymized examples in project artifacts.
2. Finalize the schema, currency/reconciliation approach, SMS provider/country cost, and Supabase security policies.
3. Build the mobile PWA shell, guided setup, phone auth, and cloud-backed personal ledger.
4. Complete groups, shared payer/split logic, and settlement movements; reconcile acceptance examples.
5. Add the AI server function and text/voice drafts; then receipt photos and private storage. The authenticated text/voice and receipt draft functions, editable forms, and private receipt attachments are now implemented.
6. Have the owner use it on their phone, fix observed friction, and only commit when the owner asks.

## Current prototype boundary

The repository now includes an installable PWA shell, guided first-use setup, editable personal accounts, personal and shared expenses, income, same-currency transfers, balance adjustments, monthly category budgets, partial or full settlement recording, editable AI-assisted text/voice/receipt drafts, private receipt attachments in local Supabase Storage, and a read-only browser preview for Excel/CSV history files. Account name and opening balance can be edited; a database guard prevents currency changes once transactions reference an account. Budget progress uses personal expenses and the owner's share of shared expenses, separated by currency. Transfers update both accounts without affecting income or spending; adjustments change the balance without entering either report; repayments update the shared balance and account without being counted as income or expense. AI drafts require a user-provided local Gemini key, an explicit send action, and never save automatically. Google free-tier requests may be used to improve products, so prototype evaluation should use sample descriptions and receipts. Local sign-in uses email one-time codes captured by Mailpit as a temporary development path; phone OTP still needs an SMS provider. No hosted project, historical import, or cross-currency transfers are connected yet.
