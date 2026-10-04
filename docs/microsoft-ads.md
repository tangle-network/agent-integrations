# Microsoft Advertising

`createMicrosoftAdsConnector({ developerToken })` uses Microsoft's REST v13 JSON API, including its separate Customer Management and Reporting hosts. It requires an approved developer token and an OAuth application configured with `MICROSOFT_ADS_CLIENT_ID` and `MICROSOFT_ADS_CLIENT_SECRET`. The runtime factory reads `MICROSOFT_ADS_DEVELOPER_TOKEN`; the token is trusted configuration, never a tool argument or connection metadata. OAuth requests `https://ads.microsoft.com/msads.manage` and `offline_access` so the maintained host flow can refresh access tokens. [Authentication](https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth?view=bingads-13)

Start with `users.getCurrent`, then `accounts.list` using its user ID and a zero-based page index. The account response identifies its currency, timezone and parent customer. Subsequent operations require both `accountId` and `customerId`.

The supported launch flow is:

1. `campaigns.createSearch` creates a paused Search campaign with a daily budget and MaxClicks bidding with a maximum CPC.
2. `adGroups.create` creates a paused ad group with required start/end dates and Microsoft owned-and-operated network distribution.
3. `keywords.create` adds a keyword; `campaigns.addLocation` adds a Microsoft location criterion. Check location intent settings in the account before launch.
4. `ads.createResponsiveSearch` creates a paused ad from 3–15 headlines, 2–4 descriptions and final URLs.
5. Explicitly enable the campaign, ad group and ad after authorization and editorial review. Each also has a pause action.

Budgets and bids are decimal **account-currency amounts**, not micros. A daily budget is **not a lifetime cap**. The date range is on each ad group because campaign dates are currently honored only for Audience campaigns. New or pre-existing groups can have different schedules; read the account before authorizing spend. Search MaxClicks is an automated bidding strategy, and provider review, billing and account eligibility remain prerequisites. Political campaigns are not supported by Microsoft. [Campaign semantics](https://learn.microsoft.com/en-us/advertising/campaign-management-service/campaign?view=bingads-13), [MaxClicks](https://learn.microsoft.com/en-us/advertising/campaign-management-service/maxclicksbiddingscheme?view=bingads-13)

`reports.requestCampaigns` submits a daily CSV report for a closed date range; `reports.get` returns status and an expiring download URL. Download without forwarding API credentials. Spend and conversions retain provider semantics; conversion tracking must be configured, and reporting can lag. No automatic report-download fetch or polling loop is installed.

Writes send one item and reject nonempty `PartialErrors` even on HTTP 200. HTTP 401 requests reconnection; HTTP 403 retains the provider access failure. No provider idempotency is claimed. Inspect provider state before retrying an uncertain network failure.

Wire contracts checked against official documentation on 2026-10-04: [AddCampaigns REST endpoint](https://learn.microsoft.com/en-us/advertising/campaign-management-service/addcampaigns?view=bingads-13), [responsive Search ads](https://learn.microsoft.com/en-us/advertising/campaign-management-service/responsivesearchad?view=bingads-13), [report submission](https://learn.microsoft.com/en-us/advertising/reporting-service/submitgeneratereport?view=bingads-13). Mocked wire tests do not establish live account approval or campaign delivery.
