-- Buddi single-owner MVP schema.
-- Applied to the local Supabase stack only; no hosted project is linked.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'es',
  time_zone text not null default 'UTC',
  default_currency text not null default 'USD'
    check (default_currency in ('USD', 'PEN')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  currency text not null check (currency in ('USD', 'PEN')),
  opening_balance numeric(18, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index accounts_owner_name_unique
  on public.accounts (owner_id, lower(name));

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index groups_owner_name_unique
  on public.groups (owner_id, lower(name));

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid not null,
  display_name text not null check (length(trim(display_name)) > 0),
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, owner_id, group_id),
  foreign key (group_id, owner_id)
    references public.groups (id, owner_id) on delete cascade
);

create unique index group_members_group_name_unique
  on public.group_members (group_id, lower(display_name));

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in (
    'personal_expense',
    'income',
    'balance_adjustment',
    'transfer',
    'shared_expense',
    'settlement_received',
    'settlement_paid'
  )),
  status text not null default 'posted' check (status in ('draft', 'posted')),
  description text not null default '',
  note text,
  occurred_at timestamptz not null default now(),
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'PEN')),
  usd_amount_snapshot numeric(18, 2) check (usd_amount_snapshot is null or usd_amount_snapshot > 0),
  usd_rate_snapshot numeric(18, 8) check (usd_rate_snapshot is null or usd_rate_snapshot > 0),
  category text,
  account_id uuid,
  source_account_id uuid,
  destination_account_id uuid,
  destination_amount numeric(18, 2) check (destination_amount is null or destination_amount > 0),
  destination_currency text check (destination_currency is null or destination_currency in ('USD', 'PEN')),
  group_id uuid,
  payer_member_id uuid,
  counterparty_member_id uuid,
  adjustment_direction text check (adjustment_direction in ('increase', 'decrease')),
  capture_source text not null default 'manual'
    check (capture_source in ('manual', 'voice', 'receipt', 'import')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, owner_id, group_id),
  foreign key (account_id, owner_id)
    references public.accounts (id, owner_id),
  foreign key (source_account_id, owner_id)
    references public.accounts (id, owner_id),
  foreign key (destination_account_id, owner_id)
    references public.accounts (id, owner_id),
  foreign key (group_id, owner_id)
    references public.groups (id, owner_id),
  foreign key (payer_member_id, owner_id, group_id)
    references public.group_members (id, owner_id, group_id),
  foreign key (counterparty_member_id, owner_id, group_id)
    references public.group_members (id, owner_id, group_id),
  check (status = 'draft' or length(trim(description)) > 0),
  check (type = 'transfer' or (destination_amount is null and destination_currency is null)),
  check (
    (type = 'personal_expense'
      and account_id is not null and category is not null and group_id is null
      and source_account_id is null and destination_account_id is null
      and payer_member_id is null and counterparty_member_id is null
      and adjustment_direction is null)
    or
    (type = 'income'
      and account_id is not null and group_id is null
      and source_account_id is null and destination_account_id is null
      and payer_member_id is null and counterparty_member_id is null
      and adjustment_direction is null)
    or
    (type = 'balance_adjustment'
      and account_id is not null and category is not null and group_id is null
      and source_account_id is null and destination_account_id is null
      and payer_member_id is null and counterparty_member_id is null
      and adjustment_direction is not null)
    or
    (type = 'transfer'
      and account_id is null and group_id is null
      and source_account_id is not null and destination_account_id is not null
      and source_account_id <> destination_account_id
      and payer_member_id is null and counterparty_member_id is null
      and adjustment_direction is null
      and ((destination_amount is null and destination_currency is null)
        or (destination_amount is not null and destination_currency is not null))
      and (destination_currency is distinct from currency
        or destination_amount is null or destination_amount = amount))
    or
    (type = 'shared_expense'
      and group_id is not null and category is not null
      and source_account_id is null and destination_account_id is null
      and counterparty_member_id is null and adjustment_direction is null
      and ((payer_member_id is null and account_id is not null)
        or (payer_member_id is not null and account_id is null)))
    or
    (type in ('settlement_received', 'settlement_paid')
      and group_id is not null and counterparty_member_id is not null
      and account_id is not null
      and source_account_id is null and destination_account_id is null
      and payer_member_id is null and adjustment_direction is null)
  ),
  check (status = 'draft' or type <> 'shared_expense' or confirmed_at is not null)
);

create index transactions_owner_date_idx
  on public.transactions (owner_id, occurred_at desc);
create index transactions_group_idx
  on public.transactions (group_id, occurred_at desc)
  where group_id is not null;

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid not null,
  group_member_id uuid,
  is_owner boolean not null default false,
  share_amount numeric(18, 2) not null check (share_amount > 0),
  created_at timestamptz not null default now(),
  foreign key (transaction_id, owner_id, group_id)
    references public.transactions (id, owner_id, group_id) on delete cascade,
  foreign key (group_member_id, owner_id, group_id)
    references public.group_members (id, owner_id, group_id),
  check ((is_owner and group_member_id is null) or (not is_owner and group_member_id is not null)),
  unique (transaction_id, group_member_id)
);

create unique index transaction_splits_one_owner_idx
  on public.transaction_splits (transaction_id)
  where is_owner;

create function public.validate_shared_expense_splits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_transaction_id uuid;
  transaction_type text;
  transaction_status text;
  transaction_amount numeric(18, 2);
  share_total numeric(18, 2);
  owner_share_count integer;
  share_count integer;
begin
  if tg_table_name = 'transactions' then
    target_transaction_id := new.id;
  elsif tg_op = 'DELETE' then
    target_transaction_id := old.transaction_id;
  else
    target_transaction_id := new.transaction_id;
  end if;

  select t.type, t.status, t.amount
    into transaction_type, transaction_status, transaction_amount
    from public.transactions as t
    where t.id = target_transaction_id;

  if not found then
    return null;
  end if;

  if transaction_type <> 'shared_expense' then
    if exists (
      select 1 from public.transaction_splits as s
      where s.transaction_id = target_transaction_id
    ) then
      raise exception 'Only shared expenses can have participant splits';
    end if;
    return null;
  end if;

  if transaction_status = 'draft' then
    return null;
  end if;

  select count(*), count(*) filter (where s.is_owner), coalesce(sum(s.share_amount), 0)
    into share_count, owner_share_count, share_total
    from public.transaction_splits as s
    where s.transaction_id = target_transaction_id;

  if share_count < 2 or owner_share_count <> 1 or share_total <> transaction_amount then
    raise exception 'A posted shared expense needs one owner share and participant shares that sum to the bill total';
  end if;

  return null;
end;
$$;

revoke all on function public.validate_shared_expense_splits() from public, anon, authenticated;

create constraint trigger transactions_validate_shared_splits
  after insert or update on public.transactions
  deferrable initially deferred
  for each row execute function public.validate_shared_expense_splits();

create constraint trigger splits_validate_shared_transaction
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.validate_shared_expense_splits();

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/%'),
  foreign key (transaction_id, owner_id)
    references public.transactions (id, owner_id) on delete cascade
);

-- The browser can access only its own rows. Keep grants and RLS together.
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.attachments enable row level security;

revoke all on table public.profiles, public.accounts, public.groups,
  public.group_members, public.transactions, public.transaction_splits,
  public.attachments from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.accounts, public.groups,
  public.group_members, public.transactions, public.transaction_splits,
  public.attachments to authenticated;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy accounts_select_owner on public.accounts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy accounts_insert_owner on public.accounts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy accounts_update_owner on public.accounts
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy accounts_delete_owner on public.accounts
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy groups_select_owner on public.groups
  for select to authenticated using (owner_id = (select auth.uid()));
create policy groups_insert_owner on public.groups
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy groups_update_owner on public.groups
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy groups_delete_owner on public.groups
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy group_members_select_owner on public.group_members
  for select to authenticated using (owner_id = (select auth.uid()));
create policy group_members_insert_owner on public.group_members
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy group_members_update_owner on public.group_members
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy group_members_delete_owner on public.group_members
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy transactions_select_owner on public.transactions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy transactions_insert_owner on public.transactions
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy transactions_update_owner on public.transactions
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy transactions_delete_owner on public.transactions
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy transaction_splits_select_owner on public.transaction_splits
  for select to authenticated using (owner_id = (select auth.uid()));
create policy transaction_splits_insert_owner on public.transaction_splits
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy transaction_splits_update_owner on public.transaction_splits
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy transaction_splits_delete_owner on public.transaction_splits
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy attachments_select_owner on public.attachments
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attachments_insert_owner on public.attachments
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attachments_update_owner on public.attachments
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy attachments_delete_owner on public.attachments
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Receipt object names must start with the authenticated user's UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'buddi-receipts',
  'buddi-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy buddi_receipts_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'buddi-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy buddi_receipts_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'buddi-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy buddi_receipts_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'buddi-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'buddi-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy buddi_receipts_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'buddi-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
