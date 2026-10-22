# تشغيل المنصة على سيرفر الوزارة

جميع إعدادات الاتصال تُقرأ من ملف `.env` **وقت التشغيل**، ولا توجد أي قيمة مكتوبة داخل الكود.
تعديل `.env` يكفيه إعادة تشغيل الخدمة، دون إعادة بناء الموقع.

## كيف يعمل

```
المتصفح ──HTTPS──> Nginx ──> خادم المنصة (Node، المنفذ 3000) ──> Supabase
                               ├─ /config.js   يُولَّد من .env عند التشغيل
                               ├─ /api/data    بوابة البيانات المحمية
                               └─ /*           ملفات الموقع المبنية (dist)
```

- الواجهة تقرأ عنوان قاعدة البيانات والمفتاح من `/config.js` عند فتح الصفحة.
- الخادم يقرأ `.env` مرة واحدة عند التشغيل.
- لا يُرسَل للمتصفح إلا المفتاح العلني (anon). وإن وُضع مفتاح `service_role` بالخطأ يرفض الخادم التشغيل.

## المتغيرات

| المتغير | الوصف | مطلوب |
|---|---|---|
| `SUPABASE_URL` | عنوان Supabase على السيرفر (Kong / API Gateway) | نعم |
| `SUPABASE_KEY` | المفتاح العلني `ANON_KEY` | نعم |
| `PORT` | منفذ خادم المنصة (الافتراضي 3000) | لا |
| `MEDSP_DATA_DIR` | مجلد البيانات المحمية (الافتراضي `server-data`) | لا |

⚠️ لا يوضع `SERVICE_ROLE_KEY` في هذا الملف أبداً.

## التثبيت أول مرة (Docker)

```bash
git clone <رابط المستودع> medsp && cd medsp
cp .env.example .env
nano .env                     # ضع SUPABASE_URL و SUPABASE_KEY
docker compose up -d --build
curl http://127.0.0.1:3000/healthz   # يجب أن يطبع: ok
```

ثم إعداد Nginx:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/medsp
sudo nano /etc/nginx/sites-available/medsp   # النطاق ومسار شهادة SSL
sudo ln -s /etc/nginx/sites-available/medsp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## العمليات اليومية

| المهمة | الأمر |
|---|---|
| تعديل الإعدادات | عدّل `.env` ثم `docker compose restart medsp` |
| بيانات شهر جديد | ضع ملف Excel في `data/` ثم `docker compose up -d --build` |
| تحديث الكود | `git pull` ثم `docker compose up -d --build` |
| السجلات | `docker compose logs -f medsp` |

## ملاحظات

- **ذاكرة البناء:** تحويل ملفات Excel يحتاج حوالي 4 GB ذاكرة أثناء البناء فقط (مضبوطة في `Dockerfile`). التشغيل نفسه خفيف.
- **البناء والإنترنت:** `npm ci` يحتاج اتصالاً بسجل npm وبـ `cdn.sheetjs.com`. إن كان السيرفر معزولاً: ابنِ الصورة على جهاز متصل ثم انقلها:
  ```bash
  docker save medsp-medsp | gzip > medsp.tar.gz      # على الجهاز المتصل
  docker load < medsp.tar.gz                          # على السيرفر
  ```
- **بدون Docker:** `npm ci && npm run build && npm start` (Node 20 أو أحدث)، ويُفضّل تشغيله كخدمة systemd.
- **التطوير المحلي:** ضع القيم في `.env.local` ثم `npm run dev`.
