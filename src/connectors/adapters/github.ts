import { declarativeRestConnector } from './declarative-rest.js'

const repoParams = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
  },
  required: ['owner', 'repo'],
}

export const githubConnector = declarativeRestConnector({
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
    // A change is proposed in five calls, each one request: read the base
    // branch head, read the tree/blobs being edited, write one tree holding
    // every changed file, write one commit on top of the base, then CREATE a
    // new branch ref at that commit. There is deliberately no ref-update
    // action: a caller can create a new branch but can never move an existing
    // one, so the default branch and every protected branch stay out of reach.
    // GitHub refuses `git.createRef` for a ref that already exists (422).
    {
      name: 'repos.getBranch',
      class: 'read',
      description: 'Read one branch: its head commit sha and that commit\'s tree sha. Use it to find the base a proposed change builds on.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          branch: { type: 'string', description: 'Branch name, e.g. `main`.' },
        },
        required: ['owner', 'repo', 'branch'],
      },
      request: { method: 'GET', path: '/repos/{owner}/{repo}/branches/{branch}' },
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
      description: 'Write a tree: `base_tree` plus the changed entries. Each entry is `{ path, mode: "100644", type: "blob", content }` (use `sha: null` to delete a file). Creates an unreferenced object; nothing is visible until a branch points at a commit using it.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          base_tree: { type: 'string', description: 'Tree sha of the base commit.' },
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
      description: 'Write a commit object for a tree with explicit parents (normally the base branch head). Creates an unreferenced object; it moves no branch.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          message: { type: 'string' },
          tree: { type: 'string', description: 'Tree sha from git.createTree.' },
          parents: { type: 'array', items: { type: 'string' }, description: 'Parent commit shas.' },
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
      description: 'Create a NEW branch at a commit: `ref` must be `refs/heads/<new-branch>`. Never moves an existing branch; GitHub returns 422 when the ref already exists.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string', pattern: '^refs/heads/.+', description: 'Fully qualified new branch ref, e.g. `refs/heads/gtm-agent/hero-copy`.' },
          sha: { type: 'string', description: 'Commit sha from git.createCommit.' },
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
      description: 'Open a pull request from `head` into `base` on the target repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          head: {
            type: 'string',
            description: 'Branch (or cross-fork ref like `octocat:feature-x`) containing the changes.',
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
})
