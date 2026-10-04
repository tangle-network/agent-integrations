# Pinterest Ads

`pinterestAdsConnector` uses the Pinterest v5 API with `PINTEREST_ADS_CLIENT_ID` and `PINTEREST_ADS_CLIENT_SECRET`, standard authorization-code OAuth, and `ads:read` / `ads:write`. Token exchange authenticates the client with HTTP Basic. An approved Pinterest application and an authorized business ad account are required. Credentials remain in the host's credential store. [Connect an app](https://developers.pinterest.com/docs/getting-started/connect-app/)

`accounts.list` discovers accessible ad accounts and their currency. Account, campaign, ad-group and ad list responses expose the provider bookmark for pagination.

The supported flow is a consideration campaign using **campaign budget optimization and a lifetime spending cap**:

1. `campaigns.createConsideration` creates it paused with a lifetime cap and required Unix start/end timestamps in seconds. Automatic campaigns, Performance+ and flexible daily budgets are disabled.
2. `adGroups.create` creates a paused clickthrough ad group with location codes, optional interests/languages and a maximum CPC bid. Its budget and schedule come from the parent campaign; no independent ad-group daily budget is added. Automatic targeting expansion is disabled.
3. `ads.createFromPin` creates a paused regular image ad from an existing eligible Pin and destination URL. It does not upload media or create an organic Pin.
4. Explicit campaign, ad-group and ad enable/pause actions control serving. Enabling active children can spend immediately and still requires ad review, billing and spend authorization.

The lifetime cap and bid use integer **microcurrency in the ad account currency**: `1000000` equals one currency unit. `reports.account` reads daily spend, paid impressions and clickthroughs for a date range. Pinterest retains the historical report column name `SPEND_IN_MICRO_DOLLAR`; do not treat every account as USD. Attribution and reporting lag remain provider-defined.

Writes use a native top-level array containing one item. Item-level `exceptions` fail the operation even when HTTP status is 200. A single returned item with an entity ID is required; missing or malformed receipts require reconciliation before retry. HTTP 401 signals expired credentials; HTTP 403 preserves an access or approval denial. Writes have no claimed upstream idempotency; inspect account state before retrying an uncertain result.

Current contracts were checked on 2026-10-04 against Pinterest's [official v5.28.0 OpenAPI source](https://github.com/pinterest/api-description/blob/main/v5/openapi.json), including campaign-budget optimization, native targeting fields, reporting and batch errors. Other objectives, video/shopping creatives, audience uploads and organic Pin management are outside this adapter. Mocked contract tests do not prove a live account is approved or an ad has served.
