import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Cognism Search API — sales-intelligence reads over Cognism's B2B contact
 * and company database (search, enrich, redeem).
 *
 * Auth is a static, user-generated bearer token (created in app.cognism.com →
 * Profile Settings → API/Tokens, ~6-month TTL) sent as
 * `Authorization: Bearer <token>`. There is no OAuth flow — the operator
 * pastes their token at connect time, so the manifest declares `api-key` auth
 * with bearer placement.
 *
 * MANDATORY TWO-STEP CHAIN. `*.search` and `*.enrich` return only
 * data-PRESENCE flags (hasEmail, hasMobilePhoneNumbers, …) plus a `redeemId`
 * per record — never the actual PII. To get real emails/phones/full profiles
 * the agent must make a second call to the matching `*.redeem` with the
 * redeemId(s). Search and enrich are free; `contact.redeem` CONSUMES 1 credit
 * per contact, so it is modeled as an external-effect mutation (the agent's
 * planner must confirm before spending credits). `account.redeem` is free and
 * is modeled as a read.
 *
 * Every endpoint is POST with a JSON body and returns JSON. The search/enrich
 * filter bodies are passed as a single `filters` / `match` object the agent
 * constructs, rather than per-field placeholders, because the supported filter
 * fields are broad and mostly optional.
 *
 * API access is an enterprise-tier add-on; tokens are issued manually inside
 * Cognism (no self-serve key signup). `account.*` filter field names are
 * medium-confidence — verify against a live token before relying on company
 * filtering.
 */
export const cognismConnector = declarativeRestConnector({
  kind: 'cognism',
  displayName: 'Cognism',
  description:
    'B2B sales intelligence: search and enrich contacts and companies against the Cognism database, then redeem records for full contact data (emails, phones, firmographics).',
  auth: {
    kind: 'api-key',
    hint: 'Cognism API token from Profile Settings → API. Sent as the `Authorization: Bearer <token>` header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.cognism.com/api/search',
  credentialPlacement: { kind: 'bearer' },
  capabilities: [
    {
      name: 'contact.search',
      class: 'read',
      description:
        'Search the Cognism contact database by persona/firmographic filters. Returns a preview list with data-presence flags and a redeemId per record (no PII). Free. Follow with contact.redeem to fetch full data.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            description:
              'Search filter body, e.g. { jobTitles: ["CTO"], excludeJobTitles: ["CEO"], regions: ["EMEA"], countries: ["US"], emailQuality: { highPlus: true }, account: { names: ["Acme"] } }. All fields optional; pass {} to match broadly.',
          },
          lastReturnedKey: { type: 'string', description: 'Pagination cursor from a previous page (linear only).' },
          indexSize: { type: 'integer', description: 'Page size, 20–100 (default 20).' },
        },
        required: ['filters'],
      },
      request: {
        method: 'POST',
        path: '/contact/search',
        query: { lastReturnedKey: '{lastReturnedKey}', indexSize: '{indexSize}' },
        body: '{filters}',
      },
    },
    {
      name: 'contact.enrich',
      class: 'read',
      description:
        'Match a single contact by known identifiers (email, linkedinUrl, domain, name + company). Returns one best-match preview with matchScore, data-presence flags, and a redeemId (no PII). Free. Follow with contact.redeem.',
      parameters: {
        type: 'object',
        properties: {
          match: {
            type: 'object',
            description:
              'Identifier body, e.g. { email: "jane@acme.com", linkedinUrl: "...", domain: "acme.com", minMatchScore: 30, firstName, lastName, jobTitle, companyName }. At least one identifier recommended.',
          },
        },
        required: ['match'],
      },
      request: { method: 'POST', path: '/contact/enrich', body: '{match}' },
    },
    {
      name: 'contact.redeem',
      class: 'mutation',
      description:
        'Fetch full contact profiles (email, mobile, direct dial, LinkedIn, seniority, …) for redeemIds obtained from contact.search/contact.enrich. CONSUMES 1 credit per contact redeemed. 1–20 redeemIds per call.',
      parameters: {
        type: 'object',
        properties: {
          redeemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'redeemId values from contact.search/contact.enrich (1–20).',
          },
        },
        required: ['redeemIds'],
      },
      request: { method: 'POST', path: '/contact/redeem', body: { redeemIds: '{redeemIds}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'account.search',
      class: 'read',
      description:
        'Search the Cognism company/account database by name, industry, location, size, revenue. Returns matching accounts with data-presence flags and redeemIds. Free. Follow with account.redeem.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            description:
              'Account filter body, e.g. { names: ["Acme Corp"], industries: ["SaaS"], countries: ["US"], regions: ["EMEA"], employeeCount: {...}, revenue: {...} }. All fields optional.',
          },
          lastReturnedKey: { type: 'string' },
          indexSize: { type: 'integer', description: 'Page size, 20–100.' },
        },
        required: ['filters'],
      },
      request: {
        method: 'POST',
        path: '/account/search',
        query: { lastReturnedKey: '{lastReturnedKey}', indexSize: '{indexSize}' },
        body: '{filters}',
      },
    },
    {
      name: 'account.enrich',
      class: 'read',
      description:
        'Match a company/account by domain, website, linkedinUrl, or name. Returns one best-match preview with data-presence flags and a redeemId. Free. Follow with account.redeem.',
      parameters: {
        type: 'object',
        properties: {
          match: {
            type: 'object',
            description: 'Identifier body, e.g. { domain: "cognism.com" } or { website, linkedinUrl, name }.',
          },
        },
        required: ['match'],
      },
      request: { method: 'POST', path: '/account/enrich', body: '{match}' },
    },
    {
      name: 'account.redeem',
      class: 'read',
      description:
        'Fetch full company/account profiles (domain, revenue, employeeCount, industry, …) for redeemIds from account.search/account.enrich. Free (account redeem does not consume credits).',
      parameters: {
        type: 'object',
        properties: {
          redeemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'redeemId values from account.search/account.enrich.',
          },
        },
        required: ['redeemIds'],
      },
      request: { method: 'POST', path: '/account/redeem', body: { redeemIds: '{redeemIds}' } },
    },
  ],
})
