# TikTok Ads

`tiktok-ads` executes API for Business `open_api/v1.3`. This is separate from TikTok creator OAuth/publishing. The provider requires an approved Business API app, authorized advertiser and eligible funded Ads Manager account.

Connect using the existing encrypted API-key field containing a JSON bundle:

```json
{"accessToken":"<Business API access token>","appId":"<app id>","appSecret":"<app secret>"}
```

Never put these values into agent arguments or public connection metadata. Obtain the access token using the Business API authorization flow and its JSON `app_id`, `secret`, `auth_code` exchange. This adapter does not advertise a hosted OAuth/automatic refresh flow; replace a revoked/expired bundle through the connection owner. Discovery sends app ID/secret only to TikTok's fixed `/oauth2/advertiser/get/` endpoint and disables redirects. Ordinary calls use `Access-Token`.

1. `advertisers.list`, `advertisers.get`: discover authorized accounts and check currency/timezone. `targeting.locations` and `identities.list`: obtain location and advertising identity IDs.
2. `videos.uploadFromUrl`: import public HTTPS media using TikTok's multipart URL-upload protocol. `videos.list`: confirm the asset is usable.
3. `campaigns.createTraffic`: DISABLED traffic campaign with `BUDGET_MODE_TOTAL`. `adgroups.createTraffic`: DISABLED TikTok website-traffic group, total budget, start/end, locations and CPC bid.
4. `ads.createVideo`: DISABLED video ad from the asset/identity and tracked landing URL. Inspect native review/status. Enable ad/group then campaign only under spending authority. `*.pause` disables delivery without changing budgets.
5. `reports.integrated`: paginated BASIC spend/click/conversion reports at campaign, group or ad level.

Amounts are **advertiser currency units**, not cents or micros. TikTok enforces its campaign/ad-group minimums; lifetime minimums depend on flight duration. No unlimited budget or automatic budget increase is exposed. The user/host must allocate its cross-channel total before enabling, including existing objects. These APIs do not create a global spending ledger or prove attributed conversions are sales.

HTTP 200 with nonzero `code`, missing numeric code or missing `data` fails. Errors report numeric codes without potentially secret-bearing provider messages. Transport throttling remains a non-commit. Hub retains approval/idempotency/audit ownership; no local retry loop or mutation replay store is introduced.

Tests cover provider wire formats and failures, not an advertiser's approved live delivery. Smart+, catalog/shop, pixel installation, custom audiences and app promotion are outside this traffic workflow.

References: [official authentication SDK contract](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AuthenticationApi.md), [campaign](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CampaignCreateBody.md), [ad group](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdgroupCreateBody.md), [creative](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdcreateCreatives.md), [media](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/FileApi.md), [reporting](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/ReportingApi.md), [lifetime budget rules](https://ads.tiktok.com/resources/help/article/about-lifetime-budgets?lang=en-GB).
