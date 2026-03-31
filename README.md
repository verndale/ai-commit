# @verndale/commit-ai

AI-assisted [Conventional Commits](https://www.conventionalcommits.org/) with **bundled [commitlint](https://commitlint.js.org/)** so generated messages match the same rules enforced in hooks.

## Requirements

- **Node.js** `>=24.14.0`
- This repo uses **pnpm** (`packageManager` is pinned in `package.json`; enable via [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`).

## Install

```bash
pnpm add -D @verndale/commit-ai
```

## Environment

- **`OPENAI_API_KEY`** — Required for `commit-ai run` (and for AI-filled `prepare-commit-msg` when you want the model). Optional `COMMIT_AI_MODEL` (default `gpt-4o-mini`).
- The CLI loads **`.env`** from the current working directory (project root).
- **Optional tooling** (see [`.env.example`](./.env.example)): `PR_*` for [`tools/open-pr.js`](./tools/open-pr.js) / the **Create or update PR** workflow; `RELEASE_NOTES_AI_*` for the semantic-release notes plugin. Use a GitHub PAT as **`GH_TOKEN`** (or `GITHUB_TOKEN`) when calling the GitHub API outside Actions.

## Commit policy (v2)

- **Mandatory scope** — Every header is `type(scope): Subject` (or `type(scope)!:` when breaking). The **scope is not chosen by the model**; it is derived from staged paths (see [`lib/core/message-policy.js`](lib/core/message-policy.js)) and falls back to a short name from `package.json` (e.g. `commit-ai`).
- **Types** — `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Subject** — Imperative, Beams-style (first word capitalized), max **50** characters, no trailing period.
- **Body / footer** — Wrap lines at **72** characters when present.
- **Issues** — If branch or diff mentions `#123`, footers may add `Refs #n` / `Closes #n` (no invented numbers).
- **Breaking changes** — Only when policy detects governance-related files (commitlint, Husky, this package’s rules/preset); otherwise `!` and `BREAKING CHANGE:` lines are stripped.
- **Staged diff for AI** — Lockfile and common binary globs are **excluded** from the diff text sent to the model (see [`lib/core/git.js`](lib/core/git.js)); path detection still uses the full staged file list.

**Semver:** v2 tightens commitlint (mandatory scope, stricter lengths). If you `extends` this preset, review [lib/rules.js](lib/rules.js) and adjust overrides as needed.

## Commands

| Command | Purpose |
| --- | --- |
| `commit-ai run` | Generate a message from the staged diff and run `git commit`. |
| `commit-ai prepare-commit-msg <file> [source]` | Git `prepare-commit-msg` hook: fill an empty message; skips `merge` / `squash`. |
| `commit-ai lint --edit <file>` | Git `commit-msg` hook: run commitlint with this package’s default config. |

## package.json scripts (example)

```json
{
  "scripts": {
    "commit": "commit-ai run"
  }
}
```

## Husky (manual setup)

Install Husky in your project (`husky` + `"prepare": "husky"` in `package.json` if needed), then add hooks.

**`.husky/prepare-commit-msg`**

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec commit-ai prepare-commit-msg "$1" "$2"
```

**`.husky/commit-msg`**

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec commit-ai lint --edit "$1"
```

Use `npx` or `yarn` instead if that matches your toolchain.

## commitlint without a second install

Use the packaged binary from hooks (`commit-ai lint --edit`) as above.

To **extend** the default rules in your own `commitlint.config.js`, you can start from the same preset:

```js
module.exports = {
  extends: ["@verndale/commit-ai"],
  rules: {
    // optional overrides
  },
};
```

Programmatic access to shared constants (types, line limits) is available via:

```js
const rules = require("@verndale/commit-ai/rules");
```

## Development (this repository)

```bash
corepack enable
pnpm install
```

Copy `.env.example` to `.env` and set **`OPENAI_API_KEY`**. After staging, **`pnpm commit`** runs this repo’s CLI (`node ./bin/cli.js run`; the published package exposes `commit-ai` in `node_modules/.bin` for dependents). Hooks under `.husky/` call **`pnpm exec commit-ai`** from this checkout.

### Repository automation

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`.github/workflows/commitlint.yml`](./.github/workflows/commitlint.yml) | PRs to `main`, pushes to non-`main` branches | Commitlint on PR range or last push commit |
| [`.github/workflows/pr.yml`](./.github/workflows/pr.yml) | Pushes (not `main`) and `workflow_dispatch` | Install deps, run **`pnpm open-pr`** (`node tools/open-pr.js`) — set **`PR_HEAD_BRANCH`** / **`PR_BASE_BRANCH`** in CI via env (workflow sets them). Use a PAT secret **`PR_BOT_TOKEN`** if branch protection requires it; otherwise document your org’s policy. |
| [`.github/workflows/release.yml`](./.github/workflows/release.yml) | Push to **`main`** (including when a PR merges) | **`semantic-release`** — version bump, `CHANGELOG.md`, git tag, npm publish (with provenance), GitHub Release |

Optional **`pnpm open-pr`** locally: set **`GH_TOKEN`** (or **`GITHUB_TOKEN`**) and branch overrides **`PR_BASE_BRANCH`** / **`PR_HEAD_BRANCH`** as needed.

## Publishing (maintainers)

Releases are automated with **[semantic-release](https://github.com/semantic-release/semantic-release)** on every push to **`main`** (see [`.releaserc.json`](./.releaserc.json) and [`tools/semantic-release-notes.cjs`](./tools/semantic-release-notes.cjs)).

### Secrets and registry

- **`NPM_TOKEN`** (repository or organization secret) — npm **automation** or granular token with **publish** rights for `@verndale/commit-ai`. The Release workflow sets both `NPM_TOKEN` and `NODE_AUTH_TOKEN` from it.
- **`GITHUB_TOKEN`** — provided by Actions for API calls (GitHub Release, etc.). The checkout and git plugin use **`SEMANTIC_RELEASE_TOKEN`** when set; otherwise they use `GITHUB_TOKEN` (see below).

**npm provenance:** [`.releaserc.json`](./.releaserc.json) sets `"provenance": true` on `@semantic-release/npm`, which matches **npm Trusted Publishing** from this GitHub repository. On [npmjs.com](https://www.npmjs.com/), enable **Trusted Publishing** for this package linked to **`verndale/commit-ai`** (or your fork’s repo if you test there). If publish fails until that is configured, either finish Trusted Publishing setup or temporarily set `"provenance": false` in `.releaserc.json` (you lose the provenance badge).

### Branch protection and release commits

semantic-release pushes a **release commit** and **tag** back to `main` via `@semantic-release/git`. If **`main`** is protected and the default token cannot push, either allow **GitHub Actions** to bypass protection for this repository, or add a personal access token (classic: `repo`, or fine-grained: **Contents** read/write on this repo) as **`SEMANTIC_RELEASE_TOKEN`**. The Release workflow passes `SEMANTIC_RELEASE_TOKEN || GITHUB_TOKEN` to checkout and to semantic-release as `GITHUB_TOKEN`.

### Commits that produce releases

**Conventional Commits** on `main` drive `@semantic-release/commit-analyzer` (patch / minor / major). The analyzer uses the **first line** of each commit since the last tag; long PR bodies do not substitute for a releasable header.

With the default plugin configuration in [`.releaserc.json`](./.releaserc.json) (no custom `releaseRules`), commits whose type is only **`chore`**, **`docs`**, **`ci`**, **`style`**, **`test`**, **`build`**, etc. **do not** trigger a version bump, `CHANGELOG.md` update, or tag. To ship semver for user-facing work, use a squash **PR title** (or merge commit message) with a releasable type—typically **`feat`**, **`fix`**, **`perf`**, or **`revert`**, or a **breaking** change (`!` / `BREAKING CHANGE:`). For **squash merge**, the merged commit message is usually the **PR title**, so match commitlint there. PR checks lint the PR title and the commits on the branch.

If the project ever needs patch releases from `chore`/`docs`-only merges, maintainers can add **`releaseRules`** to `@semantic-release/commit-analyzer` in `.releaserc.json`; the default is to skip those types so releases stay signal-heavy.

Tag-only npm publish was removed in favor of this flow to avoid double publishes. To try a release locally: `pnpm release` (requires appropriate tokens and git state; use a fork or `--dry-run` as appropriate).

## License

MIT — see [LICENSE](./LICENSE).
