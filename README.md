# Buddi

**Your budget, with a buddy.**

Buddi is an early-stage portfolio prototype exploring a single experience for everyday budgeting and friend-to-friend expense sharing. The goal is to make personal transactions, shared bills, and who-owes-whom balances feel like one coherent picture.

## Prototype features

- Overview dashboard for balances, monthly spending, categories, and recent activity
- Personal and shared expense entry
- Optional browser speech recognition to start filling an expense form
- Split preview that separates your share from the amount owed
- Friend balance list with reminder and settlement states
- Searchable transaction list, simple budget cards, and mobile layout
- Browser-only demo persistence using `localStorage`

## Run it

Open `index.html` in a modern browser. For the best experience, serve the folder with any static web server so browser speech recognition can request microphone access. There is no package installation or build step.

## Important prototype boundaries

- Demo data only; this prototype is not connected to a bank, Money Manager, or Splitwise.
- Records are stored in the current browser only and can be cleared through browser storage settings.
- Voice recognition support depends on the browser and permission; all fields remain editable.
- Friend reminders, account creation, budgets, authentication, and real settlement transfers are illustrative UI only.

## Product direction

The intended product model keeps personal financial accounts and categories separate from the shared-expense ledger. A shared purchase can therefore be recorded once, show the user's own portion in personal spending, and create receivables for the other participants. Before connecting external services, the data model and reconciliation rules should be validated with real usage examples.

## Stack

Vanilla HTML, CSS, and JavaScript. No third-party runtime dependencies.

