import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Luxury Presence connector.
 *
 * Luxury Presence is a CRM + website + marketing platform for real-estate
 * agents and brokerages. The integration surface that LP exposes to outside
 * automation tools is its Lead Connect REST API: an api-key-authenticated
 * endpoint family that lets a third-party system push prospective buyer /
 * seller leads into the agent's LP CRM and read back the resulting lead
 * records for state reconciliation.
 *
 * The upstream activepieces catalog entry for luxury-presence documents
 * only a webhook trigger (`new.lead`) and no actions, because that piece
 * is webhook-receiver-only. We model the side of the integration that the
 * orchestrator needs in order to actually do CRM work: write a lead into
 * LP and read leads back out.
 *
 * Auth is a per-tenant API key issued in the LP admin console and sent in
 * the `X-API-Key` header (LP rejects Bearer placement for this surface).
 */
export const luxuryPresenceConnector = declarativeRestConnector({
  kind: 'luxury-presence',
  displayName: 'Luxury Presence',
  description:
    'Push real-estate buyer/seller leads into Luxury Presence and read leads back out of the agent CRM.',
  auth: {
    kind: 'api-key',
    hint: 'Luxury Presence API key issued in the admin console (Settings → Integrations → API). Sent on every request as the X-API-Key header.',
  },
  category: 'crm',
  // Lead records in LP are the system of record for the agent's pipeline.
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.luxurypresence.com/v1',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  test: { method: 'GET', path: '/leads', query: { limit: 1 } },
  capabilities: [
    {
      name: 'leads.create',
      class: 'mutation',
      description:
        'Create a new lead in the agent`s Luxury Presence CRM. Mirrors the inbound shape consumed by the LP `new.lead` webhook.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'Lead first name.' },
          lastName: { type: 'string', description: 'Lead last name.' },
          email: {
            type: 'string',
            format: 'email',
            description: 'Lead email address. At least one of email/phone is required by LP.',
          },
          phone: {
            type: 'string',
            description: 'Lead phone number in E.164 form. At least one of email/phone is required by LP.',
          },
          message: {
            type: 'string',
            description: 'Free-form inquiry text from the lead (the body of their first contact).',
          },
          source: {
            type: 'string',
            description:
              'Origin tag recorded against the lead (e.g. "facebook-ad", "open-house"). Surfaces as `source` in the LP admin.',
          },
          tags: {
            type: 'array',
            description: 'Optional list of LP lead-tag strings to apply at creation time.',
            items: { type: 'string' },
          },
          propertyInterest: {
            type: 'object',
            description: 'Optional structured interest hint for the agent.',
            properties: {
              address: { type: 'string' },
              listingId: { type: 'string' },
              priceMin: { type: 'integer' },
              priceMax: { type: 'integer' },
              bedrooms: { type: 'integer' },
              bathrooms: { type: 'number' },
            },
          },
        },
      },
      request: {
        method: 'POST',
        path: '/leads',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          email: '{email}',
          phone: '{phone}',
          message: '{message}',
          source: '{source}',
          tags: '{tags}',
          propertyInterest: '{propertyInterest}',
        },
      },
      // LP issues a fresh leadId per POST; duplicate posts create duplicate
      // leads unless the caller supplies their own dedupe upstream.
      cas: 'native-idempotency',
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description:
        'Patch an existing LP lead by id (status change, agent reassignment, tag edits).',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'LP-assigned lead identifier.' },
          status: {
            type: 'string',
            description: 'Pipeline status string recognised by the tenant`s LP workflow.',
          },
          assignedAgentId: {
            type: 'string',
            description: 'LP user-id of the agent that should own this lead.',
          },
          tags: {
            type: 'array',
            description: 'Replacement set of tag strings for this lead.',
            items: { type: 'string' },
          },
          notes: {
            type: 'string',
            description: 'Free-form private note appended to the lead by this update.',
          },
        },
        required: ['leadId'],
      },
      request: {
        method: 'PATCH',
        path: '/leads/{leadId}',
        body: {
          status: '{status}',
          assignedAgentId: '{assignedAgentId}',
          tags: '{tags}',
          notes: '{notes}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'leads.list',
      class: 'read',
      description: 'List leads in the LP CRM, optionally filtered by status, source, or assigned agent.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by pipeline status.' },
          source: { type: 'string', description: 'Filter by origin tag.' },
          assignedAgentId: {
            type: 'string',
            description: 'Filter to leads owned by a specific LP agent.',
          },
          updatedSince: {
            type: 'string',
            format: 'date-time',
            description: 'ISO-8601 lower bound on `updatedAt` for incremental sync.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: {
            type: 'string',
            description: 'Opaque pagination cursor returned by a prior leads.list response.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          status: '{status}',
          source: '{source}',
          assignedAgentId: '{assignedAgentId}',
          updatedSince: '{updatedSince}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Fetch a single lead by LP-assigned id.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' } },
        required: ['leadId'],
      },
      request: { method: 'GET', path: '/leads/{leadId}' },
    },
  ],
})
