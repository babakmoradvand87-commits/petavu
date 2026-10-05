# ADR-0028 — پشتیبان رمزشده و آزمون بازیابی اجباری

گام ۳۶؛ §86–۸۹، §132، §191.

پشتیبان AES-256-GCM است، SHA-256 روی ciphertext، کلید از محیط (`BACKUP_KEY`). رازهای `ops.setting` در dump نیستند. ردیف `ops.backup` بدون `ops.restore_test` موفق، پس از مهلت، در `ops.unverified_backups` دیده می‌شود. بازیابی روی موتور تازه (`environment=fresh`) فهرست مهاجرت و تنظیمات غیرمحرمانه را می‌سنجد.
