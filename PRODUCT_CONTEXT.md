# Buddi product context

## Product goal

Buddi combines the user's personal money ledger with the ease of shared expense tracking. Keep the bookkeeping logic the user already trusts, while making entry faster and clearer than the current spreadsheet/app workflow.

The user wants fewer taps and eventually wants to record transactions by natural speech or a receipt photo. AI should understand varied descriptions and suggest structured fields, while keeping the result editable before it is saved.

## First release

- Start with one registered user: the owner records everything.
- Friends and group members are names in the owner's ledger. They do not need Buddi accounts or phone verification.
- Personal expenses still have a category and personal account.
- The owner can create reusable shared groups (such as a household or trip) and add members by name, without inviting accounts.
- Equal splits are the default; the owner's portion can be adjusted.
- Keep the current native amount and currency, with a USD equivalent as a later requirement from the source ledger.
- Do not connect banks, send messages, or move money in the early prototype.

## Accounting rules

1. If the owner pays a shared bill, the full amount leaves the selected personal account. The owner's share counts as a personal expense; each other person's share becomes money owed to the owner.
2. If another person pays, the owner's share still counts as a personal expense, but no money leaves the owner's personal account at that moment. The owner owes the payer that share.
3. If a friend repays the owner, record a personal-account inflow and reduce the amount owed. Do not count the repayment as income a second time.
4. If the owner repays a friend, record a personal-account outflow and reduce the debt. Do not count the repayment as another expense.
5. Show the full shared bill, the owner's personal portion, who paid, and the group on the transaction. Keep group balances separate from personal spending totals.

## Capture and AI direction

- Existing voice input is browser speech recognition and is only a prototype convenience; it is not yet a reliable natural-language transaction parser.
- The planned flow is speech or receipt photo → suggested description, amount, date, category, account, group, payer, and split → owner reviews/edits → save.
- Restaurant conversation capture is a later exploration. It needs a clear, deliberate recording action and should not create expenses without review.
- The initial AI experiment should use a free-tier provider with synthetic/sample data, no exposed API key in browser code, and no automatic saving of model guesses.
- A backend or serverless function will be needed before a provider secret can be used safely in a deployed app.

## Current prototype status

- Static HTML/CSS/JavaScript; the current personal/shared expense slice uses local Supabase, with email OTP through local Mailpit for development.
- Shared groups can be created separately and reused from the shared-expense view or entry form.
- Shared-entry form supports payer selection, participants, editable personal share, and a split preview.
- Saving a shared expense updates the demo ledger and person-level balances locally.
- Account creation with an opening balance is connected. Dashboard spending summaries, budgets, reminder delivery, and settlement are still incomplete; settlement does not yet create a matching personal-account transaction.
- Gemini, receipt reading, authentication, multi-user sync, and bank connections are not implemented.

## Working agreement

- Keep the existing GitHub checkout in this workspace; do not make another copy on the Desktop.
- The owner will say when a commit is wanted. Until then, leave work uncommitted and local.
- Treat the exported spreadsheet as a reference for behavior. Do not modify or copy its private records into the repository.
