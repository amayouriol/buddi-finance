create or replace function public.guard_account_currency_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.currency is distinct from old.currency and exists (
    select 1
    from public.transactions tx
    where tx.account_id = old.id
       or tx.source_account_id = old.id
       or tx.destination_account_id = old.id
  ) then
    raise exception 'Currency cannot change after transactions are recorded for this account.';
  end if;
  return new;
end;
$$;

create trigger accounts_currency_history_guard
  before update of currency on public.accounts
  for each row execute function public.guard_account_currency_change();
