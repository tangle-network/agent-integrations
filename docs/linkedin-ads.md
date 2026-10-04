# LinkedIn Ads

`linkedinAdsConnector` (`linkedin-ads`) executes the versioned Marketing REST API, pinned to `LinkedIn-Version: 202609` with Rest.li 2.0. Organic LinkedIn publishing remains in the existing connector; advertising gets a separate connection and grant.

## Connect

Configure the existing `LINKEDIN_OAUTH_CLIENT_ID` and `LINKEDIN_OAUTH_CLIENT_SECRET` for a Marketing Developer Platform approved application. The advertising connection requests `rw_ads` and `r_ads_reporting`. Sign-in or `w_member_social` grants alone cannot manage advertising. The authenticated member needs a suitable role on the advertiser account. `accounts.list` is the connection probe. Provider 403 approval/role denial is not treated as expired credentials. [Accounts](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts?view=li-lms-2026-09)

## Operate

1. `accounts.list`: inspect account currency, permissions, billing holds and whether it is a test account. Follow native `nextPageToken`.
2. `campaignGroups.create`: create a DRAFT group with total budget and fixed schedule. LinkedIn allows DRAFT or ACTIVE at creation, not PAUSED.
3. `targeting.search` and `targeting.listFacet`: discover current geography and professional-audience URNs. Include a location facet. Geography uses current Bing geo, not retired legacy IDs.
4. `campaigns.createSponsored`: create a PAUSED website-visit sponsored-content campaign with lifetime pacing, total budget, fixed schedule and maximum CPC. Currency amounts are decimal strings, not micros. Automatic audience expansion and offsite delivery are disabled.
5. Author an approved company post using the existing LinkedIn publishing connection. `creatives.createFromPost` creates a PAUSED ad referencing its share/UGC URN; it does not repost or invent sponsorship rights. Inspect review/holds through `creatives.get`. Creation IDs returned only in `x-restli-id` are retained in results.
6. Check both group and campaign ceilings, funding, schedule, audience, creative review and authorization. Activate prepared creatives/campaigns, then the group. Existing parent resources must be checked before activation. Pause the group/campaign if a creative under review cannot be paused.
7. `reports.analytics` returns daily campaign spend in account currency, clicks and configured website conversions. Native attribution is not confirmed revenue. [Groups](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaign-groups?view=li-lms-2026-09), [Campaigns and lifetime pacing](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09), [Creatives](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-creatives?view=li-lms-2026-09), [Targeting](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/ads-targeting?view=li-lms-2026-09), [Reporting](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting?view=li-lms-2026-09)

The consuming product must present LinkedIn's targeting discrimination notice and obtain the required advertiser political-ad declaration for EU targeting. `politicalIntent` is an explicit required input; the connector does not infer the advertiser's declaration. The linked campaign documentation owns the required notice wording. Hub retains approvals, aggregate spending authority and idempotency. Adapter writes declare `cas: 'none'`; uncertain write outcomes require reconciliation before retry.

## Evidence and limits

`tests/linkedin-ads.test.ts` verifies Marketing version/auth, pagination, native header-only IDs, fixed lifetime budgets, paused campaign/creative creation, DRAFT groups, invalid budgets/schedules, status partial updates, targeting/reporting and redacted provider failures. Tests do not prove app approval, advertiser role, live creative review, impressions, conversions or billing. Deployment qualification must capture those provider receipts separately.
