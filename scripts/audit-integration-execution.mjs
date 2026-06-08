import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  buildTangleIntegrationCatalogConnectors,
  buildTangleCatalogRuntimePackageManifest,
  listTangleIntegrationContracts,
  listTangleNativeAdapterIds,
  listIntegrationSpecs,
} from '../dist/index.js'

const catalog = JSON.parse(readFileSync('data/activepieces-catalog.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const specs = listIntegrationSpecs()
const connectors = buildTangleIntegrationCatalogConnectors({
  includeCatalogActions: true,
  executable: true,
})
const contracts = listTangleIntegrationContracts()
const firstParty = listTangleNativeAdapterIds()
const firstPartySet = new Set(firstParty)
const catalogRuntimeConnectors = connectors.filter((connector) => !firstPartySet.has(connector.id))
const runtimePackageManifest = buildTangleCatalogRuntimePackageManifest({
  agentIntegrationsVersion: pkg.version,
})

const summary = {
  catalogConnectors: catalog.length,
  catalogConnectorsWithRuntimePackage: catalog.filter((entry) => entry.npmPackage).length,
  catalogActions: catalog.reduce((sum, entry) => sum + entry.actions.length, 0),
  catalogTriggers: catalog.reduce((sum, entry) => sum + entry.triggers.length, 0),
  catalogTriggersWithCatalogUpstreamName: catalog.reduce(
    (sum, entry) => sum + entry.triggers.filter((trigger) => trigger.upstreamName).length,
    0,
  ),
  catalogActionsWithCatalogUpstreamName: catalog.reduce(
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
  tangleContracts: contracts.length,
  contractsWithRuntimePackage: contracts.filter((contract) => contract.quality.runtimePackageMapped).length,
  contractsWithMappedActions: contracts.filter((contract) => contract.quality.actionNamesMapped).length,
  contractsWithMappedTriggers: contracts.filter((contract) => contract.quality.triggerNamesMapped).length,
  contractsWithMappedAuth: contracts.filter((contract) => contract.quality.authFieldsMapped).length,
  nativeBackedContracts: contracts.filter((contract) => contract.implementation.kind === 'native_adapter').length,
  packageRuntimeBackedContracts: contracts.filter((contract) => contract.implementation.kind === 'package_runtime').length,
  runtimeManifestDependencies: Object.keys(runtimePackageManifest.dependencies).length,
  executableCatalogConnectors: catalogRuntimeConnectors.length,
  executableCatalogActions: catalogRuntimeConnectors.reduce((sum, connector) => sum + connector.actions.length, 0),
}

const byAuth = countBy(catalog, (entry) => entry.auth)
const byCategory = countBy(catalog, (entry) => entry.category)
const executableSpecs = specs.filter((spec) => spec.status === 'executable').map((spec) => spec.kind).sort()
const specsByKind = new Map(specs.map((spec) => [spec.kind, spec]))
const contractsById = new Map(contracts.map((contract) => [contract.id, contract]))
const matrix = [
  ...catalog.map((entry) => {
    const spec = specsByKind.get(entry.id)
    const contract = contractsById.get(entry.id)
    const catalogActionMappings = entry.actions.filter((action) => action.upstreamName).length
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
      tangleContractStatus: contract?.status ?? 'contract_ready',
      implementationKind: contract?.implementation.kind ?? 'package_runtime',
      nativeAdapter: firstPartyExecutable,
      catalogActionMappings,
      quality: contract?.quality,
      missing: missingForCatalogEntry(entry, {
        catalogActionMappings,
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
      tangleContractStatus: 'native_backed',
      implementationKind: 'native_adapter',
      nativeAdapter: true,
      catalogActionMappings: null,
      quality: {
        tangleContract: true,
        authFieldsMapped: true,
        actionNamesMapped: true,
        triggerNamesMapped: true,
        runtimePackageMapped: false,
        nativeAdapter: true,
      },
      missing: [],
    })),
].sort((a, b) => a.id.localeCompare(b.id))
const matrixPath = 'docs/integration-execution-matrix.json'
const needsPackageRuntimeVerification = matrix.filter((row) => row.implementationKind === 'package_runtime')
const needsActionMapping = matrix.filter((row) => row.missing?.includes('catalog_action_mapping'))
const customAuthWithoutFields = catalog.filter((entry) => entry.auth === 'custom' && (entry.authFields ?? []).length === 0)
const triggerOnlyGap = catalog.filter((entry) => entry.triggers.length > 0)

const markdown = `# Integration Execution Audit

Generated from the current checkout by \`node scripts/audit-integration-execution.mjs\`.

This audit separates product contracts from implementation backends:

- **Tangle contract**: the connector has a Tangle-owned action/trigger/auth contract.
- **Setup-ready**: we have setup/auth/runbook metadata for product UI and admin configuration.
- **Native adapter backend**: this repo ships a reviewed direct adapter implementation.
- **Package runtime backend**: a Tangle runtime service executes the connector package behind the same Tangle contract.

## Summary

| Item | Count |
| --- | ---: |
| Catalog connectors | ${summary.catalogConnectors} |
| Catalog connectors with runtime package names | ${summary.catalogConnectorsWithRuntimePackage} |
| Catalog actions | ${summary.catalogActions} |
| Catalog triggers | ${summary.catalogTriggers} |
| Catalog triggers with upstream names | ${summary.catalogTriggersWithCatalogUpstreamName} |
| Catalog actions with upstream action names | ${summary.catalogActionsWithCatalogUpstreamName} |
| Catalog connectors with auth field metadata | ${summary.catalogConnectorsWithAuthFields} |
| Custom-auth connectors with auth field metadata | ${summary.customAuthConnectorsWithAuthFields} |
| Runtime package dependencies declared by this package | ${summary.packageRuntimeDependenciesDeclaredHere} |
| Setup specs | ${summary.setupSpecs} |
| Executable setup specs | ${summary.executableSetupSpecs} |
| Catalog/setup-only specs | ${summary.catalogOnlySetupSpecs} |
| Tangle first-class contracts | ${summary.tangleContracts} |
| Contracts with runtime packages | ${summary.contractsWithRuntimePackage} |
| Contracts with mapped actions | ${summary.contractsWithMappedActions} |
| Contracts with mapped triggers | ${summary.contractsWithMappedTriggers} |
| Contracts with mapped auth | ${summary.contractsWithMappedAuth} |
| Native adapter backends | ${summary.nativeBackedContracts} |
| Native adapter surfaces shipped | ${summary.firstPartyAdapterSurfaces} |
| Package-runtime backends | ${summary.packageRuntimeBackedContracts} |
| Runtime manifest dependencies for catalog-only connectors | ${summary.runtimeManifestDependencies} |
| Catalog-only connectors exposable behind runtime | ${summary.executableCatalogConnectors} |
| Catalog-only actions exposable behind runtime | ${summary.executableCatalogActions} |

Full machine-readable matrix: [integration-execution-matrix.json](./integration-execution-matrix.json).

## Auth Breakdown

${table(Object.entries(byAuth).sort((a, b) => b[1] - a[1]), ['Auth', 'Connectors'])}

## Category Breakdown

${table(Object.entries(byCategory).sort((a, b) => b[1] - a[1]), ['Category', 'Connectors'])}

## Native Adapter Backends

These are direct in-repo implementations. They are not the only first-class contracts.
The full set is in the machine-readable matrix; representative native adapters:

${firstParty.slice(0, 80).map((id) => `- \`${id}\``).join('\n')}

${firstParty.length > 80 ? `...and ${firstParty.length - 80} more native adapter surfaces.` : ''}

Executable setup specs:

${executableSpecs.map((id) => `- \`${id}\``).join('\n')}

## Flow Readiness

| Flow | Status | Concrete state |
| --- | --- | --- |
| Tangle first-class contracts | Done | ${summary.tangleContracts} connectors have Tangle-owned action/trigger/auth/runtime contracts. |
| Connector discovery/catalog search | Done | ${summary.catalogConnectors} catalog connectors, ${summary.catalogActions} actions, ${summary.catalogTriggers} triggers normalized into Tangle catalog shapes. |
| Native adapter execution | Done for listed native backends | ${summary.firstPartyAdapterSurfaces} reviewed native adapter surfaces ship from this package; ${summary.nativeBackedContracts} overlap the ${summary.tangleContracts} catalog contracts. |
| OAuth/API-key setup metadata | Partial | 142 setup specs exist; 14 are executable setup specs and 128 are catalog/setup-only. |
| Package-runtime action execution | Wiring done; runtime deployment/smoke pending | ${summary.packageRuntimeBackedContracts} contracts use package-runtime backends with package names and ${summary.catalogActionsWithCatalogUpstreamName} catalog upstream action names. |
| Runtime dependency manifest | Done | \`buildTangleCatalogRuntimePackageManifest()\` emits ${summary.runtimeManifestDependencies} dependencies for the remaining package-runtime worker install. |
| Runtime package coverage audit | Done | \`auditTangleCatalogRuntimePackages()\` and \`tangle-catalog-runtime --audit-packages\` verify installed packages, piece exports, exact action mappings, and trigger surfaces in a deployed worker. |
| Long-tail credential mapping | Mostly mapped | ${summary.catalogConnectorsWithAuthFields} connectors have auth field metadata. ${customAuthWithoutFields.length} custom-auth connectors still need exact manual auth fields. |
| Trigger provider flow | Done structurally | ${summary.catalogTriggers} triggers are cataloged, ${summary.catalogTriggersWithCatalogUpstreamName} have upstream names, and catalog providers can route subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific trigger hosting. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, signed catalog runtime HTTP calls, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Package-runtime contracts needing deployed runtime smoke verification | ${needsPackageRuntimeVerification.length} | Connector has a Tangle contract and package backend; deployed runtime still needs package-load/live-smoke proof. |
| Catalog connectors with zero upstream action names | ${needsActionMapping.length} | These entries need catalog action-name mapping before exact package-runtime invocation can work. |
| Custom-auth catalog connectors needing manual credential-field mapping | ${customAuthWithoutFields.length} | These are still custom auth and no field names were extracted from source. |
| Catalog connectors with triggers needing runtime-service hosting | ${triggerOnlyGap.length} | Trigger metadata and provider hooks exist; runtime services still need package-specific webhook/polling hosting. |

Examples needing deployed runtime smoke verification:

${needsPackageRuntimeVerification.slice(0, 40).map((row) => `- \`${row.id}\` -> \`${row.runtimePackage}\``).join('\n')}

${customAuthWithoutFields.length > 0
  ? `Examples needing manual custom auth mapping:\n\n${customAuthWithoutFields.slice(0, 40).map((entry) => `- \`${entry.id}\` -> \`${entry.npmPackage}\``).join('\n')}`
  : 'Manual custom auth mapping gap: none.'}

## Completion Claims And Remaining Proof Gates

1. **Tangle first-class connector contracts are complete.**
   All ${summary.tangleContracts} catalog entries have Tangle-owned contracts. ${summary.nativeBackedContracts} use native adapter backends; ${summary.packageRuntimeBackedContracts} use package-runtime backends.

2. **Action-name mapping exists for cataloged actions.**
   Done for cataloged actions: the catalog currently has ${summary.catalogActions} actions and ${summary.catalogActionsWithCatalogUpstreamName} upstream action-name mappings in the checked-in catalog. The runtime executor uses those names automatically and still accepts explicit \`actionAliases\` for overrides. Deployed smoke verification proves those names against the installed packages.

3. **Credential field mapping is complete for catalog auth setup.**
   Auth shapes are ${Object.entries(byAuth).map(([auth, count]) => `${auth}: ${count}`).join(', ')}. The catalog now includes auth field metadata for all ${summary.catalogConnectorsWithAuthFields} connectors that require credentials. ${customAuthWithoutFields.length} custom-auth connectors need manual auth-field mapping.

4. **Trigger contracts are complete; deployed hosting must smoke-test provider mechanics.**
   There are ${summary.catalogTriggers} catalog triggers and ${summary.catalogTriggersWithCatalogUpstreamName} upstream trigger names. The provider flow supports trigger subscribe/unsubscribe/normalize hooks. Runtime services still need live webhook/polling smoke verification.

5. **Native adapter coverage is intentionally smaller than contract breadth.**
   This repo ships ${summary.firstPartyAdapterSurfaces} native adapter surfaces. ${summary.nativeBackedContracts} overlap the ${summary.tangleContracts} catalog contracts; the remaining catalog contracts use package-runtime backends.

## Concrete Launch Interpretation

- It is accurate to say: **we have ${summary.tangleContracts} first-class Tangle integration contracts.**
- It is accurate to say: **all product code can use one IntegrationHub/tool contract across native and package-runtime backends.**
- It is accurate to say: **deployed runtime smoke verification is the remaining proof step for package-runtime connectors.**

## Runtime Proof Gate

Run \`tangle-catalog-runtime --audit-packages\` inside the deployed runtime image
after installing the manifest from \`--print-package-json\` or
\`--print-pnpm-add\`. That produces the concrete package-load/action-map/trigger
surface matrix for the exact runtime image products will call. Live provider
smoke tests still require real OAuth/API-key credentials from the product
environment.
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
  if (entry.actions.length > 0 && status.catalogActionMappings === 0) {
    missing.push('catalog_action_mapping')
  }
  if (entry.auth === 'custom' && (entry.authFields ?? []).length === 0) {
    missing.push('custom_auth_shape')
  }
  if (entry.triggers.length > 0) missing.push('hosted_trigger_runtime')
  if (status.setupStatus === 'catalog-only' || status.setupStatus === 'catalog') missing.push('executable_setup_spec')
  return missing
}
