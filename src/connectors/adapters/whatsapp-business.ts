/**
 * WhatsApp Business connector — Meta Graph API messaging surface.
 *
 *   send_text_message(to, body, previewUrl?)         → mutation; cas: 'none'
 *   send_template_message(to, template, language)    → mutation; cas: 'none'
 *   list_message_templates(limit?, status?)          → read
 *   get_business_phone_number()                      → read
 *
 * Why `cas: 'none'` on sends:
 * WhatsApp Business outbound messages are append-only and Meta does not
 * expose a server-side idempotency key on /messages. MutationGuard's
 * idempotency-key short-circuit (one level above the connector) is the
 * dedup. We pin `defaultConsistencyModel: 'advisory'` to keep the
 * validator happy — chat outbound is informational, not transactional.
 *
 * Auth: Facebook Login for Business (OAuth2). The OAuth response returns
 * a `User Access Token`; the app then exchanges it via /debug_token for
 * a long-lived (~60d) Business Token. We store the long-lived token as
 * `accessToken`; no refresh_token because Meta does not issue one for
 * business tokens — re-authorization is the recovery path.
 *
 * DataSource metadata (NOT secret, set at connect-time):
 *   - phoneNumberId : the WABA-scoped Phone Number ID Meta assigned to
 *     this connection (required for /messages calls).
 *   - wabaId        : the WhatsApp Business Account ID (required for
 *     /message_templates calls).
 *
 * Both come from the Embedded Signup callback; the operator wires them
 * before invokeAction is ever called.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode } from '../oauth.js'

const SCOPES = ['whatsapp_business_messaging', 'whatsapp_business_management', 'business_management']
const AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth'
const TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token'
const API = 'https://graph.facebook.com/v21.0'

export interface WhatsappBusinessOptions {
  clientId: string
  clientSecret: string
}

export function whatsappBusiness(opts: WhatsappBusinessOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'whatsapp-business',
      displayName: 'WhatsApp Business',
      description:
        'Send text and template messages from a verified WhatsApp Business number, and read your approved message templates. Advisory surface — WhatsApp sends are append-only.',
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'WHATSAPP_BUSINESS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'WHATSAPP_BUSINESS_OAUTH_CLIENT_SECRET',
      },
      category: 'comms',
      defaultConsistencyModel: 'advisory',
      capabilities: [
        {
          name: 'send_text_message',
          class: 'mutation',
          description: 'Send a free-form text message from the connected WABA number. Outside the 24h customer-service window, Meta will reject — use send_template_message instead.',
          cas: 'none',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_messaging'],
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'E.164 destination, e.g. +14155551212.' },
              body: { type: 'string', description: 'Message body (≤4096 chars).' },
              previewUrl: { type: 'boolean', description: 'Render a link preview if body contains a URL.', default: false },
            },
            required: ['to', 'body'],
          },
        },
        {
          name: 'send_template_message',
          class: 'mutation',
          description: 'Send a pre-approved Meta message template. Required for outbound contact outside the 24h customer-service window.',
          cas: 'none',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_messaging'],
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'E.164 destination.' },
              template: { type: 'string', description: 'Name of the approved template.' },
              language: { type: 'string', description: 'BCP-47 language code, e.g. en_US.', default: 'en_US' },
              components: {
                type: 'array',
                description: 'Optional Meta template components array (header/body/button parameter substitutions).',
              },
            },
            required: ['to', 'template'],
          },
        },
        {
          name: 'list_message_templates',
          class: 'read',
          description: 'List approved message templates for the connected WhatsApp Business Account.',
          requiredScopes: ['whatsapp_business_management'],
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              status: { type: 'string', description: 'Optional filter by template status (APPROVED, PENDING, REJECTED).' },
            },
          },
        },
        {
          name: 'get_business_phone_number',
          class: 'read',
          description: 'Return the verified display name, quality rating, and verification status of the connected phone number.',
          requiredScopes: ['whatsapp_business_management'],
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'media.upload',
          class: 'mutation',
          description: 'Upload media (image, audio, video, document) to the connected phone number for later use as a message attachment. Returns the Meta media ID.',
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_messaging'],
          parameters: {
            type: 'object',
            properties: {
              dataBase64: { type: 'string', description: 'Raw media bytes, base64-encoded.' },
              mimeType: { type: 'string', description: 'MIME type of the media, e.g. image/jpeg, audio/ogg.' },
              filename: { type: 'string', description: 'Optional filename hint (recommended for documents).' },
            },
            required: ['dataBase64', 'mimeType'],
          },
        },
        {
          name: 'templates.create',
          class: 'mutation',
          description: 'Submit a new message template for Meta approval. Components follow the Cloud API message_templates schema.',
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_management'],
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Template name (lowercase, snake_case, ≤512 chars).' },
              language: { type: 'string', description: 'BCP-47 language code, e.g. en_US.' },
              category: { type: 'string', description: 'Template category (MARKETING, UTILITY, AUTHENTICATION).' },
              components: { type: 'array', description: 'Template components array (header/body/footer/buttons).' },
            },
            required: ['name', 'language', 'category', 'components'],
          },
        },
        {
          name: 'templates.delete',
          class: 'mutation',
          description: 'Delete a message template by name (and optional hsm_id to delete a specific language variant).',
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_management'],
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Template name to delete.' },
              hsmId: { type: 'string', description: 'Optional template ID to delete a specific language variant only.' },
            },
            required: ['name'],
          },
        },
        {
          name: 'messages.mark-read',
          class: 'mutation',
          description: 'Mark an incoming WhatsApp message as read (sends the blue tick to the sender).',
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: ['whatsapp_business_messaging'],
          parameters: {
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'WAMID of the incoming message to mark as read.' },
            },
            required: ['messageId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = readAccessToken(inv.source.credentials)
      if (inv.capabilityName === 'list_message_templates') {
        const wabaId = readMetaString(inv.source.metadata, 'wabaId')
        const { limit, status } = inv.args as { limit?: number; status?: string }
        const params = new URLSearchParams()
        params.set('limit', String(Math.min(Math.max(1, limit ?? 50), 200)))
        if (status) params.set('status', status)
        const url = `${API}/${encodeURIComponent(wabaId)}/message_templates?${params.toString()}`
        const json = await graphGet(url, accessToken, inv.source.id)
        const data = (json as { data?: Array<{ id: string; name: string; status: string; language: string; category?: string }> }).data ?? []
        return {
          data: {
            templates: data.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              language: t.language,
              category: t.category,
            })),
          },
          fetchedAt: Date.now(),
        }
      }
      if (inv.capabilityName === 'get_business_phone_number') {
        const phoneNumberId = readMetaString(inv.source.metadata, 'phoneNumberId')
        const params = new URLSearchParams({
          fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,platform_type',
        })
        const url = `${API}/${encodeURIComponent(phoneNumberId)}?${params.toString()}`
        const json = (await graphGet(url, accessToken, inv.source.id)) as {
          display_phone_number?: string
          verified_name?: string
          quality_rating?: string
          code_verification_status?: string
          platform_type?: string
        }
        return {
          data: {
            phoneNumber: json.display_phone_number,
            verifiedName: json.verified_name,
            qualityRating: json.quality_rating,
            codeVerificationStatus: json.code_verification_status,
            platformType: json.platform_type,
          },
          fetchedAt: Date.now(),
        }
      }
      throw new Error(`whatsapp-business: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = readAccessToken(inv.source.credentials)

      if (inv.capabilityName === 'media.upload') {
        return uploadMedia(inv, accessToken)
      }
      if (inv.capabilityName === 'templates.create') {
        return createTemplate(inv, accessToken)
      }
      if (inv.capabilityName === 'templates.delete') {
        return deleteTemplate(inv, accessToken)
      }

      const phoneNumberId = readMetaString(inv.source.metadata, 'phoneNumberId')
      const url = `${API}/${encodeURIComponent(phoneNumberId)}/messages`
      let body: Record<string, unknown>
      if (inv.capabilityName === 'send_text_message') {
        const { to, body: text, previewUrl } = inv.args as { to: string; body: string; previewUrl?: boolean }
        body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text, preview_url: previewUrl ?? false },
        }
      } else if (inv.capabilityName === 'send_template_message') {
        const { to, template, language, components } = inv.args as {
          to: string
          template: string
          language?: string
          components?: unknown[]
        }
        body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: template,
            language: { code: language ?? 'en_US' },
            ...(Array.isArray(components) && components.length > 0 ? { components } : {}),
          },
        }
      } else if (inv.capabilityName === 'messages.mark-read') {
        const { messageId } = inv.args as { messageId: string }
        if (typeof messageId !== 'string' || messageId.length === 0) {
          throw new Error('whatsapp-business messages.mark-read: messageId is required')
        }
        body = {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }
      } else {
        throw new Error(`whatsapp-business: unknown mutation capability ${inv.capabilityName}`)
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 401) {
        throw new CredentialsExpired('WhatsApp Business rejected token (401)', inv.source.id)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // Meta returns errors as 4xx with a JSON body; surface fb-trace-id if present.
        throw new Error(`whatsapp-business ${inv.capabilityName} HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      if (inv.capabilityName === 'messages.mark-read') {
        const json = (await res.json().catch(() => ({}))) as { success?: boolean }
        return {
          status: 'committed',
          data: { success: json.success === true },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      const json = (await res.json()) as {
        messaging_product?: string
        contacts?: Array<{ input: string; wa_id: string }>
        messages?: Array<{ id: string; message_status?: string }>
      }
      const message = json.messages?.[0]
      const contact = json.contacts?.[0]
      return {
        status: 'committed',
        data: {
          messageId: message?.id,
          messageStatus: message?.message_status,
          waId: contact?.wa_id,
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('WhatsApp Business OAuth client not configured (WHATSAPP_BUSINESS_OAUTH_CLIENT_ID / _SECRET)')
      }
      const tokens = await exchangeAuthorizationCode({
        tokenUrl: TOKEN_URL,
        clientId,
        clientSecret,
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
      })
      return {
        credentials: {
          kind: 'oauth2',
          accessToken: tokens.accessToken,
          // Meta business tokens do not include a refresh_token; long-lived
          // tokens last ~60 days, then the operator re-authorizes.
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        },
        scopes: tokens.scope?.split(/[,\s]+/) ?? SCOPES,
        metadata: {},
      }
    },

    async test(source) {
      try {
        const accessToken = readAccessToken(source.credentials)
        const phoneNumberId = typeof source.metadata.phoneNumberId === 'string' ? source.metadata.phoneNumberId : undefined
        const probeUrl = phoneNumberId
          ? `${API}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`
          : `${API}/me?fields=id`
        const res = await fetch(probeUrl, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401) return { ok: false, reason: 'WhatsApp Business rejected credentials (401) — reconnect required' }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { ok: false, reason: `WhatsApp Business returned ${res.status}: ${text.slice(0, 200)}` }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

function readAccessToken(creds: ConnectorCredentials): string {
  if (creds.kind !== 'oauth2' || typeof creds.accessToken !== 'string' || creds.accessToken.length === 0) {
    throw new Error('whatsapp-business: expected oauth2 credentials with accessToken')
  }
  return creds.accessToken
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`whatsapp-business DataSource.metadata.${key} is missing — set it at connect-time from the Embedded Signup callback`)
  }
  return v
}

async function graphGet(url: string, accessToken: string, dataSourceId: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('WhatsApp Business rejected token (401)', dataSourceId)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`whatsapp-business HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  return (await res.json()) as unknown
}

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function uploadMedia(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const phoneNumberId = readMetaString(inv.source.metadata, 'phoneNumberId')
  const { dataBase64, mimeType, filename } = inv.args as {
    dataBase64: string
    mimeType: string
    filename?: string
  }
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new Error('whatsapp-business media.upload: dataBase64 is required')
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    throw new Error('whatsapp-business media.upload: mimeType is required')
  }
  const bytes = decodeBase64(dataBase64)
  const form = new FormData()
  form.set('messaging_product', 'whatsapp')
  form.set('type', mimeType)
  form.set('file', new Blob([bytes as BlobPart], { type: mimeType }), filename ?? 'upload')
  const url = `${API}/${encodeURIComponent(phoneNumberId)}/media`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('WhatsApp Business rejected token (401)', inv.source.id)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`whatsapp-business media.upload HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = (await res.json()) as { id?: string }
  return {
    status: 'committed',
    data: { mediaId: json.id },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createTemplate(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const wabaId = readMetaString(inv.source.metadata, 'wabaId')
  const { name, language, category, components } = inv.args as {
    name: string
    language: string
    category: string
    components: unknown[]
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('whatsapp-business templates.create: name is required')
  }
  if (typeof language !== 'string' || language.length === 0) {
    throw new Error('whatsapp-business templates.create: language is required')
  }
  if (typeof category !== 'string' || category.length === 0) {
    throw new Error('whatsapp-business templates.create: category is required')
  }
  if (!Array.isArray(components)) {
    throw new Error('whatsapp-business templates.create: components must be an array')
  }
  const url = `${API}/${encodeURIComponent(wabaId)}/message_templates`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name, language, category, components }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('WhatsApp Business rejected token (401)', inv.source.id)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`whatsapp-business templates.create HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = (await res.json()) as { id?: string; status?: string; category?: string }
  return {
    status: 'committed',
    data: { templateId: json.id, templateStatus: json.status, category: json.category },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function deleteTemplate(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const wabaId = readMetaString(inv.source.metadata, 'wabaId')
  const { name, hsmId } = inv.args as { name: string; hsmId?: string }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('whatsapp-business templates.delete: name is required')
  }
  const params = new URLSearchParams()
  params.set('name', name)
  if (typeof hsmId === 'string' && hsmId.length > 0) params.set('hsm_id', hsmId)
  const url = `${API}/${encodeURIComponent(wabaId)}/message_templates?${params.toString()}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('WhatsApp Business rejected token (401)', inv.source.id)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`whatsapp-business templates.delete HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = (await res.json().catch(() => ({}))) as { success?: boolean }
  return {
    status: 'committed',
    data: { success: json.success === true },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}
