/* أيقونات مكتبة التقارير — خطوط بسيطة بلون النص */
const P = {
  all: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  monthly: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /><path d="M8 14h2M14 14h2M8 17h2" /></>,
  annual: <><path d="M4 20h16" /><rect x="5.5" y="12" width="3" height="6" rx="0.8" /><rect x="10.5" y="8" width="3" height="10" rx="0.8" /><rect x="15.5" y="4.5" width="3" height="13.5" rx="0.8" /></>,
  emergency: <><path d="M12 3.8 21 19.5H3Z" /><path d="M12 9.5v4.5M12 16.8v.2" /></>,
  progress: <><path d="M5 21V4" /><path d="M5 4.5h11l-2.2 3.7L16 12H5" /></>,
  study: <><path d="M4 5.5c2.8-1 5.4-.8 8 1 2.6-1.8 5.2-2 8-1V19c-2.8-1-5.4-.8-8 1-2.6-1.8-5.2-2-8-1Z" /><path d="M12 6.5V20" /></>,
  other: <><path d="M7 3.5h7l4.5 4.5v12.5H7Z" /><path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h6" /></>,
  pdf: <><path d="M7 3.5h7l4.5 4.5v12.5H7Z" /><path d="M14 3.5V8h4.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  fit: <><path d="M4 12h16M7.5 8.5 4 12l3.5 3.5M16.5 8.5 20 12l-3.5 3.5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5Z" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  star: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6Z" />,
};

export default function Glyph({ name, className = '' }) {
  return (
    <svg className={`glyph ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] || P.other}
    </svg>
  );
}
