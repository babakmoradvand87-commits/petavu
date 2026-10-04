# ADR-0026 — Shop/Adminshop، B2B و موجودی تراکنشی

گام ۳۴؛ §5، §11، §15، §56، §106.

سطوح shop و admin_shop از همان API/identity/membership و Core BFF استفاده می‌کنند، با میزبان/Origin/کوکی host-only مستقل، منوی داده‌ای، دسترسی کسب‌وکار فعال و طراحی scoped جدا. shop کاتالوگ عمومی است؛ `/app` خریدار و adminshop فروشنده private/no-store/noindex اند.

قیمت در minor unit صحیح bigint است؛ ورودی اعشاری یا ارز نامعتبر پذیرفته نمی‌شود. به JS floating-point برای پول اتکا نداریم؛ total در DTO متن است. قیمت ارسال‌شده از مشتری منبع حقیقت نیست. checkout، سبد/محصول‌ها را به ترتیب ثابت قفل می‌کند، موجودی را واقعاً رزرو و ledger را در همان تراکنش می‌نویسد. nonce/idempotency، همان سفارش را برمی‌گرداند. کاهش stock پایین‌تر از reserved، oversell، تغییر خام inventory و replay گذر وضعیت بسته‌اند.

سفارش یک فروشنده/یک ارز است؛ seller تأیید/تحویل می‌دهد و buyer فقط edge مجاز لغو دارد. لغو رزرو را آزاد می‌کند و fulfillment موجودی واقعی را کم می‌کند. audit/outbox از همان هسته است. هیچ payment provider داده نشده: UI/API صریحاً **not_configured، بدون برداشت پول** می‌گویند. ثبت سفارش، دریافت پول نیست.

محصول Draft مخفی است؛ انتشار و موجودی re-auth و version می‌خواهند. public Product JSON-LD فقط SKU/قیمت/availability واقعی را می‌گیرد. کاتالوگ/محصول/robots/sitemap روی میزبان shop، نه fallback صفحهٔ اصلی سایت عمومی است. پنل فروشنده محصول/stock/orders و پنل خریدار cart/orders/account واقعاً به API متصل‌اند.

شواهد: ۱۲ آزمون تازه DB/API/SSR واقعی؛ ۱۸۱ regression سبز، شامل میزبان‌ها/منو، Draft، fresh auth، IDOR، قیمت سرور، idempotency، رزرو/عدم oversell، edge محدود/ledger، ممنوعیت SQL خام stock و عدم افشای سفارش دیگران. Quality مرورگر و concurrent Native PG در گام ۳۵ انجام می‌شود.
