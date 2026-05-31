import { declarativeRestConnector } from './declarative-rest.js'

export const seekTableConnector = declarativeRestConnector({
  kind: 'seek-table',
  displayName: 'SeekTable',
  description: 'Generate and automate reports from SeekTable.',
  auth: { kind: 'api-key', hint: 'SeekTable API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.seektable.com/api',
  test: { method: 'GET', path: '/v1/health' },
  capabilities: [
    {
      name: 'csv.upload',
      class: 'mutation',
      description: 'Upload a CSV file to SeekTable.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string' },
          fileContent: { type: 'string' },
          format: { type: 'string' },
        },
        required: ['fileName', 'fileContent'],
      },
      request: {
        method: 'POST',
        path: '/v1/csv/upload',
        body: { fileName: '{fileName}', fileContent: '{fileContent}', format: '{format}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'report.share.email',
      class: 'mutation',
      description: 'Share a SeekTable report via email.',
      parameters: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
          to: { type: 'string' },
          subject: { type: 'string' },
          message: { type: 'string' },
          includeReportHtml: { type: 'boolean' },
          attachExport: { type: 'string' },
          reportParameters: { type: 'object' },
        },
        required: ['reportId', 'to', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/v1/reports/{reportId}/share/email',
        body: {
          to: '{to}',
          subject: '{subject}',
          message: '{message}',
          includeReportHtml: '{includeReportHtml}',
          attachExport: '{attachExport}',
          reportParameters: '{reportParameters}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
