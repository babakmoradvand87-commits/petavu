# Runbook استقرار خودمیزبان

هدف تولید: PostgreSQL **18.6** (آخرین پایدار در زمان ساخت). موتور تعبیه‌شدهٔ تست PGlite 17.5 است و جایگزین تولید نیست.

## متغیرها

از `.env.example`. در production، `SESSION_SECRET` و `AUTH_PEPPER` حداقل ۳۲ نویسه و `https` روی هر پنج Origin اجباری‌اند.

## ترتیب

1. `docker compose -f deploy/docker-compose.yml up -d db`
2. `DATABASE_URL=... npm run migrate && npm run seed`
3. `npm run start` یا سرویس `app`
4. پنج میزبان مستقل: سایت، panel، adminpanel، shop، adminshop — کوکی host-only، بدون Domain مشترک.
5. `node scripts/backup.mjs` سپس ظرف ۴۸ ساعت `node scripts/restore.mjs`؛ پشتیبان بدون restore-test در `ops.unverified_backups` می‌ماند.

## انتقال

Dump رمزشدهٔ منطقی (`*.pvbak`) را به هاست جدید ببرید، Postgres 18.6 را بالا بیاورید، migrate+seed، سپس restore-test روی محیط `fresh`. DNS پنج میزبان را یکی‌یکی ببرید.

## توقف اضطراری

`SIGTERM` به `scripts/run.mjs` API/Web/Worker را می‌بندد. Worker lease را رها می‌کند.
