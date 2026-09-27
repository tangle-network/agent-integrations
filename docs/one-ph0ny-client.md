# One ph0ny client: GTR proof

`@ph0ny/sdk` owns ph0ny HTTP. This connector owns capabilities, argument validation, consent checks and credential error mapping. `createPhonyConnector({ baseUrl, fetchImpl })` selects a deployment without taking an API URL from capability arguments. The existing host factory inventory maps `PH0NY_API_URL` to this factory. The production singleton remains available.

## Before merging: install and build the actual archives

Run in fresh checkouts. Node 22, Corepack, pnpm 10.28.0 and an authenticated `gh` are required. These commands do not publish, deploy or dial.

```bash
set -euo pipefail
umask 077
export PROOF_ROOT="$(mktemp -d "$HOME/one-ph0ny.XXXXXX")"
mkdir "$PROOF_ROOT/packages"
gh repo clone drewstone/ph0ny "$PROOF_ROOT/ph0ny"
git -C "$PROOF_ROOT/ph0ny" fetch origin pro/one-ph0ny-client-complete
git -C "$PROOF_ROOT/ph0ny" checkout --detach FETCH_HEAD
git -C "$PROOF_ROOT/ph0ny" rev-parse HEAD > "$PROOF_ROOT/sdk-source.txt"
(
  cd "$PROOF_ROOT/ph0ny"
  corepack pnpm install --filter @ph0ny/sdk... --frozen-lockfile --ignore-scripts
  corepack pnpm --filter @ph0ny/sdk build
  corepack pnpm --dir packages/sdk pack --pack-destination "$PROOF_ROOT/packages"
) 2>&1 | tee "$PROOF_ROOT/sdk-build.log"
export SDK_TGZ="$PROOF_ROOT/packages/ph0ny-sdk-0.1.1.tgz"
test -s "$SDK_TGZ"

gh repo clone tangle-network/agent-integrations "$PROOF_ROOT/integrations"
git -C "$PROOF_ROOT/integrations" fetch origin pro/use-ph0ny-sdk
git -C "$PROOF_ROOT/integrations" checkout --detach FETCH_HEAD
git -C "$PROOF_ROOT/integrations" rev-parse HEAD > "$PROOF_ROOT/integrations-source.txt"
(
  cd "$PROOF_ROOT/integrations"
  # Deliberate proof-only dependency substitution in this disposable checkout.
  # It exercises the real npm archive before its version is on the registry.
  corepack pnpm add "@ph0ny/sdk@file:$SDK_TGZ" --ignore-scripts
  corepack pnpm build
  corepack pnpm pack --pack-destination "$PROOF_ROOT/packages"
) 2>&1 | tee "$PROOF_ROOT/integrations-build.log"
sha256sum "$PROOF_ROOT/packages/"*.tgz > "$PROOF_ROOT/packages.sha256"
```

Expected evidence: both build commands exit zero; the archive files exist; source SHAs, complete build logs and package SHA-256 hashes are saved. This is an archive installation, not a source alias or mocked HTTP implementation. Do not commit the proof checkout's `file:` dependency substitution.

## Real staging requests and one authorized call

Prepare a private environment file outside either repository. It must set:

```dotenv
PH0NY_STAGE_URL=https://YOUR-APPROVED-STAGING-API/v1
PH0NY_STAGE_CONFIRMED=https://YOUR-APPROVED-STAGING-API
PH0NY_API_KEY=YOUR_STAGING_KEY
PH0NY_AGENT_ID=YOUR_PERSONAL_ASSISTANT_AGENT
PH0NY_EXPECT_TOOL=ask_workspace
PH0NY_FROM_NUMBER=YOUR_PROVISIONED_E164_CALLER
PH0NY_TO_NUMBER=YOUR_CONTROLLED_E164_DESTINATION
PH0NY_CALL_CONSENT=I control the destination and authorize one call
```

The destination must belong to the operator or a person who authorized this proof. The agent must belong to this developer, support outbound calls, and have the named voice tool. A dry run or an unanswered call does not count.

```bash
export PH0NY_PROOF_ENV=/absolute/path/to/private-ph0ny-staging.env
chmod 600 "$PH0NY_PROOF_ENV"
cd "$PROOF_ROOT/integrations"
PROOF_DIR="$PROOF_ROOT/read" node --env-file="$PH0NY_PROOF_ENV" \
  scripts/prove-one-ph0ny.mjs --read
# Answer the controlled destination. This next command places one real call.
PROOF_DIR="$PROOF_ROOT/call" node --env-file="$PH0NY_PROOF_ENV" \
  scripts/prove-one-ph0ny.mjs --dial
```

The read proof must record a 2xx tools lookup containing `ask_workspace`, a successful connector credential check, and a real calls lookup. The call proof must record exactly one `POST /v1/outbound/start`, a provider call ID, and a completed call with a nonempty transcript. `build.json` records the resolved SDK and adapter modules and their hashes. `http.jsonl` records only method, path, status, duration and provider request ID. Every request is checked against the explicitly approved staging origin.

On a write timeout, inspect `call-intent.json` and provider history using its `missionId` before authorizing another attempt. The runner never retries the write. The final transcript and other call evidence are private files. Do not attach them to a public PR. Attach only redacted statuses, source/archive hashes and request IDs.

## Published installation gate

After the owner merges and publishes the exact SDK archive, and this release is published as `0.55.1`, verify a fresh disposable install without local substitutions:

```bash
mkdir "$PROOF_ROOT/registry-consumer"
cd "$PROOF_ROOT/registry-consumer"
printf '{"private":true,"type":"module"}\n' > package.json
npm install --ignore-scripts @ph0ny/sdk@0.1.1 @tangle-network/agent-integrations@0.55.1
node --input-type=module <<'JS'
import { VoiceClient } from '@ph0ny/sdk';
import { createPhonyConnector } from '@tangle-network/agent-integrations/connectors/adapters';
if (typeof new VoiceClient({apiKey: ''}).fetchResponse !== 'function') throw Error('wrong SDK artifact');
if (typeof createPhonyConnector !== 'function') throw Error('wrong adapter artifact');
console.log('registry-install-ok');
JS
```

The archive proof does not claim that an unpublished version is already on npm. Keep publication and staging-call receipts separate from build receipts. Platform line enable, in-call workspace execution, media-host selection and disable are proved in agent-dev-container PR #8183.
