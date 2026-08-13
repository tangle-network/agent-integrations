export declare function encodeBundledAdapterManifests(manifests: readonly unknown[]): string

export declare function assertBundledManifestSnapshotFresh(input: {
  snapshot: string
  manifests: readonly unknown[]
}): { manifestCount: number }
