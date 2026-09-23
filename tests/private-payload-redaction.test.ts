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
const input = {
  contentBase64,
  contentType: 'audio/ogg',
  nested: { payload: new Uint8Array([1, 2, 3]) },
}
const redactedInput = {
  contentBase64: '[REDACTED]',
  contentType: 'audio/ogg',
  nested: { payload: '[REDACTED]' },
}

describe('private action input previews', () => {
  it('hides audio under unexpected keys without hiding ordinary text', () => {
    const unexpectedAudio = Buffer.alloc(256, 0xa5).toString('base64')
    expect(redactUnknown({ extra: unexpectedAudio, nested: { audio: 'short private bytes' }, note: 'ordinary text' }))
      .toEqual({ extra: '[REDACTED]', nested: { audio: '[REDACTED]' }, note: 'ordinary text' })
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
    expect(JSON.stringify(events)).not.toContain(contentBase64)
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
    expect(JSON.stringify(preview)).not.toContain(contentBase64)
  })

  it('keeps audio out of normalized error metadata', () => {
    const error = new IntegrationRuntimeError({
      code: 'provider_error', message: 'Deepgram rejected the recording.',
      metadata: { input, contentBase64 },
    })
    const normalized = normalizeIntegrationError(error)
    expect(normalized.metadata).toEqual({ input: redactedInput, contentBase64: '[REDACTED]' })
    expect(JSON.stringify(normalized)).not.toContain(contentBase64)
  })
})
