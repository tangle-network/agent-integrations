import { InvalidCapabilityArgument, type ConnectorAdapter, type ConnectorInvocation } from '../types.js'
import {
  declarativeRestConnector,
  executeRestRequest,
  mutationResultFromTransport,
  type RestConnectorSpec,
  type RestRequestSpec,
} from './declarative-rest.js'

// A full object id: SHA-1 (40 hex) or, for SHA-256 repositories, 64 hex.
const GIT_SHA = '(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})'
/** The most files one pulls.propose call may write or delete. */
const PROPOSE_MAX_FILES = 50
// A conservative git branch name: no spaces, `..`, `@{`, control, glob or
// leading/trailing separator characters, and no `.lock` suffix. Checked in
// code rather than published as a schema pattern: model providers compile
// published patterns and do not all accept lookarounds.
const PLAIN_BRANCH = '^(?!/)(?!.*//)(?!.*\\.\\.)(?!.*@\\{)(?!.*\\.lock$)[A-Za-z0-9._/-]+(?<![/.])$'

const repoParams = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
  },
  required: ['owner', 'repo'],
}

const githubSpec: RestConnectorSpec = {
  kind: 'github',
  displayName: 'GitHub',
  description: 'Search repositories/issues and create or update GitHub issues through a user-scoped token.',
  auth: { kind: 'api-key', hint: 'GitHub fine-grained personal access token or installation token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.github.com',
  defaultHeaders: {
    'x-github-api-version': '2022-11-28',
  },
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'repositories.get',
      class: 'read',
      description: 'Read repository metadata.',
      parameters: repoParams,
      request: { method: 'GET', path: '/repos/{owner}/{repo}' },
    },
    {
      name: 'repos.listForAuthenticatedUser',
      class: 'read',
      description:
        'List repositories the connected account can read, including private and organization repositories the token is granted. Use it to suggest a repository before reading its files.',
      parameters: {
        type: 'object',
        properties: {
          sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'] },
          affiliation: { type: 'string', description: 'Comma-separated owner, collaborator, organization_member.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/user/repos',
        query: { sort: '{sort}', affiliation: '{affiliation}', per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search GitHub issues and pull requests.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['q'],
      },
      request: { method: 'GET', path: '/search/issues', query: { q: '{q}', per_page: '{per_page}' } },
    },
    {
      name: 'users.getAuthenticated',
      class: 'read',
      description:
        'Resolve the authenticated user (the token owner). Quest verification anchors author:/owner: filters to this login, so it must be resolved first.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/user' },
    },
    {
      name: 'activity.checkStarred',
      class: 'read',
      description:
        'Check whether the authenticated user has starred a repository. Returns { exists: true } when starred, { exists: false } when not.',
      parameters: repoParams,
      request: { method: 'GET', path: '/user/starred/{owner}/{repo}', existenceCheck: true },
    },
    {
      name: 'users.checkFollowing',
      class: 'read',
      description:
        'Check whether the authenticated user follows another user. Returns { exists: true } when following, { exists: false } when not.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'Login of the user to check the follow against.' } },
        required: ['target'],
      },
      request: { method: 'GET', path: '/user/following/{target}', existenceCheck: true },
    },
    {
      name: 'repos.listCommits',
      class: 'read',
      description:
        'List commits on a repository, optionally filtered to a single author login/email. Used to verify a user contributed to the repo.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          author: { type: 'string', description: 'Restrict to commits authored by this GitHub login or email.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/commits',
        query: { author: '{author}', per_page: '{per_page}' },
      },
    },
    {
      name: 'repos.getReadme',
      class: 'read',
      description: "Read a repository's README (returns base64-encoded content). Used to verify README mentions.",
      parameters: repoParams,
      request: { method: 'GET', path: '/repos/{owner}/{repo}/readme' },
    },
    {
      name: 'search.code',
      class: 'read',
      description: 'Search code across GitHub. Used to verify code usage of a symbol or string.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['q'],
      },
      request: { method: 'GET', path: '/search/code', query: { q: '{q}', per_page: '{per_page}' } },
    },
    {
      name: 'orgs.checkMembership',
      class: 'read',
      description:
        'Check whether a user is a member of an organization. Returns { exists: true } when a member, { exists: false } when not.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string' },
          user: { type: 'string', description: 'Login of the user to check membership for.' },
        },
        required: ['org', 'user'],
      },
      request: { method: 'GET', path: '/orgs/{org}/members/{user}', existenceCheck: true },
    },
    {
      name: 'pulls.get',
      class: 'read',
      description: 'Read a single pull request, including its head/base refs and the repository it targets.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer', description: 'The pull request number within the repository.' },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/pulls/{pull_number}' },
    },
    {
      name: 'pulls.list',
      class: 'read',
      description: 'List pull requests in a repository, newest first by default.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to open.' },
          sort: { type: 'string', enum: ['created', 'updated', 'popularity', 'long-running'] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/pulls',
        query: { state: '{state}', sort: '{sort}', direction: '{direction}', per_page: '{per_page}' },
      },
    },
    {
      name: 'pulls.listFiles',
      class: 'read',
      description: 'List the files a pull request changes, with per-file patches. Page with per_page — a large PR exceeds a single response budget.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/pulls/{pull_number}/files',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'pulls.listReviews',
      class: 'read',
      description: 'List the reviews already submitted on a pull request, so a reviewer does not repeat existing findings.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'pulls.listReviewComments',
      class: 'read',
      description: 'List the inline review comments on a pull request.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/pulls/{pull_number}/comments',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'repos.getCombinedStatusForRef',
      class: 'read',
      description:
        'Read the combined commit status for a ref (a SHA, branch or tag): its overall state and every status context, such as CI jobs or deploy receipts. Page with per_page.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string', description: 'A commit SHA, branch name or tag name.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'ref'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/commits/{ref}/status',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'checks.listForRef',
      class: 'read',
      description:
        'List the check runs (for example GitHub Actions jobs) reported on a ref, with their status and conclusion. Page with per_page.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string', description: 'A commit SHA, branch name or tag name.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'ref'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/commits/{ref}/check-runs',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'issues.get',
      class: 'read',
      description: 'Read a single issue by number.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/issues/{issue_number}' },
    },
    {
      name: 'issues.list',
      class: 'read',
      description: 'List issues in a repository. GitHub includes pull requests here; filter on the `pull_request` key when that matters.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          labels: { type: 'string', description: 'Comma-separated label names.' },
          sort: { type: 'string', enum: ['created', 'updated', 'comments'] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/issues',
        query: {
          state: '{state}',
          labels: '{labels}',
          sort: '{sort}',
          direction: '{direction}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'issues.listComments',
      class: 'read',
      description: 'Read the comment thread on an issue or pull request before replying to it.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/issues/{issue_number}/comments',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'repos.listLabels',
      class: 'read',
      description: 'List the labels a repository defines, so an automation applies one that exists rather than inventing it.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/labels',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    {
      name: 'repos.listBranches',
      class: 'read',
      description: "List a repository's branches. Used to resolve the default branch to diff against.",
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/branches',
        query: { per_page: '{per_page}', page: '{page}' },
      },
    },
    // ---------- Git Data: propose a change on a NEW branch ----------
    // A change is proposed as a draft pull request in this order, each step
    // one request:
    //   1. repos.getBranch    the BASE branch by name: head commit + tree sha
    //   2. git.createTree     base tree + every changed file -> new tree sha
    //   3. git.createCommit   new tree, parents [base head]  -> new commit sha
    //      git.getCommit      optional: verify that commit by sha
    //   4. git.createRef      refs/heads/<new-branch> at the new commit
    //   5. pulls.create       head <new-branch>, base <base>, draft: true
    // (git.getTree / git.getBlob read the files being edited before step 2.)
    // There is deliberately no ref-update action: a caller can create a new
    // branch but can never move an existing one, so the default branch and
    // every protected branch stay out of reach. GitHub refuses
    // `git.createRef` for a ref that already exists (422).
    {
      name: 'repos.getBranch',
      class: 'read',
      description:
        'Read one branch BY NAME: `commit.sha` is its head commit and `commit.commit.tree.sha` that commit\'s tree. '
        + 'Step 1 of a draft pull request: read the base branch (e.g. `main`), then git.createTree on that tree, '
        + 'git.createCommit with that head as parent, git.createRef `refs/heads/<new-branch>`, and pulls.create with `draft: true`. '
        + 'A commit sha is not a branch name: read a commit with git.getCommit.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          branch: { type: 'string', description: 'Branch name such as `main` or `gtm-agent/hero-copy`; never a commit sha or a `refs/` path.' },
        },
        required: ['owner', 'repo', 'branch'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/branches/{branch}' },
      refuseArguments: [
        {
          field: 'branch',
          pattern: `^${GIT_SHA}$`,
          message: 'that is a commit sha, not a branch name. Pass a branch name such as `main`; read a commit by sha with git.getCommit.',
        },
        {
          field: 'branch',
          pattern: '^refs/',
          message: 'pass the bare branch name (`main`), not a ref path (`refs/heads/main`).',
        },
      ],
    },
    {
      name: 'repos.getCommit',
      class: 'read',
      description: 'Resolve a branch, tag, HEAD or commit SHA to an immutable repository commit. Returns sha and commit.tree.sha; use the tree SHA for a consistent source snapshot.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string', minLength: 1, description: 'Branch, tag, HEAD, or commit SHA. Slash-containing branch names are supported.' },
        },
        required: ['owner', 'repo', 'ref'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/commits/{ref}',
        redirect: 'error',
        maxResponseBytes: 8 * 1024 * 1024,
      },
    },
    {
      name: 'git.getCommit',
      class: 'read',
      description:
        'Read one commit object by sha: its `tree.sha`, `parents[].sha`, message and author. '
        + 'Use it to verify the commit git.createCommit returned before git.createRef points a new branch at it.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          commit_sha: { type: 'string', pattern: `^${GIT_SHA}$`, description: 'Full commit sha.' },
        },
        required: ['owner', 'repo', 'commit_sha'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/git/commits/{commit_sha}' },
    },
    {
      name: 'git.getTree',
      class: 'read',
      description: 'Read a git tree. With `recursive: "1"` it lists every file path with its blob sha, so files can be read without path URLs.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          tree_sha: { type: 'string', description: 'Tree sha (or a commit sha / branch name).' },
          recursive: { type: 'string', enum: ['1'], description: 'Set to "1" to list the whole tree.' },
        },
        required: ['owner', 'repo', 'tree_sha'],
      },
      request: {
        method: 'GET',
        path: '/repos/{owner}/{repo}/git/trees/{tree_sha}',
        query: { recursive: '{recursive}' },
      },
    },
    {
      name: 'git.getBlob',
      class: 'read',
      description: 'Read one file blob by sha. GitHub returns its content base64-encoded (`encoding: "base64"`).',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          file_sha: { type: 'string' },
        },
        required: ['owner', 'repo', 'file_sha'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/git/blobs/{file_sha}' },
    },
    {
      name: 'git.createTree',
      class: 'mutation',
      description: 'Prefer pulls.propose, which proposes a whole change under one owner approval; each of these low-level steps needs its own. Step 2 of a draft pull request. Write a tree: `base_tree` plus the changed entries. Each entry is `{ path, mode: "100644", type: "blob", content }` (use `sha: null` to delete a file). Creates an unreferenced object; nothing is visible until a branch points at a commit using it.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          base_tree: { type: 'string', pattern: `^${GIT_SHA}$`, description: 'Tree sha of the base commit: `commit.commit.tree.sha` from repos.getBranch.' },
          tree: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                mode: { type: 'string', enum: ['100644', '100755', '040000', '160000', '120000'] },
                type: { type: 'string', enum: ['blob', 'tree', 'commit'] },
                content: { type: 'string' },
                sha: { type: ['string', 'null'] },
              },
              required: ['path', 'mode', 'type'],
            },
          },
        },
        required: ['owner', 'repo', 'base_tree', 'tree'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/git/trees',
        body: { base_tree: '{base_tree}', tree: '{tree}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'git.createCommit',
      class: 'mutation',
      description: 'Prefer pulls.propose for a pull request (one owner approval for the whole change). Step 3 of a draft pull request. Write a commit object for a tree with explicit parents (normally the base branch head). Creates an unreferenced object; it moves no branch. Its `sha` is what git.createRef needs.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          message: { type: 'string' },
          tree: { type: 'string', pattern: `^${GIT_SHA}$`, description: 'Tree sha from git.createTree.' },
          parents: { type: 'array', items: { type: 'string', pattern: `^${GIT_SHA}$` }, description: 'Parent commit shas: the base branch head from repos.getBranch.' },
        },
        required: ['owner', 'repo', 'message', 'tree', 'parents'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/git/commits',
        body: { message: '{message}', tree: '{tree}', parents: '{parents}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'git.createRef',
      class: 'mutation',
      description: 'Prefer pulls.propose for a pull request (one owner approval for the whole change). Step 4 of a draft pull request. Create a NEW branch at a commit: `ref` must be `refs/heads/<new-branch>` and `sha` the commit from git.createCommit. Never moves an existing branch; GitHub returns 422 when the ref already exists. Then pulls.create with `head: "<new-branch>"` (no `refs/heads/`) and `draft: true`.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string', pattern: '^refs/heads/.+', description: 'Fully qualified new branch ref, e.g. `refs/heads/gtm-agent/hero-copy`.' },
          sha: { type: 'string', pattern: `^${GIT_SHA}$`, description: 'Commit sha from git.createCommit.' },
        },
        required: ['owner', 'repo', 'ref', 'sha'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/git/refs',
        body: { ref: '{ref}', sha: '{sha}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create an issue in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['owner', 'repo', 'title'],
      },
      request: { method: 'POST', path: '/repos/{owner}/{repo}/issues', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update an issue by number.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed'] },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
      request: { method: 'PATCH', path: '/repos/{owner}/{repo}/issues/{issue_number}', body: 'args' },
      cas: 'etag-if-match',
    },
    {
      name: 'pulls.create',
      class: 'mutation',
      description: 'Open a pull request from `head` into `base` on the target repository. To propose file changes, prefer pulls.propose, which writes the files and opens the draft under one owner approval. Step 5 of a draft pull request: `head` is the branch git.createRef created and `draft: true`.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          head: {
            type: 'string',
            description: 'Branch name (or cross-fork `octocat:feature-x`) containing the changes, without `refs/heads/`.',
          },
          base: { type: 'string', description: 'Branch in the target repo to merge into (e.g. `main`).' },
          body: { type: 'string', description: 'PR description body (markdown).' },
          draft: { type: 'boolean', description: 'When true, open the PR as a draft.' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
      request: { method: 'POST', path: '/repos/{owner}/{repo}/pulls', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'pulls.propose',
      class: 'mutation',
      description:
        'Propose a change as a draft pull request in ONE call, under one owner approval: write `files` on a NEW branch '
        + 'cut from the head of `base`, commit them, and open a draft pull request from `branch` into `base`. '
        + 'Prefer it over git.createTree, git.createCommit, git.createRef and pulls.create, which each need their own approval. '
        + 'It never moves an existing branch and never merges. Returns the pull request, the commit and each changed file '
        + 'with its line counts.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          base: {
            type: 'string',
            description: 'Branch the pull request merges into, usually the default branch (`main`). A plain branch name.',
          },
          branch: {
            type: 'string',
            description: 'The NEW branch to create, e.g. `gtm-agent/hero-copy`. It must not exist yet and must differ from `base`.',
          },
          title: { type: 'string', minLength: 1, maxLength: 256 },
          body: { type: 'string', description: 'Pull request description (markdown).' },
          commit_message: { type: 'string', description: 'Commit message; defaults to the title.' },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: PROPOSE_MAX_FILES,
            description: 'Every file the change writes or deletes. `{ path, content }` writes the whole new file; `{ path, delete: true }` removes it.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', description: 'Repository-relative path, e.g. `src/routes/_index.tsx`.' },
                content: { type: 'string', description: 'The complete new file content (UTF-8 text).' },
                mode: { type: 'string', enum: ['100644', '100755'], description: 'File mode; `100755` for an executable. Defaults to `100644`.' },
                delete: { type: 'boolean', description: 'True deletes the file; false or absent writes `content`.' },
              },
              required: ['path'],
            },
          },
        },
        required: ['owner', 'repo', 'base', 'branch', 'title', 'files'],
      },
      // Executed by `proposePullRequest` below as six requests; this is the
      // request that makes the change visible.
      request: { method: 'POST', path: '/repos/{owner}/{repo}/pulls' },
      // The new branch is the at-most-once guard: GitHub refuses to create a
      // ref that exists, so a replay fails before it can open a second pull
      // request.
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'pulls.merge',
      class: 'mutation',
      description: 'Merge a pull request by number. `merge_method` selects merge | squash | rebase.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          commit_title: { type: 'string', description: 'Optional commit title for the merge commit.' },
          merge_method: {
            type: 'string',
            enum: ['merge', 'squash', 'rebase'],
            description: 'Merge strategy. Defaults to `merge` on GitHub.',
          },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: { method: 'PUT', path: '/repos/{owner}/{repo}/pulls/{pull_number}/merge', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'issues.createComment',
      class: 'mutation',
      description: 'Add a comment to an existing issue or pull request.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
          body: { type: 'string', description: 'Comment body (markdown).' },
        },
        required: ['owner', 'repo', 'issue_number', 'body'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/issues/{issue_number}/comments',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'pulls.reviews.create',
      class: 'mutation',
      description: 'Submit a review on a pull request: approve, request changes, or comment.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          event: {
            type: 'string',
            enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
            description: 'Review action to submit.',
          },
          body: {
            type: 'string',
            description: 'Optional review body. Required by GitHub when `event` is REQUEST_CHANGES or COMMENT.',
          },
        },
        required: ['owner', 'repo', 'pull_number', 'event'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
}

const base = declarativeRestConnector(githubSpec)
const baseMutation = base.executeMutation!

export const githubConnector: ConnectorAdapter = {
  ...base,
  async executeMutation(inv: ConnectorInvocation) {
    if (inv.capabilityName === 'pulls.propose') return proposePullRequest(inv)
    return baseMutation(inv)
  },
}

// ---------- pulls.propose ----------

const PROPOSE_MAX_FILE_BYTES = 1_000_000
const PROPOSE_MAX_TOTAL_BYTES = 4_000_000
/** Branches a repository serves by default; a proposal never creates one. */
const DEFAULT_BRANCH_NAMES = new Set(['main', 'master', 'trunk', 'default', 'head', 'develop'])
const PROPOSE_ARGUMENTS = new Set(['owner', 'repo', 'base', 'branch', 'title', 'body', 'commit_message', 'files'])
const PROPOSE_FILE_FIELDS = new Set(['path', 'content', 'mode', 'delete'])

interface ProposedFile {
  path: string
  content?: string
  mode: '100644' | '100755'
  delete: boolean
}

interface ProposeArgs {
  owner: string
  repo: string
  base: string
  branch: string
  title: string
  body?: string
  commitMessage: string
  files: ProposedFile[]
}

function refuse(field: string, message: string): never {
  throw new InvalidCapabilityArgument(`github pulls.propose: invalid argument "${field}": ${message}`, field)
}

function requiredText(args: Record<string, unknown>, field: string, max = 256): string {
  const value = args[field]
  if (typeof value !== 'string' || !value.trim()) refuse(field, 'is required')
  if (value.length > max) refuse(field, `is longer than ${max} characters`)
  return value.trim()
}

function branchName(args: Record<string, unknown>, field: 'base' | 'branch'): string {
  const value = requiredText(args, field, 200)
  if (new RegExp(`^${GIT_SHA}$`).test(value)) refuse(field, 'is a commit sha, not a branch name')
  if (value.startsWith('refs/')) refuse(field, 'pass the bare branch name, not a `refs/` path')
  // git check-ref-format: no component may start with `.` or end with `.lock`.
  if (!new RegExp(PLAIN_BRANCH).test(value) || value.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    refuse(field, 'is not a plain git branch name')
  }
  return value
}

function repoPath(value: unknown, index: number): string {
  const field = `files[${index}].path`
  if (typeof value !== 'string' || !value.trim()) refuse(field, 'is required')
  const path = value.trim()
  if (path.startsWith('/') || /[\\\0]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    refuse(field, `${JSON.stringify(path.slice(0, 80))} is not a repository-relative path`)
  }
  if (path === '.git' || path.startsWith('.git/')) refuse(field, 'cannot write inside .git')
  return path
}

/** Validate every argument before the first request, so a refusal writes nothing. */
function proposeArgs(raw: Record<string, unknown>): ProposeArgs {
  for (const key of Object.keys(raw)) {
    if (!PROPOSE_ARGUMENTS.has(key)) refuse(key, 'is not an argument of pulls.propose')
  }
  const base = branchName(raw, 'base')
  const branch = branchName(raw, 'branch')
  if (branch === base) refuse('branch', 'must be a new branch, not the base')
  if (DEFAULT_BRANCH_NAMES.has(branch.toLowerCase())) refuse('branch', `${branch} is a default branch name; name a new branch`)
  const title = requiredText(raw, 'title')
  const body = raw.body === undefined ? undefined : typeof raw.body === 'string' ? raw.body : refuse('body', 'must be a string')
  const commitMessage = raw.commit_message === undefined ? title : requiredText(raw, 'commit_message', 4_000)
  if (!Array.isArray(raw.files) || raw.files.length === 0) refuse('files', 'name at least one file')
  if (raw.files.length > PROPOSE_MAX_FILES) refuse('files', `a proposal changes at most ${PROPOSE_MAX_FILES} files`)
  const seen = new Set<string>()
  let total = 0
  const files = raw.files.map((entry, index): ProposedFile => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse(`files[${index}]`, 'must be an object')
    const file = entry as Record<string, unknown>
    for (const key of Object.keys(file)) {
      if (!PROPOSE_FILE_FIELDS.has(key)) refuse(`files[${index}].${key}`, 'is not a file field')
    }
    const path = repoPath(file.path, index)
    if (seen.has(path)) refuse(`files[${index}].path`, `${path} is listed twice`)
    seen.add(path)
    const mode = file.mode === undefined ? '100644' : file.mode
    if (mode !== '100644' && mode !== '100755') refuse(`files[${index}].mode`, 'must be 100644 or 100755')
    if (file.delete !== undefined && typeof file.delete !== 'boolean') refuse(`files[${index}].delete`, 'must be true or false')
    if (file.delete === true) {
      if (file.content !== undefined) refuse(`files[${index}]`, 'a deleted file carries no content')
      return { path, mode, delete: true }
    }
    if (typeof file.content !== 'string') refuse(`files[${index}].content`, 'is required unless delete is true')
    const bytes = new TextEncoder().encode(file.content).length
    if (bytes > PROPOSE_MAX_FILE_BYTES) refuse(`files[${index}].content`, `is larger than ${PROPOSE_MAX_FILE_BYTES} bytes`)
    total += bytes
    return { path, content: file.content, mode, delete: false }
  })
  if (total > PROPOSE_MAX_TOTAL_BYTES) refuse('files', `the change is larger than ${PROPOSE_MAX_TOTAL_BYTES} bytes`)
  return {
    owner: requiredText(raw, 'owner', 100),
    repo: requiredText(raw, 'repo', 100),
    base,
    branch,
    title,
    ...(body !== undefined ? { body } : {}),
    commitMessage,
    files,
  }
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function shaOf(value: unknown, what: string, ...path: string[]): string {
  const sha = field(value, ...path)
  if (typeof sha !== 'string' || !new RegExp(`^${GIT_SHA}$`).test(sha)) throw new Error(`github pulls.propose: GitHub returned no ${what}`)
  return sha
}

/**
 * Write the files on a new branch and open a draft pull request, as one call:
 * read the base head, write a tree, commit it on that head, create the branch,
 * open the draft, and read its file list. The branch is new (GitHub refuses
 * an existing ref), so the call never moves an existing branch.
 */
async function proposePullRequest(inv: ConnectorInvocation) {
  const args = proposeArgs(inv.args)
  const at = (request: RestRequestSpec, values: Record<string, unknown>) =>
    executeRestRequest(githubSpec, request, { ...inv, args: { owner: args.owner, repo: args.repo, ...values } })

  const head = await at({ method: 'GET', path: '/repos/{owner}/{repo}/branches/{branch}' }, { branch: args.base })
  if (head.outcome) return mutationResultFromTransport(githubSpec.displayName, head)
  const parent = shaOf(head.data, 'base head commit', 'commit', 'sha')
  const baseTree = shaOf(head.data, 'base tree', 'commit', 'commit', 'tree', 'sha')

  const tree = await at({
    method: 'POST',
    path: '/repos/{owner}/{repo}/git/trees',
    body: { base_tree: '{base_tree}', tree: '{tree}' },
  }, {
    base_tree: baseTree,
    tree: args.files.map((file) => file.delete
      ? { path: file.path, mode: file.mode, type: 'blob', sha: null }
      : { path: file.path, mode: file.mode, type: 'blob', content: file.content }),
  })
  if (tree.outcome) return mutationResultFromTransport(githubSpec.displayName, tree)

  const commit = await at({
    method: 'POST',
    path: '/repos/{owner}/{repo}/git/commits',
    body: { message: '{message}', tree: '{tree}', parents: '{parents}' },
  }, { message: args.commitMessage, tree: shaOf(tree.data, 'tree', 'sha'), parents: [parent] })
  if (commit.outcome) return mutationResultFromTransport(githubSpec.displayName, commit)
  const commitSha = shaOf(commit.data, 'commit', 'sha')

  let ref
  try {
    ref = await at({
      method: 'POST',
      path: '/repos/{owner}/{repo}/git/refs',
      body: { ref: '{ref}', sha: '{sha}' },
    }, { ref: `refs/heads/${args.branch}`, sha: commitSha })
  } catch (error) {
    if (error instanceof Error && / HTTP 422: /.test(error.message) && /already exists/i.test(error.message)) {
      refuse('branch', `${args.branch} already exists in ${args.owner}/${args.repo}; name a new branch`)
    }
    throw error
  }
  if (ref.outcome) return mutationResultFromTransport(githubSpec.displayName, ref)

  // The branch exists from here on. A failure names it and the commit, so a
  // retry opens the pull request with pulls.create instead of redoing the change.
  const created = `branch ${args.branch} at commit ${commitSha} exists in ${args.owner}/${args.repo}`
  let pull
  try {
    pull = await at({
      method: 'POST',
      path: '/repos/{owner}/{repo}/pulls',
      body: { title: '{title}', head: '{head}', base: '{base}', body: '{body}', draft: true },
    }, { title: args.title, head: args.branch, base: args.base, ...(args.body !== undefined ? { body: args.body } : {}) })
  } catch (error) {
    throw new Error(`github pulls.propose: ${created}, but opening the pull request failed; call pulls.create with head ${args.branch}. ${error instanceof Error ? error.message : String(error)}`)
  }
  // A throttled or conflicted pull request is not retryable as a whole: a
  // replay would stop at the branch that now exists.
  if (pull.outcome) {
    throw new Error(`github pulls.propose: ${created}, but GitHub ${pull.outcome === 'rate-limited' ? 'throttled' : 'refused'} opening the pull request; call pulls.create with head ${args.branch}. ${(pull.message ?? '').slice(0, 300)}`.trim())
  }
  const number = field(pull.data, 'number')
  if (typeof number !== 'number') throw new Error(`github pulls.propose: ${created}, but GitHub returned no pull request number`)

  let files: Array<{ path: string; status: string; additions: number; deletions: number }> = args.files.map((file) => ({
    path: file.path, status: file.delete ? 'removed' : 'modified', additions: 0, deletions: 0,
  }))
  try {
    const listed = await at({
      method: 'GET',
      path: '/repos/{owner}/{repo}/pulls/{pull_number}/files',
      query: { per_page: '100' },
    }, { pull_number: number })
    if (!listed.outcome && Array.isArray(listed.data)) {
      files = listed.data.flatMap((entry) => {
        const path = field(entry, 'filename')
        return typeof path === 'string' ? [{
          path,
          status: String(field(entry, 'status') ?? 'modified'),
          additions: Number(field(entry, 'additions') ?? 0),
          deletions: Number(field(entry, 'deletions') ?? 0),
        }] : []
      })
    }
  } catch {
    // The pull request is open; the declared files stand in for GitHub's list.
  }

  return {
    status: 'committed' as const,
    data: {
      pullRequest: {
        number,
        url: String(field(pull.data, 'html_url') ?? `https://github.com/${args.owner}/${args.repo}/pull/${number}`),
        title: String(field(pull.data, 'title') ?? args.title),
        state: String(field(pull.data, 'state') ?? 'open'),
        draft: field(pull.data, 'draft') !== false,
      },
      repository: `${args.owner}/${args.repo}`,
      base: args.base,
      branch: args.branch,
      commit: { sha: commitSha, url: `https://github.com/${args.owner}/${args.repo}/commit/${commitSha}` },
      files,
    },
    etagAfter: pull.etag,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}
