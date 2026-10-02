# ماتریس مجوز و اسکیمای امنیت

این پرونده **تولیدشده** است (`npm run audit:security`). منبع حقیقت، پایگاه‌داده است؛
ویرایش دستی این پرونده بی‌اثر است و در اجرای بعدی بازنویسی می‌شود (§103).

- زمان تولید (UTC): 2026-10-02 12:23
- جدول‌های دامنه: 79 — همه با RLS فعال: بله
- سیاست‌ها: 239
- مجوزها: 60 — دامنه‌ای: 40، پلتفرمی: 20

## نقش‌های کسب‌وکار

| نقش | نام | رتبه | شمار مجوز |
| --- | --- | --- | --- |
| `owner` | مالک | 10 | 40 |
| `admin` | مدیر | 20 | 32 |
| `editor` | ویرایشگر محتوا | 40 | 9 |
| `marketer` | بازاریاب | 45 | 13 |
| `member` | عضو | 60 | 6 |
| `viewer` | ناظر | 80 | 2 |

## نقش‌های پلتفرم

| نقش | نام | رتبه | شمار مجوز |
| --- | --- | --- | --- |
| `superadmin` | مدیر ارشد پلتفرم | 10 | 60 |
| `admin` | مدیر پلتفرم | 20 | 11 |
| `moderator` | ناظر محتوا | 40 | 4 |
| `support` | پشتیبانی | 60 | 2 |
| `analyst` | تحلیل‌گر | 70 | 4 |

## ماتریس مجوز × نقش

`●` = دارد، `—` = ندارد. ستون «حساس» یعنی مجوز نیازمند احراز مجدد/تأیید صریح است.

| مجوز | دسته | حساس | owner | admin | editor | marketer | member | viewer | superadmin | admin | moderator | support | analyst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `business.billing.manage` | billing | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `business.analytics.view` | business | — | ● | ● | ● | ● | ● | ● | ● | — | — | — | — |
| `business.archive` | business | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.contact.manage` | business | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.create` | business | — | ● | — | — | — | — | — | ● | — | — | — | — |
| `business.delete` | business | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `business.integration.manage` | business | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.location.manage` | business | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.publish` | business | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.relationship.manage` | business | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.role.manage` | business | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.transfer.accept` | business | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `business.transfer.initiate` | business | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `business.update` | business | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.verification.submit` | business | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `content.category.manage` | content | — | ● | ● | ● | — | — | — | ● | — | — | — | — |
| `content.create` | content | — | ● | ● | ● | ● | ● | — | ● | — | — | — | — |
| `content.delete` | content | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `content.publish` | content | بله | ● | ● | — | ● | — | — | ● | — | — | — | — |
| `content.review` | content | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `content.update` | content | — | ● | ● | ● | ● | ● | — | ● | — | — | — | — |
| `design.manage` | design | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `design.publish` | design | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `design.rollback` | design | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `design.view` | design | — | ● | ● | ● | ● | — | — | ● | — | — | — | — |
| `media.manage` | media | — | ● | ● | ● | ● | — | — | ● | — | — | — | — |
| `media.upload` | media | — | ● | ● | ● | ● | ● | — | ● | — | — | — | — |
| `business.member.invite` | member | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.member.manage` | member | بله | ● | ● | — | — | — | — | ● | — | — | — | — |
| `business.member.remove` | member | بله | ● | — | — | — | — | — | ● | — | — | — | — |
| `platform.api_key.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.audit.view` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | ● |
| `platform.automation.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.backup.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.business.moderate` | platform | بله | — | — | — | — | — | — | ● | ● | ● | — | — |
| `platform.business.review` | platform | بله | — | — | — | — | — | — | ● | ● | ● | ● | — |
| `platform.content.moderate` | platform | بله | — | — | — | — | — | — | ● | ● | ● | — | — |
| `platform.design.manage` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | — |
| `platform.export` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | ● |
| `platform.feature.manage` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | — |
| `platform.impersonate` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.job.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.job.observe` | platform | — | — | — | — | — | — | — | ● | ● | — | — | ● |
| `platform.role.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.security.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.seo.manage` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | — |
| `platform.settings.manage` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.taxonomy.manage` | platform | بله | — | — | — | — | — | — | ● | ● | — | — | — |
| `platform.user.suspend` | platform | بله | — | — | — | — | — | — | ● | — | — | — | — |
| `platform.user.view` | platform | بله | — | — | — | — | — | — | ● | ● | ● | ● | ● |
| `profile.edit` | profile | — | ● | ● | ● | ● | ● | — | ● | — | — | — | — |
| `profile.view` | profile | — | ● | ● | ● | ● | ● | ● | ● | — | — | — | — |
| `seo.audit.run` | seo | — | ● | ● | — | ● | — | — | ● | — | — | — | — |
| `seo.keyword.manage` | seo | — | ● | ● | — | ● | — | — | ● | — | — | — | — |
| `seo.manage` | seo | — | ● | ● | — | ● | — | — | ● | — | — | — | — |
| `seo.redirect.manage` | seo | — | ● | ● | — | ● | — | — | ● | — | — | — | — |
| `shop.discount.manage` | shop | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `shop.order.manage` | shop | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `shop.order.view` | shop | — | ● | ● | — | — | — | — | ● | — | — | — | — |
| `shop.product.manage` | shop | — | ● | ● | — | — | — | — | ● | — | — | — | — |

## جدول‌ها، RLS و سیاست‌ها

| جدول | RLS | شمار سیاست |
| --- | --- | --- |
| `app.business` | روشن | 8 |
| `app.business_contact` | روشن | 3 |
| `app.business_location` | روشن | 3 |
| `app.business_profile` | روشن | 3 |
| `app.business_relationship` | روشن | 4 |
| `app.business_verification` | روشن | 4 |
| `app.content` | روشن | 8 |
| `app.content_block` | روشن | 6 |
| `app.content_category` | روشن | 4 |
| `app.content_review` | روشن | 3 |
| `app.invitation` | روشن | 2 |
| `app.membership` | روشن | 5 |
| `app.ownership_transfer` | روشن | 3 |
| `app.role` | روشن | 3 |
| `app.role_permission` | روشن | 2 |
| `auth.app_user` | روشن | 4 |
| `auth.credential` | روشن | 1 |
| `auth.device` | روشن | 4 |
| `auth.identity` | روشن | 3 |
| `auth.login_attempt` | روشن | 3 |
| `auth.one_time_token` | روشن | 3 |
| `auth.permission` | روشن | 2 |
| `auth.platform_role` | روشن | 2 |
| `auth.platform_role_permission` | روشن | 2 |
| `auth.recovery_code` | روشن | 0 |
| `auth.session` | روشن | 4 |
| `auth.user_platform_role` | روشن | 2 |
| `design.audit` | روشن | 3 |
| `design.component` | روشن | 2 |
| `design.page` | روشن | 5 |
| `design.page_revision` | روشن | 3 |
| `design.page_template` | روشن | 2 |
| `design.preview_link` | روشن | 2 |
| `design.release` | روشن | 4 |
| `design.theme` | روشن | 4 |
| `design.theme_token` | روشن | 2 |
| `design.token` | روشن | 4 |
| `media.album` | روشن | 3 |
| `media.album_item` | روشن | 3 |
| `media.asset` | روشن | 5 |
| `media.derivative` | روشن | 4 |
| `ops.audit_log` | روشن | 2 |
| `ops.backup` | روشن | 3 |
| `ops.event` | روشن | 3 |
| `ops.feature` | روشن | 2 |
| `ops.idempotency_key` | روشن | 2 |
| `ops.job` | روشن | 2 |
| `ops.job_attempt` | روشن | 3 |
| `ops.migration` | روشن | 0 |
| `ops.rate_limit_counter` | روشن | 3 |
| `ops.restore_test` | روشن | 3 |
| `ops.retention_policy` | روشن | 3 |
| `ops.retention_run` | روشن | 3 |
| `ops.security_event` | روشن | 2 |
| `ops.setting` | روشن | 3 |
| `ops.webhook_delivery` | روشن | 4 |
| `ops.webhook_endpoint` | روشن | 3 |
| `ref.business_type` | روشن | 2 |
| `ref.category` | روشن | 6 |
| `ref.industry` | روشن | 2 |
| `ref.location` | روشن | 2 |
| `seo.audit` | روشن | 2 |
| `seo.audit_finding` | روشن | 2 |
| `seo.canonical` | روشن | 4 |
| `seo.content_opportunity` | روشن | 2 |
| `seo.entity` | روشن | 2 |
| `seo.entity_link` | روشن | 2 |
| `seo.entity_mention` | روشن | 2 |
| `seo.indexing_event` | روشن | 3 |
| `seo.internal_link` | روشن | 4 |
| `seo.keyword` | روشن | 2 |
| `seo.keyword_link` | روشن | 2 |
| `seo.metadata` | روشن | 3 |
| `seo.redirect` | روشن | 3 |
| `seo.settings` | روشن | 4 |
| `seo.sitemap` | روشن | 4 |
| `seo.structured_data` | روشن | 2 |
| `seo.template` | روشن | 4 |
| `seo.topic` | روشن | 2 |

## سیاست‌ها به تفکیک جدول

| جدول | سیاست | دستور | نقش‌ها |
| --- | --- | --- | --- |
| `app.business` | `business_insert_self` | INSERT | pv_app |
| `app.business` | `business_member_select` | SELECT | pv_app |
| `app.business` | `business_owner_select` | SELECT | pv_app |
| `app.business` | `business_public_select` | SELECT | pv_public |
| `app.business` | `business_reader` | SELECT | pv_reader |
| `app.business` | `business_update_member` | UPDATE | pv_app |
| `app.business` | `business_worker_select` | SELECT | pv_worker |
| `app.business` | `business_worker_update` | UPDATE | pv_worker |
| `app.business_contact` | `business_contact_member` | ALL | pv_app |
| `app.business_contact` | `business_contact_public` | SELECT | pv_public |
| `app.business_contact` | `business_contact_reader` | SELECT | pv_reader |
| `app.business_location` | `business_location_member` | ALL | pv_app |
| `app.business_location` | `business_location_public` | SELECT | pv_public |
| `app.business_location` | `business_location_reader` | SELECT | pv_reader |
| `app.business_profile` | `business_profile_member` | ALL | pv_app |
| `app.business_profile` | `business_profile_public` | SELECT | pv_public |
| `app.business_profile` | `business_profile_reader` | SELECT | pv_reader |
| `app.business_relationship` | `relationship_manage` | ALL | pv_app |
| `app.business_relationship` | `relationship_party_select` | SELECT | pv_app |
| `app.business_relationship` | `relationship_public_select` | SELECT | pv_public |
| `app.business_relationship` | `relationship_reader` | SELECT | pv_reader |
| `app.business_verification` | `business_verification_member` | SELECT | pv_app |
| `app.business_verification` | `business_verification_reader` | SELECT | pv_reader |
| `app.business_verification` | `business_verification_review` | UPDATE | pv_app, pv_worker |
| `app.business_verification` | `business_verification_submit` | INSERT | pv_app |
| `app.content` | `content_member_insert` | INSERT | pv_app |
| `app.content` | `content_member_select` | SELECT | pv_app |
| `app.content` | `content_member_update` | UPDATE | pv_app |
| `app.content` | `content_platform_write` | ALL | pv_app |
| `app.content` | `content_public_select` | SELECT | pv_public |
| `app.content` | `content_reader` | SELECT | pv_reader |
| `app.content` | `content_worker_select` | SELECT | pv_worker |
| `app.content` | `content_worker_update` | UPDATE | pv_worker |
| `app.content_block` | `content_block_member_delete` | DELETE | pv_app |
| `app.content_block` | `content_block_member_insert` | INSERT | pv_app |
| `app.content_block` | `content_block_member_select` | SELECT | pv_app |
| `app.content_block` | `content_block_member_update` | UPDATE | pv_app |
| `app.content_block` | `content_block_public_select` | SELECT | pv_public |
| `app.content_block` | `content_block_reader` | SELECT | pv_reader |
| `app.content_category` | `content_category_member_select` | SELECT | pv_app |
| `app.content_category` | `content_category_member_write` | ALL | pv_app |
| `app.content_category` | `content_category_public` | SELECT | pv_public |
| `app.content_category` | `content_category_reader` | SELECT | pv_reader |
| `app.content_review` | `content_review_insert` | INSERT | pv_app |
| `app.content_review` | `content_review_member_select` | SELECT | pv_app |
| `app.content_review` | `content_review_reader` | SELECT | pv_reader |
| `app.invitation` | `invitation_member` | ALL | pv_app |
| `app.invitation` | `invitation_reader` | SELECT | pv_reader |
| `app.membership` | `membership_bootstrap_owner` | INSERT | pv_app |
| `app.membership` | `membership_manager_all` | ALL | pv_app |
| `app.membership` | `membership_reader` | SELECT | pv_reader |
| `app.membership` | `membership_self_leave` | UPDATE | pv_app |
| `app.membership` | `membership_self_select` | SELECT | pv_app |
| `app.ownership_transfer` | `ownership_transfer_manage` | ALL | pv_app |
| `app.ownership_transfer` | `ownership_transfer_reader` | SELECT | pv_reader |
| `app.ownership_transfer` | `ownership_transfer_select` | SELECT | pv_app |
| `app.role` | `role_read` | SELECT | pv_app, pv_public, pv_reader |
| `app.role` | `role_staff_write` | ALL | pv_app, pv_worker |
| `app.role` | `role_write_member` | ALL | pv_app |
| `app.role_permission` | `role_permission_member` | ALL | pv_app |
| `app.role_permission` | `role_permission_read` | SELECT | pv_app, pv_reader |
| `auth.app_user` | `app_user_reader` | SELECT | pv_reader |
| `auth.app_user` | `app_user_self_select` | SELECT | pv_app |
| `auth.app_user` | `app_user_self_update` | UPDATE | pv_app |
| `auth.app_user` | `app_user_signup_insert` | INSERT | pv_app, pv_public |
| `auth.credential` | `credential_staff_select` | SELECT | pv_app, pv_worker |
| `auth.device` | `device_insert_login` | INSERT | pv_app, pv_public |
| `auth.device` | `device_reader` | SELECT | pv_reader |
| `auth.device` | `device_self` | ALL | pv_app |
| `auth.device` | `device_staff_select` | SELECT | pv_app, pv_reader |
| `auth.identity` | `identity_reader` | SELECT | pv_reader |
| `auth.identity` | `identity_self` | ALL | pv_app |
| `auth.identity` | `identity_signup_insert` | INSERT | pv_app, pv_public |
| `auth.login_attempt` | `login_attempt_insert` | INSERT | pv_app, pv_public |
| `auth.login_attempt` | `login_attempt_reader` | SELECT | pv_reader |
| `auth.login_attempt` | `login_attempt_staff_select` | SELECT | pv_app, pv_worker |
| `auth.one_time_token` | `one_time_token_insert` | INSERT | pv_app, pv_public |
| `auth.one_time_token` | `one_time_token_reader` | SELECT | pv_reader |
| `auth.one_time_token` | `one_time_token_staff_select` | SELECT | pv_app, pv_worker |
| `auth.permission` | `permission_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `auth.permission` | `platform_catalog_write` | ALL | pv_app, pv_worker |
| `auth.platform_role` | `platform_role_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `auth.platform_role` | `platform_role_write` | ALL | pv_app, pv_worker |
| `auth.platform_role_permission` | `platform_role_permission_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `auth.platform_role_permission` | `platform_role_permission_write` | ALL | pv_app, pv_worker |
| `auth.session` | `session_insert_impersonation` | INSERT | pv_app, pv_public |
| `auth.session` | `session_reader` | SELECT | pv_reader |
| `auth.session` | `session_self` | ALL | pv_app |
| `auth.session` | `session_staff_select` | SELECT | pv_app, pv_reader |
| `auth.user_platform_role` | `user_platform_role_self` | SELECT | pv_app |
| `auth.user_platform_role` | `user_platform_role_staff` | ALL | pv_app, pv_worker |
| `design.audit` | `design_audit_insert` | INSERT | pv_app, pv_worker |
| `design.audit` | `design_audit_member` | SELECT | pv_app |
| `design.audit` | `design_audit_reader` | SELECT | pv_reader |
| `design.component` | `component_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `design.component` | `component_write` | ALL | pv_app, pv_worker |
| `design.page` | `page_public_select` | SELECT | pv_public |
| `design.page` | `page_read_member` | SELECT | pv_app |
| `design.page` | `page_reader` | SELECT | pv_reader |
| `design.page` | `page_worker` | SELECT | pv_worker |
| `design.page` | `page_write` | ALL | pv_app |
| `design.page_revision` | `page_revision_insert` | INSERT | pv_app |
| `design.page_revision` | `page_revision_member` | SELECT | pv_app |
| `design.page_revision` | `page_revision_reader` | SELECT | pv_reader |
| `design.page_template` | `page_template_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `design.page_template` | `page_template_write` | ALL | pv_app, pv_worker |
| `design.preview_link` | `preview_link_member` | ALL | pv_app |
| `design.preview_link` | `preview_link_reader` | SELECT | pv_reader |
| `design.release` | `release_insert` | INSERT | pv_app, pv_worker |
| `design.release` | `release_member` | SELECT | pv_app |
| `design.release` | `release_reader` | SELECT | pv_reader |
| `design.release` | `release_update` | UPDATE | pv_app, pv_worker |
| `design.theme` | `theme_read_app` | SELECT | pv_app, pv_worker |
| `design.theme` | `theme_read_public` | SELECT | pv_public |
| `design.theme` | `theme_read_reader` | SELECT | pv_reader |
| `design.theme` | `theme_write` | ALL | pv_app, pv_worker |
| `design.theme_token` | `theme_token_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `design.theme_token` | `theme_token_write` | ALL | pv_app, pv_worker |
| `design.token` | `token_read_app` | SELECT | pv_app, pv_worker |
| `design.token` | `token_read_public` | SELECT | pv_public |
| `design.token` | `token_read_reader` | SELECT | pv_reader |
| `design.token` | `token_write` | ALL | pv_app, pv_worker |
| `media.album` | `album_member_all` | ALL | pv_app |
| `media.album` | `album_public_select` | SELECT | pv_public |
| `media.album` | `album_reader` | SELECT | pv_reader |
| `media.album_item` | `album_item_member_all` | ALL | pv_app |
| `media.album_item` | `album_item_public_select` | SELECT | pv_public |
| `media.album_item` | `album_item_reader` | SELECT | pv_reader |
| `media.asset` | `asset_member_all` | ALL | pv_app |
| `media.asset` | `asset_public_select` | SELECT | pv_public |
| `media.asset` | `asset_reader` | SELECT | pv_reader |
| `media.asset` | `asset_worker_select` | SELECT | pv_worker |
| `media.asset` | `asset_worker_update` | UPDATE | pv_worker |
| `media.derivative` | `derivative_member` | ALL | pv_app |
| `media.derivative` | `derivative_public_select` | SELECT | pv_public |
| `media.derivative` | `derivative_reader` | SELECT | pv_reader |
| `media.derivative` | `derivative_worker` | ALL | pv_worker |
| `ops.audit_log` | `audit_log_insert` | INSERT | pv_app, pv_public, pv_worker |
| `ops.audit_log` | `audit_log_select_staff` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `ops.backup` | `backup_reader` | SELECT | pv_reader |
| `ops.backup` | `backup_staff_all` | ALL | pv_app |
| `ops.backup` | `backup_worker_all` | ALL | pv_worker |
| `ops.event` | `event_insert` | INSERT | pv_app, pv_worker |
| `ops.event` | `event_select_staff` | SELECT | pv_app, pv_reader |
| `ops.event` | `event_select_worker` | SELECT | pv_worker |
| `ops.feature` | `feature_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `ops.feature` | `feature_write_staff` | ALL | pv_app, pv_worker |
| `ops.idempotency_key` | `idempotency_app_all` | ALL | pv_app |
| `ops.idempotency_key` | `idempotency_staff_select` | SELECT | pv_reader, pv_worker |
| `ops.job` | `job_staff_select` | SELECT | pv_app, pv_reader |
| `ops.job` | `job_worker_all` | ALL | pv_worker |
| `ops.job_attempt` | `job_attempt_reader` | SELECT | pv_reader |
| `ops.job_attempt` | `job_attempt_staff_select` | SELECT | pv_app |
| `ops.job_attempt` | `job_attempt_worker_all` | ALL | pv_worker |
| `ops.rate_limit_counter` | `rate_limit_counter_reader` | SELECT | pv_reader |
| `ops.rate_limit_counter` | `rate_limit_counter_staff_select` | SELECT | pv_app |
| `ops.rate_limit_counter` | `rate_limit_counter_worker_all` | ALL | pv_worker |
| `ops.restore_test` | `restore_test_reader` | SELECT | pv_reader |
| `ops.restore_test` | `restore_test_staff_all` | ALL | pv_app |
| `ops.restore_test` | `restore_test_worker_all` | ALL | pv_worker |
| `ops.retention_policy` | `retention_policy_reader` | SELECT | pv_reader |
| `ops.retention_policy` | `retention_policy_staff_all` | ALL | pv_app |
| `ops.retention_policy` | `retention_policy_worker_all` | ALL | pv_worker |
| `ops.retention_run` | `retention_run_reader` | SELECT | pv_reader |
| `ops.retention_run` | `retention_run_staff_select` | SELECT | pv_app |
| `ops.retention_run` | `retention_run_worker_all` | ALL | pv_worker |
| `ops.security_event` | `security_event_insert` | INSERT | pv_app, pv_public, pv_worker |
| `ops.security_event` | `security_event_staff_all` | ALL | pv_app, pv_worker |
| `ops.setting` | `setting_business_all` | ALL | pv_app |
| `ops.setting` | `setting_global_read` | SELECT | pv_app, pv_public |
| `ops.setting` | `setting_staff_all` | ALL | pv_app, pv_worker |
| `ops.webhook_delivery` | `webhook_delivery_member_select` | SELECT | pv_app |
| `ops.webhook_delivery` | `webhook_delivery_reader` | SELECT | pv_reader |
| `ops.webhook_delivery` | `webhook_delivery_staff_select` | SELECT | pv_app |
| `ops.webhook_delivery` | `webhook_delivery_worker_all` | ALL | pv_worker |
| `ops.webhook_endpoint` | `webhook_endpoint_member_all` | ALL | pv_app |
| `ops.webhook_endpoint` | `webhook_endpoint_staff_all` | ALL | pv_app, pv_worker |
| `ops.webhook_endpoint` | `webhook_endpoint_worker_all` | ALL | pv_worker |
| `ref.business_type` | `business_type_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `ref.business_type` | `business_type_write` | ALL | pv_app, pv_worker |
| `ref.category` | `category_read_app` | SELECT | pv_app, pv_worker |
| `ref.category` | `category_read_public` | SELECT | pv_public |
| `ref.category` | `category_read_reader` | SELECT | pv_reader |
| `ref.category` | `category_select_business` | SELECT | pv_app |
| `ref.category` | `category_write` | ALL | pv_app, pv_worker |
| `ref.category` | `category_write_business` | ALL | pv_app |
| `ref.industry` | `industry_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `ref.industry` | `industry_write` | ALL | pv_app, pv_worker |
| `ref.location` | `location_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `ref.location` | `location_write` | ALL | pv_app, pv_worker |
| `seo.audit` | `seo_audit_read` | SELECT | pv_app, pv_reader, pv_worker |
| `seo.audit` | `seo_audit_write` | ALL | pv_app, pv_worker |
| `seo.audit_finding` | `seo_audit_finding_read` | SELECT | pv_app, pv_reader, pv_worker |
| `seo.audit_finding` | `seo_audit_finding_write` | ALL | pv_app, pv_worker |
| `seo.canonical` | `canonical_read_app` | SELECT | pv_app, pv_worker |
| `seo.canonical` | `canonical_read_public` | SELECT | pv_public |
| `seo.canonical` | `canonical_read_reader` | SELECT | pv_reader |
| `seo.canonical` | `canonical_write` | ALL | pv_app, pv_worker |
| `seo.content_opportunity` | `opportunity_read` | SELECT | pv_app, pv_reader, pv_worker |
| `seo.content_opportunity` | `opportunity_write` | ALL | pv_app, pv_worker |
| `seo.entity` | `entity_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `seo.entity` | `entity_write` | ALL | pv_app, pv_worker |
| `seo.entity_link` | `entity_link_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `seo.entity_link` | `entity_link_write` | ALL | pv_app, pv_worker |
| `seo.entity_mention` | `entity_mention_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `seo.entity_mention` | `entity_mention_write` | ALL | pv_app, pv_worker |
| `seo.indexing_event` | `indexing_event_insert` | INSERT | pv_app, pv_worker |
| `seo.indexing_event` | `indexing_event_read_app` | SELECT | pv_app, pv_worker |
| `seo.indexing_event` | `indexing_event_read_reader` | SELECT | pv_reader |
| `seo.internal_link` | `internal_link_read_app` | SELECT | pv_app, pv_worker |
| `seo.internal_link` | `internal_link_read_public` | SELECT | pv_public |
| `seo.internal_link` | `internal_link_read_reader` | SELECT | pv_reader |
| `seo.internal_link` | `internal_link_write` | ALL | pv_app, pv_worker |
| `seo.keyword` | `keyword_read` | SELECT | pv_app, pv_reader |
| `seo.keyword` | `keyword_write` | ALL | pv_app |
| `seo.keyword_link` | `keyword_link_read` | SELECT | pv_app, pv_reader |
| `seo.keyword_link` | `keyword_link_write` | ALL | pv_app |
| `seo.metadata` | `seo_metadata_read_app` | SELECT | pv_app, pv_worker |
| `seo.metadata` | `seo_metadata_read_reader` | SELECT | pv_reader |
| `seo.metadata` | `seo_metadata_write` | ALL | pv_app, pv_worker |
| `seo.redirect` | `redirect_read_public` | SELECT | pv_app, pv_public, pv_worker |
| `seo.redirect` | `redirect_read_reader` | SELECT | pv_reader |
| `seo.redirect` | `redirect_write` | ALL | pv_app, pv_worker |
| `seo.settings` | `seo_settings_read_app` | SELECT | pv_app, pv_worker |
| `seo.settings` | `seo_settings_read_public` | SELECT | pv_public |
| `seo.settings` | `seo_settings_read_reader` | SELECT | pv_reader |
| `seo.settings` | `seo_settings_write` | ALL | pv_app, pv_worker |
| `seo.sitemap` | `sitemap_read_app` | SELECT | pv_app, pv_worker |
| `seo.sitemap` | `sitemap_read_public` | SELECT | pv_public |
| `seo.sitemap` | `sitemap_read_reader` | SELECT | pv_reader |
| `seo.sitemap` | `sitemap_write` | ALL | pv_app, pv_worker |
| `seo.structured_data` | `structured_data_read` | SELECT | pv_app, pv_public, pv_reader, pv_worker |
| `seo.structured_data` | `structured_data_write` | ALL | pv_app, pv_worker |
| `seo.template` | `seo_template_read_app` | SELECT | pv_app, pv_worker |
| `seo.template` | `seo_template_read_public` | SELECT | pv_public |
| `seo.template` | `seo_template_read_reader` | SELECT | pv_reader |
| `seo.template` | `seo_template_write` | ALL | pv_app, pv_worker |
| `seo.topic` | `topic_read` | SELECT | pv_app, pv_reader |
| `seo.topic` | `topic_write` | ALL | pv_app |
