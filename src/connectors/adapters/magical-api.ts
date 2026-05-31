import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Magical API connector.
 *
 * Magical API (magicalapi.com) is an HR/recruiting data API that wraps two
 * concerns into one tenant-scoped key:
 *   1. Resume intelligence — parse a resume PDF/DOC/DOCX into structured
 *      fields, run a qualitative review against a job description, or
 *      compute a numeric fit score.
 *   2. LinkedIn enrichment — fetch profile-by-username and company-by-name
 *      / username / website snapshots.
 *
 * Catalog action surface (Activepieces piece-magical-api 0.1.4):
 *   - review.resume       -> reviewResume     (write/billed call)
 *   - parse.resume        -> parseResume      (write/billed call)
 *   - score.resume        -> scoreResume      (write/billed call)
 *   - get.profile.data    -> getProfileData   (read enrichment lookup)
 *   - get.company.data    -> getCompanyData   (read enrichment lookup)
 * No triggers are declared upstream; this connector exposes the five
 * actions and nothing else.
 *
 * Auth: tenant-issued API key, sent via the `api-key` header on every
 * request. The vendor does not accept Bearer placement.
 *
 * Async / Request-ID pattern: the resume endpoints return a `request_id`
 * when the upstream model is still working; callers re-POST the same
 * endpoint with `{ request_id }` to fetch the completed result. The
 * catalog surfaces `request_id` as a top-level auth-form field for that
 * retry flow, but this adapter models it as a per-call parameter so the
 * runtime can drive both the initial submit and the retry through the
 * same capability without re-binding credentials.
 *
 * Consistency:
 *   - parse/review/score are LLM-backed, non-deterministic, billed on
 *     every accepted submit, and the vendor issues the request_id
 *     server-side. CAS = `none`, externalEffect = true so dry-run policy
 *     treats them as side-effecting.
 *   - profile/company reads are advisory enrichment snapshots — the
 *     underlying LinkedIn data may change between calls.
 */
export const magicalApiConnector = declarativeRestConnector({
  kind: 'magical-api',
  displayName: 'Magical API',
  description:
    'Magical API resume intelligence and LinkedIn enrichment. Parse, review, or score resumes against a job description, and fetch LinkedIn profile or company snapshots by username / website.',
  auth: {
    kind: 'api-key',
    hint: 'Magical API key from the magicalapi.com dashboard. Sent in the api-key header on every request.',
  },
  category: 'crm',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://gw.magicalapi.com',
  credentialPlacement: { kind: 'header', header: 'api-key' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Magical API does not document a free auth-probe endpoint; every
  // documented route is a billed model call, so test is intentionally
  // omitted rather than burning the tenant's quota on a health check.
  capabilities: [
    {
      name: 'resume.parse',
      class: 'mutation',
      description:
        'Submit a resume URL for structured parsing. Returns either the parsed result or a request_id to poll with the same call when the model is still working.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'Direct link to a publicly accessible resume file (PDF, DOC, or DOCX).',
          },
          request_id: {
            type: 'string',
            description:
              'Optional. request_id returned by a prior parse.resume submit; pass it back to fetch the completed result without re-billing the parse.',
          },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/resume-parser',
        body: {
          url: '{url}',
          request_id: '{request_id}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'resume.review',
      class: 'mutation',
      description:
        'Run a qualitative review of a resume against an optional job description. Returns either the review result or a request_id to poll with the same call.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'Direct link to a publicly accessible resume file (PDF, DOC, or DOCX).',
          },
          job_description: {
            type: 'string',
            description:
              'Optional. Job description text the resume should be reviewed against; omit for an unanchored review.',
          },
          request_id: {
            type: 'string',
            description:
              'Optional. request_id returned by a prior resume.review submit; pass it back to fetch the completed result without re-billing the review.',
          },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/resume-review',
        body: {
          url: '{url}',
          job_description: '{job_description}',
          request_id: '{request_id}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'resume.score',
      class: 'mutation',
      description:
        'Compute a numeric fit score for a resume against a job description. Returns either the score or a request_id to poll with the same call.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'Direct link to a publicly accessible resume file (PDF, DOC, or DOCX).',
          },
          job_description: {
            type: 'string',
            description:
              'Job description text the resume should be scored against.',
          },
          request_id: {
            type: 'string',
            description:
              'Optional. request_id returned by a prior resume.score submit; pass it back to fetch the completed result without re-billing the score.',
          },
        },
        required: ['url', 'job_description'],
      },
      request: {
        method: 'POST',
        path: '/resume-score',
        body: {
          url: '{url}',
          job_description: '{job_description}',
          request_id: '{request_id}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'profile.get',
      class: 'read',
      description:
        'Fetch a LinkedIn profile data snapshot by profile username (the slug from the linkedin.com/in/<username> URL).',
      parameters: {
        type: 'object',
        properties: {
          profile_name: {
            type: 'string',
            description:
              'Username slug from the LinkedIn profile URL (e.g. the "drewstone" in linkedin.com/in/drewstone).',
          },
        },
        required: ['profile_name'],
      },
      request: {
        method: 'POST',
        path: '/profile-data',
        body: {
          profile_name: '{profile_name}',
        },
      },
    },
    {
      name: 'company.get',
      class: 'read',
      description:
        'Fetch a LinkedIn company data snapshot. Resolves by company_username (LinkedIn company slug), company_name, or company_website; at least one must be supplied.',
      parameters: {
        type: 'object',
        properties: {
          company_username: {
            type: 'string',
            description:
              'Company slug from the LinkedIn company URL (e.g. the "tangle-network" in linkedin.com/company/tangle-network).',
          },
          company_name: {
            type: 'string',
            description: 'Free-text company name to resolve.',
          },
          company_website: {
            type: 'string',
            description: 'Company website URL to resolve.',
          },
        },
      },
      request: {
        method: 'POST',
        path: '/company-data',
        body: {
          company_username: '{company_username}',
          company_name: '{company_name}',
          company_website: '{company_website}',
        },
      },
    },
  ],
})
