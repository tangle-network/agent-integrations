/**
 * ph0ny connector — voice agents that place real phone calls. The agent's
 * "call this number on the user's behalf and report back" surface.
 *
 * Auth: Bearer API key. ph0ny issues a single `plabs_`-prefixed key per
 * developer (created in the developer portal via POST /v1/keys); the
 * connector sends it as `Authorization: Bearer <key>` on every request.
 *
 *   list_agents(limit?, cursor?)
 *     Read. GET /v1/outbound's sibling — GET /v1/agents. Lists the
 *     developer's agents (cursor-paginated, newest first).
 *
 *   get_call(id)
 *     Read. GET /v1/outbound/:id. Fetches one outbound call row including
 *     status, transcript, and extracted fields.
 *
 *   list_calls(agentId?, limit?)
 *     Read. GET /v1/outbound. Lists recent outbound calls for the
 *     developer, optionally filtered by agentId.
 *
 *   start_outbound_call(agentId, toNumber, fromNumber, mission, …)
 *     Mutation, external effect. POST /v1/outbound/start. Places a real
 *     phone call. `userConsentRecorded` is a REQUIRED gate — ph0ny rejects
 *     the request (400 CONSENT_REQUIRED) when it is false, even with valid
 *     auth. `dryRun: true` walks every gate but stops short of the carrier
 *     fetch and the row insert, returning a `dryRunReport`.
 *
 *   create_agent(name, …)
 *     Mutation, external effect. POST /v1/agents. Creates a voice agent on
 *     the developer account. Only `name` is required; every other column is
 *     optional and passed through verbatim from the route's CreateAgentSchema.
 *
 *   provision_agent(name, collection?, initialContent?, …)
 *     Mutation, external effect. POST /v1/agents/provision. One call that
 *     creates the agent, optionally a fresh KB collection, and optionally
 *     seeds that collection with initial content — atomic on the server.
 *     Returns { agent, collection?, ingested? }.
 *
 *   kb_create_collection(name, description?, metadata?)
 *     Mutation, external effect. POST /v1/collections. Creates a knowledge-
 *     base collection the agent can search at call time.
 *
 *   kb_ingest(collectionId, content|sourceUrl, contentType, …)
 *     Mutation, external effect. POST /v1/collections/:id/ingest. Chunks and
 *     embeds content into a collection (≤1MB text). contentType 'url' returns
 *     501 server-side; 'audio' requires a sourceUrl that ph0ny transcribes.
 *
 *   kb_search(collectionId, query, …)
 *     Read. POST /v1/collections/:id/search. Hybrid vector+keyword search
 *     over a collection. Returns { results, queryTokens, graphContext? }.
 *
 *   list_voices(provider?, query?, limit?, cursor?)
 *     Read. GET /v1/voices. Voices an agent can speak with: the account's
 *     clones plus provider voices, each naming `provider` and
 *     `providerVoiceId` (set those as an agent's ttsProvider and voiceId).
 *
 *   list_phone_numbers()
 *     Read. GET /v1/phone-numbers. Caller ids that start_outbound_call accepts.
 *
 *   synthesize_speech(text, voiceId?, provider?, format?, speed?)
 *     Mutation (billed). POST /v1/synthesize. A voice memo: ph0ny stores the
 *     audio and returns a download URL valid for about an hour; save it as a
 *     file rather than passing audio through the conversation.
 *
 *   transcribe(audioUrl, language?, diarize?, …)
 *     Read (billed). POST /v1/transcribe. Speech-to-text of a public URL.
 *
 *   clone_voice(name, sampleUrls, consent, …)
 *     Mutation, external effect. POST /v1/voices/clone. Instant clone of the
 *     requester's OWN voice only: consent.subject must be "self" and
 *     consent.statement must quote them consenting. ph0ny stores the consent
 *     with the voice. Use the returned voice.id as start_outbound_call's
 *     voiceCloneId.
 *
 *   update_agent(agentId, …)
 *     Mutation. PUT /v1/agents/:id. Change an agent's voice, prompt or model.
 *
 * The agent test/eval routes (/v1/agents/:id/tests/*, benchmark, redteam) are
 * deliberately NOT exposed here: they run platform-funded LLM/TTS inference with
 * no usage metering, and are platform-admin tooling — not workspace-agent surface.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  CredentialsExpired,
} from '../types.js'
import { VoiceClient, VoiceApiException } from '@ph0ny/sdk'

const E164 = /^\+[1-9]\d{7,14}$/

export interface PhonyConnectorOptions {
  /** Operator-selected API, never taken from capability arguments. */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/** The production singleton and staging deployments share the same adapter. */
export function createPhonyConnector(options: PhonyConnectorOptions = {}): ConnectorAdapter {
  async function ph0ny<T>(
    sourceId: string,
    token: string,
    request: { method: 'GET' | 'POST' | 'PUT'; path: string; body?: Record<string, unknown>; timeout: number },
    label: string,
  ): Promise<T> {
    try {
      return await new VoiceClient({ apiKey: token, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl }).request<T>(request.method, request.path, {
        body: request.body,
        timeout: request.timeout,
      })
    } catch (error) {
      if (!(error instanceof VoiceApiException)) throw error
      if (error.statusCode === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', sourceId)
      throw new Error(`phony ${label} ${error.statusCode}: ${error.message.slice(0, 200)}`)
    }
  }

  return {
  manifest: {
    kind: 'phony',
    displayName: 'ph0ny',
    description:
      'Place real outbound phone calls with a voice agent, then read back call status, transcript, and extracted fields. Outbound calls require recorded user consent and support a dry-run that validates the full configuration without dialing.',
    auth: {
      kind: 'api-key',
      hint: 'Paste your ph0ny API key (plabs_…). Create one in the developer portal via POST /v1/keys — it is shown once.',
    },
    category: 'comms',
    // A call's status/transcript evolve while it is live, so a fetched row
    // can be stale moments later — reads are point-in-time, not authoritative
    // truth. start_outbound_call creates a fresh, uncontended call each time
    // (cas='none', fire-and-forget external effect; no upstream CAS exists).
    defaultConsistencyModel: 'cache',
    capabilities: [
      {
        name: 'list_agents',
        class: 'read',
        description: 'List the voice agents on your ph0ny developer account (newest first).',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            cursor: { type: 'string', description: 'Pagination cursor from a prior response.' },
          },
        },
      },
      {
        name: 'get_call',
        class: 'read',
        description: 'Fetch a single outbound call by id, including status, transcript, and extracted fields.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Outbound call id returned by start_outbound_call.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'list_calls',
        class: 'read',
        description: 'List recent outbound calls for the account, optionally filtered by agent.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Optional filter — only calls placed by this agent.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
      {
        name: 'start_outbound_call',
        class: 'mutation',
        description:
          'Place an outbound phone call. Requires userConsentRecorded=true (the user must have explicitly authorized the call). Set dryRun=true to validate the full configuration without dialing.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent that will place the call (agentKind must be personal_assistant).' },
            toNumber: { type: 'string', description: 'E.164 destination, e.g. +14155551212.' },
            fromNumber: { type: 'string', description: 'E.164 caller number provisioned to your developer account.' },
            mission: {
              type: 'object',
              description: 'What the agent should accomplish on the call.',
              properties: {
                goal: { type: 'string', description: 'Plain-language objective (8–2000 chars).' },
                successSchema: { type: 'object', description: 'Optional JSON schema describing fields to extract on success.' },
                ivrHints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional hints for navigating phone-tree / IVR menus (≤8 entries).',
                },
                maxTurns: { type: 'integer', minimum: 1, maximum: 60 },
                maxDurationMs: { type: 'integer', minimum: 30000, maximum: 1200000 },
              },
              required: ['goal'],
            },
            missionId: { type: 'string', description: 'Optional caller-supplied mission id.' },
            callerProfile: {
              type: 'object',
              properties: {
                userName: { type: 'string' },
                companyName: { type: 'string' },
              },
            },
            voiceCloneId: {
              type: 'string',
              description: 'Optional voice.id from clone_voice. The agent must use the same ttsProvider as the clone (cartesia).',
            },
            callback: {
              type: 'object',
              description:
                'Optional. ph0ny POSTs the outcome (summary, extracted fields, transcript, recording URL) here once the call ends, signed X-Signature: hex(HMAC-SHA256(body, token)) and sent with Authorization: Bearer <token>.',
              properties: {
                url: { type: 'string', description: 'https URL that receives the outcome.' },
                token: { type: 'string', description: 'Shared secret, 16-512 chars.' },
              },
              required: ['url', 'token'],
            },
            userConsentRecorded: {
              type: 'boolean',
              description: 'REQUIRED. Must be true — the user explicitly authorized this call. ph0ny rejects false.',
            },
            dryRun: {
              type: 'boolean',
              description: 'When true, validate every gate and return a dryRunReport without placing the call.',
            },
          },
          required: ['agentId', 'toNumber', 'fromNumber', 'mission', 'userConsentRecorded'],
        },
      },
      {
        name: 'create_agent',
        class: 'mutation',
        description:
          'Create a voice agent on your ph0ny developer account. Only name is required; the rest configure the LLM, TTS, voice, knowledge base, and capture behavior.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Optional caller-supplied agent id (1–60 chars).' },
            name: { type: 'string', description: 'Display name (1–100 chars).' },
            agentKind: {
              type: 'string',
              enum: ['inbound', 'personal_assistant', 'outbound'],
              description: 'Agent runtime kind. Use personal_assistant for outbound calls; omitted defaults to inbound.',
            },
            description: { type: 'string', description: 'Optional description (≤1000 chars).' },
            systemPrompt: { type: 'string', description: 'Optional system prompt (≤10000 chars).' },
            firstMessage: { type: 'string', description: 'Optional opening line the agent speaks first (≤1000 chars).' },
            voiceId: { type: 'string', description: 'Optional TTS voice id.' },
            ttsProvider: { type: 'string', description: 'TTS provider; "default" lets ph0ny choose.' },
            ttsModel: { type: 'string', description: 'Optional TTS model id.' },
            sttProvider: { type: 'string', description: 'Optional speech-to-text provider.' },
            llmProvider: { type: 'string', description: 'LLM provider (e.g. openai, anthropic). Defaults to openai server-side.' },
            llmModel: { type: 'string', description: 'Optional LLM model id.' },
            libraryId: { type: 'string', description: 'Ingest-service library id (preferred over collectionId).' },
            collectionId: { type: 'string', description: 'Deprecated — KB collection id to attach. Prefer libraryId.' },
            styleProfile: { type: 'object', description: 'Optional style profile object.' },
            promptByModel: { type: 'object', description: 'Optional per-model prompt overrides (modelId → prompt).' },
            language: { type: 'string', description: 'BCP-47 language code; defaults to "en".' },
            temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Sampling temperature (0–2); defaults to 0.7.' },
            maxTokens: { type: 'integer', minimum: 1, maximum: 16384, description: 'Optional max output tokens.' },
            contactCaptureEnabled: { type: 'boolean', description: 'Enable structured contact capture during calls.' },
            contactCaptureFields: {
              type: 'array',
              items: { type: 'string', enum: ['name', 'email', 'phone'] },
              description: 'Which contact fields to capture when capture is enabled.',
            },
            metadata: { type: 'object', description: 'Arbitrary metadata object stored with the agent.' },
          },
          required: ['name'],
        },
      },
      {
        name: 'provision_agent',
        class: 'mutation',
        description:
          'Create an agent and, in the same atomic call, optionally a fresh knowledge-base collection and seed it with initial content. Returns the agent plus the created collection and ingestion results.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Optional caller-supplied agent id (1–60 chars).' },
            name: { type: 'string', description: 'Display name (1–100 chars).' },
            agentKind: {
              type: 'string',
              enum: ['inbound', 'personal_assistant', 'outbound'],
              description: 'Agent runtime kind. Use personal_assistant for outbound calls; omitted defaults to inbound.',
            },
            description: { type: 'string', description: 'Optional description (≤1000 chars).' },
            systemPrompt: { type: 'string', description: 'Optional system prompt (≤10000 chars).' },
            firstMessage: { type: 'string', description: 'Optional opening line the agent speaks first (≤1000 chars).' },
            voiceId: { type: 'string', description: 'Optional TTS voice id.' },
            ttsProvider: { type: 'string', description: 'TTS provider; "default" lets ph0ny choose.' },
            ttsModel: { type: 'string', description: 'Optional TTS model id.' },
            sttProvider: { type: 'string', description: 'Optional speech-to-text provider.' },
            llmProvider: { type: 'string', description: 'LLM provider (e.g. openai, anthropic). Defaults to openai server-side.' },
            llmModel: { type: 'string', description: 'Optional LLM model id.' },
            libraryId: { type: 'string', description: 'Ingest-service library id (preferred over collectionId).' },
            collectionId: { type: 'string', description: 'Existing KB collection id to attach instead of creating one.' },
            styleProfile: { type: 'object', description: 'Optional style profile object.' },
            promptByModel: { type: 'object', description: 'Optional per-model prompt overrides (modelId → prompt).' },
            language: { type: 'string', description: 'BCP-47 language code; defaults to "en".' },
            temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Sampling temperature (0–2); defaults to 0.7.' },
            maxTokens: { type: 'integer', minimum: 1, maximum: 16384, description: 'Optional max output tokens.' },
            contactCaptureEnabled: { type: 'boolean', description: 'Enable structured contact capture during calls.' },
            contactCaptureFields: {
              type: 'array',
              items: { type: 'string', enum: ['name', 'email', 'phone'] },
              description: 'Which contact fields to capture when capture is enabled.',
            },
            metadata: { type: 'object', description: 'Arbitrary metadata object stored with the agent.' },
            collection: {
              type: 'object',
              description: 'When present, create a fresh KB collection and attach it to the agent.',
              properties: {
                name: { type: 'string', description: 'Collection name (1–100 chars).' },
                description: { type: 'string', description: 'Optional collection description (≤500 chars).' },
              },
              required: ['name'],
            },
            initialContent: {
              type: 'array',
              maxItems: 10,
              description: 'Documents to ingest into the new/attached collection (≤10).',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Raw text or transcript content.' },
                  contentType: { type: 'string', enum: ['text', 'transcript'], description: 'Defaults to "text".' },
                  metadata: { type: 'object', description: 'Arbitrary metadata stored with the document.' },
                },
                required: ['content'],
              },
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'kb_create_collection',
        class: 'mutation',
        description: 'Create a knowledge-base collection the agent can search at call time.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Collection name (1–100 chars).' },
            description: { type: 'string', description: 'Optional description (≤500 chars).' },
            metadata: { type: 'object', description: 'Arbitrary metadata object stored with the collection.' },
          },
          required: ['name'],
        },
      },
      {
        name: 'kb_ingest',
        class: 'mutation',
        description:
          'Chunk, embed, and store content into a KB collection. Provide content directly (≤1MB), or a sourceUrl for audio transcription. contentType "url" is not yet implemented server-side (501).',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            collectionId: { type: 'string', description: 'Target collection id.' },
            content: { type: 'string', description: 'Raw text/transcript content (≤1,000,000 chars).' },
            sourceUrl: { type: 'string', description: 'Public URL — required when contentType is "audio" (transcribed) or "url".' },
            contentType: {
              type: 'string',
              enum: ['text', 'transcript', 'audio', 'url'],
              description: 'Defaults to "text". "audio" transcribes sourceUrl; "url" returns 501.',
            },
            metadata: { type: 'object', description: 'Arbitrary metadata stored with the document.' },
            chunkSize: { type: 'integer', minimum: 100, maximum: 4000, description: 'Chunk size in chars; defaults to 1000.' },
            chunkOverlap: { type: 'integer', minimum: 0, maximum: 500, description: 'Chunk overlap in chars; defaults to 200. Must be < chunkSize.' },
          },
          required: ['collectionId'],
        },
      },
      {
        name: 'kb_search',
        class: 'read',
        description: 'Hybrid vector + keyword search over a KB collection. Returns ranked results with scores.',
        parameters: {
          type: 'object',
          properties: {
            collectionId: { type: 'string', description: 'Collection id to search.' },
            query: { type: 'string', description: 'Search query (1–2000 chars).' },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results; defaults to 10.' },
            threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum similarity score; defaults to 0.7.' },
            includeMetadata: { type: 'boolean', description: 'Include per-result metadata; defaults to true.' },
          },
          required: ['collectionId', 'query'],
        },
      },
      {
        name: 'list_voices',
        class: 'read',
        description:
          'List voices an agent can speak with: your cloned voices, ElevenLabs account voices and, with provider "cartesia", Cartesia stock voices. Each voice names provider and providerVoiceId; set them as an agent\'s ttsProvider and voiceId.',
        parameters: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['cartesia'], description: 'Also list this provider\'s stock voices.' },
            query: { type: 'string', description: 'Filter provider voices by name (with provider).' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string', description: 'Pagination cursor from a prior response.' },
          },
        },
      },
      {
        name: 'list_phone_numbers',
        class: 'read',
        description: 'List the phone numbers on your ph0ny account; use one as start_outbound_call fromNumber.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'transcribe',
        class: 'read',
        consistencyModel: 'authoritative',
        description: 'Transcribe speech from a public audio URL (billed per audio minute).',
        parameters: {
          type: 'object',
          properties: {
            audioUrl: { type: 'string', description: 'Public https URL of the audio.' },
            language: { type: 'string', description: 'BCP-47 language hint, e.g. "en".' },
            diarize: { type: 'boolean', description: 'Label speakers.' },
            mode: { type: 'string', enum: ['fast', 'accurate'] },
          },
          required: ['audioUrl'],
        },
      },
      {
        name: 'synthesize_speech',
        class: 'mutation',
        description:
          'Speak text in a voice and store it as an audio file (a voice memo). Returns audioUrl, a download link valid for about an hour: save the file to the workspace instead of pasting audio into the conversation.',
        cas: 'none',
        externalEffect: false,
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'What to say (1-10000 chars).' },
            voiceId: { type: 'string', description: 'providerVoiceId from list_voices; omitted uses the default voice.' },
            provider: { type: 'string', description: 'The voice\'s provider from list_voices, e.g. "cartesia" or "elevenlabs".' },
            format: { type: 'string', enum: ['mp3', 'wav', 'ogg'], default: 'mp3' },
            speed: { type: 'number', minimum: 0.5, maximum: 2 },
          },
          required: ['text'],
        },
      },
      {
        name: 'clone_voice',
        class: 'mutation',
        description:
          'Clone the requester\'s OWN voice from their recording(s). Only self-clones are allowed: consent.subject must be "self" and consent.statement must quote the speaker consenting (for example "I consent to Tangle cloning my voice"). Never clone someone else\'s voice. Returns voice.id for start_outbound_call voiceCloneId.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Voice name (1-100 chars).' },
            sampleUrls: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: { type: 'string' },
              description: 'Public https URLs of the speaker\'s recordings (any common audio format, including iMessage voice memos); 10 s to 3 min of clean speech works best.',
            },
            language: { type: 'string', description: 'ISO 639-1 code; defaults to "en".' },
            description: { type: 'string', description: 'Optional description (<=500 chars).' },
            consent: {
              type: 'object',
              properties: {
                subject: { type: 'string', enum: ['self'], description: 'Whose voice: only "self" is accepted.' },
                statement: { type: 'string', description: 'The speaker\'s own words consenting to the clone, quoted from their request.' },
                speakerName: { type: 'string', description: 'Who the speaker is.' },
                sourceRef: { type: 'string', description: 'Where the consent was given, e.g. the message id.' },
              },
              required: ['subject', 'statement'],
            },
          },
          required: ['name', 'sampleUrls', 'consent'],
        },
      },
      {
        name: 'update_agent',
        class: 'mutation',
        description: 'Update a voice agent: its voice (voiceId + ttsProvider from list_voices), prompt, greeting, kind or model.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent to update.' },
            name: { type: 'string' },
            agentKind: { type: 'string', enum: ['inbound', 'personal_assistant', 'outbound'] },
            description: { type: 'string' },
            systemPrompt: { type: 'string' },
            firstMessage: { type: 'string' },
            voiceId: { type: 'string', description: 'providerVoiceId from list_voices.' },
            ttsProvider: { type: 'string', description: 'provider from list_voices.' },
            ttsModel: { type: 'string' },
            sttProvider: { type: 'string' },
            llmProvider: { type: 'string' },
            llmModel: { type: 'string' },
            language: { type: 'string' },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTokens: { type: 'integer', minimum: 1, maximum: 16384 },
            metadata: { type: 'object' },
          },
          required: ['agentId'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const token = bearerToken(inv.source.credentials)
    if (inv.capabilityName === 'list_agents') {
      const { limit, cursor } = inv.args as { limit?: number; cursor?: string }
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(1, limit ?? 20), 100)))
      if (cursor) params.set('cursor', cursor)
      const json = await ph0ny<{ data?: unknown[]; nextCursor?: string; hasMore?: boolean }>(
        inv.source.id,
        token,
        { method: 'GET', path: `/v1/agents?${params.toString()}`, timeout: 10_000 },
        'list_agents',
      )
      return {
        data: { agents: json.data ?? [], nextCursor: json.nextCursor ?? null, hasMore: json.hasMore ?? false },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'get_call') {
      const { id } = inv.args as { id: string }
      const json = await ph0ny<{ call?: unknown }>(
        inv.source.id,
        token,
        { method: 'GET', path: `/v1/outbound/${encodeURIComponent(id)}`, timeout: 10_000 },
        'get_call',
      )
      return { data: { call: json.call ?? null }, fetchedAt: Date.now() }
    }
    if (inv.capabilityName === 'list_calls') {
      const { agentId, limit } = inv.args as { agentId?: string; limit?: number }
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(1, limit ?? 20), 50)))
      if (agentId) params.set('agentId', agentId)
      const json = await ph0ny<{ calls?: unknown[] }>(
        inv.source.id,
        token,
        { method: 'GET', path: `/v1/outbound?${params.toString()}`, timeout: 10_000 },
        'list_calls',
      )
      return { data: { calls: json.calls ?? [] }, fetchedAt: Date.now() }
    }
    if (inv.capabilityName === 'kb_search') {
      const { collectionId, query, limit, threshold, includeMetadata } = inv.args as {
        collectionId: string
        query: string
        limit?: number
        threshold?: number
        includeMetadata?: boolean
      }
      const payload: Record<string, unknown> = { query }
      if (limit !== undefined) payload.limit = limit
      if (threshold !== undefined) payload.threshold = threshold
      if (includeMetadata !== undefined) payload.includeMetadata = includeMetadata
      const json = await ph0ny<{ results?: unknown[]; queryTokens?: number; graphContext?: unknown }>(
        inv.source.id,
        token,
        {
          method: 'POST',
          path: `/v1/collections/${encodeURIComponent(collectionId)}/search`,
          body: payload,
          timeout: 15_000,
        },
        'kb_search',
      )
      return {
        data: {
          results: json.results ?? [],
          queryTokens: json.queryTokens ?? 0,
          ...(json.graphContext !== undefined ? { graphContext: json.graphContext } : {}),
        },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'list_voices') {
      const { provider, query, limit, cursor } = inv.args as { provider?: string; query?: string; limit?: number; cursor?: string }
      const params = new URLSearchParams({ includeCustom: 'true', limit: String(Math.min(Math.max(1, limit ?? 50), 200)) })
      if (provider === 'cartesia') params.set('provider', 'cartesia')
      if (query) params.set('q', query)
      if (cursor) params.set('cursor', cursor)
      const json = await ph0ny<{ data?: unknown[]; nextCursor?: string; hasMore?: boolean }>(
        inv.source.id,
        token,
        { method: 'GET', path: `/v1/voices?${params.toString()}`, timeout: 15_000 },
        'list_voices',
      )
      return {
        data: { voices: json.data ?? [], nextCursor: json.nextCursor ?? null, hasMore: json.hasMore ?? false },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'list_phone_numbers') {
      const json = await ph0ny<{ data?: unknown[] }>(
        inv.source.id,
        token,
        { method: 'GET', path: '/v1/phone-numbers', timeout: 10_000 },
        'list_phone_numbers',
      )
      return { data: { phoneNumbers: json.data ?? [] }, fetchedAt: Date.now() }
    }
    if (inv.capabilityName === 'transcribe') {
      const args = inv.args as { audioUrl?: unknown; language?: unknown; diarize?: unknown; mode?: unknown }
      assertHttpsUrl(args.audioUrl, 'transcribe audioUrl')
      const payload = pick(args as Record<string, unknown>, ['audioUrl', 'language', 'diarize', 'mode'])
      const json = await ph0ny<Record<string, unknown>>(
        inv.source.id,
        token,
        { method: 'POST', path: '/v1/transcribe', body: payload, timeout: 120_000 },
        'transcribe',
      )
      return { data: json, fetchedAt: Date.now() }
    }
    throw new Error(`phony: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const token = bearerToken(inv.source.credentials)
    if (inv.capabilityName === 'start_outbound_call') {
      const args = validateOutboundStartArgs(inv.args)
      const payload: Record<string, unknown> = {
        agentId: args.agentId,
        toNumber: args.toNumber,
        fromNumber: args.fromNumber,
        mission: args.mission,
        userConsentRecorded: args.userConsentRecorded,
      }
      if (args.missionId !== undefined) payload.missionId = args.missionId
      if (args.callerProfile !== undefined) payload.callerProfile = args.callerProfile
      if (args.voiceCloneId !== undefined) payload.voiceCloneId = args.voiceCloneId
      if (args.callback !== undefined) payload.callback = args.callback
      if (args.dryRun !== undefined) payload.dryRun = args.dryRun

      const json = await ph0ny<{
        callSid: string | null
        callId: string | null
        status: string
        dryRun?: boolean
        dryRunReport?: unknown
      }>(inv.source.id, token, { method: 'POST', path: '/v1/outbound/start', body: payload, timeout: 20_000 }, 'start_outbound_call')
      return {
        status: 'committed',
        data: {
          callId: json.callId,
          callSid: json.callSid,
          callStatus: json.status,
          dryRun: json.dryRun ?? false,
          ...(json.dryRunReport !== undefined ? { dryRunReport: json.dryRunReport } : {}),
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'create_agent') {
      const payload = pick(inv.args as Record<string, unknown>, AGENT_FIELDS)
      const json = await ph0ny<Record<string, unknown>>(
        inv.source.id,
        token,
        { method: 'POST', path: `/v1/agents`, body: payload, timeout: 20_000 },
        'create_agent',
      )
      return {
        status: 'committed',
        data: { agent: json },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'provision_agent') {
      const args = inv.args as Record<string, unknown>
      const payload = pick(args, AGENT_FIELDS)
      if (args.collection !== undefined) payload.collection = args.collection
      if (args.initialContent !== undefined) payload.initialContent = args.initialContent
      const json = await ph0ny<{ agent?: unknown; collection?: unknown; ingested?: unknown }>(
        inv.source.id,
        token,
        { method: 'POST', path: `/v1/agents/provision`, body: payload, timeout: 20_000 },
        'provision_agent',
      )
      return {
        status: 'committed',
        data: {
          agent: json.agent ?? null,
          ...(json.collection !== undefined ? { collection: json.collection } : {}),
          ...(json.ingested !== undefined ? { ingested: json.ingested } : {}),
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'kb_create_collection') {
      const { name, description, metadata } = inv.args as {
        name: string
        description?: string
        metadata?: Record<string, unknown>
      }
      const payload: Record<string, unknown> = { name }
      if (description !== undefined) payload.description = description
      if (metadata !== undefined) payload.metadata = metadata
      const json = await ph0ny<Record<string, unknown>>(
        inv.source.id,
        token,
        { method: 'POST', path: `/v1/collections`, body: payload, timeout: 20_000 },
        'kb_create_collection',
      )
      return {
        status: 'committed',
        data: { collection: json },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'kb_ingest') {
      const { collectionId, ...rest } = inv.args as { collectionId: string } & Record<string, unknown>
      const payload = pick(rest, INGEST_FIELDS)
      const json = await ph0ny<{ documentId?: string; chunksCreated?: number; tokensUsed?: number }>(
        inv.source.id,
        token,
        { method: 'POST', path: `/v1/collections/${encodeURIComponent(collectionId)}/ingest`, body: payload, timeout: 20_000 },
        'kb_ingest',
      )
      return {
        status: 'committed',
        data: {
          documentId: json.documentId ?? null,
          chunksCreated: json.chunksCreated ?? 0,
          tokensUsed: json.tokensUsed ?? 0,
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'synthesize_speech') {
      const args = inv.args as Record<string, unknown>
      if (typeof args.text !== 'string' || args.text.trim().length === 0 || args.text.length > 10_000) {
        throw new Error('phony synthesize_speech text must be 1-10000 chars')
      }
      const payload = pick(args, ['text', 'voiceId', 'provider', 'format', 'speed'])
      if (payload.format === undefined) payload.format = 'mp3'
      const json = await ph0ny<{ audioUrl?: string; audio?: string; audioFormat?: string; duration?: number; charactersUsed?: number; provider?: string }>(
        inv.source.id,
        token,
        { method: 'POST', path: '/v1/synthesize', body: payload, timeout: 60_000 },
        'synthesize_speech',
      )
      // Audio stays out of the conversation: ph0ny stores it and returns a link.
      if (!json.audioUrl) throw new Error('phony synthesize_speech: ph0ny returned no audioUrl (storage unavailable)')
      return {
        status: 'committed',
        data: {
          audioUrl: json.audioUrl,
          format: payload.format,
          durationSeconds: json.duration ?? null,
          charactersUsed: json.charactersUsed ?? null,
          provider: json.provider ?? null,
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'clone_voice') {
      const payload = validateCloneArgs(inv.args)
      const json = await ph0ny<{ voice?: unknown; message?: string }>(
        inv.source.id,
        token,
        { method: 'POST', path: '/v1/voices/clone', body: payload, timeout: 120_000 },
        'clone_voice',
      )
      return { status: 'committed', data: { voice: json.voice ?? null }, committedAt: Date.now(), idempotentReplay: false }
    }
    if (inv.capabilityName === 'update_agent') {
      const { agentId, ...rest } = inv.args as { agentId?: unknown } & Record<string, unknown>
      if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > 128) throw new Error('phony update_agent requires agentId')
      const payload = pick(rest, AGENT_FIELDS.filter((f) => f !== 'id'))
      if (Object.keys(payload).length === 0) throw new Error('phony update_agent needs at least one field to change')
      const json = await ph0ny<Record<string, unknown>>(
        inv.source.id,
        token,
        { method: 'PUT', path: `/v1/agents/${encodeURIComponent(agentId)}`, body: payload, timeout: 20_000 },
        'update_agent',
      )
      return { status: 'committed', data: { agent: json }, committedAt: Date.now(), idempotentReplay: false }
    }
    throw new Error(`phony: unknown mutation capability ${inv.capabilityName}`)
  },

  async test(source) {
    try {
      const token = bearerToken(source.credentials)
      // GET /v1/outbound?limit=1 is the cheapest authed read that proves the
      // key is valid.
      await new VoiceClient({ apiKey: token, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl }).request('GET', '/v1/outbound?limit=1', { timeout: 8_000 })
      return { ok: true }
    } catch (err) {
      if (err instanceof VoiceApiException) {
        return {
          ok: false,
          reason:
            err.statusCode === 401
              ? 'ph0ny rejected credentials (401) — reconnect required'
              : `ph0ny returned ${err.statusCode}`,
        }
      }
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
}

export const phonyConnector = createPhonyConnector()

function bearerToken(creds: { kind: string; apiKey?: string }): string {
  if (creds.kind !== 'api-key' || typeof creds.apiKey !== 'string' || creds.apiKey.length === 0) {
    throw new Error('phony: expected api-key credentials')
  }
  return creds.apiKey
}

type OutboundStartArgs = {
  agentId: string
  toNumber: string
  fromNumber: string
  mission: {
    goal: string
    successSchema?: Record<string, unknown>
    ivrHints?: string[]
    maxTurns?: number
    maxDurationMs?: number
  }
  missionId?: string
  callerProfile?: { userName?: string; companyName?: string }
  voiceCloneId?: string
  callback?: { url: string; token: string }
  userConsentRecorded: true
  dryRun?: boolean
}

function validateOutboundStartArgs(args: Record<string, unknown>): OutboundStartArgs {
  if (args.userConsentRecorded !== true) {
    throw new Error(
      'phony start_outbound_call requires userConsentRecorded=true after explicit user authorization; refusing before contacting ph0ny',
    )
  }

  assertNonEmptyString(args.agentId, 'agentId', 128)
  assertE164(args.toNumber, 'toNumber')
  assertE164(args.fromNumber, 'fromNumber')

  if (!isRecord(args.mission)) throw new Error('phony start_outbound_call requires mission')
  const mission = args.mission
  assertNonEmptyString(mission.goal, 'mission.goal', 2000)
  if (mission.goal.trim().length < 8) throw new Error('phony start_outbound_call mission.goal must be at least 8 characters')
  if (mission.successSchema !== undefined && !isRecord(mission.successSchema)) {
    throw new Error('phony start_outbound_call mission.successSchema must be an object when supplied')
  }
  if (mission.ivrHints !== undefined) {
    if (!Array.isArray(mission.ivrHints) || mission.ivrHints.length > 8) {
      throw new Error('phony start_outbound_call mission.ivrHints must be an array with at most 8 entries')
    }
    for (const hint of mission.ivrHints) assertNonEmptyString(hint, 'mission.ivrHints[]', 200)
  }
  assertOptionalInteger(mission.maxTurns, 'mission.maxTurns', 1, 60)
  assertOptionalInteger(mission.maxDurationMs, 'mission.maxDurationMs', 30_000, 20 * 60 * 1000)
  if (args.missionId !== undefined) assertNonEmptyString(args.missionId, 'missionId', 128)
  if (args.voiceCloneId !== undefined) assertNonEmptyString(args.voiceCloneId, 'voiceCloneId', 128)
  if (args.callerProfile !== undefined) {
    if (!isRecord(args.callerProfile)) throw new Error('phony start_outbound_call callerProfile must be an object')
    if (args.callerProfile.userName !== undefined) assertNonEmptyString(args.callerProfile.userName, 'callerProfile.userName', 120)
    if (args.callerProfile.companyName !== undefined) {
      assertNonEmptyString(args.callerProfile.companyName, 'callerProfile.companyName', 120)
    }
  }
  if (args.callback !== undefined) {
    if (!isRecord(args.callback)) throw new Error('phony start_outbound_call callback must be an object')
    assertHttpsUrl(args.callback.url, 'start_outbound_call callback.url')
    if (typeof args.callback.token !== 'string' || args.callback.token.length < 16 || args.callback.token.length > 512) {
      throw new Error('phony start_outbound_call callback.token must be 16-512 chars')
    }
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    throw new Error('phony start_outbound_call dryRun must be boolean when supplied')
  }

  return args as OutboundStartArgs
}

function assertNonEmptyString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`phony start_outbound_call ${field} must be a non-empty string <= ${maxLength} chars`)
  }
}

function assertE164(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !E164.test(value)) {
    throw new Error(`phony start_outbound_call ${field} must be E.164 format, e.g. +14155550123`)
  }
}

function assertOptionalInteger(value: unknown, field: string, min: number, max: number): asserts value is number | undefined {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`phony start_outbound_call ${field} must be an integer between ${min} and ${max}`)
  }
}

function assertHttpsUrl(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value) || new URL(value).protocol !== 'https:') {
    throw new Error(`phony ${field} must be an https URL`)
  }
}

/** The self-clone rule, checked before ph0ny is contacted; ph0ny enforces it again. */
function validateCloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.name !== 'string' || args.name.trim().length === 0 || args.name.length > 100) {
    throw new Error('phony clone_voice name must be 1-100 chars')
  }
  if (!Array.isArray(args.sampleUrls) || args.sampleUrls.length < 1 || args.sampleUrls.length > 10) {
    throw new Error('phony clone_voice sampleUrls must hold 1-10 URLs')
  }
  for (const url of args.sampleUrls) assertHttpsUrl(url, 'clone_voice sampleUrls[]')
  const consent = args.consent
  if (!isRecord(consent) || consent.subject !== 'self') {
    throw new Error('phony clone_voice only clones the requester\'s own voice: consent.subject must be "self"')
  }
  if (typeof consent.statement !== 'string' || consent.statement.trim().length < 10 || !/consent/i.test(consent.statement)) {
    throw new Error('phony clone_voice consent.statement must quote the speaker consenting to the clone')
  }
  return pick(args, ['name', 'sampleUrls', 'language', 'description', 'consent'])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


/** Copy only the declared keys that are present (not undefined) into a fresh
 *  payload. Keeps the connector from forwarding fields the route's zod schema
 *  doesn't declare. */
function pick(args: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of fields) {
    if (args[key] !== undefined) out[key] = args[key]
  }
  return out
}

// Field allowlists — exactly the keys each route's zod schema declares. The
// :id path params (agentId, collectionId) are routed via the URL and excluded.
const AGENT_FIELDS = [
  'id',
  'name',
  'agentKind',
  'description',
  'systemPrompt',
  'firstMessage',
  'voiceId',
  'ttsProvider',
  'ttsModel',
  'sttProvider',
  'llmProvider',
  'llmModel',
  'libraryId',
  'collectionId',
  'styleProfile',
  'promptByModel',
  'language',
  'temperature',
  'maxTokens',
  'contactCaptureEnabled',
  'contactCaptureFields',
  'metadata',
] as const

const INGEST_FIELDS = [
  'content',
  'sourceUrl',
  'contentType',
  'metadata',
  'chunkSize',
  'chunkOverlap',
] as const
