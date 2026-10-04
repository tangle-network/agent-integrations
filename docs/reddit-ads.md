# Reddit Ads

`redditAdsConnector` (`reddit-ads`) implements Reddit Ads API v3 at `https://ads-api.reddit.com/api/v3`. It is separate from the organic Reddit connector.

## Connect

Create an Ads developer application and configure `REDDIT_ADS_OAUTH_CLIENT_ID` and `REDDIT_ADS_OAUTH_CLIENT_SECRET`. The existing OAuth broker exchanges authorization codes using HTTP Basic client authentication, requests `duration=permanent`, and stores refresh tokens in the protected credential envelope. Ads scopes are `adsread` and `adsedit`; ordinary Reddit `read`/`submit` grants do not suffice. PKCE is explicitly unsupported by this flow. [Authentication](https://ads-api.reddit.com/docs/v3/guides/quick-start/authenticate), [Official OpenAPI](https://ads-api.reddit.com/api/v3/openapi.json)

## Operate

1. `businesses.list`, `accounts.list`, `accounts.get`: select a permitted advertiser account and inspect currency/funding. Follow `page.token` pagination. `profiles.list` identifies the advertiser profile used to author creative; `pixels.list` discovers its conversion pixel.
2. `campaigns.createTraffic`: create a PAUSED Standard traffic campaign with campaign budget optimization, `LIFETIME_SPEND`, positive integer microcurrency budget and fixed start/end. The legacy `CLICKS` objective remains supported in the September 2026 migration. Pixel ID is required even for traffic CBO campaigns.
3. `targeting.communities` and `targeting.geolocations`: discover valid audience values. `adGroups.createTraffic` requires explicit geography, matches the parent pixel and schedule, inherits its budget/bid through native null values, and disables audience expansion.
4. `posts.createImage` or `posts.createText`: submit a structured creative job for the selected profile. Image assets must be provider-fetchable HTTPS URLs. Poll `posts.getJob`; a committed submission is not completed media processing. Only SUCCESS supplies a usable post; CLIENT_ERROR/SERVER_ERROR remain failed jobs.
5. `ads.create`: attach the resulting legacy `t3_…` post to a PAUSED ad group; match its landing/click URL. Inspect native entities and effective status with the list/get actions.
6. After checking lifetime budget, schedule, targeting, review, billing and user authority, enable ads and groups while the campaign is paused, then enable the campaign. `campaigns.pause`, `adGroups.pause` and `ads.pause` preserve existing budget/history.
7. `reports.get`: request UTC hour-aligned timestamps and selected metrics. Reports group by campaign/day. SPEND/CPC are microcurrency; conversion total values are cents. Metrics can take six hours to stabilize. [Campaign setup](https://ads-api.reddit.com/docs/v3/guides/programs/campaign/campaign-setup), [Budget rules](https://ads-api.reddit.com/docs/v3/guides/programs/campaign/campaign-objective-matrix), [Reports](https://ads-api.reddit.com/docs/v3/api/get-a-report)

This first supported creation path is Standard traffic CBO, not every Reddit campaign objective or Max automation. The provider requires pixels for campaigns/ad groups since July 2026. Other existing entities can be inspected or paused; activation does not add a budget to an unbounded pre-existing resource. Hub policy owns aggregate spend authority, action grants, approvals and deduplication. Mutations use `cas: 'none'` and do not auto-retry uncertain writes. Account access errors, OAuth expiry and throttling remain failures.

## Evidence and limits

`tests/reddit-ads.test.ts` checks v3 account discovery, separate Ads OAuth, pagination, paused lifetime-budget campaign creation, null bid inheritance, geography, pixel/schedule guards, creative-job/readback semantics, paused ad creation, native launch/pause, reporting and redacted failures. These transport tests do not prove an actual funded account, provider review, live delivery or conversion tracking. Production qualification must retain the corresponding provider receipts; tests spend no money.

Mutation success requires a native entity-ID receipt; missing receipts and native error envelopes fail and require reconciliation before retry. A creative job receipt in QUEUED or PROCESSING acknowledges job submission only: `posts.getJob` must reach SUCCESS before its post is usable. Immediate failed or unknown job statuses are rejected.
