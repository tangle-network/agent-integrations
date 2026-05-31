import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Chat Data connector.
 *
 * Chat Data is a chatbot-as-a-service platform: create AI chatbots backed by
 * model providers + custom training material (scraped URLs, free-form text,
 * uploaded files, Q&A pairs, product catalogs) and drive conversations with
 * them through a REST API. Optional integrations cover live-chat escalation
 * and custom backend dispatch.
 *
 * The public REST API is bearer-authenticated against
 * `https://api.chat-data.com/api/v2` with a workspace API key minted from the
 * Chat Data dashboard. All six declared capabilities map 1:1 to the
 * activepieces `actions` array for the `chat-data` piece — there are no
 * read-class endpoints in the activepieces surface (every action is risk
 * `write` or `destructive`).
 *
 * The `chat` category in the activepieces catalog has no analogue in our
 * `Manifest.category` enum, so we map to `comms` — the closest matching
 * concept (conversation-oriented messaging surface).
 */
export const chatDataConnector = declarativeRestConnector({
  kind: 'chat-data',
  displayName: 'Chat Data',
  description:
    'Build and operate AI chatbots: create chatbots with custom training data, send messages, update prompts, retrain, and upload knowledge files.',
  auth: {
    kind: 'api-key',
    hint: 'Chat Data workspace API key. Generate one from the Chat Data dashboard → Settings → API.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chat-data.com/api/v2',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
  },
  capabilities: [
    {
      name: 'chatbot.create',
      class: 'mutation',
      description:
        'Create a new chatbot. `model` selects the underlying base model; for `custom-data-upload` you may pass `sourceText` and `urlsToScrape`, which are ignored for medical and other custom models. Returns the new chatbot id.',
      parameters: {
        type: 'object',
        properties: {
          chatbotName: {
            type: 'string',
            description: 'The display name of the chatbot to create.',
          },
          model: {
            type: 'string',
            description:
              'Base model id. Examples: custom-data-upload, medical-chat-human, medical-chat-vet, custom-model. Vendor-specific values pass through unchanged.',
          },
          sourceText: {
            type: 'string',
            description:
              'Training text. Only used when model = custom-data-upload. Character limits depend on the workspace plan.',
          },
          urlsToScrape: {
            type: 'array',
            description: 'URLs to crawl and ingest as training data. Each must start with http:// or https://.',
            items: { type: 'string' },
          },
          customBackend: {
            type: 'string',
            description: 'Optional custom backend URL the chatbot delegates to instead of the platform model.',
          },
          bearer: {
            type: 'string',
            description: 'Optional bearer token forwarded to the custom backend.',
          },
          initialMessages: {
            type: 'array',
            description: 'Greeting messages the chatbot opens new conversations with.',
            items: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
              required: ['message'],
            },
          },
          suggestedMessages: {
            type: 'array',
            description: 'Quick-reply chips shown in the chatbot UI.',
            items: { type: 'string' },
          },
          visibility: {
            type: 'string',
            description: 'Access scope: private, public, or unlisted (vendor-specific values pass through).',
          },
          temperature: {
            type: 'number',
            description: 'Model temperature 0-1; higher = more random.',
          },
        },
        required: ['chatbotName'],
      },
      request: {
        method: 'POST',
        path: '/chatbot',
        body: {
          chatbotName: '{chatbotName}',
          model: '{model}',
          sourceText: '{sourceText}',
          urlsToScrape: '{urlsToScrape}',
          customBackend: '{customBackend}',
          bearer: '{bearer}',
          initialMessages: '{initialMessages}',
          suggestedMessages: '{suggestedMessages}',
          visibility: '{visibility}',
          temperature: '{temperature}',
        },
      },
      // Chat Data does not expose an idempotency-key header — replay creates a
      // duplicate chatbot. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'chatbot.delete',
      class: 'mutation',
      description:
        'Delete a chatbot by id. Destroys the chatbot, its training data, and its conversation history. Not reversible.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description: 'Target chatbot id.',
          },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'DELETE',
        path: '/chatbot/{chatbotId}',
      },
      // Re-deleting an already-deleted chatbot is a 404 from the vendor, but
      // the effect (chatbot is gone) is the same — model as native idempotent.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chatbot.send_message',
      class: 'mutation',
      description:
        'Send a user message to a chatbot and receive a generated reply. Pass conversationId to continue an existing conversation; omit it to start a new one. Optional attachedFiles supports up to three inline file references.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description: 'Target chatbot id.',
          },
          messageContent: {
            type: 'string',
            description: 'The user message body.',
          },
          messageRole: {
            type: 'string',
            description: 'Sender role. Typical values: user, assistant, system.',
          },
          conversationId: {
            type: 'string',
            description: 'Existing conversation id to continue. Omit to start a new conversation.',
          },
          includeReasoning: {
            type: 'boolean',
            description: 'Include reasoning trace in the response, overriding the chatbot default.',
          },
          baseModel: {
            type: 'string',
            description: 'Per-call model override.',
          },
          basePrompt: {
            type: 'string',
            description: 'Per-call system-prompt override.',
          },
          openAIFormat: {
            type: 'boolean',
            description: 'Return the response in OpenAI chat-completion shape.',
          },
          appendMessages: {
            type: 'boolean',
            description: 'Append to prior messages with the same conversationId instead of starting fresh.',
          },
          attachedFiles: {
            type: 'array',
            description: 'Up to 3 attached files (name + optional pre-parsed content).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['chatbotId', 'messageContent'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/chat',
        body: {
          messages: [
            {
              role: '{messageRole}',
              content: '{messageContent}',
            },
          ],
          conversationId: '{conversationId}',
          includeReasoning: '{includeReasoning}',
          baseModel: '{baseModel}',
          basePrompt: '{basePrompt}',
          openAIFormat: '{openAIFormat}',
          appendMessages: '{appendMessages}',
          attachedFiles: '{attachedFiles}',
        },
      },
      // LLM generation is non-deterministic; replay yields a different reply.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'chatbot.update_base_prompt',
      class: 'mutation',
      description:
        'Overwrite the chatbot base (system) prompt. The change applies to all subsequent conversations; in-flight conversations keep the prior prompt.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description: 'Target chatbot id.',
          },
          basePrompt: {
            type: 'string',
            description: 'New base prompt body.',
          },
        },
        required: ['chatbotId', 'basePrompt'],
      },
      request: {
        method: 'PATCH',
        path: '/chatbot/{chatbotId}',
        body: {
          basePrompt: '{basePrompt}',
        },
      },
      // PATCH with the same prompt is a no-op on the server; safe to replay.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chatbot.retrain',
      class: 'mutation',
      description:
        'Kick off a retrain job that re-ingests the chatbot training data (source text, scraped URLs, uploaded files, Q&As, product catalog). Returns a job id the caller can poll for completion.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description: 'Target chatbot id.',
          },
          sourceText: {
            type: 'string',
            description: 'Optional replacement training text.',
          },
          urlsToScrape: {
            type: 'array',
            description: 'Optional replacement URL list to crawl.',
            items: { type: 'string' },
          },
          products: {
            type: 'array',
            description: 'Optional product catalog entries.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                information: { type: 'object' },
              },
              required: ['id', 'information'],
            },
          },
          qAndAs: {
            type: 'array',
            description: 'Optional Q&A training pairs.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                answer: { type: 'string' },
              },
              required: ['question', 'answer'],
            },
          },
          deletes: {
            type: 'array',
            description: 'Knowledge chunks to remove from the chatbot during retrain.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                id: { type: 'string' },
              },
              required: ['type'],
            },
          },
          extractMainContent: {
            type: 'boolean',
            description: 'For URL ingestion: strip headers/footers/nav/sidebar/ads automatically.',
          },
          includeOnlyTags: {
            type: 'string',
            description: 'CSS selectors to exclusively extract during crawling (comma-separated).',
          },
          excludeTags: {
            type: 'string',
            description: 'CSS selectors to exclude during crawling (comma-separated).',
          },
          cookies: {
            type: 'string',
            description: 'Cookies for authenticated crawling (semicolon-separated name=value pairs).',
          },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/retrain',
        body: {
          sourceText: '{sourceText}',
          urlsToScrape: '{urlsToScrape}',
          products: '{products}',
          qAndAs: '{qAndAs}',
          deletes: '{deletes}',
          extractMainContent: '{extractMainContent}',
          includeOnlyTags: '{includeOnlyTags}',
          excludeTags: '{excludeTags}',
          cookies: '{cookies}',
        },
      },
      // Chat Data coalesces overlapping retrain requests on a chatbot into a
      // single job; replay returns the same in-progress job id.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chatbot.upload_file',
      class: 'mutation',
      description:
        'Upload a file to a chatbot knowledge base. The vendor expects multipart/form-data; the file payload is passed through as the `file` argument (path, base64, or pre-resolved file reference depending on the runtime). Returns the created file id.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description: 'Target chatbot id.',
          },
          name: {
            type: 'string',
            description: 'File name (must include the extension for content-type sniffing).',
          },
          file: {
            description: 'File payload reference (runtime-defined: local path, base64 string, or pre-resolved blob handle).',
          },
        },
        required: ['chatbotId', 'name', 'file'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/files',
        body: {
          name: '{name}',
          file: '{file}',
        },
      },
      // No vendor-side idempotency key — re-uploading creates a duplicate.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
