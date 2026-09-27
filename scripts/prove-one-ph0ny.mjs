#!/usr/bin/env node
/** Real provider traffic only. Read-only unless --dial is explicitly supplied. */
import assert from 'node:assert/strict';
import { mkdir, appendFile, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
const mode = process.argv[2] ?? '--read';
assert(['--read', '--dial'].includes(mode), 'Use --read or --dial');
const base = new URL(required('PH0NY_STAGE_URL'));
assert(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash, 'Use an HTTPS staging API URL without credentials or query');
assert(required('PH0NY_STAGE_CONFIRMED') === base.origin, 'PH0NY_STAGE_CONFIRMED must equal the approved staging origin');
base.pathname = base.pathname.replace(/\/+$/, '');
if (!base.pathname) base.pathname = '/v1';
const apiKey = required('PH0NY_API_KEY');
const agentId = required('PH0NY_AGENT_ID');
const expectedTool = process.env.PH0NY_EXPECT_TOOL ?? 'ask_workspace';
const id = randomUUID();
const out = resolve(process.env.PROOF_DIR ?? `proof-ph0ny-${id}`);
await mkdir(out, { recursive: false, mode: 0o700 });
const save = (name, data) => writeFile(resolve(out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const require = createRequire(import.meta.url);
const sdkPath = require.resolve('@ph0ny/sdk');
const { VoiceClient } = await import(pathToFileURL(sdkPath).href);
const adapterPath = process.env.PH0NY_ADAPTER_MODULE ? resolve(process.env.PH0NY_ADAPTER_MODULE) : fileURLToPath(new URL('../dist/connectors/adapters/index.js', import.meta.url));
const { createPhonyConnector } = await import(pathToFileURL(adapterPath).href);
assert.equal(typeof createPhonyConnector, 'function', 'Build this PR before running the proof');
const transport = globalThis.fetch;
let writes = 0;
const tracedFetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(url.origin, base.origin, 'A request escaped staging');
  const method = init?.method ?? 'GET';
  if (method === 'POST' && url.pathname.endsWith('/outbound/start')) {
    writes++;
    assert(mode === '--dial' && writes === 1, 'This proof never retries a call');
  }
  const start = Date.now();
  const response = await transport(input, init);
  await appendFile(resolve(out, 'http.jsonl'), JSON.stringify({ at: new Date().toISOString(), method, path: url.pathname, status: response.status, elapsedMs: Date.now() - start, requestId: response.headers.get('x-request-id') ?? response.headers.get('cf-ray') }) + '\n', { mode: 0o600 });
  return response;
};
const client = new VoiceClient({ apiKey, baseUrl: base.href, fetchImpl: tracedFetch });
assert.equal(typeof client.fetchResponse, 'function', 'Install the SDK built from the owner PR');
assert.equal(client.fetchImpl, tracedFetch, 'The SDK must preserve the real transport hook');
const adapter = createPhonyConnector({ baseUrl: base.href, fetchImpl: tracedFetch });
const source = { id: `gtr-${id}`, kind: 'phony', credentials: { kind: 'api-key', apiKey } };
const invoke = (capabilityName, args) => ({ source, capabilityName, args });
await save('build.json', { proofId: id, stagingOrigin: base.origin, sdkModule: sdkPath, sdkSha256: createHash('sha256').update(await readFile(sdkPath)).digest('hex'), adapterModule: adapterPath, adapterSha256: createHash('sha256').update(await readFile(adapterPath)).digest('hex') });

try {
  const tools = await client.agents.listTools(agentId);
  assert(Array.isArray(tools), 'Tools lookup did not return an array');
  assert(tools.some(tool => tool.name === expectedTool), `Required voice tool ${expectedTool} is missing`);
  // Tool configs can hold webhook credentials. Never retain them as proof.
  await save('tools.json', tools.map(({ id, name, type, enabled }) => ({ id, name, type, enabled })));
  const auth = await adapter.test(source);
  assert(auth.ok, auth.reason ?? 'Adapter credential lookup failed');
  const recent = await adapter.executeRead(invoke('list_calls', { agentId, limit: 1 }));
  await save('read.json', { credentialAccepted: true, listCallsReturned: Array.isArray(recent.data?.calls) });
  if (mode === '--dial') {
    assert.equal(required('PH0NY_CALL_CONSENT'), 'I control the destination and authorize one call');
    const toNumber = required('PH0NY_TO_NUMBER');
    const fromNumber = required('PH0NY_FROM_NUMBER');
    assert(/^\+[1-9]\d{7,14}$/.test(toNumber) && /^\+[1-9]\d{7,14}$/.test(fromNumber), 'Use provisioned E.164 numbers');
    // The write is deliberately not wrapped in retry logic. On timeout, inspect
    // provider history using missionId before authorizing another attempt.
    await save('call-intent.json', { missionId: id, agentId, createdAt: new Date().toISOString() });
    const placed = await adapter.executeMutation(invoke('start_outbound_call', {
      agentId, toNumber, fromNumber, missionId: id, userConsentRecorded: true, dryRun: false,
      mission: { goal: `This is an authorized staging verification call. Ask the operator to say proof ${id.slice(0, 8)}, repeat it once, then end the call.`, maxDurationMs: 60000, maxTurns: 6 },
    }));
    await save('call-start.json', placed);
    const callId = placed.data?.callId;
    assert(placed.status === 'committed' && typeof callId === 'string' && callId && placed.data?.dryRun !== true, 'Provider did not acknowledge a real call');
    let completed = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const read = await adapter.executeRead(invoke('get_call', { id: callId }));
      await save('call-final.json', read);
      const call = read.data?.call;
      const status = call?.status;
      if (['failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(status)) throw new Error(`Call ended without proof: ${status}`);
      if (status === 'completed') {
        assert(call.transcript && JSON.stringify(call.transcript).length > 10, 'Completed row has no conversation transcript');
        completed = true;
        break;
      }
      await sleep(3000);
    }
    assert(completed, 'No completed call with a transcript within three minutes; inspect provider evidence, do not redial automatically');
  }
  assert.equal(writes, mode === '--dial' ? 1 : 0, 'Expected exactly one traced call, or no call in read-only mode');
  await save('result.json', { passed: true, mode, realProviderRequests: true, callAttempted: writes === 1 });
  console.log(`Proof passed. Private evidence: ${out}`);
} catch (error) {
  await save('result.json', { passed: false, mode, error: error instanceof Error ? error.message : String(error), callAttempted: writes === 1 });
  console.error(`Proof failed. Inspect private evidence at ${out}. No call will be retried.`);
  process.exitCode = 1;
}
