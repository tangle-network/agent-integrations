# X Ads

`xAdsConnector` (`x-ads`) executes X Ads API v12. It is separate from the existing Twitter/X organic-publishing connector and its grants.

## Connect

X requires an Ads API approved developer application, an advertiser account with usable funding, and OAuth 1.0a user access. Store this JSON bundle in the existing encrypted API-key connection field:

```json
{"consumerKey":"…","consumerSecret":"…","accessToken":"…","accessTokenSecret":"…"}
```

Trusted direct consumers may supply the same fields in `credentials: {kind: 'custom', values: …}`. Credentials never belong in capability arguments or public connection metadata. The shared transport signs the final URL and form body with HMAC-SHA1. This connector does not implement an OAuth 1.0a browser authorization handshake. The existing Twitter OAuth2 connection cannot substitute for this bundle. [Authentication](https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests)

## Operate

1. `accounts.list`, then `fundingInstruments.list`: verify approval, timezone, currency and usable funding. Read pagination cursors.
2. `campaigns.create`: supply funding instrument, positive total and daily microcurrency budgets. The campaign is always PAUSED; daily cannot exceed total.
3. `lineItems.createTraffic`: create a PAUSED website-click campaign line item with its own total budget, maximum bid, start and end. The parent budget also applies.
4. `targeting.locations`, `targeting.add`: select native geography and keyword/language/follower criteria. These are explicit additions, not an audience inference from the campaign name.
5. `posts.createPromotedOnly` and `ads.promotePost`: select the advertiser ID from `accounts.promotableUsers`, check `accounts.authenticatedUserAccess`, then create text or attach existing card/media keys and promote one post. Upload media through existing X media tooling; this connector does not duplicate upload transport. Keep parents paused while assembling.
6. Inspect campaign, line items, promoted posts and funding. Enable prepared line items, then `campaigns.enable` with the authorized total and daily budgets. Enable can spend immediately. `campaigns.pause` or `lineItems.pause` stops serving.
7. `reports.stats`: request a range no longer than seven days and at most twenty entity IDs. Read billing microcurrency, engagement and web conversions. Billing can be revised for three days; conversion reporting depends on tracking setup. [Campaign reference](https://docs.x.com/x-ads-api/campaign-management/reference), [Creatives](https://docs.x.com/x-ads-api/creatives/reference), [Analytics](https://docs.x.com/x-ads-api/analytics)

A budget is per campaign, not a cross-provider spending ledger. Hub policy must retain the user's aggregate authority, serialize writes and deduplicate logical requests. Launching an existing line item does not create or validate its parent budget; inspect pre-existing resources before granting launch. Creation and status mutations have `cas: 'none'`, not a fabricated provider idempotency guarantee. A successful HTTP status without a native entity-ID receipt, or with an error envelope, fails qualification and requires state readback before retry. HTTP denial, expiration, conflicts and throttling remain failures; there are no automatic mutation retries.

## Evidence and limits

`tests/x-ads.test.ts` checks native request construction, independent OAuth signature verification, paused creation, budget/schedule guards, launch/pause, reporting, credential redaction and failure outcomes. These are transport contract tests, not a funded-account delivery receipt. Live account discovery, real write/readback, ad review, delivery and billing remain provider-account checks for the deployment owner. No ad spend is incurred by these tests.
