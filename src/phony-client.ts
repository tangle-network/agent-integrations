export const PH0NY_API_URL = 'https://api.ph0ny.com'

export class Ph0nyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`ph0ny ${method} ${path} returned HTTP ${status}`)
    this.name = 'Ph0nyHttpError'
  }
}

export interface Ph0nyClientOptions {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface Ph0nyRequest {
  method?: string
  path: string
  body?: unknown
  timeoutMs?: number
}

export class Ph0nyClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: Ph0nyClientOptions) {
    this.baseUrl = (options.baseUrl ?? PH0NY_API_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async request<T = unknown>(request: Ph0nyRequest): Promise<T> {
    const method = request.method ?? 'GET'
    if (!request.path.startsWith('/')) throw new TypeError('ph0ny request path must start with /')
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiKey}`,
      accept: 'application/json',
    }
    const init: RequestInit = {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(request.timeoutMs ?? this.timeoutMs),
      headers,
    }
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(request.body)
    }
    const response = await this.fetchImpl(`${this.baseUrl}${request.path}`, init)
    const text = await response.text()
    if (!response.ok) throw new Ph0nyHttpError(response.status, method, request.path, text)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`ph0ny ${method} ${request.path} returned invalid JSON`)
    }
  }

  listAgentTools<T = unknown>(agentId: string): Promise<T> {
    return this.request<T>({ path: `/v1/agents/${encodeURIComponent(agentId)}/tools` })
  }

  bindInkboxLine<T = unknown>(identityId: string, body: unknown): Promise<T> {
    return this.request<T>({
      method: 'PUT',
      path: `/v1/inkbox-lines/${encodeURIComponent(identityId)}`,
      body,
    })
  }

  unbindInkboxLine<T = unknown>(identityId: string): Promise<T> {
    return this.request<T>({
      method: 'DELETE',
      path: `/v1/inkbox-lines/${encodeURIComponent(identityId)}`,
    })
  }
}
