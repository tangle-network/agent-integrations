import type {
  CredentialFieldSpec,
  CredentialValidationResult,
  IntegrationSpec,
  IntegrationSpecValidationIssue,
  IntegrationSpecValidationResult,
} from './types.js'

export function validateIntegrationSpec(spec: IntegrationSpec): IntegrationSpecValidationResult {
  const issues: IntegrationSpecValidationIssue[] = []
  if (!spec.kind.trim()) issues.push({ path: 'kind', message: 'kind is required' })
  if (!spec.title.trim()) issues.push({ path: 'title', message: 'title is required' })
  if (!spec.actions.length) issues.push({ path: 'actions', message: 'at least one action is required' })
  if (!spec.permissions.length) issues.push({ path: 'permissions', message: 'at least one permission is required' })
  if (spec.auth.mode === 'oauth2') {
    if (!spec.auth.authorizationUrl) issues.push({ path: 'auth.authorizationUrl', message: 'authorizationUrl is required' })
    if (!spec.auth.tokenUrl) issues.push({ path: 'auth.tokenUrl', message: 'tokenUrl is required' })
    if (!spec.auth.redirectUriTemplate) issues.push({ path: 'auth.redirectUriTemplate', message: 'redirectUriTemplate is required' })
  }
  const actionIds = new Set<string>()
  for (const [index, action] of spec.actions.entries()) {
    if (actionIds.has(action.id)) issues.push({ path: `actions[${index}].id`, message: `duplicate action id ${action.id}` })
    actionIds.add(action.id)
  }
  return { ok: issues.length === 0, issues }
}

export function validateCredentialFormat(field: CredentialFieldSpec, value: string): CredentialValidationResult {
  if (!value.trim()) return { ok: false, field: field.label, message: `${field.label} is required` }
  if (field.regex && !new RegExp(field.regex).test(value)) {
    return { ok: false, field: field.label, message: `${field.label} does not match expected format` }
  }
  return { ok: true, field: field.label }
}
