# Meta Ads

`meta-ads` is the paid Facebook **and** Instagram connector. Organic Page/Instagram publishing remains separate. Execution uses Graph Marketing API `v25.0` through the maintained REST transport, Hub credential store, mutation policy, approval, idempotency and audit contracts.

Configure `META_ADS_OAUTH_CLIENT_ID` and `META_ADS_OAUTH_CLIENT_SECRET` for a Meta app with Marketing API access. Register the Hub callback and obtain the requested `ads_read`, `ads_management`, `pages_show_list`, and `pages_read_engagement` permissions. App review/business verification and the authorizing user's ad-account/Page tasks still determine access. OAuth login alone does not establish billing or advertising eligibility.

1. `accounts.list`: check account status, currency and timezone; use its numeric `account_id` for action inputs (not prefixed `id`). `pages.list`: discover Page and Instagram identity IDs without returning Page access tokens. Bearer authorization keeps credentials out of request URLs; returned pagination URLs are removed, retaining safe cursors for further reads.
2. `campaigns.createTraffic`: create PAUSED `OUTCOME_TRAFFIC` campaign with a required campaign `spend_cap`.
3. `adSets.createTraffic`: create PAUSED website link-click ad set with explicit countries, lifetime budget and start/end. Include DSA beneficiary/payor where required. Regional or special-category targeting restrictions are enforced by Meta.
4. `creatives.createLink`: create Page-backed link creative with HTTPS image/destination and optional Instagram identity. `ads.create`: attach it as a PAUSED ad.
5. Read native review/effective statuses. With spending authorization, enable the ad and ad set, then campaign. `*.pause` changes status only. `reports.insights` returns spend and attributed actions for an explicit date range.

Caps/budgets use **account currency minor units**, while insight spend uses currency units. Campaign spend cap covers all its ad sets; ad-set lifetime budgets additionally bound each flight. A daily budget is not exposed. Enabling an existing object does not establish its cap or its owner's spending authority: the host must authorize it and inspect existing state first. Billing taxes, other campaigns, provider reporting lag and independent edits are not a global cross-channel spending ledger.

These actions cover traffic/link acquisition, not catalog/app/lead-form campaigns, audience uploads or conversion-event installation. Tests check request encoding, paused creation, budget/status isolation and HTTP failures. They do **not** prove an approved advertiser campaign has served.

References: [Marketing API](https://developers.facebook.com/docs/marketing-api/), [Meta-maintained ad account schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [campaign fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py), [Insights](https://developers.facebook.com/docs/marketing-api/insights/).
