# Knowledge ingestion provider contracts

These are provider operations, not a managed knowledge service. The product owns
source selection, ingestion jobs, tenant authorization, refresh checkpoints,
embedding configuration, and the ownership of derived indexes. `agent-knowledge`
remains the evidence/knowledge record owner. Reuse Hub connections, grants,
capabilities and `IntegrationConnection.secretRef`; never send provider credentials
to an app or sandbox UI.

## S3 sources

`amazon-s3.files.list` takes `{ bucket, prefix?, maxKeys?, continuationToken? }`.
`maxKeys` is 1–1000. `bucket` can be omitted only when the AWS credential bundle
already contains a bucket. It must be a bucket name, not `s3://...` or an HTTPS URL.
The adapter calls ListObjectsV2 and returns:

```json
{"objects":[{"key":"docs/a.txt","etag":"\"version-hash\"","size":42}],"isTruncated":true,"nextContinuationToken":"opaque-token"}
```

The result is in the normal read result's `data`. Follow the opaque token until
`isTruncated` is false, even when an intermediate page is empty. There is no
adapter page-count cap. The host must enforce its own total object, byte, time,
and cost budgets and report a limit explicitly rather than call a partial import
complete. XML parsing is provider-owned; malformed pages, DTD/entity declarations,
missing cursors, >1000 objects and responses larger than 2 MiB fail closed.

`amazon-s3.files.readBytes` takes `{ bucket, key, versionId? }` and returns
`data: { base64, contentType? }` and an optional read-result `etag`. Decode base64
before extraction, hashing or evidence registration. The 32 MiB response budget is
enforced while streaming as well as against Content-Length. `files.read` retains
JSON-or-text decoding for existing callers; source ingestion should use readBytes
so JSON formatting and binary files are preserved. Keys are exact bucket-relative
strings (1–1024 UTF-8 bytes). Nested slashes remain slashes, percent escapes are
literal key text, and `.`/`..` path segments are rejected before fetch. Object URL
parsing belongs at the product boundary: produce a bucket/key, never fetch an
arbitrary URL using the provider credential.

AWS credentials are resolved from the existing connection secret as the supported
JSON bundle `{accessKeyId, secretAccessKey, region, sessionToken?, endpoint?, bucket?}`.
Requests use SigV4. An explicit endpoint overrides the regional S3 endpoint;
endpoint custody and network policy stay with the host. Knowledge import hosts must restrict to official AWS endpoints or use a DNS-pinned public-HTTPS transport for custom hosts; merely selecting a saved connection does not make an arbitrary endpoint safe. These reads reject redirects. This does not create a new
authentication or credential-storage model. Source detach does not delete source
objects. The legacy upload/copy/move/presign capabilities are not part of this
read-only knowledge ingestion contract.

## Existing vector databases and embeddings

| Provider | Connection metadata | Discover/connect | Create derived index | Write/query/delete |
| --- | --- | --- | --- | --- |
| Qdrant | `qdrantUrl` | `collections.list`, `collections.get` (`collection_name`) | `collections.create` (`collection_name`, `vectors: {size, distance}` or named vector map) | `points.upsert`, `points.query`/`points.search`, `points.delete`; all collection-scoped |
| Pinecone | `indexHost` for vector data | `indexes.list`, `indexes.describe` (`indexName`); retain returned host | `indexes.create` (`name`, `dimension`, `metric`, `spec`) | `vectors.upsert`, `vectors.query` (`top_k`, `vector`, optional `namespace`, `filter`), `vectors.delete` |
| Weaviate | `clusterUrl` | `schema.list`, `schema.get` (`className`) | `schema.create` (`class`, optional `vectorizer`, `properties`, configs) | `objects.create`/`batch.objects.create`, `graphql.query`, `objects.delete`/`batch.objects.delete` |
| OpenAI embeddings | Optional `baseUrl` | Existing OpenAI connection | Not an index service | `embeddings.create` (`model`, `input`, optional `dimensions`, `encoding_format`) |

All are executable adapter primitives. They do not automatically provision a
hosted cluster or import a corpus. The host must record embedding model, dimension,
metric and optional vector name and verify compatibility before querying an
existing collection. Existing remote vectors must have a declared mapping to text
and source provenance; connecting a database does not create valid evidence by
itself. Weaviate may use its configured server vectorizer or explicit vectors.

Managed index creation and connecting an existing index are different operations.
Track which derived collection/index and vector IDs the host owns. Refresh must
fetch source revisions, re-extract/re-embed changed content, and remove stale
owned vector IDs; do not append duplicate chunks indefinitely. Detaching an
external index must not delete it. Deleting managed derived data must be explicit
and scoped to the recorded owned resource. Provider upsert/delete APIs exist;
knowledge refresh jobs and lifecycle orchestration remain product responsibilities.

## Git repository sources

Resolve a mutable branch/tag/HEAD with `github.repos.getCommit({owner, repo, ref})`.
Its result preserves GitHub's `{sha, commit: {tree: {sha}}}` shape. Persist the
resolved commit SHA and use `commit.tree.sha` with `git.getTree`; read selected
blob SHAs with `git.getBlob`. `git.getCommit` is a different endpoint accepting an
immutable SHA only, so do not send `HEAD` to it. The repository commit read rejects
redirects and limits responses to 8 MiB. Slash-containing refs remain one encoded
path parameter. Hosts must reject truncated tree listings or explicitly walk
subtrees, bound total source bytes/count, and retain revision provenance.

Qdrant collection list/get/exists/create/delete and point query/search/scroll/upsert/delete
reject redirects (including redirects that could forward the custom api-key
header) and cap responses at 8 MiB. Knowledge hosts still must enforce official
Cloud endpoints or use a maintained DNS-pinned public transport for custom hosts;
this adapter-level guard is not a general custom-endpoint SSRF defense.
