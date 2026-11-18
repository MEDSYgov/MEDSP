-- الحذف (الناعم، مع سبب) صار متاحاً للمعتمد النهائي أيضاً، إضافةً إلى المدراء.
-- الاسترجاع والاطلاع على المحذوف يبقيان للمدراء فقط. إعادة تعريف review_action كما هي مع تغيير شرط الحذف وحده.

create or replace function public.review_action(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.responses; stage text; who text; nxt text; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.responses where id = p_id for update;
  if not found then raise exception 'الاستمارة غير موجودة'; end if;
  stage := public.review_stage(r.survey_id);
  if stage is null then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  if stage = 'specialist' and r.answers ? 'rt_contractor' and exists (
       select 1 from public.admins a where a.user_id = (select auth.uid()) and a.entity is not null
         and r.answers->>'rt_contractor' <> a.entity::text) then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  select coalesce(nullif(display_name, ''), username) into who from public.admins where user_id = (select auth.uid());

  if r.deleted_at is not null and p_action <> 'restore' then raise exception 'الاستمارة محذوفة'; end if;

  if p_action = 'confirm' then          /* اعتماد أولي */
    if stage not in ('specialist','admin') or r.status not in ('pending','returned') then raise exception 'لا يمكن الاعتماد الأولي لهذه الاستمارة الآن'; end if;
    nxt := 'confirmed';
  elsif p_action = 'return' then        /* إعادة للتعديل */
    if stage not in ('specialist','admin') or r.status not in ('pending','confirmed') then raise exception 'لا يمكن إعادة هذه الاستمارة الآن'; end if;
    if note is null then raise exception 'اكتب سبب الإعادة'; end if;
    nxt := 'returned';
  elsif p_action = 'approve' then       /* اعتماد نهائي */
    if stage not in ('final','admin') or r.status <> 'confirmed' then raise exception 'الاعتماد النهائي للاستمارات المعتمدة أولياً فقط'; end if;
    nxt := 'approved';
  elsif p_action = 'reject' then        /* رفض نهائي ← تعود للأخصائي */
    if stage not in ('final','admin') or r.status <> 'confirmed' then raise exception 'لا يمكن رفض هذه الاستمارة الآن'; end if;
    if note is null then raise exception 'اكتب سبب الرفض'; end if;
    nxt := 'pending';
  elsif p_action = 'unapprove' then     /* تراجع عن الاعتماد */
    if stage not in ('final','admin') or r.status <> 'approved' then raise exception 'الاستمارة غير معتمدة'; end if;
    if note is null then raise exception 'اكتب سبب التراجع'; end if;
    nxt := 'confirmed';
  elsif p_action = 'delete' then
    if stage not in ('final','admin') then raise exception 'الحذف للمعتمد النهائي والمدير فقط' using errcode = '42501'; end if;
    if note is null then raise exception 'اكتب سبب الحذف'; end if;
    perform set_config('medsp.review_rpc', '1', true);
    update public.responses set deleted_at = now(), deleted_by = who,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'deleted', 'by', who, 'note', note))
    where id = p_id;
    return jsonb_build_object('id', p_id, 'deleted', true);
  elsif p_action = 'restore' then
    if stage <> 'admin' then raise exception 'الاسترجاع للمدير فقط' using errcode = '42501'; end if;
    perform set_config('medsp.review_rpc', '1', true);
    update public.responses set deleted_at = null, deleted_by = null,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'restored', 'by', who))
    where id = p_id;
    return jsonb_build_object('id', p_id, 'deleted', false);
  else
    raise exception 'إجراء غير معروف';
  end if;

  perform set_config('medsp.review_rpc', '1', true);
  update public.responses set status = nxt, reviewed_by = who, reviewed_at = now(), review_note = note,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', p_action, 'status', nxt, 'by', who, 'note', note))
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', nxt);
end; $$;
