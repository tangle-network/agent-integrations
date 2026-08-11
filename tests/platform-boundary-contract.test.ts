import { describe, expect, it, vi } from 'vitest'
import { finishConnectFlow } from '../src/connect'
import { createTangleIdentityClient } from '../src/connectors/adapters/tangle-id'

describe('Platform live-boundary contracts', () => {
  it('accepts the current verified exchange response and sends the email policy request', async () => {
    let request: { url: string; body: unknown } | undefined
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) }
      return new Response(JSON.stringify({
        apiKey: 'sk-tan-contract-key',
        paidAccessPolicyVersion: 1,
        emailVerified: true,
        user: { id: 'user_1', email: 'person@company.com', emailVerified: true },
        subscription: { plan: 'pro', status: 'active' },
        balance: 0,
      }), { status: 200 })
    })

    const result = await finishConnectFlow({ baseUrl: 'https://id.tangle.tools', fetchImpl }, {
      code: 'code_1',
      appId: 'product_1',
    })

    expect(request).toEqual({
      url: 'https://id.tangle.tools/cross-site/exchange',
      body: { code: 'code_1', app: 'product_1', requireVerifiedEmail: true },
    })
    expect(result).toMatchObject({ apiKey: 'sk-tan-contract-key', balance: 0, paidAccessPolicyVersion: 1 })
  })

  it('does not accept an exchange response that would bypass verified email', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: 'email_verification_required',
    }), { status: 403 }))

    await expect(finishConnectFlow({ fetchImpl }, { code: 'code_2', appId: 'product_1' }))
      .rejects.toMatchObject({ status: 403 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects a Platform key verification response with a placeholder email', async () => {
    const client = createTangleIdentityClient({
      serviceToken: 'svc_contract',
      serviceName: 'agent-integrations-tests',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        valid: true,
        userId: 'user_1',
        emailVerified: true,
        email: 'test@example.com',
      }), { status: 200 })),
    })

    await expect(client.verifyToken('sk-tan-contract-key')).resolves.toEqual({
      valid: false,
      reason: 'real_email_required',
    })
  })
})
