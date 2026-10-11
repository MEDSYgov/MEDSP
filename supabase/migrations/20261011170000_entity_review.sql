-- ===== مراجعة الجهات: اعتماد على مرحلتين (الجهة تؤكد ← الوزارة تعتمد) =====
-- طُبّق عبر execute_sql. سجل الجهات زُوّد بـ 15 جهة من استمارات KoBo (بتسمياتها البديلة).

alter table public.admins add column if not exists entity uuid references public.rubble_entities(id) on delete set null;
alter table public.responses drop constraint if exists responses_status_check;
alter table public.responses add constraint responses_status_check check (status in ('pending','confirmed','approved','rejected'));

-- my_role تُرجع entity و entityName (انظر التعريف الحالي في القاعدة)

create or replace function public.can_review_response(p_survey uuid, p_answers jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_review(p_survey) and (public.is_admin() or coalesce((
    select a.entity is null or p_answers->>'rt_contractor' = a.entity::text
    from public.admins a where a.user_id = (select auth.uid())), false));
$$;
alter policy responses_reviewer_read on public.responses using ((select public.can_review_response(survey_id, answers)));
alter policy responses_reviewer_update on public.responses using ((select public.can_review_response(survey_id, answers))) with check ((select public.can_review_response(survey_id, answers)));

create or replace function public.guard_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() or exists (select 1 from public.admins where user_id = (select auth.uid()) and role = 'reviewer' and entity is null) then
    return new;
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    raise exception 'الاعتماد النهائي للوزارة. يمكنك «تأكيد» الإجابة لتنتقل إليها.' using errcode = '42501';
  end if;
  if old.status = 'approved' then
    raise exception 'هذه الإجابة معتمدة من الوزارة ولا يمكن تعديلها.' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger responses_guard_review before update on public.responses for each row execute function public.guard_review();

-- خيارات «الجهة المنفذة» (rt_contractor) تُبنى من سجل الجهات تلقائياً: sync_contractor_choices + trigger rubble_entities_sync
-- rt_contractor_other: نص يظهر عند اختيار «جهة أخرى»
-- rubble_transfer_feed تُرجع entityName من السجل
-- create_account(...,p_entity) و update_account_access(...,p_entity) و list_accounts_v3()
