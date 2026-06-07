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
 *   run_synthetic_test(agentId, persona, goal, …)
 *     Mutation, external effect. POST /v1/agents/:id/tests/run-synthetic.
 *     Drives a synthetic LLM caller against the agent — NO billing, NO real
 *     dial. Creates a test-run row and returns its results + summary.
 *
 *   run_selfplay_test(agentId, …)
 *     Mutation, external effect. POST /v1/agents/:id/tests/run-selfplay.
 *     Runs two agents against each other in text or simulated audio — NO
 *     billing, NO real dial. Returns { testRun }.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  CredentialsExpired,
} from '../types.js'

const API = 'https://api.ph0ny.com'
const E164 = /^\+[1-9]\d{7,14}$/

export const phonyConnector: ConnectorAdapter = {
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
            voiceCloneId: { type: 'string', description: 'Optional cloned-voice id to speak with.' },
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
        name: 'run_synthetic_test',
        class: 'mutation',
        description:
          'Run a synthetic LLM caller against the agent to validate behavior. No billing, no real phone call — creates a test-run row and returns its results and summary.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent under test.' },
            persona: {
              type: 'string',
              enum: ['friendly', 'confused', 'impatient', 'adversarial', 'tangential', 'detailed', 'multiTopic'],
              description: 'Synthetic caller persona.',
            },
            goal: { type: 'string', description: "The synthetic caller's objective (1–1000 chars)." },
            maxTurns: { type: 'integer', minimum: 1, maximum: 20, description: 'Max conversation turns; defaults to 10.' },
            maxSteps: { type: 'integer', minimum: 1, maximum: 8, description: 'Max tool steps per turn; defaults to 5.' },
            callerPhone: { type: 'string', description: 'Optional E.164 caller phone used to resolve an agent instance.' },
            instanceId: { type: 'string', description: 'Optional explicit agent-instance id.' },
            assertions: { type: 'array', items: { type: 'object' }, description: 'Per-turn assertions to evaluate.' },
            sessionAssertions: { type: 'array', maxItems: 10, items: { type: 'object' }, description: 'Session-level assertions (≤10).' },
            enableJudge: { type: 'boolean', description: 'Run the LLM judge over the transcript; defaults to false.' },
            systemPromptOverride: { type: 'string', description: 'Override the agent system prompt for this run (≤8000 chars).' },
            firstMessageOverride: { type: 'string', description: 'Override the agent first message for this run (≤1000 chars).' },
            disableRag: { type: 'boolean', description: 'Disable KB retrieval for this run.' },
            questions: { type: 'array', maxItems: 20, items: { type: 'object' }, description: 'Campaign questions to extract from the transcript (≤20).' },
            expectedAnswers: { type: 'object', description: 'Expected answers keyed by question id for ground-truth comparison.' },
            realism: {
              type: 'string',
              enum: ['clean', 'light', 'moderate', 'chaos'],
              description: 'Inject STT artifacts/interrupts/silences to simulate real-call conditions.',
            },
          },
          required: ['agentId', 'persona', 'goal'],
        },
      },
      {
        name: 'run_selfplay_test',
        class: 'mutation',
        description:
          'Run two agents against each other in text or simulated audio to validate end-to-end behavior. No billing, no real phone call. Returns { testRun }.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent A (the agent under test).' },
            agentBId: { type: 'string', description: 'Optional agent B; defaults to agent A (self-play against itself).' },
            taskA: { type: 'string', description: "Optional task/goal for agent A (≤1000 chars)." },
            taskB: { type: 'string', description: "Optional task/goal for agent B (≤1000 chars)." },
            participants: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              description: 'Optional multi-party participant list (overrides A/B pairing).',
              items: {
                type: 'object',
                properties: {
                  agentId: { type: 'string' },
                  speaker: { type: 'string', description: 'Speaker label (≤20 chars).' },
                  task: { type: 'string', description: 'Per-participant task (≤1000 chars).' },
                  instanceId: { type: 'string' },
                },
                required: ['agentId'],
              },
            },
            maxExchanges: { type: 'integer', minimum: 1, maximum: 20, description: 'Max back-and-forth exchanges; defaults to 6.' },
            maxSteps: { type: 'integer', minimum: 1, maximum: 8, description: 'Max tool steps per turn; defaults to 5.' },
            initialSpeaker: { type: 'string', description: 'Speaker who opens; defaults to "A".' },
            callerPhone: { type: 'string', description: 'Optional E.164 caller phone used to resolve agent instances.' },
            instanceIdA: { type: 'string', description: 'Optional explicit instance id for agent A.' },
            instanceIdB: { type: 'string', description: 'Optional explicit instance id for agent B.' },
            transportMode: { type: 'string', enum: ['text', 'audio'], description: 'Text or audio transport; defaults to text. Audio requires enableTts=true.' },
            enableTts: { type: 'boolean', description: 'Synthesize speech each turn; required when transportMode is "audio".' },
            overlapMode: { type: 'string', enum: ['none', 'simulated', 'duplex'], description: 'Turn-overlap model; "duplex" requires audio transport.' },
            bargeInEnabled: { type: 'boolean', description: 'Allow barge-in interruptions; defaults to false.' },
            bargeInSensitivity: { type: 'number', minimum: 0, maximum: 1, description: 'Barge-in sensitivity (0–1); defaults to 0.65.' },
            ttsProviderOverride: { type: 'string', description: 'Override the TTS provider for all speakers.' },
            speakerTtsOverrides: { type: 'object', description: 'Per-speaker TTS provider overrides (speaker → provider).' },
            voiceIdOverride: { type: 'string', description: 'Override the voice id for all speakers.' },
            speakerVoiceOverrides: { type: 'object', description: 'Per-speaker voice id overrides (speaker → voiceId).' },
            ttsModelOverride: { type: 'string', description: 'Override the TTS model for all speakers.' },
            speakerTtsModelOverrides: { type: 'object', description: 'Per-speaker TTS model overrides (speaker → model).' },
            enableSttLoop: { type: 'boolean', description: 'Feed TTS output through STT to close the audio loop; defaults to false.' },
            sttProvider: { type: 'string', enum: ['whisper', 'deepgram', 'groq'], description: 'STT provider for the audio loop; defaults to whisper.' },
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
      const json = await getJson<{ data?: unknown[]; nextCursor?: string; hasMore?: boolean }>(
        inv,
        token,
        `${API}/v1/agents?${params.toString()}`,
        'list_agents',
      )
      return {
        data: { agents: json.data ?? [], nextCursor: json.nextCursor ?? null, hasMore: json.hasMore ?? false },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'get_call') {
      const { id } = inv.args as { id: string }
      const json = await getJson<{ call?: unknown }>(
        inv,
        token,
        `${API}/v1/outbound/${encodeURIComponent(id)}`,
        'get_call',
      )
      return { data: { call: json.call ?? null }, fetchedAt: Date.now() }
    }
    if (inv.capabilityName === 'list_calls') {
      const { agentId, limit } = inv.args as { agentId?: string; limit?: number }
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(1, limit ?? 20), 50)))
      if (agentId) params.set('agentId', agentId)
      const json = await getJson<{ calls?: unknown[] }>(
        inv,
        token,
        `${API}/v1/outbound?${params.toString()}`,
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
      const res = await fetch(`${API}/v1/collections/${encodeURIComponent(collectionId)}/search`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`phony kb_search ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as { results?: unknown[]; queryTokens?: number; graphContext?: unknown }
      return {
        data: {
          results: json.results ?? [],
          queryTokens: json.queryTokens ?? 0,
          ...(json.graphContext !== undefined ? { graphContext: json.graphContext } : {}),
        },
        fetchedAt: Date.now(),
      }
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
      if (args.dryRun !== undefined) payload.dryRun = args.dryRun

      const res = await fetch(`${API}/v1/outbound/start`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`phony start_outbound_call ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        callSid: string | null
        callId: string | null
        status: string
        dryRun?: boolean
        dryRunReport?: unknown
      }
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
      const json = await postJson<Record<string, unknown>>(inv, token, `${API}/v1/agents`, payload, 'create_agent')
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
      const json = await postJson<{ agent?: unknown; collection?: unknown; ingested?: unknown }>(
        inv,
        token,
        `${API}/v1/agents/provision`,
        payload,
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
      const json = await postJson<Record<string, unknown>>(inv, token, `${API}/v1/collections`, payload, 'kb_create_collection')
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
      const json = await postJson<{ documentId?: string; chunksCreated?: number; tokensUsed?: number }>(
        inv,
        token,
        `${API}/v1/collections/${encodeURIComponent(collectionId)}/ingest`,
        payload,
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
    if (inv.capabilityName === 'run_synthetic_test') {
      const { agentId, ...rest } = inv.args as { agentId: string } & Record<string, unknown>
      const payload = pick(rest, SYNTHETIC_FIELDS)
      const json = await postJson<Record<string, unknown>>(
        inv,
        token,
        `${API}/v1/agents/${encodeURIComponent(agentId)}/tests/run-synthetic`,
        payload,
        'run_synthetic_test',
      )
      return {
        status: 'committed',
        data: { run: json },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'run_selfplay_test') {
      const { agentId, ...rest } = inv.args as { agentId: string } & Record<string, unknown>
      const payload = pick(rest, SELFPLAY_FIELDS)
      const json = await postJson<{ testRun?: unknown }>(
        inv,
        token,
        `${API}/v1/agents/${encodeURIComponent(agentId)}/tests/run-selfplay`,
        payload,
        'run_selfplay_test',
      )
      return {
        status: 'committed',
        data: { testRun: json.testRun ?? json },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    throw new Error(`phony: unknown mutation capability ${inv.capabilityName}`)
  },

  async test(source) {
    try {
      const token = bearerToken(source.credentials)
      // GET /v1/outbound?limit=1 is the cheapest authed read that proves the
      // key is valid.
      const res = await fetch(`${API}/v1/outbound?limit=1`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) return { ok: false, reason: 'ph0ny rejected credentials (401) — reconnect required' }
      if (!res.ok) return { ok: false, reason: `ph0ny returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getJson<T>(
  inv: ConnectorInvocation,
  token: string,
  url: string,
  label: string,
): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`phony ${label} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

async function postJson<T>(
  inv: ConnectorInvocation,
  token: string,
  url: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`phony ${label} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
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

const SYNTHETIC_FIELDS = [
  'persona',
  'goal',
  'maxTurns',
  'maxSteps',
  'callerPhone',
  'instanceId',
  'assertions',
  'sessionAssertions',
  'enableJudge',
  'systemPromptOverride',
  'firstMessageOverride',
  'disableRag',
  'questions',
  'expectedAnswers',
  'realism',
] as const

const SELFPLAY_FIELDS = [
  'agentBId',
  'taskA',
  'taskB',
  'participants',
  'maxExchanges',
  'maxSteps',
  'initialSpeaker',
  'callerPhone',
  'instanceIdA',
  'instanceIdB',
  'transportMode',
  'enableTts',
  'overlapMode',
  'bargeInEnabled',
  'bargeInSensitivity',
  'ttsProviderOverride',
  'speakerTtsOverrides',
  'voiceIdOverride',
  'speakerVoiceOverrides',
  'ttsModelOverride',
  'speakerTtsModelOverrides',
  'enableSttLoop',
  'sttProvider',
] as const
