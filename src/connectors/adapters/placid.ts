import { declarativeRestConnector } from './declarative-rest.js'

export const placidConnector = declarativeRestConnector({
  kind: 'placid',
  displayName: 'Placid',
  description: 'Generate dynamic images, PDFs, and videos from templates and data.',
  auth: { kind: 'api-key', hint: 'Placid API key.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.placid.app/api/rest/v1',
  test: { method: 'GET', path: '/templates' },
  capabilities: [
    {
      name: 'images.create',
      class: 'mutation',
      description: 'Create a dynamic image from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template.' },
          data: { type: 'object', description: 'Template variables and their values.' },
          outputDpi: { type: 'integer', description: 'Output DPI (default 72).' },
          outputFilename: { type: 'string', description: 'Custom output filename.' },
        },
        required: ['templateId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/templates/{templateId}/renders',
        body: { data: '{data}', output_dpi: '{outputDpi}', output_filename: '{outputFilename}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'images.get',
      class: 'read',
      description: 'Retrieve an image by ID.',
      parameters: {
        type: 'object',
        properties: {
          imageId: { type: 'string', description: 'The ID of the image to retrieve.' },
        },
        required: ['imageId'],
      },
      request: { method: 'GET', path: '/images/{imageId}' },
    },
    {
      name: 'pdfs.create',
      class: 'mutation',
      description: 'Create a dynamic PDF from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template.' },
          data: { type: 'object', description: 'Template variables and their values.' },
          outputFilename: { type: 'string', description: 'Custom output filename.' },
        },
        required: ['templateId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/templates/{templateId}/renders',
        body: { data: '{data}', output_filename: '{outputFilename}', output_format: 'pdf' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pdfs.get',
      class: 'read',
      description: 'Retrieve a PDF by ID.',
      parameters: {
        type: 'object',
        properties: {
          pdfId: { type: 'string', description: 'The ID of the PDF to retrieve.' },
        },
        required: ['pdfId'],
      },
      request: { method: 'GET', path: '/pdfs/{pdfId}' },
    },
    {
      name: 'videos.create',
      class: 'mutation',
      description: 'Create a dynamic video from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template.' },
          data: { type: 'object', description: 'Template variables and their values.' },
          outputFps: { type: 'integer', description: 'Output frames per second.' },
          outputFilename: { type: 'string', description: 'Custom output filename.' },
        },
        required: ['templateId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/templates/{templateId}/renders',
        body: { data: '{data}', output_fps: '{outputFps}', output_filename: '{outputFilename}', output_format: 'video' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'videos.get',
      class: 'read',
      description: 'Retrieve a video by ID.',
      parameters: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'The ID of the video to retrieve.' },
        },
        required: ['videoId'],
      },
      request: { method: 'GET', path: '/videos/{videoId}' },
    },
    {
      name: 'files.convert',
      class: 'mutation',
      description: 'Convert a file to a shareable URL.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File content or path.' },
          filename: { type: 'string', description: 'Optional custom filename.' },
        },
        required: ['file'],
      },
      request: {
        method: 'POST',
        path: '/files/convert',
        body: { file: '{file}', filename: '{filename}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List available templates.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum number of templates to return.' },
          offset: { type: 'integer', description: 'Pagination offset.' },
        },
      },
      request: { method: 'GET', path: '/templates', query: { limit: '{limit}', offset: '{offset}' } },
    },
  ],
})
