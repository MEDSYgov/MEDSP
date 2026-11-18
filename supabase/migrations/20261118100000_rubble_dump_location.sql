-- ===== الاستمارة الرسمية للأنقاض: موقع وصورة المكان الذي رُحّلت إليه الأنقاض =====
-- بعد سؤال الوجهة (rt_dump) مباشرة يظهر سؤالان إلزاميان:
--   rt_dump_point: موقع الوجهة (تحديد GPS أو كتابة الإحداثيات أو الاختيار من الخريطة)
--   rt_dump_photo: صورة الوجهة
-- عنوانهما يتغير حسب الخيار: طريق ترابي مقترح / مكب.
-- إضافي فقط، ويمر مرة واحدة (وجود rt_dump_point علامته). الصورة لا تصل إلى التغذية (strip_media).

create or replace function public.rt_dump_loc_nodes(p jsonb)
returns jsonb language plpgsql immutable as $f$
declare res jsonb := '[]'::jsonb; n jsonb;
  road constant text := '${rt_dump} = ''طريق ترابي أو زراعي مقترح''';
  notroad constant text := '${rt_dump} != '''' and ${rt_dump} != ''طريق ترابي أو زراعي مقترح''';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return p; end if;
  for n in select * from jsonb_array_elements(p) loop
    if n ? 'children' then n := jsonb_set(n, '{children}', public.rt_dump_loc_nodes(n->'children')); end if;
    res := res || jsonb_build_array(n);
    if n->>'name' = 'rt_dump' then
      res := res || jsonb_build_array(
        jsonb_build_object('name', 'rt_dump_point', 'type', 'geopoint', 'required', true,
          'label', 'موقع المكب الذي رُحّلت إليه الأنقاض', 'relevant', notroad,
          'hint', 'حدّد موقعك وأنت في المكب، أو اكتب الإحداثيات، أو اخترها من الخريطة.'),
        jsonb_build_object('name', 'rt_dump_photo', 'type', 'image', 'required', true,
          'label', 'صورة المكب الذي رُحّلت إليه الأنقاض', 'relevant', notroad),
        jsonb_build_object('name', 'rt_road_point', 'type', 'geopoint', 'required', true,
          'label', 'موقع الطريق الذي فُرشت عليه الأنقاض', 'relevant', road,
          'hint', 'حدّد موقعك وأنت على الطريق، أو اكتب الإحداثيات، أو اخترها من الخريطة.'),
        jsonb_build_object('name', 'rt_road_photo', 'type', 'image', 'required', true,
          'label', 'صورة الطريق الذي فُرشت عليه الأنقاض', 'relevant', road));
    end if;
  end loop;
  return res;
end; $f$;

update public.surveys set pages = public.rt_dump_loc_nodes(pages)
where pages::text like '%"rt_dump"%' and pages::text like '%"rt_volume"%'
  and pages::text not like '%"rt_dump_point"%';

drop function public.rt_dump_loc_nodes(jsonb);
