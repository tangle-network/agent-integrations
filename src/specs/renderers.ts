import type {
  ConsoleStep,
  HealthcheckPlan,
  IntegrationSpec,
  RenderSpecOptions,
  RenderedConsoleStep,
} from './types.js'

export function renderConsoleSteps(spec: IntegrationSpec, options: RenderSpecOptions): RenderedConsoleStep[] {
  const redirectUri = renderRedirectUri(spec, options)
  return spec.setup.consoleSteps.map((step) => ({
    ...step,
    detail: renderTemplate(step.detail, spec, options, redirectUri),
    copyValue: step.copyValue ? renderTemplate(step.copyValue, spec, options, redirectUri) : undefined,
  }))
}

export function renderRunbookMarkdown(spec: IntegrationSpec, options: RenderSpecOptions): string {
  const steps = renderConsoleSteps(spec, options)
  const lines = [
    `# ${spec.title} Integration Setup`,
    '',
    `- Kind: \`${spec.kind}\``,
    `- Status: \`${spec.status}\``,
    `- Auth: \`${spec.auth.mode}\``,
    `- Family: \`${spec.family}\``,
  ]
  if (spec.setup.consoleUrl) lines.push(`- Console: ${spec.setup.consoleUrl}`)
  if (spec.setup.redirectUriTemplate) lines.push(`- Redirect URI: \`${renderRedirectUri(spec, options)}\``)
  lines.push('', '## Credentials', '')
  for (const field of spec.setup.credentialFields) {
    lines.push(`- ${field.secret ? '[secret] ' : ''}${field.label}${field.env ? ` (\`${field.env}\`)` : ''}: ${field.description}`)
  }
  lines.push('', '## Permissions', '')
  for (const permission of spec.permissions) {
    lines.push(`- \`${permission.normalized}\`: ${permission.providerScopes.length ? permission.providerScopes.map((scope) => `\`${scope}\``).join(', ') : 'no provider scope'} - ${permission.reason}`)
  }
  lines.push('', '## Console Steps', '')
  for (const [i, step] of steps.entries()) {
    lines.push(`${i + 1}. ${step.title}: ${step.detail}`)
  }
  if (spec.setup.knownQuirks?.length) {
    lines.push('', '## Known Quirks', '')
    for (const quirk of spec.setup.knownQuirks) lines.push(`- ${quirk.severity}: ${quirk.message}`)
  }
  return `${lines.join('\n')}\n`
}

export function renderAgentToolDescription(spec: IntegrationSpec): string {
  const hints = spec.plannerHints
  const useFor = hints?.useFor?.length ? `Use for ${hints.useFor.join(', ')}.` : `Use for ${spec.title} workflows.`
  const risk = hints ? `Freshness: ${hints.dataFreshness}. Write risk: ${hints.writeRisk}.` : ''
  return `${spec.title} (${spec.kind}). ${useFor} ${risk}`.trim()
}

export function buildHealthcheckPlan(spec: IntegrationSpec): HealthcheckPlan {
  const healthcheck = spec.setup.healthcheck ?? { id: `${spec.kind}.static`, level: 'static', description: 'No healthcheck defined.' as const }
  const requires: HealthcheckPlan['requires'] = []
  if (healthcheck.level === 'connection') requires.push('connection_credentials')
  if (healthcheck.level === 'client_config' && spec.auth.mode === 'oauth2') requires.push('client_id', 'client_secret')
  if (spec.auth.mode === 'api_key') requires.push('api_key')
  if (spec.auth.mode === 'hmac') requires.push('hmac_secret')
  return {
    kind: spec.kind,
    healthcheck,
    requires,
    message: healthcheck.description,
  }
}

function renderTemplate(template: string, spec: IntegrationSpec, options: RenderSpecOptions, redirectUri?: string): string {
  return template
    .replaceAll('{host}', options.host)
    .replaceAll('{kind}', spec.kind)
    .replaceAll('{redirectUri}', redirectUri ?? renderRedirectUri(spec, options))
}

function renderRedirectUri(spec: IntegrationSpec, options: RenderSpecOptions): string {
  return (options.callbackPath ?? spec.setup.redirectUriTemplate ?? '')
    .replaceAll('{host}', options.host)
    .replaceAll('{kind}', spec.kind)
}

export function consoleStepsToText(steps: ConsoleStep[]): string {
  return steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')
}
