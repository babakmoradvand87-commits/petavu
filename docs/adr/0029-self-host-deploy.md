# ADR-0029 — استقرار خودمیزبان

گام ۳۷؛ §80–۹۲، §183–۱۸۵.

یک Dockerfile Node ۲۲ و Compose با تصویر `postgres:18`. پنج Origin از محیط، نه از هدر Host. انتقال یعنی Postgres ۱۸ + migrate/seed + restore-test، نه ابزار ابری اجباری.
