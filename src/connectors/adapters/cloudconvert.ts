import { declarativeRestConnector } from './declarative-rest.js'

// CloudConvert's v2 REST API is built around two long-lived resources: `tasks`
// (a single conversion / capture / merge / optimize / archive operation) and
// `jobs` (a DAG of tasks plus import/export endpoints). The convenience routes
// under `/v2/convert`, `/v2/capture-website`, `/v2/merge`, `/v2/optimize`, and
// `/v2/archive` create a one-task job per call, which is the natural match for
// the activepieces action set. `tasks/{id}` is polled for completion and
// exposes signed download URLs on the export-url task.
export const cloudconvertConnector = declarativeRestConnector({
  kind: 'cloudconvert',
  displayName: 'CloudConvert',
  description: 'File conversion and processing platform supporting 200+ formats — convert, capture, merge, optimize, and archive files.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://cloudconvert.com/oauth/authorize',
    tokenUrl: 'https://cloudconvert.com/oauth/token',
    scopes: ['user.read', 'user.write', 'task.read', 'task.write'],
    clientIdEnv: 'CLOUDCONVERT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CLOUDCONVERT_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cloudconvert.com',
  test: { method: 'GET', path: '/v2/users/me' },
  capabilities: [
    {
      name: 'convert.file',
      class: 'mutation',
      description: 'Convert a file from one format to another. Creates a job containing an import/url, convert, and export/url task chain.',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Source URL or task id whose output to consume.' },
          input_format: { type: 'string', description: 'Source format (e.g. "docx", "png"). Auto-detected when omitted.' },
          output_format: { type: 'string', description: 'Target format (e.g. "pdf", "jpg").' },
          filename: { type: 'string', description: 'Output filename (without path).' },
          engine: { type: 'string', description: 'Specific conversion engine, e.g. "office", "imagemagick".' },
          engine_version: { type: 'string' },
          options: { type: 'object', description: 'Engine-specific options (quality, dpi, page_range, etc.).' },
        },
        required: ['input', 'output_format'],
      },
      request: {
        method: 'POST',
        path: '/v2/convert',
        body: {
          input: '{input}',
          input_format: '{input_format}',
          output_format: '{output_format}',
          filename: '{filename}',
          engine: '{engine}',
          engine_version: '{engine_version}',
          options: '{options}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['task.write'],
    },
    {
      name: 'capture.website',
      class: 'mutation',
      description: 'Capture a website as PDF, PNG, or JPG by rendering the URL in CloudConvert\'s headless browser.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Fully-qualified URL to capture.' },
          output_format: { type: 'string', enum: ['pdf', 'png', 'jpg'] },
          filename: { type: 'string' },
          pages: { type: 'string', description: 'Page range for PDF output (e.g. "1-3").' },
          zoom: { type: 'number' },
          page_width: { type: 'number' },
          page_height: { type: 'number' },
          margin_top: { type: 'number' },
          margin_bottom: { type: 'number' },
          margin_left: { type: 'number' },
          margin_right: { type: 'number' },
          print_background: { type: 'boolean' },
          display_header_footer: { type: 'boolean' },
          wait_until: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'] },
          wait_for_element: { type: 'string', description: 'CSS selector to wait for before capturing.' },
          wait_time: { type: 'integer', description: 'Additional delay in ms after page load.' },
        },
        required: ['url', 'output_format'],
      },
      request: {
        method: 'POST',
        path: '/v2/capture-website',
        body: {
          url: '{url}',
          output_format: '{output_format}',
          filename: '{filename}',
          pages: '{pages}',
          zoom: '{zoom}',
          page_width: '{page_width}',
          page_height: '{page_height}',
          margin_top: '{margin_top}',
          margin_bottom: '{margin_bottom}',
          margin_left: '{margin_left}',
          margin_right: '{margin_right}',
          print_background: '{print_background}',
          display_header_footer: '{display_header_footer}',
          wait_until: '{wait_until}',
          wait_for_element: '{wait_for_element}',
          wait_time: '{wait_time}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['task.write'],
    },
    {
      name: 'merge.pdf',
      class: 'mutation',
      description: 'Merge multiple input PDFs into a single output PDF, preserving page order.',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'array', items: { type: 'string' }, description: 'Array of source URLs or task ids to merge.' },
          output_format: { type: 'string', enum: ['pdf'], default: 'pdf' },
          filename: { type: 'string' },
          engine: { type: 'string' },
        },
        required: ['input'],
      },
      request: {
        method: 'POST',
        path: '/v2/merge',
        body: {
          input: '{input}',
          output_format: '{output_format}',
          filename: '{filename}',
          engine: '{engine}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['task.write'],
    },
    {
      name: 'download.file',
      class: 'read',
      description: 'Read a task by id to obtain its status and, for export tasks, the signed download URL(s) under result.files.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task id (typically the export/url task on a finished job).' },
          include: { type: 'string', description: 'Comma-separated relations to expand (e.g. "job,depends_on_tasks").' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/v2/tasks/{taskId}',
        query: { include: '{include}' },
      },
      requiredScopes: ['task.read'],
    },
    {
      name: 'archive.file',
      class: 'mutation',
      description: 'Archive (delete) a task. CloudConvert retains task results for 24h by default; this removes them and any associated stored file early.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: { method: 'DELETE', path: '/v2/tasks/{taskId}' },
      cas: 'native-idempotency',
      requiredScopes: ['task.write'],
    },
    {
      name: 'optimize.file',
      class: 'mutation',
      description: 'Optimize a PDF or image to reduce file size while preserving acceptable quality. Engine and profile choose the trade-off.',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Source URL or task id whose output to optimize.' },
          input_format: { type: 'string' },
          output_format: { type: 'string', description: 'Target format. Defaults to input_format.' },
          filename: { type: 'string' },
          engine: { type: 'string' },
          engine_version: { type: 'string' },
          profile: { type: 'string', description: 'Optimization profile (e.g. "web", "print", "archive", "max").' },
          options: { type: 'object' },
        },
        required: ['input'],
      },
      request: {
        method: 'POST',
        path: '/v2/optimize',
        body: {
          input: '{input}',
          input_format: '{input_format}',
          output_format: '{output_format}',
          filename: '{filename}',
          engine: '{engine}',
          engine_version: '{engine_version}',
          profile: '{profile}',
          options: '{options}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['task.write'],
    },
    // Job listing supports the triggers (new.job, job.finished, job.failed) on
    // the polling side: a worker filters by status to drive trigger fan-out.
    {
      name: 'jobs.list',
      class: 'read',
      description: 'List jobs filtered by status — backs the new.job / job.finished / job.failed triggers via polling.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['waiting', 'processing', 'finished', 'error'] },
          tag: { type: 'string', description: 'Filter by user-supplied job tag.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/jobs',
        query: {
          'filter[status]': '{status}',
          'filter[tag]': '{tag}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['task.read'],
    },
    {
      name: 'jobs.get',
      class: 'read',
      description: 'Read a single job by id with its task graph, status, and any error payload.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          include: { type: 'string', description: 'Comma-separated relations to expand (e.g. "tasks,tasks.depends_on_tasks").' },
        },
        required: ['jobId'],
      },
      request: {
        method: 'GET',
        path: '/v2/jobs/{jobId}',
        query: { include: '{include}' },
      },
      requiredScopes: ['task.read'],
    },
  ],
})
