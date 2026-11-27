create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (category in (
    'Groceries', 'Eating Out', 'Transport', 'House', 'Fun', 'Life style',
    'Utilities', 'Other expense'
  )),
  currency text not null check (currency in ('USD', 'PEN')),
  monthly_limit numeric(18, 2) not null check (monthly_limit > 0),
  created_at timestamptz not null default now(),
  unique (owner_id, category, currency)
);

alter table public.budgets enable row level security;
revoke all on table public.budgets from anon, authenticated;
grant select, insert, update, delete on table public.budgets to authenticated;

create policy budgets_select_owner on public.budgets
  for select to authenticated using (owner_id = (select auth.uid()));
create policy budgets_insert_owner on public.budgets
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy budgets_update_owner on public.budgets
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy budgets_delete_owner on public.budgets
  for delete to authenticated using (owner_id = (select auth.uid()));
