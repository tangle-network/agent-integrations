import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Descript public API connector.
 *
 * Capability set mirrors the activepieces `@activepieces/piece-descript` piece:
 *   - descript.agent.edit       → POST /agent/jobs        (Underlord prompt run on a project)
 *   - descript.get.job.status   → GET  /agent/jobs/{id}   (read job state + result URL)
 *   - descript.get.project      → GET  /projects/{id}     (single project fetch)
 *   - descript.import.media     → POST /projects/{id}/media (URL-import + optional composition)
 *   - descript.list.projects    → GET  /projects          (filter/sort)
 *   - descript.publish.project  → POST /projects/{id}/publish (export + share)
 *
 * Auth is an API key (Descript "Personal API token" in workspace settings),
 * sent as `Authorization: Bearer <token>` — matched by the piece's
 * `PieceAuth.SecretText` shape.
 */
export const descriptConnector = declarativeRestConnector({
  kind: 'descript',
  displayName: 'Descript',
  description:
    'AI-powered video and podcast editor. Run Underlord edits on a project, import media, list/get projects, and publish.',
  auth: { kind: 'api-key', hint: 'Descript personal API token (workspace settings → API).' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.descript.com/v1',
  test: { method: 'GET', path: '/projects', query: { limit: '1' } },
  capabilities: [
    {
      name: 'projects.list',
      class: 'read',
      description:
        'List projects in the workspace, optionally filtered by name, creator, and created/updated date range.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Substring filter on project name (case-insensitive).' },
          created_by: { type: 'string', description: 'Filter by creator user ID, or "me".' },
          sort: {
            type: 'string',
            enum: ['name', 'created_at', 'updated_at'],
            description: 'Field to sort results by.',
          },
          direction: { type: 'string', enum: ['asc', 'desc'] },
          created_after: { type: 'string', description: 'ISO 8601 lower bound on created_at.' },
          created_before: { type: 'string', description: 'ISO 8601 upper bound on created_at.' },
          updated_after: { type: 'string', description: 'ISO 8601 lower bound on updated_at.' },
          updated_before: { type: 'string', description: 'ISO 8601 upper bound on updated_at.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/projects',
        query: {
          name: '{name}',
          created_by: '{created_by}',
          sort: '{sort}',
          direction: '{direction}',
          created_after: '{created_after}',
          created_before: '{created_before}',
          updated_after: '{updated_after}',
          updated_before: '{updated_before}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Fetch a single project by ID, including composition list and Drive folder.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
      },
      request: { method: 'GET', path: '/projects/{project_id}' },
    },
    {
      name: 'jobs.get',
      class: 'read',
      description:
        'Get the status of an Underlord/agent job. Returns state (queued|running|succeeded|failed) plus result payload on success.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/agent/jobs/{job_id}' },
    },
    {
      name: 'agent.edit',
      class: 'mutation',
      description:
        'Submit a natural-language Underlord edit job against an existing project, or create a new project first and edit it. Returns a job_id to poll via jobs.get.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['existing', 'new'],
            description: 'Edit an existing project or create a brand-new one before editing.',
          },
          project_id: {
            type: 'string',
            description: 'Required when mode = "existing".',
          },
          project_name: {
            type: 'string',
            description: 'Name for the new project when mode = "new".',
          },
          team_access: {
            type: 'string',
            enum: ['view', 'comment', 'edit'],
            description: 'Team access level for the newly created project (mode = "new" only).',
          },
          folder_name: {
            type: 'string',
            description: 'Drive folder path for the new project (mode = "new" only).',
          },
          prompt: {
            type: 'string',
            description: 'Natural-language instruction for Underlord (e.g. "Remove filler words and silences").',
          },
          model: {
            type: 'string',
            description: 'Optional Underlord model override. Blank uses the Descript default.',
          },
          callback_url: {
            type: 'string',
            format: 'uri',
            description: 'Optional webhook; Descript POSTs job status here on completion/failure.',
          },
        },
        required: ['mode', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/agent/jobs',
        body: {
          mode: '{mode}',
          project_id: '{project_id}',
          project_name: '{project_name}',
          team_access: '{team_access}',
          folder_name: '{folder_name}',
          prompt: '{prompt}',
          model: '{model}',
          callback_url: '{callback_url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'media.import',
      class: 'mutation',
      description:
        'Import media (video/audio) into a project by URL. Descript fetches the URL server-side, transcribes in the given language, and optionally creates a composition on the timeline.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          media_name: { type: 'string', description: 'Display name for the media file.' },
          media_url: {
            type: 'string',
            format: 'uri',
            description: 'Public URL of the media; must support HTTP Range and stay live ~12–48h.',
          },
          language: {
            type: 'string',
            description: 'ISO 639-1 transcription language (e.g. "en", "es"). Defaults to workspace setting.',
          },
          composition_name: {
            type: 'string',
            description: 'If set, create a composition (timeline) with this name from the imported media.',
          },
          composition_width: {
            type: 'integer',
            description: 'Composition width in pixels. Defaults to 1920. Used only with composition_name.',
          },
          composition_height: {
            type: 'integer',
            description: 'Composition height in pixels. Defaults to 1080. Used only with composition_name.',
          },
        },
        required: ['project_id', 'media_name', 'media_url'],
      },
      request: {
        method: 'POST',
        path: '/projects/{project_id}/media',
        body: {
          name: '{media_name}',
          url: '{media_url}',
          language: '{language}',
          composition: {
            name: '{composition_name}',
            width: '{composition_width}',
            height: '{composition_height}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.delete',
      class: 'mutation',
      description: 'Delete a Descript project by ID. Removes the project, its compositions, and any imported media.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
      },
      request: {
        method: 'DELETE',
        path: '/projects/{project_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'project.publish',
      class: 'mutation',
      description:
        'Export a project as video or audio and publish it as a Descript share page. Returns the share URL and export job_id.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          media_type: { type: 'string', enum: ['video', 'audio'], description: 'Export format.' },
          resolution: {
            type: 'string',
            enum: ['480p', '720p', '1080p', '1440p', '2160p'],
            description: 'Video resolution. Ignored when media_type = "audio".',
          },
          access_level: {
            type: 'string',
            enum: ['public', 'workspace', 'invite_only'],
            description: 'Who can view the share page. Blank inherits Drive default.',
          },
        },
        required: ['project_id', 'media_type'],
      },
      request: {
        method: 'POST',
        path: '/projects/{project_id}/publish',
        body: {
          media_type: '{media_type}',
          resolution: '{resolution}',
          access_level: '{access_level}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
