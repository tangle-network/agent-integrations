import { declarativeRestConnector } from './declarative-rest.js'

/**
 * CustomGPT (https://app.customgpt.ai) hosts no-code RAG chatbots backed by
 * customer-supplied corpora (sitemaps, file uploads). The public REST surface
 * is rooted at `/api/v1`, authenticated with a workspace API token presented
 * as `Authorization: Bearer <key>` — the same shape the Activepieces
 * piece-customgpt connector uses.
 *
 * Capabilities mirror the upstream actions array verbatim:
 *   - createAgent        → agents.create
 *   - updateAgent        → agents.update
 *   - deleteAgent        → agents.delete
 *   - updateSettings     → agents.updateSettings
 *   - createConversation → conversations.create
 *   - sendMessage        → conversations.sendMessage
 *   - findConversation   → conversations.find
 *   - exportConversation → conversations.export
 *
 * The `newConversation` polling trigger upstream is modelled as the read
 * capability `conversations.list.recent` so the agent can poll on its own
 * cadence without leaving the declarative-REST contract.
 */
export const customgptConnector = declarativeRestConnector({
  kind: 'customgpt',
  displayName: 'CustomGPT',
  description:
    'Create and manage CustomGPT agents (chatbots), drive conversations, and export transcripts.',
  auth: {
    kind: 'api-key',
    hint: 'CustomGPT API token (Profile → API → Create API Key).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.customgpt.ai/api/v1',
  test: { method: 'GET', path: '/projects' },
  capabilities: [
    {
      name: 'agents.create',
      class: 'mutation',
      description:
        'Create a new CustomGPT agent (project) seeded from a sitemap URL or uploaded file.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            type: 'string',
            description: 'Display name for the new agent/project.',
          },
          sitemap_path: {
            type: 'string',
            description:
              'URL to a sitemap to import as agent knowledge. Omit if uploading a file.',
          },
          file: {
            type: 'string',
            description:
              'Base64-encoded file payload (text/audio/video) to seed agent knowledge. Omit if using sitemap.',
          },
          is_shared: {
            type: 'boolean',
            description: 'Whether the agent is public.',
          },
        },
        required: ['project_name'],
      },
      request: {
        method: 'POST',
        path: '/projects',
        body: {
          project_name: '{project_name}',
          sitemap_path: '{sitemap_path}',
          file: '{file}',
          is_shared: '{is_shared}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'agents.update',
      class: 'mutation',
      description: 'Update an existing CustomGPT agent (project) — rename, change sharing, or replace knowledge source.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target project ID.' },
          project_name: { type: 'string', description: 'New display name.' },
          sitemap_path: { type: 'string', description: 'New sitemap URL.' },
          is_shared: { type: 'boolean', description: 'Whether the agent is public.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}',
        body: {
          project_name: '{project_name}',
          sitemap_path: '{sitemap_path}',
          is_shared: '{is_shared}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'agents.delete',
      class: 'mutation',
      description: 'Permanently delete a CustomGPT agent (project) and its associated knowledge.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target project ID.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'DELETE',
        path: '/projects/{projectId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'agents.updateSettings',
      class: 'mutation',
      description:
        'Update chatbot UI/behavior settings for a CustomGPT agent (persona, colors, citations, branding).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target project ID.' },
          custom_persona: { type: 'string', description: 'Custom persona instructions.' },
          chatbot_model: { type: 'string', description: 'Underlying model identifier.' },
          response_source: {
            type: 'string',
            description: 'Source for generating responses (e.g. own_content, default).',
          },
          chatbot_msg_lang: { type: 'string', description: 'Language code for chatbot messages.' },
          chatbot_color: { type: 'string', description: 'Hex color code for chatbot UI.' },
          chatbot_toolbar_color: { type: 'string', description: 'Hex color code for toolbar.' },
          default_prompt: { type: 'string', description: 'Default prompt shown to users.' },
          persona_instructions: { type: 'string', description: 'Chatbot persona instructions.' },
          no_answer_message: { type: 'string', description: 'Message when no answer is found.' },
          ending_message: { type: 'string', description: 'Message shown at end of conversation.' },
          hang_in_there_msg: { type: 'string', description: 'Message for long processing times.' },
          chatbot_siesta_msg: { type: 'string', description: 'Message when chatbot is unavailable.' },
          enable_citations: { type: 'boolean', description: 'Show citations in responses.' },
          enable_feedbacks: { type: 'boolean', description: 'Collect user feedback.' },
          citations_view_type: { type: 'string', description: 'Citation display style.' },
          citations_answer_source_label_msg: {
            type: 'string',
            description: 'Label for the citation answer source.',
          },
          citations_sources_label_msg: {
            type: 'string',
            description: 'Label for the citation sources list.',
          },
          is_loading_indicator_enabled: {
            type: 'boolean',
            description: 'Show loading indicator during responses.',
          },
          remove_branding: { type: 'boolean', description: 'Remove CustomGPT branding.' },
          enable_recaptcha_for_public_chatbots: {
            type: 'boolean',
            description: 'Enable reCAPTCHA on public chatbots.',
          },
          is_selling_enabled: { type: 'boolean', description: 'Enable selling features.' },
          is_ocr_enabled: { type: 'boolean', description: 'Enable OCR for image inputs.' },
          is_anonymized: { type: 'boolean', description: 'Anonymize stored data.' },
          file_data_retension: { type: 'boolean', description: 'Enable file data retention.' },
          are_licenses_allowed: {
            type: 'boolean',
            description: 'Whether project licenses are allowed.',
          },
        },
        required: ['projectId'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/settings',
        body: {
          custom_persona: '{custom_persona}',
          chatbot_model: '{chatbot_model}',
          response_source: '{response_source}',
          chatbot_msg_lang: '{chatbot_msg_lang}',
          chatbot_color: '{chatbot_color}',
          chatbot_toolbar_color: '{chatbot_toolbar_color}',
          default_prompt: '{default_prompt}',
          persona_instructions: '{persona_instructions}',
          no_answer_message: '{no_answer_message}',
          ending_message: '{ending_message}',
          hang_in_there_msg: '{hang_in_there_msg}',
          chatbot_siesta_msg: '{chatbot_siesta_msg}',
          enable_citations: '{enable_citations}',
          enable_feedbacks: '{enable_feedbacks}',
          citations_view_type: '{citations_view_type}',
          citations_answer_source_label_msg: '{citations_answer_source_label_msg}',
          citations_sources_label_msg: '{citations_sources_label_msg}',
          is_loading_indicator_enabled: '{is_loading_indicator_enabled}',
          remove_branding: '{remove_branding}',
          enable_recaptcha_for_public_chatbots: '{enable_recaptcha_for_public_chatbots}',
          is_selling_enabled: '{is_selling_enabled}',
          is_ocr_enabled: '{is_ocr_enabled}',
          is_anonymized: '{is_anonymized}',
          file_data_retension: '{file_data_retension}',
          are_licenses_allowed: '{are_licenses_allowed}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'conversations.create',
      class: 'mutation',
      description:
        'Open a new conversation thread with a CustomGPT agent so subsequent messages share a session.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target agent (project) ID.' },
          name: { type: 'string', description: 'Optional human-readable conversation name.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/conversations',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.sendMessage',
      class: 'mutation',
      description: 'Send a message to a CustomGPT conversation and receive the agent reply.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Owning agent (project) ID.' },
          session_id: { type: 'string', description: 'Conversation session ID.' },
          prompt: { type: 'string', description: 'Message/question to send.' },
          stream: { type: 'boolean', description: 'Stream the response in real time.' },
          custom_persona: {
            type: 'string',
            description: 'Per-message persona override (optional).',
          },
          chatbot_model: { type: 'string', description: 'Override the agent model for this turn.' },
          response_source: {
            type: 'string',
            description: 'Source for generating the response (own_content, default).',
          },
          agent_capability: {
            type: 'string',
            description: 'Capability mode (fastest-responses, premium-responses, etc).',
          },
          lang: { type: 'string', description: 'Language code for the prompt (default en).' },
          custom_context: {
            type: 'string',
            description: 'Extra context appended to the conversation.',
          },
        },
        required: ['projectId', 'session_id', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/conversations/{session_id}/messages',
        body: {
          prompt: '{prompt}',
          stream: '{stream}',
          custom_persona: '{custom_persona}',
          chatbot_model: '{chatbot_model}',
          response_source: '{response_source}',
          agent_capability: '{agent_capability}',
          lang: '{lang}',
          custom_context: '{custom_context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.find',
      class: 'read',
      description:
        'Find conversations for an agent — optionally filtered by user, freshness, or session ID.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Owning agent (project) ID.' },
          session_id: { type: 'string', description: 'Exact conversation session ID.' },
          userFilter: {
            type: 'string',
            description: 'Filter by user who created the conversation.',
          },
          lastUpdatedAfter: {
            type: 'string',
            description: 'ISO-8601 timestamp; return conversations updated after this point.',
          },
          limit: { type: 'integer', description: 'Maximum conversations to return.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/conversations',
        query: {
          session_id: '{session_id}',
          user_filter: '{userFilter}',
          updated_after: '{lastUpdatedAfter}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'conversations.export',
      class: 'mutation',
      description:
        'Export the full message history of a CustomGPT conversation as a downloadable transcript.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Owning agent (project) ID.' },
          session_id: { type: 'string', description: 'Conversation session to export.' },
        },
        required: ['projectId', 'session_id'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/conversations/{session_id}/export',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.list.recent',
      class: 'read',
      description:
        'List recently created conversations for an agent — backs the newConversation polling trigger upstream.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Owning agent (project) ID.' },
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return conversations created after this point.',
          },
          limit: { type: 'integer', description: 'Maximum conversations to return.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/conversations',
        query: {
          created_after: '{since}',
          sort: 'created_at:desc',
          limit: '{limit}',
        },
      },
    },
  ],
})
