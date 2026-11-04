/*
  أيقونات خطية مرسومة يدوياً — لا مكتبة خارجية.
  كلها بمقاس واحد وسماكة خط واحدة لتبدو من عائلة واحدة.
*/

const PATHS = {
  /* جرس — الإشعارات */
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  /* لهب — الحرائق */
  flame: (
    <>
      <path d="M12 3c0 3-3 4-3 7a3 3 0 0 0 6 0c0-1.2-.6-2-1.2-2.8" />
      <path d="M12 21a6 6 0 0 1-6-6c0-2.4 1.2-4 2.4-5.4" />
      <path d="M12 21a6 6 0 0 0 6-6c0-1.6-.6-3-1.5-4.2" />
    </>
  ),
  /* ساعة — الزمن */
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  /* هدف — التحديد */
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  /* مساحة — الأرض المحترقة */
  area: (
    <>
      <path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z" />
      <path d="M12 4v16" />
    </>
  ),
  /* مدني مصاب */
  civilianHurt: (
    <>
      <circle cx="12" cy="6.5" r="2.8" />
      <path d="M5.5 20.5v-2a6.5 6.5 0 0 1 9-6" />
      <path d="M18 14.5v5M15.5 17h5" />
    </>
  ),
  /* مدني — وفاة */
  civilian: (
    <>
      <circle cx="12" cy="6.5" r="2.8" />
      <path d="M5.5 20.5v-2a6.5 6.5 0 0 1 13 0v2" />
    </>
  ),
  /* خوذة إطفاء — كادر مصاب */
  staffHurt: (
    <>
      <path d="M5 16.5a7 7 0 0 1 14 0" />
      <path d="M2.5 16.5h19" />
      <path d="M9.5 16.5c0-4.2 1-7 2.5-7s2.5 2.8 2.5 7" />
      <path d="M18 19v4M16 21h4" />
    </>
  ),
  /* خوذة إطفاء */
  staff: (
    <>
      <path d="M5 16.5a7 7 0 0 1 14 0" />
      <path d="M2.5 16.5h19" />
      <path d="M9.5 16.5c0-4.2 1-7 2.5-7s2.5 2.8 2.5 7" />
    </>
  ),
  /* شمس — تبديل للوضع الداكن */
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.6 12H2M22 12h-2.6M6.2 6.2l1.8 1.8M16 16l1.8 1.8M17.8 6.2 16 8M8 16l-1.8 1.8" />
    </>
  ),
  /* هلال — تبديل للوضع الفاتح */
  moon: (
    <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2Z" />
  ),
  /* كاميرا */
  camera: (
    <>
      <path d="M3 8.6h3.2l1.6-2.4h8.4l1.6 2.4H21v10.2H3z" />
      <circle cx="12" cy="13.4" r="3.4" />
    </>
  ),
  /* ===== أنواع أسئلة الاستبيان ===== */
  /* سطر واحد — نص قصير */
  t_text: (
    <>
      <path d="M4 8.5h16" />
      <path d="M4 13h11" />
    </>
  ),
  /* فقرة — نص طويل */
  t_textarea: (
    <>
      <path d="M4 6.5h16" />
      <path d="M4 11h16" />
      <path d="M4 15.5h10" />
    </>
  ),
  /* معلومة — ملاحظة للقارئ */
  t_note: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.9" />
    </>
  ),
  /* عدّاد — رقم صحيح */
  t_integer: (
    <>
      <path d="M8.5 4.5 6.5 19.5" />
      <path d="M15.5 4.5 13.5 19.5" />
      <path d="M4.5 9h15" />
      <path d="M3.8 15h15" />
    </>
  ),
  /* فاصلة عشرية */
  t_decimal: (
    <>
      <path d="M5 5.5h5.5v13H5z" />
      <circle cx="13.6" cy="17.4" r="1.05" fill="currentColor" stroke="none" />
      <path d="M16.6 5.5h2.6v13h-2.6z" />
    </>
  ),
  /* مقياس متدرّج */
  t_range: (
    <>
      <path d="M3.5 12h17" />
      <path d="M7 9.4v5.2" />
      <path d="M12 8.2v7.6" />
      <path d="M17 9.4v5.2" />
    </>
  ),
  /* دائرة مفردة — اختيار واحد */
  t_select_one: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
    </>
  ),
  /* مربعات مؤشّرة — اختيار متعدد */
  t_select_multiple: (
    <>
      <rect x="3.5" y="4.5" width="7" height="7" rx="1.6" />
      <path d="m5.2 8 1.5 1.6 2.3-2.8" />
      <rect x="13.5" y="4.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <path d="m5.2 17 1.5 1.6 2.3-2.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  /* درجات — ترتيب أفضليات */
  t_rank: (
    <>
      <path d="M4 18.5h4.2v2.2H4z" />
      <path d="M9.9 12h4.2v8.7H9.9z" />
      <path d="M15.8 6.2h4.2v14.5h-4.2z" />
    </>
  ),
  /* تقويم — تاريخ */
  t_date: (
    <>
      <rect x="3.5" y="5.2" width="17" height="15.3" rx="2.2" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v3.4" />
      <path d="M16 3.5v3.4" />
    </>
  ),
  /* ساعة — وقت */
  t_time: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.6V12l2.8 1.9" />
    </>
  ),
  /* تقويم وساعة */
  t_datetime: (
    <>
      <rect x="3.2" y="5.2" width="12.6" height="12.6" rx="2" />
      <path d="M3.2 9.4h12.6" />
      <circle cx="17.4" cy="17.2" r="4.2" />
      <path d="M17.4 15.2v2.1l1.4 1" />
    </>
  ),
  /* دبوس على منطقة — سؤال المحافظة */
  t_governorate: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  /* حدود إدارية — محافظة وناحية */
  t_admin_area: (
    <>
      <path d="M3.6 6.4 9 4.2l6 2.2 5.4-2.2v13.4L15 19.8l-6-2.2-5.4 2.2z" />
      <path d="M9 4.2v13.4" />
      <path d="M15 6.4v13.4" />
    </>
  ),
  /* دبوس — إحداثيات */
  t_geopoint: (
    <>
      <path d="M12 21.5s6.4-6.2 6.4-11a6.4 6.4 0 1 0-12.8 0c0 4.8 6.4 11 6.4 11Z" />
      <circle cx="12" cy="10.4" r="2.4" />
    </>
  ),
  /* صورة */
  t_image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <circle cx="8.6" cy="9.8" r="1.7" />
      <path d="m4.2 16.6 4.4-4 3.3 3 3-2.4 5.3 4.6" />
    </>
  ),
  /* تكرار — مجموعة متكررة */
  t_repeat: (
    <>
      <rect x="3.4" y="3.4" width="12" height="12" rx="2" />
      <path d="M8.6 20.6h9a3 3 0 0 0 3-3v-9" />
      <path d="m10.8 18.4-2.2 2.2 2.2 2.2" />
    </>
  ),
  /* آلة حاسبة — حقل محسوب */
  t_calculate: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.2" />
      <path d="M8 7.2h8" />
      <path d="M8.2 12.4h1.6M11.2 12.4h1.6M14.2 12.4h1.6M8.2 16.4h1.6M11.2 16.4h1.6M14.2 16.4h1.6" />
    </>
  ),
  /* درع — حماية بكلمة مرور */
  lock: (
    <>
      <rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.2" />
      <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" />
      <circle cx="12" cy="15.4" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  /* رابط — مشاركة */
  link: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.2 0l2.9-2.9a3.7 3.7 0 0 0-5.2-5.2l-1.5 1.5" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.2 0l-2.9 2.9a3.7 3.7 0 0 0 5.2 5.2l1.5-1.5" />
    </>
  ),
  /* نسخ */
  copy: (
    <>
      <rect x="8.4" y="8.4" width="12" height="12" rx="2" />
      <path d="M15.6 5.6H5.6a2 2 0 0 0-2 2v10" />
    </>
  ),
  /* صح */
  check: <path d="m4.8 12.6 4.6 4.6 9.8-10.4" />,
  /* دبوس موقع */
  pin: (
    <>
      <path d="M12 21.5s6.5-6.2 6.5-11a6.5 6.5 0 1 0-13 0c0 4.8 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10.4" r="2.5" />
    </>
  ),
};

export default function Icon({ name, className }) {
  const shape = PATHS[name];
  if (!shape) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className ? `icon ${className}` : 'icon'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
