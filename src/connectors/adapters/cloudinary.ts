import { declarativeRestConnector } from './declarative-rest.js'

export const cloudinaryConnector = declarativeRestConnector({
  kind: 'cloudinary',
  displayName: 'Cloudinary',
  description:
    'Upload, transform, query, and delete media assets in the Cloudinary cloud-based image and video management platform.',
  auth: {
    kind: 'api-key',
    hint: 'Cloudinary API key/secret pair scoped to a cloud_name (Basic auth against api.cloudinary.com).',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'cloudName', fallback: 'https://api.cloudinary.com/v1_1' },
  test: { method: 'GET', path: '/resources/image' },
  capabilities: [
    {
      name: 'upload.resource',
      class: 'mutation',
      description:
        'Upload a file (image, video, or raw asset) to Cloudinary. Maps to the Cloudinary upload endpoint.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Local path, remote URL, or base64 data URI of the asset to upload.' },
          public_id: { type: 'string', description: 'Optional public ID to assign to the uploaded asset.' },
          folder: { type: 'string', description: 'Cloudinary folder to upload into.' },
          tags: { type: 'string', description: 'Comma-separated tags to attach to the uploaded asset.' },
          resource_type: {
            type: 'string',
            enum: ['image', 'video', 'raw', 'auto'],
            description: 'Asset class. Defaults to image.',
          },
          overwrite: { type: 'boolean', description: 'Overwrite an existing asset at the same public_id.' },
        },
        required: ['file'],
      },
      request: {
        method: 'POST',
        path: '/{resource_type}/upload',
        body: {
          file: '{file}',
          public_id: '{public_id}',
          folder: '{folder}',
          tags: '{tags}',
          overwrite: '{overwrite}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'delete.resource',
      class: 'mutation',
      description:
        'Delete Cloudinary assets by explicit public IDs, by tag, or by prefix. Destructive — affected derived assets are also dropped unless keep_original is set.',
      parameters: {
        type: 'object',
        properties: {
          deletion_mode: {
            type: 'string',
            enum: ['public_ids', 'tag', 'prefix', 'all'],
            description: 'Strategy used to select assets for deletion.',
          },
          public_ids_manual: {
            type: 'string',
            description: 'Comma-separated public IDs (up to 100) when deletion_mode=public_ids.',
          },
          tag_manual: { type: 'string', description: 'Tag name when deletion_mode=tag (deletes up to 1000 assets).' },
          prefix: {
            type: 'string',
            description: 'Public-ID prefix when deletion_mode=prefix (deletes up to 1000 assets).',
          },
          resource_type: {
            type: 'string',
            enum: ['image', 'video', 'raw'],
            description: 'Asset class to target. Defaults to image.',
          },
          type: {
            type: 'string',
            enum: ['upload', 'private', 'authenticated'],
            description: 'Delivery type of the assets to delete.',
          },
          keep_original: { type: 'boolean', description: 'Delete only derived assets, keep the original.' },
          invalidate: {
            type: 'boolean',
            description: 'Invalidate CDN cached copies after deletion (takes a few minutes to propagate).',
          },
        },
        required: ['deletion_mode'],
      },
      request: {
        method: 'DELETE',
        path: '/resources/{resource_type}/{type}',
        query: {
          'public_ids[]': '{public_ids_manual}',
          tag: '{tag_manual}',
          prefix: '{prefix}',
          keep_original: '{keep_original}',
          invalidate: '{invalidate}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'create.usage.report',
      class: 'mutation',
      description:
        'Generate a Cloudinary account usage report for a given date. Returns aggregate counters plus an optional per-transformation breakdown.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Report date in DD-MM-YYYY format. Must be within the last 3 months. Omit for the current date.',
          },
          include_breakdown: {
            type: 'boolean',
            description: 'Include the detailed breakdown of transformation types and add-on usage.',
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/usage/{date}',
        query: { include_breakdown: '{include_breakdown}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'find.resource.by.public.id',
      class: 'read',
      description: 'Look up a Cloudinary asset by its public ID and return its full metadata (size, format, URLs, tags).',
      parameters: {
        type: 'object',
        properties: {
          public_id_manual: { type: 'string', description: 'The asset public ID to look up.' },
          resource_type: {
            type: 'string',
            enum: ['image', 'video', 'raw'],
            description: 'Asset class. Defaults to image.',
          },
          delivery_type: {
            type: 'string',
            enum: ['upload', 'private', 'authenticated', 'fetch'],
            description: 'Delivery type of the asset.',
          },
        },
        required: ['public_id_manual'],
      },
      request: {
        method: 'GET',
        path: '/resources/{resource_type}/{delivery_type}/{public_id_manual}',
      },
    },
    {
      name: 'transform.resource',
      class: 'mutation',
      description:
        'Apply a transformation (resize, crop, format conversion, quality, border, rotation, opacity, raw chain) to an existing Cloudinary asset. Set generate_url_only=true to skip eager generation and only return the derived URL.',
      parameters: {
        type: 'object',
        properties: {
          public_id_manual: { type: 'string', description: 'Source asset public ID.' },
          resource_type: {
            type: 'string',
            enum: ['image', 'video'],
            description: 'Source asset class. Defaults to image.',
          },
          delivery_type: {
            type: 'string',
            enum: ['upload', 'private', 'authenticated', 'fetch'],
            description: 'Delivery type of the source asset.',
          },
          width: { type: 'number', description: 'Target width in pixels.' },
          height: { type: 'number', description: 'Target height in pixels.' },
          crop_mode: {
            type: 'string',
            enum: ['scale', 'fit', 'fill', 'limit', 'thumb', 'crop', 'pad'],
            description: 'How to handle resizing when aspect ratios differ.',
          },
          gravity: { type: 'string', description: 'Which part of the asset to focus on when cropping.' },
          format: {
            type: 'string',
            enum: ['jpg', 'png', 'webp', 'avif', 'gif', 'auto'],
            description: 'Output format.',
          },
          quality: { type: 'string', description: 'Image quality / compression level.' },
          border: { type: 'string', description: 'Border specification (e.g. "5px_solid_red").' },
          radius: { type: 'string', description: 'Corner radius — number, list, or "max" for a circle.' },
          opacity: {
            type: 'number',
            description: 'Transparency level (0–100, where 100 is fully opaque).',
          },
          rotation: { type: 'number', description: 'Rotation in degrees (0–360).' },
          raw_transformation: {
            type: 'string',
            description: 'Advanced: raw Cloudinary transformation string applied verbatim.',
          },
          generate_url_only: {
            type: 'boolean',
            description: 'If true, only return the derived URL without forcing eager generation.',
          },
        },
        required: ['public_id_manual'],
      },
      request: {
        method: 'POST',
        path: '/{resource_type}/explicit',
        body: {
          public_id: '{public_id_manual}',
          type: '{delivery_type}',
          eager: '{raw_transformation}',
          width: '{width}',
          height: '{height}',
          crop: '{crop_mode}',
          gravity: '{gravity}',
          format: '{format}',
          quality: '{quality}',
          border: '{border}',
          radius: '{radius}',
          opacity: '{opacity}',
          angle: '{rotation}',
          eager_async: '{generate_url_only}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
