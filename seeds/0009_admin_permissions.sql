-- خواندن/نوشتن نگهداشت با مجوز بکاپ است؛ منو و RLS نباید متفاوت باشند.
update ops.menu_item set platform_permission_key='platform.backup.manage' where surface='admin' and key='retention';
