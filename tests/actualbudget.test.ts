import { afterEach, describe, expect, it, vi } from 'vitest'
import { actualbudgetConnector } from '../src/connectors/adapters/actualbudget.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_actualbudget_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'actualbudget',
    label: 'actualbudget test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { serverUrl: 'https://budget.example.com' },
    credentials: { kind: 'api-key', apiKey: 'actualbudget_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('actualbudget transactions.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to {serverUrl}/api/transactions with the transaction body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'txn_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await actualbudgetConnector.executeMutation!({
      source: source(),
      capabilityName: 'transactions.create',
      args: {
        accountId: 'acct_1',
        date: '2026-06-02',
        amount: -2599,
        payeeName: 'Coffee',
        category: 'Food',
        notes: 'lunch',
        cleared: true,
      },
      idempotencyKey: 'idemp-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://budget.example.com/api/transactions')
    expect(requestBody).toMatchObject({
      accountId: 'acct_1',
      date: '2026-06-02',
      amount: -2599,
      payeeName: 'Coffee',
    })
    expect(result.status).toBe('committed')
  })
})

describe('actualbudget transactions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/transactions/{transactionId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await actualbudgetConnector.executeMutation!({
      source: source(),
      capabilityName: 'transactions.delete',
      args: { transactionId: 'txn_42' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://budget.example.com/api/transactions/txn_42')
    expect(result.status).toBe('committed')
  })
})

describe('actualbudget categories.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/categories with the name', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'cat_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await actualbudgetConnector.executeMutation!({
      source: source(),
      capabilityName: 'categories.create',
      args: { name: 'Subscriptions', groupId: 'grp_1', isIncome: false },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://budget.example.com/api/categories')
    expect(requestBody).toMatchObject({ name: 'Subscriptions', groupId: 'grp_1', isIncome: false })
  })
})
