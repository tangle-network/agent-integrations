# Snapchat Ads

`snapchat-ads` uses Snap Marketing API `/v1` with the shared Hub connection, OAuth refresh, approval, audit and idempotency machinery. Configure `SNAPCHAT_ADS_OAUTH_CLIENT_ID` and `SNAPCHAT_ADS_OAUTH_CLIENT_SECRET` for an OAuth app created in Snap Business Manager, register the Hub callback, and authorize `snapchat-marketing-api`. An organization, funded ad account, accessible Public Profile and advertising eligibility are separate provider prerequisites.

1. `accounts.list`: discover organizations and their ad accounts. Check account currency/timezone and access.
2. `media.create` then `media.upload`: create an image/video container and upload canonical base64 bytes using multipart. The shared file parser limits this action to 10 MiB. Read `media.list` until READY. Larger assets require Snap's native chunked-upload flow, not this action.
3. `creatives.createWebsite`: attach READY media, Public Profile, headline and HTTPS destination as a `WEB_VIEW` creative. Inspect review status using `creatives.list`.
4. `campaigns.createTraffic`: PAUSED campaign with required `lifetime_spend_cap_micro` and start/end. `adsquads.createTraffic`: PAUSED squad with explicit countries, lifetime budget, flight and maximum bid. `ads.create`: PAUSED `REMOTE_WEBPAGE` ad referencing the website creative.
5. Check review, billing, effective delivery and authorization. Enable the ad and squad, then campaign. `*.pause` uses status-only JSON PATCH; full-object PUT can reset omitted settings and is intentionally avoided.
6. `reports.campaign`: fixed-range spend, impressions, swipes and configured purchase/signup attribution. DAY/HOUR requests must align to provider reporting boundaries.

Budgets and reported spend use **micro-currency**: 1,000,000 = one account currency unit. Campaign lifetime cap covers all squads; the squad lifetime budget further constrains its flight. Existing-object enable actions require host authorization and prior cap inspection. Independent campaigns, external edits, taxes and delayed reporting are not controlled by this adapter's cap.

Successful HTTP status is insufficient: request-level and nested sub-request errors fail, preserving no false committed result. Provider messages are not echoed in native-envelope errors. Throttled writes remain non-commits; automatic retries are not added.

Tests prove wire encoding, multipart bytes, fixed caps/paused creation, PATCH isolation, malformed/native failures and rate limits. No test here proves approved live delivery or sales. This initial workflow covers website traffic; dynamic catalogs, lenses, app installs, audience uploads and conversion ingestion remain separate work.

References: [authentication](https://developers.snap.com/marketing-api/Ads-API/authentication), [official launch walkthrough](https://developers.snap.com/marketing-api/Ads-API/quick-start), [campaign caps](https://developers.snap.com/marketing-api/Ads-API/campaigns), [ad squads](https://developers.snap.com/marketing-api/Ads-API/ad-squads), [creative schema](https://developers.snap.com/marketing-api/Ads-API/creatives), [ad type mapping/PATCH](https://developers.snap.com/marketing-api/Ads-API/ads), [measurement](https://developers.snap.com/marketing-api/Ads-API/measurement).
