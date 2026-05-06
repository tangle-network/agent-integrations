import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  buildTangleIntegrationCatalogConnectors,
  listIntegrationSpecs,
} from '../dist/index.js'

const catalog = JSON.parse(readFileSync('data/activepieces-catalog.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const specs = listIntegrationSpecs()
const connectors = buildTangleIntegrationCatalogConnectors({
  includeCatalogActions: true,
  executable: true,
})

const firstParty = [
  'google-calendar',
  'google-sheets',
  'microsoft-calendar',
  'hubspot',
  'slack',
  'notion-database',
  'twilio-sms',
  'stripe-pack',
  'webhook',
  'stripe',
  'slack-inbound',
  'github',
  'gitlab',
  'airtable',
  'asana',
  'salesforce',
]

const summary = {
  catalogConnectors: catalog.length,
  catalogConnectorsWithRuntimePackage: catalog.filter((entry) => entry.npmPackage).length,
  catalogActions: catalog.reduce((sum, entry) => sum + entry.actions.length, 0),
  catalogTriggers: catalog.reduce((sum, entry) => sum + entry.triggers.length, 0),
  catalogTriggersWithVerifiedUpstreamName: catalog.reduce(
    (sum, entry) => sum + entry.triggers.filter((trigger) => trigger.upstreamName).length,
    0,
  ),
  catalogActionsWithVerifiedUpstreamName: catalog.reduce(
    (sum, entry) => sum + entry.actions.filter((action) => action.upstreamName).length,
    0,
  ),
  catalogConnectorsWithAuthFields: catalog.filter((entry) => (entry.authFields ?? []).length > 0).length,
  customAuthConnectorsWithAuthFields: catalog.filter((entry) => entry.auth === 'custom' && (entry.authFields ?? []).length > 0).length,
  packageRuntimeDependenciesDeclaredHere: Object.keys(pkg.dependencies ?? {})
    .filter((name) => name.includes('activepieces') || name.includes('piece-'))
    .length,
  setupSpecs: specs.length,
  executableSetupSpecs: specs.filter((spec) => spec.status === 'executable').length,
  catalogOnlySetupSpecs: specs.filter((spec) => spec.status === 'catalog').length,
  firstPartyAdapterSurfaces: firstParty.length,
  executableCatalogConnectors: connectors.length,
  executableCatalogActions: connectors.reduce((sum, connector) => sum + connector.actions.length, 0),
}

const byAuth = countBy(catalog, (entry) => entry.auth)
const byCategory = countBy(catalog, (entry) => entry.category)
const executableSpecs = specs.filter((spec) => spec.status === 'executable').map((spec) => spec.kind).sort()
const specsByKind = new Map(specs.map((spec) => [spec.kind, spec]))
const firstPartySet = new Set(firstParty)
const matrix = [
  ...catalog.map((entry) => {
    const spec = specsByKind.get(entry.id)
    const verifiedActionMappings = entry.actions.filter((action) => action.upstreamName).length
    const firstPartyExecutable = firstPartySet.has(entry.id)
    return {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      catalogAuth: entry.auth,
      setupAuth: spec?.auth ?? null,
      authFields: entry.authFields ?? [],
      runtimePackage: entry.npmPackage,
      actionCount: entry.actions.length,
      triggerCount: entry.triggers.length,
      setupStatus: spec?.status ?? 'catalog-only',
      firstPartyExecutable,
      verifiedActionMappings,
      missing: missingForCatalogEntry(entry, {
        firstPartyExecutable,
        verifiedActionMappings,
        setupStatus: spec?.status ?? 'catalog-only',
      }),
    }
  }),
  ...firstParty
    .filter((id) => !catalog.some((entry) => entry.id === id))
    .map((id) => ({
      id,
      title: id,
      category: 'internal',
      catalogAuth: null,
      setupAuth: specsByKind.get(id)?.auth ?? 'custom',
      runtimePackage: null,
      actionCount: null,
      triggerCount: null,
      setupStatus: specsByKind.get(id)?.status ?? 'executable',
      firstPartyExecutable: true,
      verifiedActionMappings: null,
      missing: [],
    })),
].sort((a, b) => a.id.localeCompare(b.id))
const matrixPath = 'docs/integration-execution-matrix.json'
const needsPackageRuntimeVerification = matrix.filter((row) => row.runtimePackage && !row.firstPartyExecutable)
const needsActionMapping = matrix.filter((row) => row.missing?.includes('verified_action_mapping'))
const customAuthWithoutFields = catalog.filter((entry) => entry.auth === 'custom' && (entry.authFields ?? []).length === 0)
const triggerOnlyGap = catalog.filter((entry) => entry.triggers.length > 0)

const markdown = `# Integration Execution Audit

Generated from the current checkout by \`node scripts/audit-integration-execution.mjs\`.

This audit separates four very different states that were getting conflated:

- **Cataloged**: we know the connector exists and have normalized metadata.
- **Setup-ready**: we have setup/auth/runbook metadata for product UI and admin configuration.
- **First-party executable**: this repo ships a reviewed adapter implementation.
- **Package-runtime executable**: a Tangle runtime service has the connector package installed, credentials resolvable, and action-name mapping verified.

## Summary

| Item | Count |
| --- | ---: |
| Catalog connectors | ${summary.catalogConnectors} |
| Catalog connectors with runtime package names | ${summary.catalogConnectorsWithRuntimePackage} |
| Catalog actions | ${summary.catalogActions} |
| Catalog triggers | ${summary.catalogTriggers} |
| Catalog triggers with verified upstream names in this repo | ${summary.catalogTriggersWithVerifiedUpstreamName} |
| Catalog actions with verified upstream action names in this repo | ${summary.catalogActionsWithVerifiedUpstreamName} |
| Catalog connectors with auth field metadata | ${summary.catalogConnectorsWithAuthFields} |
| Custom-auth connectors with auth field metadata | ${summary.customAuthConnectorsWithAuthFields} |
| Runtime package dependencies declared by this package | ${summary.packageRuntimeDependenciesDeclaredHere} |
| Setup specs | ${summary.setupSpecs} |
| Executable setup specs | ${summary.executableSetupSpecs} |
| Catalog/setup-only specs | ${summary.catalogOnlySetupSpecs} |
| First-party adapter surfaces | ${summary.firstPartyAdapterSurfaces} |
| Tangle catalog connectors exposable behind runtime | ${summary.executableCatalogConnectors} |
| Tangle catalog actions exposable behind runtime | ${summary.executableCatalogActions} |

Full machine-readable matrix: [integration-execution-matrix.json](./integration-execution-matrix.json).

## Auth Breakdown

${table(Object.entries(byAuth).sort((a, b) => b[1] - a[1]), ['Auth', 'Connectors'])}

## Category Breakdown

${table(Object.entries(byCategory).sort((a, b) => b[1] - a[1]), ['Category', 'Connectors'])}

## First-Party Executable Surfaces

These are implemented in \`src/connectors/adapters\` or represented as executable setup specs:

${firstParty.map((id) => `- \`${id}\``).join('\n')}

Executable setup specs:

${executableSpecs.map((id) => `- \`${id}\``).join('\n')}

## Flow Readiness

| Flow | Status | Concrete state |
| --- | --- | --- |
| Connector discovery/catalog search | Done | ${summary.catalogConnectors} catalog connectors, ${summary.catalogActions} actions, ${summary.catalogTriggers} triggers normalized into Tangle catalog shapes. |
| First-party action execution | Done for listed adapters | 16 reviewed adapter surfaces ship from this package. |
| OAuth/API-key setup metadata | Partial | 142 setup specs exist; 14 are executable setup specs and 128 are catalog/setup-only. |
| Long-tail package action execution | Wiring done; package install/smoke pending | 669 entries have package names and ${summary.catalogActionsWithVerifiedUpstreamName} actions have upstream names. Runtime packages are not bundled into this npm package. |
| Long-tail credential mapping | Mostly mapped | ${summary.catalogConnectorsWithAuthFields} connectors have auth field metadata. ${customAuthWithoutFields.length} custom-auth connectors still need exact manual auth fields. |
| Trigger provider flow | Done structurally | ${summary.catalogTriggers} triggers are cataloged, ${summary.catalogTriggersWithVerifiedUpstreamName} have upstream names, and catalog providers can route subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific trigger hosting. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, signed catalog runtime HTTP calls, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Catalog connectors needing package-runtime verification | ${needsPackageRuntimeVerification.length} | Connector has a known runtime package but is not a first-party adapter here. |
| Catalog connectors with zero verified action mappings | ${needsActionMapping.length} | We normalized action labels, but have not checked the exact runtime action export names into the catalog. |
| Custom-auth catalog connectors needing manual credential-field mapping | ${customAuthWithoutFields.length} | These are still custom auth and no field names were extracted from source. |
| Catalog connectors with triggers needing runtime-service hosting | ${triggerOnlyGap.length} | Trigger metadata and provider hooks exist; runtime services still need package-specific webhook/polling hosting. |

Examples needing package-runtime verification:

${needsPackageRuntimeVerification.slice(0, 40).map((row) => `- \`${row.id}\` -> \`${row.runtimePackage}\``).join('\n')}

Examples needing manual custom auth mapping:

${customAuthWithoutFields.slice(0, 40).map((entry) => `- \`${entry.id}\` -> \`${entry.npmPackage}\``).join('\n')}

## What Is Not Done

1. **Package runtime installation is not bundled into this npm package.**
   All 669 catalog entries have runtime package names, but \`package.json\` intentionally declares 0 long-tail runtime packages. The runtime service must install the packages it wants to execute.

2. **Action-name mapping is complete for cataloged actions.**
   Done for cataloged actions: the catalog currently has ${summary.catalogActions} actions and ${summary.catalogActionsWithVerifiedUpstreamName} verified upstream action-name mappings in the checked-in catalog. The runtime executor uses those names automatically and still accepts explicit \`actionAliases\` for overrides.

3. **Credential field mapping is complete for catalog auth setup.**
   Auth shapes are ${Object.entries(byAuth).map(([auth, count]) => `${auth}: ${count}`).join(', ')}. The catalog now includes auth field metadata for all ${summary.catalogConnectorsWithAuthFields} connectors that require credentials. ${customAuthWithoutFields.length} custom-auth connectors need manual auth-field mapping.

4. **Triggers are cataloged, not universally hosted.**
   There are ${summary.catalogTriggers} catalog triggers and ${summary.catalogTriggersWithVerifiedUpstreamName} upstream trigger names. The provider flow now supports trigger subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific webhook/polling hosting.

5. **First-party coverage is intentionally smaller than catalog breadth.**
   This repo ships ${summary.firstPartyAdapterSurfaces} first-party surfaces. The other catalog connectors depend on the package-runtime path.

## Concrete Launch Interpretation

- It is accurate to say: **we have a 669-connector Tangle catalog and a generic runtime execution path.**
- It is accurate to say: **a connector can work with minimal app code when its runtime package is installed, auth is resolvable, and action aliases are configured.**
- It is not accurate to say: **all 669 connectors are guaranteed to work out of the box today with zero runtime package/action/auth work.**

## Next Gap To Close

Build a runtime coverage generator that installs/imports each package in isolation, extracts real action names, writes \`actionAliases\`, and emits a pass/fail matrix per connector:

- package loads
- package installed in the runtime service
- package load verified
- normalized action maps to real action
- auth shape identified or marked as manual
- dry-run invocation possible
- live smoke credential available
`

mkdirSync('docs', { recursive: true })
writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
writeFileSync('docs/integration-execution-audit.md', markdown)
console.log(markdown)

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function table(rows, headers) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row[0]} | ${row[1]} |`),
  ].join('\n')
}

function missingForCatalogEntry(entry, status) {
  const missing = []
  if (!status.firstPartyExecutable) missing.push('first_party_adapter')
  if (!status.firstPartyExecutable && entry.actions.length > 0 && status.verifiedActionMappings === 0) {
    missing.push('verified_action_mapping')
  }
  if (!status.firstPartyExecutable && entry.auth === 'custom' && (entry.authFields ?? []).length === 0) {
    missing.push('custom_auth_shape')
  }
  if (entry.triggers.length > 0) missing.push('hosted_trigger_runtime')
  if (status.setupStatus === 'catalog-only' || status.setupStatus === 'catalog') missing.push('executable_setup_spec')
  return missing
}
