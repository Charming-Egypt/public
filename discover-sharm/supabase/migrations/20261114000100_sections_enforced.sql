-- Sections the super admin switched off (site settings → sections) can no longer be booked — enforced by the database, not only hidden in the UI.
--  * public.site_settings.value.sections is kept in sync by the settings Worker on every save (admin_set_site_settings, called with the admin's own token).
--  * hotels must be switched ON explicitly; excursions / packages / transfers are on unless explicitly set to false (same defaults as the website).
--  * only NEW bookings are blocked; existing bookings, payments and refunds are untouched.
create or replace function public.guard_disabled_sections() returns trigger language plpgsql security definer set search_path = '' as $$
declare s jsonb; k text;
begin
  select value -> 'sections' into s from public.site_settings where id = 1;
  k := case new.kind::text when 'hotel' then 'hotels' when 'excursion' then 'excursions' when 'package' then 'packages' when 'transfer' then 'transfers' else null end;
  if k is null then return new; end if;
  if (k = 'hotels' and coalesce(s ->> 'hotels', 'false') <> 'true') or (k <> 'hotels' and coalesce(s ->> k, 'true') = 'false') then
    raise exception 'هذا القسم مقفول حاليًا — مش متاح حجزه' using errcode = 'P0001', detail = 'section_disabled';
  end if;
  return new;
end $$;
revoke all on function public.guard_disabled_sections() from public, anon, authenticated;

drop trigger if exists bookings_guard_sections on public.bookings;
create trigger bookings_guard_sections before insert on public.bookings for each row execute function public.guard_disabled_sections();

notify pgrst, 'reload schema';
