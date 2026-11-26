-- A load shipped through the ship-out check is the signed record. It cannot be deleted from the database,
-- whatever the app does. An admin reopens it first (which clears shippedAt) if it truly has to go.
create or replace function public.rs_keep_shipped() returns trigger language plpgsql as $$
begin
  if old.ship is not null and (old.ship ->> 'shippedAt') is not null then
    raise exception 'Load % was shipped with a signed record and cannot be deleted', old.load_no;
  end if;
  return old;
end $$;
drop trigger if exists rs_keep_shipped on public.rs_loads;
create trigger rs_keep_shipped before delete on public.rs_loads for each row execute function public.rs_keep_shipped();
