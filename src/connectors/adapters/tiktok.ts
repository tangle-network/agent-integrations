import {
  CredentialsExpired,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
} from '../types.js'
import {
  declarativeRestConnector,
  type RestConnectorSpec,
} from './declarative-rest.js'

const AUTHORIZATION_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const API_BASE_URL = 'https://open.tiktokapis.com'
const SCOPES = ['user.info.basic', 'video.list', 'video.publish'] as const
const VIDEO_FIELDS = [
  'id',
  'create_time',
  'cover_image_url',
  'share_url',
  'video_description',
  'duration',
  'height',
  'width',
  'title',
  'embed_link',
  'like_count',
  'comment_count',
  'share_count',
  'view_count',
].join(',')
const PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const

const jsonPostHeaders = {
  'content-type': 'application/json; charset=UTF-8',
}

const TIKTOK_SPEC: RestConnectorSpec = {
  kind: 'tiktok',
  displayName: 'TikTok',
  description:
    'Read the connected TikTok profile and videos, then publish approved videos or photo posts from verified HTTPS URLs.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: AUTHORIZATION_URL,
    tokenUrl: TOKEN_URL,
    scopes: [...SCOPES],
    scopeSeparator: ',',
    authorizationClientIdParam: 'client_key',
    tokenClientIdParam: 'client_key',
    tokenClientSecretParam: 'client_secret',
    clientIdEnv: 'TIKTOK_OAUTH_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_OAUTH_CLIENT_SECRET',
    tokenMetadata: { openId: 'open_id' },
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: API_BASE_URL,
  credentialsExpiredStatuses: [401],
  test: {
    method: 'GET',
    path: '/v2/user/info/',
    query: { fields: 'open_id,union_id,avatar_url,display_name' },
  },
  capabilities: [
    {
      name: 'user.info',
      class: 'read',
      description:
        'Read the connected TikTok account identity, display name, and avatar.',
      parameters: { type: 'object', properties: {} },
      requiredScopes: ['user.info.basic'],
      request: {
        method: 'GET',
        path: '/v2/user/info/',
        query: { fields: 'open_id,union_id,avatar_url,display_name' },
      },
    },
    {
      name: 'videos.list',
      class: 'read',
      description:
        'List videos for the connected creator, including public URLs, dimensions, duration, and engagement counts.',
      parameters: {
        type: 'object',
        properties: {
          cursor: {
            type: 'integer',
            minimum: 0,
            description: 'UTC millisecond cursor returned by the previous page.',
          },
          max_count: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            default: 10,
          },
        },
      },
      requiredScopes: ['video.list'],
      request: {
        method: 'POST',
        path: '/v2/video/list/',
        query: { fields: VIDEO_FIELDS },
        headers: jsonPostHeaders,
        body: { cursor: '{cursor}', max_count: '{max_count}' },
      },
    },
    {
      name: 'videos.query',
      class: 'read',
      description: 'Read up to 20 TikTok videos by their exact video ids.',
      parameters: {
        type: 'object',
        properties: {
          video_ids: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
        },
        required: ['video_ids'],
      },
      requiredScopes: ['video.list'],
      request: {
        method: 'POST',
        path: '/v2/video/query/',
        query: { fields: VIDEO_FIELDS },
        headers: jsonPostHeaders,
        body: { filters: { video_ids: '{video_ids}' } },
      },
    },
    {
      name: 'publishing.creatorInfo',
      class: 'read',
      description:
        'Read the latest creator posting limits, privacy choices, and interaction settings before presenting a publish confirmation.',
      parameters: { type: 'object', properties: {} },
      requiredScopes: ['video.publish'],
      request: {
        method: 'POST',
        path: '/v2/post/publish/creator_info/query/',
        headers: jsonPostHeaders,
        body: {},
      },
    },
    {
      name: 'publishing.status',
      class: 'read',
      description:
        'Read processing, moderation, and publication status for one publish request.',
      parameters: {
        type: 'object',
        properties: {
          publish_id: { type: 'string', minLength: 1, maxLength: 64 },
        },
        required: ['publish_id'],
      },
      requiredScopes: ['video.publish'],
      request: {
        method: 'POST',
        path: '/v2/post/publish/status/fetch/',
        headers: jsonPostHeaders,
        body: { publish_id: '{publish_id}' },
      },
    },
    {
      name: 'publishing.videoFromUrl',
      class: 'mutation',
      description:
        'Directly publish one approved video from an app-verified HTTPS URL. The adapter refreshes creator limits before it sends the post.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            format: 'uri',
            pattern: '^https://',
            description: 'Public HTTPS URL covered by the domain or URL prefix verified in the TikTok app.',
          },
          video_duration_sec: {
            type: 'number',
            exclusiveMinimum: 0,
            description: 'Measured video duration used to enforce the creator-specific limit.',
          },
          privacy_level: { type: 'string', enum: [...PRIVACY_LEVELS] },
          title: { type: 'string', maxLength: 2200 },
          disable_duet: { type: 'boolean' },
          disable_comment: { type: 'boolean' },
          disable_stitch: { type: 'boolean' },
          video_cover_timestamp_ms: { type: 'integer', minimum: 0 },
          brand_content_toggle: {
            type: 'boolean',
            description: 'True for a paid partnership that promotes a third-party business.',
          },
          brand_organic_toggle: {
            type: 'boolean',
            description: "True when the post promotes the creator's own business.",
          },
          is_aigc: {
            type: 'boolean',
            description: 'True when TikTok must label the video as AI-generated content.',
          },
        },
        required: [
          'video_url',
          'video_duration_sec',
          'privacy_level',
          'disable_duet',
          'disable_comment',
          'disable_stitch',
          'brand_content_toggle',
          'brand_organic_toggle',
        ],
      },
      requiredScopes: ['video.publish'],
      request: {
        method: 'POST',
        path: '/v2/post/publish/video/init/',
        headers: jsonPostHeaders,
        body: {
          post_info: {
            title: '{title}',
            privacy_level: '{privacy_level}',
            disable_duet: '{disable_duet}',
            disable_comment: '{disable_comment}',
            disable_stitch: '{disable_stitch}',
            video_cover_timestamp_ms: '{video_cover_timestamp_ms}',
            brand_content_toggle: '{brand_content_toggle}',
            brand_organic_toggle: '{brand_organic_toggle}',
            is_aigc: '{is_aigc}',
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: '{video_url}',
          },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'publishing.photosFromUrls',
      class: 'mutation',
      description:
        'Directly publish 1–35 approved photos from app-verified HTTPS URLs. The adapter refreshes creator options before it sends the post.',
      parameters: {
        type: 'object',
        properties: {
          photo_images: {
            type: 'array',
            minItems: 1,
            maxItems: 35,
            items: { type: 'string', format: 'uri', pattern: '^https://' },
          },
          photo_cover_index: { type: 'integer', minimum: 0 },
          privacy_level: { type: 'string', enum: [...PRIVACY_LEVELS] },
          title: { type: 'string', maxLength: 90 },
          description: { type: 'string', maxLength: 4000 },
          disable_comment: { type: 'boolean' },
          auto_add_music: { type: 'boolean' },
          brand_content_toggle: {
            type: 'boolean',
            description: 'True for a paid partnership that promotes a third-party business.',
          },
          brand_organic_toggle: {
            type: 'boolean',
            description: "True when the post promotes the creator's own business.",
          },
        },
        required: [
          'photo_images',
          'photo_cover_index',
          'privacy_level',
          'disable_comment',
          'auto_add_music',
          'brand_content_toggle',
          'brand_organic_toggle',
        ],
      },
      requiredScopes: ['video.publish'],
      request: {
        method: 'POST',
        path: '/v2/post/publish/content/init/',
        headers: jsonPostHeaders,
        body: {
          media_type: 'PHOTO',
          post_mode: 'DIRECT_POST',
          post_info: {
            title: '{title}',
            description: '{description}',
            privacy_level: '{privacy_level}',
            disable_comment: '{disable_comment}',
            auto_add_music: '{auto_add_music}',
            brand_content_toggle: '{brand_content_toggle}',
            brand_organic_toggle: '{brand_organic_toggle}',
          },
          source_info: {
            source: 'PULL_FROM_URL',
            photo_images: '{photo_images}',
            photo_cover_index: '{photo_cover_index}',
          },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
}

export interface TikTokOptions {
  clientId: string
  clientSecret: string
}

export const tiktokConnector = createTikTokConnector()

export function tiktok(options: TikTokOptions): ConnectorAdapter {
  const adapter = createTikTokConnector()
  type PendingRefresh = {
    promise: Promise<ConnectorCredentials>
    onCredentialsRotated?: ConnectorInvocation['onCredentialsRotated']
    persistence?: Promise<void>
  }
  const inFlightRefreshes = new Map<string, PendingRefresh>()

  const refresh = async (
    credentials: ConnectorCredentials,
  ): Promise<ConnectorCredentials> => {
    assertOAuthClient(options)
    if (credentials.kind !== 'oauth2' || !credentials.refreshToken) {
      throw new Error('tiktok.refreshToken: missing refresh token')
    }
    const token = await tiktokTokenRequest(
      options,
      {
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      },
      [credentials.refreshToken],
    )
    if (!token.expiresIn) {
      throw new Error('tiktok token request returned an incomplete refresh grant')
    }
    return {
      ...tokenCredentials(token),
      refreshToken: token.refreshToken ?? credentials.refreshToken,
    }
  }

  const withFreshCredentials = async (
    invocation: ConnectorInvocation,
  ): Promise<ConnectorInvocation> => {
    const credentials = invocation.source.credentials
    if (credentials.kind !== 'oauth2') return invocation
    if (
      credentials.expiresAt !== undefined &&
      credentials.expiresAt > Date.now() + 60_000
    ) {
      return invocation
    }
    if (!credentials.refreshToken) {
      throw new CredentialsExpired(
        'TikTok access token expired and no refresh token is available',
        invocation.source.id,
      )
    }
    let pending = inFlightRefreshes.get(invocation.source.id)
    if (!pending) {
      let next: PendingRefresh
      const promise = Promise.resolve().then(() => {
        if (!next.onCredentialsRotated) {
          throw new Error(
            'tiktok: credential rotation persistence callback is required before refreshing',
          )
        }
        return refresh(credentials)
      })
      next = {
        promise,
        onCredentialsRotated: invocation.onCredentialsRotated,
      }
      pending = next
      inFlightRefreshes.set(invocation.source.id, pending)
    } else if (!pending.onCredentialsRotated && invocation.onCredentialsRotated) {
      pending.onCredentialsRotated = invocation.onCredentialsRotated
    }
    const current = pending
    try {
      const refreshed = await current.promise
      current.persistence ??= Promise.resolve().then(() =>
        current.onCredentialsRotated?.(refreshed),
      )
      await current.persistence
      return {
        ...invocation,
        source: { ...invocation.source, credentials: refreshed },
      }
    } finally {
      if (inFlightRefreshes.get(invocation.source.id) === current) {
        inFlightRefreshes.delete(invocation.source.id)
      }
    }
  }

  return {
    ...adapter,
    async executeRead(invocation) {
      return adapter.executeRead!(await withFreshCredentials(invocation))
    },
    async executeMutation(invocation) {
      return adapter.executeMutation!(await withFreshCredentials(invocation))
    },
    async test(source, onCredentialsRotated) {
      try {
        const invocation = await withFreshCredentials({
          source,
          capabilityName: 'user.info',
          args: {},
          idempotencyKey: 'tiktok-connection-test',
          onCredentialsRotated,
        })
        return adapter.test(invocation.source)
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'unknown error',
        }
      }
    },
    async exchangeOAuth(input) {
      assertOAuthClient(options)
      const token = await tiktokTokenRequest(
        options,
        {
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
        },
        [input.code],
      )
      const grant = requireTikTokAuthorizationGrant(token)
      return {
        credentials: tokenCredentials(grant),
        scopes: grant.scopes,
        metadata: { openId: grant.openId },
      }
    },
    refreshToken: refresh,
  }
}

function createTikTokConnector(): ConnectorAdapter {
  const base = declarativeRestConnector(TIKTOK_SPEC)

  const executeRead = async (
    invocation: ConnectorInvocation,
  ): Promise<CapabilityReadResult> => {
    const result = await base.executeRead!(invocation)
    assertTikTokEnvelope(
      result.data,
      invocation.capabilityName,
      invocation.source.credentials,
    )
    return result
  }

  return {
    ...base,
    executeRead,
    async executeMutation(
      invocation: ConnectorInvocation,
    ): Promise<CapabilityMutationResult> {
      validatePublishInput(invocation)
      const creator = await executeRead({
        ...invocation,
        capabilityName: 'publishing.creatorInfo',
        args: {},
      })
      validateCreatorLimits(invocation, creator.data)
      const result = await base.executeMutation!(invocation)
      if (result.status === 'committed') {
        assertTikTokPublishResult(
          result.data,
          invocation.capabilityName,
          invocation.source.credentials,
        )
      }
      return result
    },
    async test(source) {
      try {
        await executeRead({
          source,
          capabilityName: 'user.info',
          args: {},
          idempotencyKey: 'tiktok-connection-test',
        })
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'unknown error',
        }
      }
    },
  }
}

function validatePublishInput(invocation: ConnectorInvocation): void {
  if (invocation.capabilityName === 'publishing.videoFromUrl') {
    const url = requiredString(invocation.args, 'video_url')
    requireHttpsUrl(url, 'video_url')
    const duration = requiredNumber(invocation.args, 'video_duration_sec')
    if (duration <= 0) throw new Error('tiktok: video_duration_sec must be greater than zero')
    requiredPrivacy(invocation.args)
    requiredBoolean(invocation.args, 'disable_duet')
    requiredBoolean(invocation.args, 'disable_comment')
    requiredBoolean(invocation.args, 'disable_stitch')
    requiredBoolean(invocation.args, 'brand_content_toggle')
    requiredBoolean(invocation.args, 'brand_organic_toggle')
    optionalUtf16Length(invocation.args, 'title', 2200)
    return
  }
  if (invocation.capabilityName === 'publishing.photosFromUrls') {
    const photos = invocation.args.photo_images
    if (!Array.isArray(photos) || photos.length < 1 || photos.length > 35) {
      throw new Error('tiktok: photo_images must contain between 1 and 35 URLs')
    }
    for (const [index, value] of photos.entries()) {
      if (typeof value !== 'string') {
        throw new Error(`tiktok: photo_images[${index}] must be a string`)
      }
      requireHttpsUrl(value, `photo_images[${index}]`)
    }
    const cover = requiredNumber(invocation.args, 'photo_cover_index')
    if (!Number.isInteger(cover) || cover < 0 || cover >= photos.length) {
      throw new Error('tiktok: photo_cover_index must identify one supplied photo')
    }
    requiredPrivacy(invocation.args)
    requiredBoolean(invocation.args, 'disable_comment')
    requiredBoolean(invocation.args, 'auto_add_music')
    requiredBoolean(invocation.args, 'brand_content_toggle')
    requiredBoolean(invocation.args, 'brand_organic_toggle')
    optionalUtf16Length(invocation.args, 'title', 90)
    optionalUtf16Length(invocation.args, 'description', 4000)
    return
  }
  throw new Error(`tiktok: unknown mutation capability ${invocation.capabilityName}`)
}

function validateCreatorLimits(
  invocation: ConnectorInvocation,
  envelope: unknown,
): void {
  const data = readEnvelopeData(envelope, 'publishing.creatorInfo')
  const privacy = requiredString(invocation.args, 'privacy_level')
  const choices = data.privacy_level_options
  if (!Array.isArray(choices) || !choices.every((value) => typeof value === 'string')) {
    throw new Error('tiktok publishing.creatorInfo returned invalid privacy_level_options')
  }
  if (!choices.includes(privacy)) {
    throw new Error(`tiktok: privacy_level ${privacy} is unavailable for this creator`)
  }
  requireDisabledInteraction(invocation.args, data, 'disable_comment', 'comment_disabled')
  if (invocation.capabilityName === 'publishing.videoFromUrl') {
    requireDisabledInteraction(invocation.args, data, 'disable_duet', 'duet_disabled')
    requireDisabledInteraction(invocation.args, data, 'disable_stitch', 'stitch_disabled')
    const maximum = data.max_video_post_duration_sec
    if (typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0) {
      throw new Error('tiktok publishing.creatorInfo returned an invalid video-duration limit')
    }
    const duration = requiredNumber(invocation.args, 'video_duration_sec')
    if (duration > maximum) {
      throw new Error(
        `tiktok: video duration ${duration}s exceeds this creator's ${maximum}s limit`,
      )
    }
  }
}

function assertTikTokEnvelope(
  value: unknown,
  capabilityName: string,
  credentials?: ConnectorCredentials,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`tiktok ${capabilityName} returned a malformed response`)
  }
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new Error(`tiktok ${capabilityName} returned no error status`)
  }
  const code = (error as Record<string, unknown>).code
  if (code !== 'ok') {
    const message = (error as Record<string, unknown>).message
    const detail =
      typeof message === 'string' && message
        ? ` — ${redact(message.slice(0, 200), credentialValues(credentials))}`
        : ''
    const safeCode = redact(
      safeProviderValue(code),
      credentialValues(credentials),
    )
    throw new Error(`tiktok ${capabilityName} failed: ${safeCode}${detail}`)
  }
}

function requireDisabledInteraction(
  args: Record<string, unknown>,
  creator: Record<string, unknown>,
  argumentName: string,
  creatorField: string,
): void {
  const disabled = creator[creatorField]
  if (typeof disabled !== 'boolean') {
    throw new Error(`tiktok publishing.creatorInfo returned invalid ${creatorField}`)
  }
  if (disabled && args[argumentName] !== true) {
    throw new Error(
      `tiktok: ${argumentName} must be true because the creator disabled this interaction`,
    )
  }
}

function readEnvelopeData(
  envelope: unknown,
  capabilityName: string,
  credentials?: ConnectorCredentials,
): Record<string, unknown> {
  assertTikTokEnvelope(envelope, capabilityName, credentials)
  const data = (envelope as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`tiktok ${capabilityName} returned malformed data`)
  }
  return data as Record<string, unknown>
}

function assertTikTokPublishResult(
  envelope: unknown,
  capabilityName: string,
  credentials: ConnectorCredentials,
): void {
  const data = readEnvelopeData(envelope, capabilityName, credentials)
  const publishId = data.publish_id
  if (
    typeof publishId !== 'string' ||
    !publishId.trim() ||
    publishId.length > 64
  ) {
    throw new Error(`tiktok ${capabilityName} returned an invalid publish_id`)
  }
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || !value) {
    throw new Error(`tiktok: missing required argument: ${name}`)
  }
  return value
}

function requiredNumber(args: Record<string, unknown>, name: string): number {
  const value = args[name]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`tiktok: missing required argument: ${name}`)
  }
  return value
}

function requiredBoolean(args: Record<string, unknown>, name: string): boolean {
  const value = args[name]
  if (typeof value !== 'boolean') {
    throw new Error(`tiktok: missing required argument: ${name}`)
  }
  return value
}

function requiredPrivacy(args: Record<string, unknown>): string {
  const value = requiredString(args, 'privacy_level')
  if (!(PRIVACY_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`tiktok: unsupported privacy_level ${value}`)
  }
  return value
}

function optionalUtf16Length(
  args: Record<string, unknown>,
  name: string,
  maximum: number,
): void {
  const value = args[name]
  if (value === undefined) return
  if (typeof value !== 'string') throw new Error(`tiktok: ${name} must be a string`)
  if (value.length > maximum) {
    throw new Error(`tiktok: ${name} exceeds the ${maximum} UTF-16-unit limit`)
  }
}

function requireHttpsUrl(value: string, name: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`tiktok: ${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`tiktok: ${name} must be a valid HTTPS URL`)
  }
}

interface TikTokTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  openId?: string
}

interface TikTokAuthorizationGrant extends TikTokTokenResponse {
  refreshToken: string
  expiresIn: number
  scope: string
  openId: string
  scopes: string[]
}

async function tiktokTokenRequest(
  options: TikTokOptions,
  grant: Record<string, string>,
  extraRedactions: readonly string[],
): Promise<TikTokTokenResponse> {
  const body = new URLSearchParams({
    client_key: options.clientId,
    client_secret: options.clientSecret,
    ...grant,
  })
  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'unknown transport error'
    throw new Error(`tiktok token request failed: ${redact(message, [options.clientId, options.clientSecret, ...extraRedactions])}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `tiktok token request failed: ${response.status} ${response.statusText} — ${redact(
        detail.slice(0, 300),
        [options.clientId, options.clientSecret, ...extraRedactions],
      )}`,
    )
  }
  const json = (await response.json()) as Record<string, unknown>
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('tiktok token request returned no access_token')
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === 'string' && json.refresh_token
        ? json.refresh_token
        : undefined,
    expiresIn:
      typeof json.expires_in === 'number' && json.expires_in > 0
        ? json.expires_in
        : undefined,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    openId: typeof json.open_id === 'string' ? json.open_id : undefined,
  }
}

function tokenCredentials(
  token: TikTokTokenResponse,
): Extract<ConnectorCredentials, { kind: 'oauth2' }> {
  return {
    kind: 'oauth2',
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : undefined,
  }
}

function requireTikTokAuthorizationGrant(
  token: TikTokTokenResponse,
): TikTokAuthorizationGrant {
  const scopes = token.scope ? splitScopes(token.scope) : []
  if (
    !token.refreshToken ||
    !token.expiresIn ||
    !token.openId ||
    scopes.length === 0
  ) {
    throw new Error(
      'tiktok token request returned an incomplete authorization grant',
    )
  }
  return { ...token, scopes } as TikTokAuthorizationGrant
}

function splitScopes(scope: string): string[] {
  return scope.split(',').map((value) => value.trim()).filter(Boolean)
}

function assertOAuthClient(options: TikTokOptions): void {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      'TikTok OAuth client not configured (TIKTOK_OAUTH_CLIENT_KEY / TIKTOK_OAUTH_CLIENT_SECRET)',
    )
  }
}

function redact(value: string, secrets: readonly string[]): string {
  let redacted = value
  for (const secret of secrets) {
    if (!secret) continue
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

function credentialValues(
  credentials: ConnectorCredentials | undefined,
): string[] {
  if (!credentials) return []
  switch (credentials.kind) {
    case 'oauth2':
      return [credentials.accessToken, credentials.refreshToken ?? '']
    case 'api-key':
      return [credentials.apiKey]
    case 'hmac':
      return [credentials.secret]
    case 'custom':
      return Object.values(credentials.values).filter(
        (value): value is string => typeof value === 'string',
      )
    case 'none':
      return []
  }
}

function safeProviderValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 80)
  return 'unknown_error'
}
