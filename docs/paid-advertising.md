# Paid advertising through Hub

Paid-ad connectors are distinct from organic publishing. Meta Ads serves both Facebook and Instagram; they do not need duplicate connectors. Products consume the existing Hub SDK, connections, scoped grants, approval policy, idempotency ledger and audit. Provider code lives here once.

| Connector | Included workflow | Budget used by creation | Connection |
| --- | --- | --- | --- |
| [Google Ads](./google-ads.md) | Search campaign, keywords, responsive ads, targeting, reports | Total budget and fixed flight | Google OAuth |
| [Meta Ads](./meta-ads.md) | Traffic campaign, ad sets, images/link creatives, ads, insights | Campaign spending limit and ad-set lifetime budget | Dedicated Meta Ads OAuth app |
| [X Ads](./x-ads.md) | Campaign, line items, targeting, promoted posts, reports | Campaign and line-item totals; dated line item | Approved Ads app/user OAuth1 credential bundle |
| [TikTok Ads](./tiktok-ads.md) | Traffic campaign, ad groups, uploaded video, ads, reports | Total campaign budget; dated ad group | Business API credential bundle |
| [LinkedIn Ads](./linkedin-ads.md) | Campaign groups, sponsored campaigns, professional targeting, post sponsorship, analytics | Total budgets and fixed flight | LinkedIn OAuth with Ads product access |
| [Microsoft Advertising](./microsoft-ads.md) | Search campaigns, keywords, responsive ads, location criteria, reports | Daily budget; dated ad groups; **no lifetime cap** | Microsoft Ads OAuth and approved developer token |
| [Reddit Ads](./reddit-ads.md) | Traffic campaigns, community targeting, creative jobs, ads, reports | CBO lifetime budget and fixed flight | Reddit Ads OAuth app |
| [Pinterest Ads](./pinterest-ads.md) | Consideration campaigns, ad groups, existing-Pin ads, analytics | Campaign lifetime budget and fixed flight | Pinterest Ads OAuth app |
| [Snapchat Ads](./snapchat-ads.md) | Campaigns, ad squads, media upload, creatives, ads, stats | Campaign lifetime cap and dated ad squads | Snapchat Ads OAuth app |
| [Amazon Ads](./amazon-ads.md) | Sponsored Products, keyword targets, eligible seller/vendor product ads, reports | Average daily budget and end date; **no lifetime cap** | Amazon Ads OAuth and regional marketplace profile |

New campaigns are created paused (LinkedIn campaign groups use draft). Enable and pause are separate, policy-gated writes. Activating a parent or child of an existing campaign may spend immediately. Existing campaigns must be inspected before activation; their historical budgets are not retroactively constrained by the creation tools.

Provider budgets are account-currency amounts with provider-specific units. They are not a shared cross-channel allowance. A user-authorized aggregate cap must account for every campaign and charge; do not launch a daily-budget campaign under a strict total mandate by assuming that a future pause will cap charges. Provider review, delayed reporting, currency conversion and any additional charges remain separate from configured media budgets.

`CONNECTOR_ADAPTER_FACTORIES` owns application environment mappings. Unconfigured OAuth factories remain discoverable for setup and are not executable until required application credentials exist. X and TikTok credentials use Hub's encrypted API-key envelope; never put the bundle in a chat message, action argument or connection metadata. Existing organic tokens and grants do not implicitly authorize paid advertising.

Prepare, inspect, activate, then measure using provider IDs and native readbacks. A successful creation receipt establishes a resource; enable establishes configured status; neither proves review approval, delivery, conversions or sales. Asynchronous creative/report jobs must reach their native terminal success state before consuming their output.

Adapters expose supported campaign types, not every provider advertising product. In particular Amazon Sponsored Products requires eligible Amazon inventory and cannot advertise an arbitrary SaaS landing page. Pinterest sponsorship reuses an existing Pin; LinkedIn sponsorship reuses an existing post and the maintained publishing connector.
