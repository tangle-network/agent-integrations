import { declarativeRestConnector } from './declarative-rest.js'

/**
 * AssemblyAI connector — speech-to-text, audio intelligence, and LeMUR LLM
 * operations over a stored transcript.
 *
 * Authentication: workspace API key delivered in the `Authorization` header
 * verbatim (no `Bearer` prefix — AssemblyAI's API accepts the raw key). The
 * declarative-rest engine's header placement with an empty prefix matches
 * the vendor's documented contract.
 *
 * Endpoint surface: transcript submit + poll + list + delete, paragraph and
 * sentence views over a finished transcript, subtitle export (SRT/VTT), word
 * search, redacted-audio retrieval, and the LeMUR generation endpoints
 * (summary, Q&A, action items, free-form task) keyed by transcript ids.
 *
 * Multipart audio UPLOAD against POST /v2/upload is intentionally not declared
 * here — the declarative-rest engine JSON-encodes bodies and would corrupt a
 * raw binary payload. Callers should either pass a public `audio_url` to
 * `transcripts.submit` or use a bespoke upload adapter.
 */
export const assemblyaiConnector = declarativeRestConnector({
  kind: 'assemblyai',
  displayName: 'AssemblyAI',
  description:
    'Transcribe audio, run speech intelligence (speaker labels, sentiment, content safety, entity detection), export subtitles, and run LeMUR LLM tasks over finished transcripts.',
  auth: {
    kind: 'api-key',
    hint: 'AssemblyAI workspace API key. Create one at https://www.assemblyai.com/app/account.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.assemblyai.com',
  // AssemblyAI accepts the API key in the Authorization header verbatim —
  // no Bearer prefix. Empty prefix on a header placement gives that shape.
  credentialPlacement: { kind: 'header', header: 'authorization', prefix: '' },
  // Listing transcripts is the cheapest authenticated probe — no model spin,
  // no LeMUR cost, and a 401/403 surfaces credential issues immediately.
  test: { method: 'GET', path: '/v2/transcript', query: { limit: '1' } },
  capabilities: [
    {
      name: 'transcripts.submit',
      class: 'mutation',
      description:
        'Queue a new transcription job. Pass `audio_url` (publicly reachable HTTPS) plus any AssemblyAI feature flags (speaker_labels, sentiment_analysis, content_safety, entity_detection, iab_categories, auto_chapters, summarization, language_code, etc.). Returns a transcript id the caller polls via transcripts.get.',
      parameters: {
        type: 'object',
        properties: {
          audio_url: {
            type: 'string',
            description: 'Publicly reachable HTTPS URL to the audio or video file.',
          },
          language_code: { type: 'string' },
          language_detection: { type: 'boolean' },
          punctuate: { type: 'boolean' },
          format_text: { type: 'boolean' },
          dual_channel: { type: 'boolean' },
          speech_model: { type: 'string', description: 'best | nano' },
          speaker_labels: { type: 'boolean' },
          speakers_expected: { type: 'integer', minimum: 1 },
          sentiment_analysis: { type: 'boolean' },
          content_safety: { type: 'boolean' },
          iab_categories: { type: 'boolean' },
          entity_detection: { type: 'boolean' },
          auto_chapters: { type: 'boolean' },
          summarization: { type: 'boolean' },
          summary_model: { type: 'string' },
          summary_type: { type: 'string' },
          auto_highlights: { type: 'boolean' },
          redact_pii: { type: 'boolean' },
          redact_pii_audio: { type: 'boolean' },
          redact_pii_policies: { type: 'array', items: { type: 'string' } },
          redact_pii_sub: { type: 'string' },
          filter_profanity: { type: 'boolean' },
          disfluencies: { type: 'boolean' },
          boost_param: { type: 'string' },
          word_boost: { type: 'array', items: { type: 'string' } },
          custom_spelling: { type: 'array', items: { type: 'object' } },
          webhook_url: { type: 'string' },
          webhook_auth_header_name: { type: 'string' },
          webhook_auth_header_value: { type: 'string' },
        },
        required: ['audio_url'],
      },
      request: {
        method: 'POST',
        path: '/v2/transcript',
        body: 'args',
      },
      // AssemblyAI assigns a fresh transcript id per POST — replay creates a
      // new (and billed) job. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'transcripts.get',
      class: 'read',
      description:
        'Fetch a transcript by id. The `status` field cycles queued → processing → completed | error; callers poll until it leaves processing.',
      parameters: {
        type: 'object',
        properties: { transcript_id: { type: 'string' } },
        required: ['transcript_id'],
      },
      request: { method: 'GET', path: '/v2/transcript/{transcript_id}' },
    },
    {
      name: 'transcripts.list',
      class: 'read',
      description:
        'List transcripts in the workspace, newest first. Pagination uses the `before_id` / `after_id` cursors AssemblyAI returns in `page_details`.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          status: {
            type: 'string',
            description: 'Filter to queued | processing | completed | error.',
          },
          created_on: { type: 'string', description: 'YYYY-MM-DD' },
          before_id: { type: 'string' },
          after_id: { type: 'string' },
          throttled_only: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/transcript',
        query: {
          limit: '{limit}',
          status: '{status}',
          created_on: '{created_on}',
          before_id: '{before_id}',
          after_id: '{after_id}',
          throttled_only: '{throttled_only}',
        },
      },
    },
    {
      name: 'transcripts.delete',
      class: 'mutation',
      description:
        'Delete a transcript and its derived artifacts. Useful for honouring data-retention requests; the underlying audio remains untouched.',
      parameters: {
        type: 'object',
        properties: { transcript_id: { type: 'string' } },
        required: ['transcript_id'],
      },
      request: { method: 'DELETE', path: '/v2/transcript/{transcript_id}' },
      // Re-deleting an already-deleted transcript returns the same terminal
      // shape; safe to retry.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transcripts.paragraphs',
      class: 'read',
      description: 'Return paragraph-segmented view of a finished transcript with per-paragraph timestamps.',
      parameters: {
        type: 'object',
        properties: { transcript_id: { type: 'string' } },
        required: ['transcript_id'],
      },
      request: { method: 'GET', path: '/v2/transcript/{transcript_id}/paragraphs' },
    },
    {
      name: 'transcripts.sentences',
      class: 'read',
      description: 'Return sentence-segmented view of a finished transcript with per-sentence timestamps.',
      parameters: {
        type: 'object',
        properties: { transcript_id: { type: 'string' } },
        required: ['transcript_id'],
      },
      request: { method: 'GET', path: '/v2/transcript/{transcript_id}/sentences' },
    },
    {
      name: 'transcripts.subtitles',
      class: 'read',
      description:
        'Export subtitles for a finished transcript. Format must be `srt` or `vtt`. `chars_per_caption` caps caption width.',
      parameters: {
        type: 'object',
        properties: {
          transcript_id: { type: 'string' },
          format: { type: 'string', description: 'srt | vtt' },
          chars_per_caption: { type: 'integer', minimum: 1 },
        },
        required: ['transcript_id', 'format'],
      },
      request: {
        method: 'GET',
        path: '/v2/transcript/{transcript_id}/{format}',
        query: { chars_per_caption: '{chars_per_caption}' },
      },
    },
    {
      name: 'transcripts.word_search',
      class: 'read',
      description: 'Search a finished transcript for one or more words and return their match counts and timestamps.',
      parameters: {
        type: 'object',
        properties: {
          transcript_id: { type: 'string' },
          words: {
            type: 'array',
            description: 'Keywords to search for in the transcript.',
            items: { type: 'string' },
          },
        },
        required: ['transcript_id', 'words'],
      },
      request: {
        method: 'GET',
        path: '/v2/transcript/{transcript_id}/word-search',
        query: { words: '{words}' },
      },
    },
    {
      name: 'transcripts.redacted_audio',
      class: 'read',
      description:
        'Fetch the URL of the PII-redacted audio file for a transcript submitted with `redact_pii_audio: true`. Returns `status` and `redacted_audio_url`.',
      parameters: {
        type: 'object',
        properties: { transcript_id: { type: 'string' } },
        required: ['transcript_id'],
      },
      request: { method: 'GET', path: '/v2/transcript/{transcript_id}/redacted-audio' },
    },
    {
      name: 'lemur.summary',
      class: 'mutation',
      description:
        'Run LeMUR summary over one or more finished transcripts. Returns a summary string and the LeMUR request_id.',
      parameters: {
        type: 'object',
        properties: {
          transcript_ids: { type: 'array', items: { type: 'string' } },
          context: { description: 'Optional string or object describing the audio context.' },
          final_model: { type: 'string', description: 'default | basic | anthropic/claude-3-5-sonnet | anthropic/claude-3-haiku | anthropic/claude-3-opus' },
          max_output_size: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
          answer_format: { type: 'string' },
        },
        required: ['transcript_ids'],
      },
      request: {
        method: 'POST',
        path: '/lemur/v3/generate/summary',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'lemur.question_answer',
      class: 'mutation',
      description:
        'Ask LeMUR one or more structured questions about a set of finished transcripts. Each question carries its own `question`, optional `context`, and answer schema hints.',
      parameters: {
        type: 'object',
        properties: {
          transcript_ids: { type: 'array', items: { type: 'string' } },
          questions: {
            type: 'array',
            description: 'List of { question, context?, answer_format?, answer_options? } objects.',
            items: { type: 'object' },
          },
          context: {},
          final_model: { type: 'string' },
          max_output_size: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['transcript_ids', 'questions'],
      },
      request: {
        method: 'POST',
        path: '/lemur/v3/generate/question-answer',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'lemur.action_items',
      class: 'mutation',
      description: 'Extract action items from one or more finished transcripts via LeMUR.',
      parameters: {
        type: 'object',
        properties: {
          transcript_ids: { type: 'array', items: { type: 'string' } },
          context: {},
          final_model: { type: 'string' },
          max_output_size: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
          answer_format: { type: 'string' },
        },
        required: ['transcript_ids'],
      },
      request: {
        method: 'POST',
        path: '/lemur/v3/generate/action-items',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'lemur.task',
      class: 'mutation',
      description:
        'Run a free-form LeMUR prompt over one or more finished transcripts. The `prompt` parameter is the natural-language instruction.',
      parameters: {
        type: 'object',
        properties: {
          transcript_ids: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          context: {},
          final_model: { type: 'string' },
          max_output_size: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['transcript_ids', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/lemur/v3/generate/task',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'lemur.response',
      class: 'read',
      description: 'Retrieve a previously-generated LeMUR response by its request_id.',
      parameters: {
        type: 'object',
        properties: { request_id: { type: 'string' } },
        required: ['request_id'],
      },
      request: { method: 'GET', path: '/lemur/v3/{request_id}' },
    },
    {
      name: 'lemur.purge',
      class: 'mutation',
      description:
        'Purge a stored LeMUR request and its response, deleting the prompt + completion from AssemblyAI retention.',
      parameters: {
        type: 'object',
        properties: { request_id: { type: 'string' } },
        required: ['request_id'],
      },
      request: { method: 'DELETE', path: '/lemur/v3/{request_id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
