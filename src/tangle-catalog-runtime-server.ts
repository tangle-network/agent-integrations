import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  createTangleCatalogHttpAuthResolver,
  createTangleCatalogInstalledPackageExecutor,
  createTangleCatalogRuntimeHandler,
  type TangleCatalogHttpAuthResolverOptions,
  type TangleCatalogInstalledPackageExecutorOptions,
  type TangleCatalogRuntimeHandlerOptions,
} from './tangle-catalog-runtime.js'

export interface TangleCatalogRuntimeNodeServerOptions {
  secret: string
  host?: string
  port?: number
  path?: string
  maxBodyBytes?: number
  requireSignature?: boolean
  authResolver?: false | TangleCatalogHttpAuthResolverOptions
  executor?: Omit<TangleCatalogInstalledPackageExecutorOptions, 'resolveAuth'> & {
    resolveAuth?: TangleCatalogInstalledPackageExecutorOptions['resolveAuth']
  }
  onLog?: (event: {
    level: 'info' | 'warn' | 'error'
    message: string
    metadata?: Record<string, unknown>
  }) => void
}

export interface StartedTangleCatalogRuntimeNodeServer {
  server: Server
  url: string
  close: () => Promise<void>
}

export function createTangleCatalogRuntimeNodeRequestListener(
  options: TangleCatalogRuntimeNodeServerOptions,
) {
  const path = options.path ?? '/v1/integration-catalog/actions/invoke'
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000
  const resolveAuth = options.executor?.resolveAuth
    ?? (options.authResolver
      ? createTangleCatalogHttpAuthResolver(options.authResolver)
      : undefined)
  const runtime = createTangleCatalogRuntimeHandler({
    secret: options.secret,
    requireSignature: options.requireSignature,
    maxBodyBytes,
    executeAction: createTangleCatalogInstalledPackageExecutor({
      ...options.executor,
      resolveAuth,
    }),
  } satisfies TangleCatalogRuntimeHandlerOptions)

  return async function tangleCatalogRuntimeNodeRequestListener(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true })
        return
      }
      if (request.method !== 'POST' || url.pathname !== path) {
        writeJson(response, 404, {
          ok: false,
          error: { code: 'not_found', message: 'Tangle catalog runtime route not found.' },
        })
        return
      }

      const body = await readBody(request, maxBodyBytes)
      const result = await runtime({
        body,
        headers: request.headers,
      })
      writeJson(response, result.status, result.body, result.headers)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tangle catalog runtime request failed.'
      options.onLog?.({ level: 'error', message })
      writeJson(response, message === 'payload_too_large' ? 413 : 500, {
        ok: false,
        action: 'unknown',
        output: {
          code: message === 'payload_too_large' ? 'payload_too_large' : 'runtime_request_failed',
          message: message === 'payload_too_large'
            ? 'Tangle catalog runtime request is too large.'
            : message,
        },
      })
    }
  }
}

export async function startTangleCatalogRuntimeNodeServer(
  options: TangleCatalogRuntimeNodeServerOptions,
): Promise<StartedTangleCatalogRuntimeNodeServer> {
  const host = options.host ?? '0.0.0.0'
  const port = options.port ?? 4109
  const listener = createTangleCatalogRuntimeNodeRequestListener(options)
  const server = createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host
  return {
    server,
    url: `http://${urlHost}:${actualPort}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    }),
  }
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > maxBodyBytes) {
        reject(new Error('payload_too_large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  })
  response.end(JSON.stringify(body))
}
