#!/usr/bin/env node
// Fan-out API validation: probe every registered spec and shipped adapter
// against its live vendor API — base URL reachability, OAuth endpoints,
// auth-kind consistency, operation routes — emitting JSON + a markdown
// checklist. Unauthenticated, read-route-only probes; exits 0 unless --strict.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => (args.indexOf(`--${name}`) >= 0 ? args[args.indexOf(`--${name}`) + 1] : fallback)
const OUT = flag('out', 'results/connector-api-validation')
const CONCURRENCY = Number(flag('concurrency', 8))
const TIMEOUT_MS = Number(flag('timeout-ms', 8000))

const fetchProbe = async (url, init = {}) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...init })
    return { ok: true, status: response.status }
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? error?.cause?.message ?? error?.name
    const reason = typeof code === 'number' || `${code}`.startsWith('UND_ERR') ? `connect failure (${code})` : `${code}`
    return { ok: false, reason }
  }
}

const httpCheck = async (name, url, init) => {
  if (!url) return { name, status: 'warn', reason: 'not declared' }
  const probe = await fetchProbe(url, init)
  return probe.ok
    ? { name, status: 'pass', reason: `HTTP ${probe.status}` }
    : { name, status: 'fail', reason: `unreachable: ${probe.reason}` }
}

const TEMPLATE_DEFAULTS = { region: 'us-east-1', domain: 'com' }
const resolveBase = (base) => {
  const raw = typeof base === 'string' ? base : base?.fallback
  if (!raw) return { url: undefined, templated: false }
  let templated = false
  const url = raw.replace(/\{([a-z_-]+)\}/gi, (_, name) => {
    templated = true
    return TEMPLATE_DEFAULTS[name.toLowerCase()] ?? 'probe'
  })
  return { url, templated }
}

const routeVerdict = (status) => {
  if (status < 400) return { status: 'pass', reason: `HTTP ${status}` }
  if (status === 401 || status === 403) return { status: 'pass', reason: `HTTP ${status} auth wall` }
  if ([400, 409, 422, 429].includes(status)) return { status: 'pass', reason: `HTTP ${status} validation/throttle` }
  if (status === 404) return { status: 'warn', reason: 'HTTP 404 (unauthenticated routes may be hidden)' }
  if (status === 405) return { status: 'fail', reason: 'HTTP 405 method not allowed' }
  return { status: 'warn', reason: `HTTP ${status} server error` }
}

const adapters = new Map(
  Object.entries(await import('../dist/connectors/adapters/index.js'))
    .filter(([, a]) => a?.manifest && !a.inboundOnly && !a.catalogOnly)
    .map(([, a]) => [a.manifest.kind, a]),
)
const specs = new Map((await import('../dist/index.js')).listIntegrationSpecs().map((s) => [s.kind, s]))

const manifestAuthKind = (auth) => {
  const single = auth?.kind === 'one_of' ? auth.options.find((o) => o.kind === auth.preferred) ?? auth.options[0] : auth
  return single?.kind?.replace('api-key', 'api_key') ?? 'undeclared'
}

const validateKind = async (kind) => {
  const adapter = adapters.get(kind)
  const spec = specs.get(kind)
  const checks = []
  const authMode = spec?.auth?.mode
  const authKind = adapter ? manifestAuthKind(adapter.manifest.auth) : (authMode ?? 'undeclared')
  if (adapter && authMode) {
    checks.push(
      authKind === authMode
        ? { name: 'auth-kind-consistency', status: 'pass', reason: `${authKind}` }
        : { name: 'auth-kind-consistency', status: 'fail', reason: `manifest ${authKind} vs spec ${authMode}` },
    )
  }
  if (authMode === 'oauth2') {
    const auth = spec.auth
    checks.push(
      await httpCheck('oauth-authorization-url', auth.authorizationUrl, {}),
      await httpCheck('oauth-token-url', auth.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      }),
    )
    if (!auth.scopes?.length) checks.push({ name: 'scopes-declared', status: 'warn', reason: 'no scopes' })
  }
  const rest = adapter?.rest
  if (rest) {
    const base = resolveBase(rest.baseUrl)
    if (base.url) {
      const probe = await fetchProbe(base.url)
      checks.push(
        probe.ok
          ? { name: 'base-url-reachable', status: 'pass', reason: `${base.url} HTTP ${probe.status}` }
          : { name: 'base-url-reachable', status: base.templated ? 'warn' : 'fail', reason: `${base.url} ${probe.reason}` },
      )
    } else {
      checks.push({ name: 'base-url-reachable', status: 'warn', reason: 'no static base URL' })
    }
    for (const op of rest.capabilities.filter((o) => o.class === 'read').slice(0, 3)) {
      const opBase = resolveBase(op.request.baseUrl ?? rest.baseUrl)
      if (!opBase.url) continue
      const path = op.request.path.replace(/\{[^}]+\}/g, 'probe')
      const probe = await fetchProbe(`${opBase.url}${path}`, { method: op.request.method })
      const verdict = probe.ok
        ? routeVerdict(probe.status)
        : { status: opBase.templated ? 'warn' : 'fail', reason: `unreachable: ${probe.reason}` }
      checks.push({ name: `route ${op.request.method} ${op.request.path}`, ...verdict })
    }
  }
  checks.push({ name: 'representative-call', status: 'skip', reason: 'no test credential configured' })
  const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass'
  return {
    kind,
    displayName: adapter?.manifest.displayName ?? spec?.title ?? kind,
    auth: authMode ?? authKind,
    baseUrl: rest ? (resolveBase(rest.baseUrl).url ?? null) : null,
    result: worst,
    checks,
  }
}

const queue = [...new Set([...specs.keys(), ...adapters.keys()])]
const results = []
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let kind = queue.pop(); kind; kind = queue.pop()) results.push(await validateKind(kind))
  }),
)
results.sort((a, b) => ['fail', 'warn', 'pass'].indexOf(a.result) - ['fail', 'warn', 'pass'].indexOf(b.result) || a.kind.localeCompare(b.kind))

const summary = { total: results.length, pass: 0, warn: 0, fail: 0 }
for (const r of results) summary[r.result]++
const report = { generatedAt: new Date().toISOString(), summary, results }
mkdirSync(dirname(`${OUT}.json`), { recursive: true })
writeFileSync(`${OUT}.json`, `${JSON.stringify(report, null, 2)}\n`)
const findings = (r) => r.checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => `${c.name}: ${c.reason}`).join('; ').slice(0, 160) || 'all checks passed'
const md = [
  `# Connector API validation — ${report.generatedAt}`,
  '',
  `${summary.total} connectors: **${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail**. Unauthenticated reachability probes only; see ${OUT}.json for full check detail.`,
  '',
  '| result | kind | auth | findings |',
  '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.result} | ${r.kind} | ${r.auth} | ${findings(r)} |`),
]
writeFileSync(`${OUT}.md`, `${md.join('\n')}\n`)
console.log(`pass ${summary.pass} / warn ${summary.warn} / fail ${summary.fail} of ${summary.total}; wrote ${OUT}.json and ${OUT}.md`)
if (args.includes('--strict') && summary.fail) process.exit(1)
