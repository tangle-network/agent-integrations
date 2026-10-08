import type { ConnectorInvocation, CapabilityReadResult } from '../types.js'

export const whatsappNumbersCapability = {
  name: 'numbers.list', class: 'read' as const,
  description: 'List the Meta phone numbers owned by one WhatsApp Business Account. A successful read does not prove webhook or delivery readiness.',
  parameters: { type: 'object' as const, properties: { wabaId: { type: 'string' as const, pattern: '^[0-9]{1,64}$' } }, required: ['wabaId'] },
}

export const whatsappWebhookStatusCapability = { ...whatsappNumbersCapability, name: 'webhooks.status', description: 'Read apps subscribed to the owned WhatsApp Business Account and their callback overrides.' }

export async function readWhatsappNumbers(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
  const { wabaId } = inv.args
  if (typeof wabaId !== 'string' || !/^[0-9]{1,64}$/.test(wabaId)) throw new Error('Meta number inventory requires a WABA ID')
  if (inv.source.kind === 'whatsapp-business' && inv.source.metadata.wabaId !== wabaId) throw new Error('WABA ID does not match this OAuth connection')
  const creds = inv.source.credentials
  const token = 'accessToken' in creds ? creds.accessToken : 'apiKey' in creds ? creds.apiKey : undefined
  if (typeof token !== 'string' || !token) throw new Error('Meta connection credential is unavailable')
  const path = inv.capabilityName === 'webhooks.status' ? 'subscribed_apps' : 'phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status&limit=100'
  const response = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Meta number inventory failed (HTTP ${response.status})`)
  const data: unknown = await response.json()
  return { data, fetchedAt: Date.now() }
}
