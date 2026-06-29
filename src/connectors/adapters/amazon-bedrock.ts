import { declarativeRestConnector } from './declarative-rest.js'

// AWS Bedrock exposes two HTTPS surfaces:
//   - bedrock-runtime.<region>.amazonaws.com   (model invocation, converse)
//   - bedrock.<region>.amazonaws.com           (control plane: list/describe models)
// The catalog action set (send.prompt, generate.content.from.image, generate.image,
// generate.embeddings, custom.api.call) all flow through bedrock-runtime's
// /model/{modelId}/invoke and /model/{modelId}/converse, plus the control-plane
// /foundation-models index. We model the underlying HTTP surface (not the
// per-prompt action wrappers) because that's what an agent needs to compose
// arbitrary generation flows on top of.
//
// Region comes from the credential bundle in the api-key field (falling back to
// metadata.region, then us-east-1) and is substituted into the {region} host
// templates below, so the same connector targets any AWS region. Each request is
// signed with AWS Signature V4 (`credentialPlacement: aws-sigv4`, service
// `bedrock`).

export const amazonBedrockConnector = declarativeRestConnector({
  kind: 'amazon-bedrock',
  displayName: 'Amazon Bedrock',
  description: 'Invoke AWS Bedrock foundation models for text generation, image analysis, image generation, and embeddings; list available foundation models.',
  auth: { kind: 'api-key', hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}. Optional "sessionToken" and "endpoint". Requests are signed with AWS Signature V4; the region selects the bedrock-runtime.<region>.amazonaws.com endpoint.' },
  category: 'other',
  // Bedrock model invocations are non-idempotent generative calls; the manifest
  // surfaces are advisory (best-effort), not authoritative state.
  defaultConsistencyModel: 'advisory',
  // bedrock-runtime is the workhorse endpoint for invoke/converse. Control-plane
  // listing operations override the host on a per-capability basis below.
  credentialPlacement: { kind: 'aws-sigv4', service: 'bedrock' },
  baseUrl: { metadataKey: 'runtimeEndpoint', fallback: 'https://bedrock-runtime.{region}.amazonaws.com' },
  defaultHeaders: { 'content-type': 'application/json', accept: 'application/json' },
  test: { method: 'GET', path: '/foundation-models', headers: { host: 'bedrock.{region}.amazonaws.com' } },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List foundation models available in the configured AWS region.',
      parameters: {
        type: 'object',
        properties: {
          byProvider: { type: 'string', description: 'Filter to a specific provider (e.g. anthropic, amazon, meta).' },
          byOutputModality: { type: 'string', description: 'Filter by output modality (TEXT, IMAGE, EMBEDDING).' },
          byInferenceType: { type: 'string', description: 'Filter by inference type (ON_DEMAND, PROVISIONED).' },
        },
      },
      request: {
        method: 'GET',
        path: '/foundation-models',
        query: {
          byProvider: '{byProvider}',
          byOutputModality: '{byOutputModality}',
          byInferenceType: '{byInferenceType}',
        },
        // Control-plane host override: the runtime folds this `host` header into
        // the request URL (region substituted) so SigV4 signs the bedrock.<region>
        // control-plane host, not the bedrock-runtime base host.
        headers: { host: 'bedrock.{region}.amazonaws.com' },
      },
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Describe a single foundation model.',
      parameters: {
        type: 'object',
        properties: {
          modelIdentifier: { type: 'string', description: 'Model identifier or ARN (e.g. anthropic.claude-3-sonnet-20240229-v1:0).' },
        },
        required: ['modelIdentifier'],
      },
      request: {
        method: 'GET',
        path: '/foundation-models/{modelIdentifier}',
        headers: { host: 'bedrock.{region}.amazonaws.com' },
      },
    },
    {
      name: 'model.invoke',
      class: 'mutation',
      description: 'Invoke a foundation model with a raw provider-native request body. Used for send.prompt, generate.image, generate.embeddings, and generate.content.from.image flows; the body schema is the model provider native schema (Anthropic messages, Titan image gen, Titan/Cohere embeddings, etc.).',
      parameters: {
        type: 'object',
        properties: {
          modelId: { type: 'string', description: 'Bedrock model id (e.g. anthropic.claude-3-sonnet-20240229-v1:0, amazon.titan-image-generator-v1, amazon.titan-embed-text-v2:0).' },
          body: { type: 'object', description: 'Provider-native request body (passed through as JSON).' },
          accept: { type: 'string', description: 'Response media type. Defaults to application/json; image generation returns application/json with base64-encoded artifacts.' },
          contentType: { type: 'string', description: 'Request media type. Defaults to application/json.' },
        },
        required: ['modelId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/model/{modelId}/invoke',
        body: '{body}',
        headers: {
          accept: '{accept}',
          'content-type': '{contentType}',
        },
      },
      // Bedrock InvokeModel is generative and non-idempotent: identical inputs
      // typically yield different outputs (sampling), and Bedrock does not
      // dedupe by client-supplied idempotency keys on this path.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'model.converse',
      class: 'mutation',
      description: 'Multi-turn conversation against a foundation model using the unified Bedrock Converse API (model-agnostic messages array, system prompt, inference config, tool config).',
      parameters: {
        type: 'object',
        properties: {
          modelId: { type: 'string', description: 'Bedrock model id supporting Converse.' },
          messages: {
            type: 'array',
            description: 'Conversation turns. Each item: { role: "user" | "assistant", content: [{ text } | { image } | { toolUse } | { toolResult }] }.',
          },
          system: {
            type: 'array',
            description: 'Optional system prompt blocks: [{ text }].',
          },
          inferenceConfig: {
            type: 'object',
            description: 'Optional inference settings (maxTokens, temperature, topP, stopSequences).',
          },
          toolConfig: {
            type: 'object',
            description: 'Optional tool-use configuration (tools, toolChoice).',
          },
          additionalModelRequestFields: {
            type: 'object',
            description: 'Provider-specific fields passed through verbatim (e.g. Anthropic top_k).',
          },
        },
        required: ['modelId', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/model/{modelId}/converse',
        body: {
          messages: '{messages}',
          system: '{system}',
          inferenceConfig: '{inferenceConfig}',
          toolConfig: '{toolConfig}',
          additionalModelRequestFields: '{additionalModelRequestFields}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'model.invoke.stream',
      class: 'mutation',
      description: 'Invoke a foundation model with streaming response (server-sent event stream of model output chunks). Body and modelId match model.invoke; the response is an event stream rather than a single JSON document.',
      parameters: {
        type: 'object',
        properties: {
          modelId: { type: 'string' },
          body: { type: 'object', description: 'Provider-native request body.' },
          accept: { type: 'string', description: 'Defaults to application/vnd.amazon.eventstream.' },
          contentType: { type: 'string', description: 'Defaults to application/json.' },
        },
        required: ['modelId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/model/{modelId}/invoke-with-response-stream',
        body: '{body}',
        headers: {
          accept: '{accept}',
          'content-type': '{contentType}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
