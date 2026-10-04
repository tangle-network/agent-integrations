# Amazon Ads

`createAmazonAdsConnector({ clientId })` manages **Sponsored Products for eligible Amazon sellers and vendors**. It does not make an arbitrary SaaS or GTM service eligible for Amazon product advertising. Account access, eligible products, stock/offer requirements and Amazon review remain provider prerequisites. [Sponsored Products](https://advertising.amazon.com/solutions/products/sponsored-products)

Configure an approved Login with Amazon application with `AMAZON_ADS_CLIENT_ID` and `AMAZON_ADS_CLIENT_SECRET`. The factory receives the same application client ID as trusted runtime configuration for `Amazon-Advertising-API-ClientId`. OAuth uses `advertising::campaign_management`; the maintained host handles refresh. Access tokens and application configuration are not accepted as tool arguments or connection metadata.

Connection metadata may contain `apiBaseUrl`, restricted to:

| Region | Endpoint |
| --- | --- |
| North America (default) | `https://advertising-api.amazon.com` |
| Europe | `https://advertising-api-eu.amazon.com` |
| Far East | `https://advertising-api-fe.amazon.com` |

`profiles.list` discovers authorized marketplace profiles on that endpoint, including currency, timezone and account type. Every entity/report operation requires a `profileId`, sent in `Amazon-Advertising-API-Scope`. The regional endpoint must match that profile. [API overview](https://advertising.amazon.com/API/docs/en-us/reference/api-overview)

`campaigns.createSponsoredProducts` creates a paused manual-targeting campaign with a **daily budget in profile currency**, required start/end dates and down-only dynamic bidding. This daily budget is an average, **not a hard daily or lifetime cap**. `adGroups.create` and `keywords.create` also start paused. `productAds.createSellerProduct` takes a seller SKU; `productAds.createVendorProduct` takes a vendor ASIN. Both create paused product ads. Separate enable/pause actions exist for campaigns, ad groups, keywords and product ads. Enabling can spend immediately when all parents and required targets are enabled.

List operations preserve `nextToken`. `reports.requestCampaigns` requests a daily Sponsored Products report with currency cost, impressions and clicks; `reports.get` returns status and the expiring GZIP_JSON download URL. The adapter does not fetch arbitrary download URLs or forward advertising credentials to a download host. Reporting and attribution can lag.

All entity writes use a single-item v3 request with the native versioned media type. HTTP 207 bodies with nonempty resource `error` arrays fail, rather than claiming a committed write. HTTP 401 signals expired credentials; HTTP 403 preserves account/eligibility denial. No upstream idempotency is claimed; inspect state before retrying an ambiguous network result.

Contracts checked on 2026-10-04 against the official [Sponsored Products v3 API](https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod) and its [published OpenAPI artifact](https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json), plus [Reporting v3](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/get-started). Sponsored Brands, Display, DSP, catalog management and product-targeting expressions are outside this adapter. Tests mock official wire contracts; they do not prove live account eligibility or ad delivery.
