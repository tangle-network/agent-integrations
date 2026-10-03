# Google Ads through Hub

The `google-ads` connector uses the existing Google OAuth application and Hub connection, approval, and execution stores.
It supports Search campaigns with a fixed total budget and end time.
It does not create advertiser accounts or configure payment methods.

## Connect

Enable Google Ads API access for the Cloud project owning `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
Obtain production access for that project before using real advertiser accounts.
Connect Google Ads through the normal Hub OAuth flow with `https://www.googleapis.com/auth/adwords`.
A Gmail or Analytics connection does not establish the Ads grant.

Google sunset developer tokens on September 9, 2026.
API v25 uses the OAuth Cloud project's access level; it ignores developer-token headers.
A `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` error needs project approval, not repeated OAuth refresh.

## Run a bounded campaign

1. Call `customers.listAccessible`; query `customer_client` for advertiser accounts below a manager.
2. Read `customer.currency_code`, `customer.time_zone`, `customer.status`, and billing readiness through `reports.search`.
3. Call `campaigns.createSearch` with `totalAmountMicros`, `startDateTime`, and `endDateTime` in the account timezone.
4. Add locations, languages, ad groups, keywords, and responsive Search ads.
5. Read campaign settings and ad policy status; enable with `campaigns.enable` only under the caller's authorization.
6. Report spend, impressions, clicks, and configured conversions; pause through `campaigns.pause` when intervention is needed.

Creation atomically creates a non-shared `CUSTOM_PERIOD` budget and a paused Search campaign.
The adapter does not expose daily-budget creation or arbitrary mutate operations.
Google enforces the total budget for that campaign, in the customer's currency.
Create replacement creatives in the same campaign, then use `ads.pause` to retire weaker ads.
Use `ads.enable` to resume a reviewed creative without changing the campaign budget.
The caller must account for its authorization across multiple campaigns and applicable taxes.
A Hub credential expiry does not pause a campaign already running at Google.

Mutations accept `validateOnly: true` for native provider validation without resource changes.
They do not claim native idempotency: use the Hub execution ledger and a stable idempotency key.
After an ambiguous transport failure, read Google state before requesting another creation.
The adapter does not retry mutations automatically.

## Reports

`reports.search` accepts Google Ads Query Language and returns Google's rows and `nextPageToken` unchanged.
For example:

```sql
SELECT campaign.id, campaign.name, campaign.status,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
```

Read the campaign budget, scheduled end, and ad review status separately before launch.
Conversion metrics require existing tracking; zero conversions do not establish that tracking works.
The connector does not install website tags or claim sales attribution without configured conversion actions.

## Provider contracts

- [Campaign total budgets](https://developers.google.com/google-ads/api/docs/campaigns/budgets/create-budgets)
- [Developer-token sunset and Cloud-project approval](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [OAuth account access](https://developers.google.com/google-ads/api/docs/oauth/access-model)
- [Responsive Search ad requirements](https://developers.google.com/google-ads/api/docs/responsive-search-ads/create-responsive-search-ads)

These capabilities need a connected account and a provider execution receipt before claiming a live campaign.
