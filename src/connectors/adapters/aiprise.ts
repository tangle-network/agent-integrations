import { declarativeRestConnector } from './declarative-rest.js'

/**
 * AiPrise KYC / KYB / fraud-prevention connector.
 *
 * Authentication: workspace API key delivered in the `X-API-Key` header.
 * AiPrise also runs a two-environment split (sandbox + live) gated by a
 * separate key; environment selection is the caller's concern — the same
 * declarative manifest works against either host because the spec only fixes
 * the production hostname. Sandbox callers can override `baseUrl` at the
 * source-metadata level once that surface is wired through.
 *
 * Capability surface mirrors the activepieces actions list one-for-one so the
 * catalog → adapter mapping is verifiable:
 *   - identity verifications (start, get URL, get result, get user input)
 *   - business verifications (start, get result, get input)
 *   - document checks
 *   - profile CRUD (create / read business + user profiles, list business docs)
 *   - decision override (update verification result)
 *   - business directory search
 */

export const aipriseConnector = declarativeRestConnector({
  kind: 'aiprise',
  displayName: 'AiPrise',
  description:
    'KYC, KYB, and fraud-prevention platform — start identity and business verifications, retrieve results, manage user and business profiles, and override decisions.',
  auth: {
    kind: 'api-key',
    hint: 'AiPrise workspace API key. Generate one from the AiPrise dashboard → Settings → API Keys.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.aiprise.com',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  // GET /v1/templates is a low-cost authenticated probe — every AiPrise
  // workspace has at least one verification template wired up before any
  // verification can run, so an empty 200 still proves credential validity.
  test: { method: 'GET', path: '/v1/templates' },
  capabilities: [
    {
      name: 'identity.verification.start',
      class: 'mutation',
      description:
        'Run a user verification profile — kicks off an identity verification session against the named template. Returns a session_id the caller polls or webhooks against.',
      parameters: {
        type: 'object',
        properties: {
          template_id: { type: 'string', description: 'Verification template id from the AiPrise dashboard.' },
          first_name: { type: 'string' },
          middle_name: { type: 'string' },
          last_name: { type: 'string' },
          second_last_name: { type: 'string' },
          full_name: { type: 'string' },
          date_of_birth: { type: 'string', description: 'YYYY-MM-DD.' },
          email_address: { type: 'string' },
          phone_number: { type: 'string' },
          client_reference_id: { type: 'string' },
          client_reference_data: { type: 'object' },
          callback_url: { type: 'string' },
          events_callback_url: { type: 'string' },
        },
        required: ['template_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/verifications',
        body: 'args',
      },
      // AiPrise does not honour a client-supplied idempotency key on
      // verification creation; replay produces a new session. Caller-owned
      // dedupe only via client_reference_id.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'identity.verification.url',
      class: 'read',
      description:
        'Generate a hosted verification URL for a previously-created session. The end user is redirected here to complete the flow.',
      parameters: {
        type: 'object',
        properties: {
          template_id: { type: 'string' },
          redirect_uri: { type: 'string', description: 'Where the user is sent after finishing the hosted flow.' },
          client_reference_id: { type: 'string' },
          client_reference_data: { type: 'object' },
        },
        required: ['template_id', 'redirect_uri'],
      },
      request: {
        method: 'POST',
        path: '/v1/verifications/url',
        body: 'args',
      },
    },
    {
      name: 'identity.verification.result',
      class: 'read',
      description: 'Fetch the latest decision and check breakdown for a verification session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'AiPrise verification session id.' },
        },
        required: ['session_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/verifications/{session_id}/result',
      },
    },
    {
      name: 'identity.verification.input',
      class: 'read',
      description:
        'Fetch the structured user-supplied input that was captured during a verification session (names, DOB, document fields).',
      parameters: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/verifications/{session_id}/input',
      },
    },
    {
      name: 'identity.verification.update_result',
      class: 'mutation',
      description:
        'Override the AiPrise decision on a verification session. Use to approve, decline, or push back to manual review after analyst review.',
      parameters: {
        type: 'object',
        properties: {
          verification_session_id: { type: 'string' },
          result: {
            type: 'string',
            enum: ['Approved', 'Declined', 'Pending'],
            description: 'New decision. Approved passes the subject, Declined rejects, Pending returns to manual review.',
          },
        },
        required: ['verification_session_id', 'result'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/verifications/{verification_session_id}/result',
        body: { result: '{result}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'identity.user_info.get',
      class: 'read',
      description:
        'Fetch additional analyst-only signals AiPrise gathered about the subject (device, IP, behavioural) for a verification session.',
      parameters: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/verifications/{session_id}/user-info',
      },
    },
    {
      name: 'business.verification.start',
      class: 'mutation',
      description:
        'Start a business verification (KYB) against an existing business profile. Returns a session_id used to fetch results.',
      parameters: {
        type: 'object',
        properties: {
          template_id: { type: 'string' },
          business_profile_id: { type: 'string' },
          client_reference_id: { type: 'string' },
          client_reference_data: { type: 'object' },
          callback_url: { type: 'string' },
          events_callback_url: { type: 'string' },
        },
        required: ['template_id', 'business_profile_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/business-verifications',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'business.verification.result',
      class: 'read',
      description: 'Fetch the AML / sanctions / corporate-registry result for a business verification session.',
      parameters: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/business-verifications/{session_id}/result',
      },
    },
    {
      name: 'business.verification.input',
      class: 'read',
      description: 'Fetch the structured business-profile inputs captured for a business verification session.',
      parameters: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/business-verifications/{session_id}/input',
      },
    },
    {
      name: 'document.check.run',
      class: 'mutation',
      description:
        'Run a standalone document check against a previously-uploaded file. Returns the extracted fields and a pass / fail verdict.',
      parameters: {
        type: 'object',
        properties: {
          file_uuid: { type: 'string', description: 'UUID returned from the AiPrise file upload endpoint.' },
          document_input_title: { type: 'string' },
          client_reference_id: { type: 'string' },
          client_reference_data: { type: 'object' },
        },
        required: ['file_uuid'],
      },
      request: {
        method: 'POST',
        path: '/v1/document-checks',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'business.profile.create',
      class: 'mutation',
      description: 'Create a business profile that subsequent KYB verifications and searches can reference.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Legal business name (preferred) or trade name.' },
          alternate_name: { type: 'string' },
          tax_identification_number: { type: 'string' },
          website: { type: 'string' },
          formation_date: { type: 'string', description: 'YYYY-MM-DD.' },
          country_code: { type: 'string', description: 'ISO 3166-1 alpha-2.' },
          state_code: { type: 'string' },
          business_entity_id: { type: 'string' },
          addresses: {
            type: 'array',
            description: 'Structured address objects (preferred over flat street/city fields when both are available).',
            items: { type: 'object' },
          },
          address_street_1: { type: 'string' },
          address_street_2: { type: 'string' },
          address_city: { type: 'string' },
          address_state: { type: 'string' },
          address_zip_code: { type: 'string' },
          address_country: { type: 'string' },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          email_addresses: { type: 'array', items: { type: 'object' } },
          additional_information: { type: 'array', items: { type: 'object' } },
          client_reference_id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v1/business-profiles',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'business.profile.get',
      class: 'read',
      description: 'Fetch a business profile by id.',
      parameters: {
        type: 'object',
        properties: { business_profile_id: { type: 'string' } },
        required: ['business_profile_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/business-profiles/{business_profile_id}',
      },
    },
    {
      name: 'business.profile.documents',
      class: 'read',
      description: 'List documents (incorporation, ownership, financials) attached to a business profile.',
      parameters: {
        type: 'object',
        properties: { business_profile_id: { type: 'string' } },
        required: ['business_profile_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/business-profiles/{business_profile_id}/documents',
      },
    },
    {
      name: 'business.search',
      class: 'read',
      description: 'Search the AiPrise corporate-registry index for businesses by name, country, or tax id.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          country_code: { type: 'string' },
          tax_identification_number: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/business-profiles/search',
        query: {
          name: '{name}',
          country_code: '{country_code}',
          tax_identification_number: '{tax_identification_number}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'user.profile.create',
      class: 'mutation',
      description: 'Create a reusable user profile that subsequent KYC verifications can reference.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          middle_name: { type: 'string' },
          last_name: { type: 'string' },
          second_last_name: { type: 'string' },
          full_name: { type: 'string' },
          date_of_birth: { type: 'string', description: 'YYYY-MM-DD.' },
          email_address: { type: 'string' },
          phone_number: { type: 'string' },
          address_street_1: { type: 'string' },
          address_street_2: { type: 'string' },
          address_city: { type: 'string' },
          address_state: { type: 'string' },
          address_zip_code: { type: 'string' },
          address_country: { type: 'string' },
          client_reference_id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      request: {
        method: 'POST',
        path: '/v1/user-profiles',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'user.profile.get',
      class: 'read',
      description: 'Fetch a user profile by id.',
      parameters: {
        type: 'object',
        properties: { user_profile_id: { type: 'string' } },
        required: ['user_profile_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/user-profiles/{user_profile_id}',
      },
    },
  ],
})
