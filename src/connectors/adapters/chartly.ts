import { declarativeRestConnector } from './declarative-rest.js'

export const chartlyConnector = declarativeRestConnector({
  kind: 'chartly',
  displayName: 'Chartly',
  description:
    'Generate cached chart images (PNG or SVG) from Chart.js configurations via the Chartly REST API.',
  auth: { kind: 'api-key', hint: 'Chartly API key, sent as a bearer token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chartly.dev/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'create.chart',
      class: 'mutation',
      description:
        'Create a chart image from a Chart.js configuration. Returns the cached image URL and metadata.',
      parameters: {
        type: 'object',
        properties: {
          chart_type: {
            type: 'string',
            description: 'Chart.js chart type (bar, line, pie, doughnut, radar, polarArea, scatter, bubble).',
          },
          chart_title: { type: 'string', description: 'Optional title rendered on the chart.' },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels for the data points (e.g., ["Jan", "Feb", "Mar"]).',
          },
          dataset_label: { type: 'string', description: 'Label for the data series.' },
          data_values: {
            type: 'array',
            items: { type: 'number' },
            description: 'Numeric values for the chart (e.g., [10, 20, 30]).',
          },
          background_color: {
            type: 'string',
            description: 'Background color for data points (e.g., "#4285F4" or "rgba(66,133,244,0.6)").',
          },
          width: { type: 'integer', minimum: 1, maximum: 2000, description: 'Image width in pixels.' },
          height: { type: 'integer', minimum: 1, maximum: 2000, description: 'Image height in pixels.' },
          format: { type: 'string', enum: ['png', 'svg'], description: 'Output image format.' },
          background_color_image: {
            type: 'string',
            description: 'Background color for the whole image (e.g., "#ffffff").',
          },
          advanced_config: {
            type: 'object',
            description: 'Complete Chart.js configuration; overrides the high-level fields above when set.',
          },
          chart_id: {
            type: 'string',
            description: 'Optional client-supplied identifier used for caching and later retrieval.',
          },
        },
        required: ['chart_type', 'labels', 'dataset_label', 'data_values', 'width', 'height', 'format'],
      },
      request: {
        method: 'POST',
        path: '/charts',
        body: {
          chart_type: '{chart_type}',
          chart_title: '{chart_title}',
          labels: '{labels}',
          dataset_label: '{dataset_label}',
          data_values: '{data_values}',
          background_color: '{background_color}',
          width: '{width}',
          height: '{height}',
          format: '{format}',
          background_color_image: '{background_color_image}',
          advanced_config: '{advanced_config}',
          chart_id: '{chart_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.chart',
      class: 'read',
      description: 'Fetch a previously generated chart image by its identifier.',
      parameters: {
        type: 'object',
        properties: {
          chart_id: { type: 'string', description: 'Identifier returned (or supplied) when the chart was created.' },
          format: {
            type: 'string',
            enum: ['png', 'svg'],
            description: 'Optional output format override; defaults to the format used at creation.',
          },
        },
        required: ['chart_id'],
      },
      request: {
        method: 'GET',
        path: '/charts/{chart_id}',
        query: { format: '{format}' },
      },
    },
  ],
})
