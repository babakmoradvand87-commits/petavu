# نمودار منطقی پایگاه‌داده

```mermaid
flowchart TB
  auth[auth: user identity session credential MFA]
  app[app: business membership content shop]
  design[design: token theme page release]
  seo[seo: metadata sitemap audit]
  ops[ops: audit job backup restore_test migration]
  auth --> app
  app --> design
  app --> seo
  ops --> auth
  ops --> app
```

منبع حقیقت: مهاجرت‌های `migrations/0001` تا آخرین فایل نسخه‌دار. ماتریس مجوز: `docs/security/permission-matrix.md`.
