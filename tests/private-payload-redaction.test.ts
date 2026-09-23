import { describe, expect, it } from 'vitest'
import {
  InMemoryIntegrationAuditStore,
  IntegrationRuntimeError,
  createAuditingActionGuard,
  normalizeIntegrationError,
  type IntegrationGuardContext,
} from '../src/index.js'
import { redactInvocationEnvelope, type IntegrationInvocationEnvelope } from '../src/sandbox.js'
import { redactUnknown } from '../src/redaction.js'

const contentBase64 = Buffer.from('private voice recording').toString('base64')
const shortBase64 = Buffer.from('secret voice').toString('base64')
const unpaddedBase64 = Buffer.from('private bytes').toString('base64').replace(/=+$/, '')
const urlSafeBase64 = Buffer.from([251, 255, 253, 251, 255, 253, 251, 255, 253, 251, 255, 253]).toString('base64url')
const oddLengthOpaque = 'A'.repeat(129)
const repeatedBase64 = Buffer.alloc(90, 0xa5).toString('base64')
const dataUrl = `data:audio/ogg;base64,${repeatedBase64}`
const wrappedBase64 = repeatedBase64.match(/.{1,76}/g)!.join('\n')
const foldedDataUrl = `DATA:audio/ogg;\r\n\tbase64,${repeatedBase64}`
const tabbedDataUrl = `data:audio/ogg;\tbase64,${repeatedBase64}`
const longHeaderDataUrl = `data:audio/ogg;${'x'.repeat(300)};base64,${repeatedBase64}`
const spacedBase64 = repeatedBase64.match(/.{1,20}/g)!.join('  ')
const tabbedBase64 = repeatedBase64.match(/.{1,20}/g)!.join('\t')
const indentedBase64 = repeatedBase64.match(/.{1,20}/g)!.join('\n  ')
const input = {
  contentBase64,
  contentType: 'audio/ogg',
  nested: { payload: new Uint8Array([1, 2, 3]) },
  extra: { data: shortBase64, trace: unpaddedBase64, value: urlSafeBase64, odd: oddLengthOpaque,
    dataUrl, wrapped: wrappedBase64, foldedDataUrl, tabbedDataUrl, longHeaderDataUrl,
    spaced: spacedBase64, tabbed: tabbedBase64, indented: indentedBase64 },
}
const redactedInput = {
  contentBase64: '[REDACTED]',
  contentType: 'audio/ogg',
  nested: { payload: '[REDACTED]' },
  extra: { data: '[REDACTED]', trace: '[REDACTED]', value: '[REDACTED]', odd: '[REDACTED]',
    dataUrl: '[REDACTED]', wrapped: '[REDACTED]', foldedDataUrl: '[REDACTED]',
    tabbedDataUrl: '[REDACTED]', longHeaderDataUrl: '[REDACTED]',
    spaced: '[REDACTED]', tabbed: '[REDACTED]', indented: '[REDACTED]' },
}

function expectPrivateValuesHidden(value: unknown): void {
  const preview = JSON.stringify(value)
  for (const privateValue of [contentBase64, shortBase64, unpaddedBase64, urlSafeBase64,
    oddLengthOpaque, dataUrl, tabbedDataUrl, longHeaderDataUrl, spacedBase64, tabbedBase64, indentedBase64,
    repeatedBase64.slice(0, 76)]) {
    expect(preview).not.toContain(privateValue)
  }
}

describe('private action input previews', () => {
  it('hides audio under unexpected keys without hiding ordinary text', () => {
    const unexpectedAudio = Buffer.alloc(256, 0xa5).toString('base64')
    expect(redactUnknown({ extra: unexpectedAudio, nested: { audio: 'short private bytes' },
      note: 'ordinary text', ordinarySpacing: 'ordinary  text',
      data: shortBase64, trace: unpaddedBase64, value: urlSafeBase64, odd: oddLengthOpaque,
      dataUrl, wrapped: wrappedBase64, foldedDataUrl, tabbedDataUrl, longHeaderDataUrl,
      spaced: spacedBase64, tabbed: tabbedBase64, indented: indentedBase64 }))
      .toEqual({ extra: '[REDACTED]', nested: { audio: '[REDACTED]' },
        note: 'ordinary text', ordinarySpacing: 'ordinary  text',
        data: '[REDACTED]', trace: '[REDACTED]', value: '[REDACTED]', odd: '[REDACTED]',
        dataUrl: '[REDACTED]', wrapped: '[REDACTED]', foldedDataUrl: '[REDACTED]',
        tabbedDataUrl: '[REDACTED]', longHeaderDataUrl: '[REDACTED]',
        spaced: '[REDACTED]', tabbed: '[REDACTED]', indented: '[REDACTED]' })
  })

  it('keeps audio out of an audit event with input previews enabled', async () => {
    const audit = new InMemoryIntegrationAuditStore()
    const guard = createAuditingActionGuard({ sink: audit, includeInputPreview: true })
    const ctx: IntegrationGuardContext = {
      connection: {
        id: 'deepgram-connection', owner: { type: 'user', id: 'owner-1' },
        providerId: 'first-party', connectorId: 'deepgram', status: 'active',
        grantedScopes: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      },
      request: { connectionId: 'deepgram-connection', action: 'transcription.bytes', input, idempotencyKey: 'voice-1' },
      action: { id: 'transcription.bytes', title: 'Transcribe audio', risk: 'destructive',
        requiredScopes: [], dataClass: 'private' },
    }
    await guard.invokeAction(ctx, async () => ({ ok: true, action: 'transcription.bytes', output: { text: 'Hello' } }))

    const events = audit.list({ type: 'action.invoked' })
    expect(events).toHaveLength(1)
    expect(events[0]?.metadata?.inputPreview).toEqual(redactedInput)
    expectPrivateValuesHidden(events)
  })

  it('keeps audio out of sandbox envelope input and metadata previews', () => {
    const envelope: IntegrationInvocationEnvelope = {
      kind: 'integration.invocation', capabilityToken: 'private-capability-token',
      toolName: 'first-party.deepgram.transcription.bytes', action: 'transcription.bytes',
      input, idempotencyKey: 'voice-1', metadata: { contentBase64 },
    }
    const preview = redactInvocationEnvelope(envelope)
    expect(preview.input).toEqual(redactedInput)
    expect(preview.metadata).toEqual({ contentBase64: '[REDACTED]' })
    expect(preview.capabilityToken).toBe('[REDACTED]')
    expectPrivateValuesHidden(preview)
  })

  it('keeps audio out of normalized error metadata', () => {
    const error = new IntegrationRuntimeError({
      code: 'provider_error', message: 'Deepgram rejected the recording.',
      metadata: { input, contentBase64 },
    })
    const normalized = normalizeIntegrationError(error)
    expect(normalized.metadata).toEqual({ input: redactedInput, contentBase64: '[REDACTED]' })
    expectPrivateValuesHidden(normalized)
  })
})
