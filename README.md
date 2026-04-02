# @verndale/ai-commit

AI-assisted [Conventional Commits](https://www.conventionalcommits.org/) with **bundled [commitlint](https://commitlint.js.org/)** so generated messages match the same rules enforced in hooks.

---

## Requirements

| | |
| --- | --- |
| **Node.js** | `>=24.14.0` |
| **Package manager** | This repo pins **pnpm** in `package.json`. Enable with [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`. |

---

## Install

```bash
pnpm add -D @verndale/ai-commit
```

**npm** and **yarn** work too (`npm install -D @verndale/ai-commit`). Where this doc says `pnpm exec`, use your tool’s equivalent (`npx`, `yarn exec`, etc.).

---

## Setup

Do these **in order** from your **git repository root** (the directory that contains `package.json`).

### 1. Install the package

See [Install](#install).

### 2. Run init

```bash
pnpm exec ai-commit init
```

**What init does (by default):**

| Action | Detail |
| --- | --- |
| Env files | Merges **`.env`** and **`.env-example`**; creates **`.env-example`** from the bundled template if missing. Template reference: [`.env-example`](.env-example). |
| Husky | Runs **`npx husky@9 init`** if Husky is not present. |
| `package.json` | Adds missing **`commit`**, **`prepare`**, **`husky`** entries when the file exists. |
| Hooks | Writes **`.husky`** hook files. |

If **`package.json`** changed, run **`pnpm install`** (or `npm install`) again.

### 3. Add your API key

Set **`OPENAI_API_KEY`** in **`.env`** and/or **`.env.local`**. Duplicate keys: **`.env.local`** wins.

---

### Init: flags and shortcuts

| Flag | Use when |
| --- | --- |
| *(none)* | Full setup: env files + Husky + hooks + `package.json` updates (when applicable). |
| `--env-only` | You only want env / **`.env-example`** updates—no Git hooks. |
| `--husky` | Hooks + Husky only; skips **`package.json`** changes. Combine with **`--workspace`** if you need **`package.json`** merged again. |
| `--force` | Replace **`.env`** and **`.env-example`** with the bundled template **(destructive)** and/or overwrite existing Husky hook files. |

**Edge cases**

| Situation | Behavior |
| --- | --- |
| Not in a git repo | Init updates env files only and reports that Git/Husky were skipped. |
| Template filename | The published file is **`.env-example`** (hyphen), not **`.env.example`**. |
| Without **`--force`** | Missing **`.env-example`** is created; otherwise missing ai-commit keys are **appended** to **`.env`** (and the example file) without wiping the file. |

---

### Setup — command cheat sheet

```bash
pnpm add -D @verndale/ai-commit
pnpm exec ai-commit init
# Set OPENAI_API_KEY in .env or .env.local
```

Optional variants:

```bash
pnpm exec ai-commit init --env-only
pnpm exec ai-commit init --husky
pnpm exec ai-commit init --force
```

---

## Environment variables

| Variable | Notes |
| --- | --- |
| **`OPENAI_API_KEY`** | Required for **`ai-commit run`** and for AI in **`prepare-commit-msg`** when you want the model. |
| **`COMMIT_AI_MODEL`** | Optional; default **`gpt-4o-mini`**. |
| **Load order** | CLI loads **`.env`**, then **`.env.local`** (same key → `.env.local` wins). |

**Comments:** If another tool already documents **`OPENAI_API_KEY`** or **`COMMIT_AI_MODEL`**, **`ai-commit init`** inserts a `# @verndale/ai-commit — …` line above the assignment when that line is missing. It does not remove existing comments.

**Other tooling (optional):** `PR_*` for [`@verndale/ai-pr`](https://www.npmjs.com/package/@verndale/ai-pr) and **`pnpm run pr:create`** / PR workflows; `RELEASE_NOTES_AI_*` for [`tools/semantic-release-notes.cjs`](./tools/semantic-release-notes.cjs). Use a GitHub PAT as **`GH_TOKEN`** or **`GITHUB_TOKEN`** when calling the GitHub API outside Actions.

---

## Commit policy (v2)

- **Mandatory scope** — Headers are `type(scope): Subject` (or `type(scope)!:` when breaking). Scope comes from staged paths ([`lib/core/message-policy.js`](lib/core/message-policy.js)), not from the model, with fallback from `package.json` (e.g. `ai-commit`).
- **Types** — `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Subject** — Imperative, Beams-style (first word capitalized), max **50** characters, no trailing period.
- **Body / footer** — Wrap at **72** characters when present.
- **Issues** — If branch or diff mentions `#123`, footers may add `Refs #n` / `Closes #n` (no invented numbers).
- **Breaking changes** — Only when policy detects governance-related files (commitlint, Husky, this package’s rules/preset); otherwise `!` and `BREAKING CHANGE:` are stripped.
- **Staged diff for AI** — Lockfile and common binary globs are excluded from the text sent to the model ([`lib/core/git.js`](lib/core/git.js)); path detection still uses the full staged file list.

**Semver:** v2 tightens commitlint (mandatory scope, stricter lengths). If you `extends` this preset, review [`lib/rules.js`](lib/rules.js) and adjust overrides as needed.

---

## CLI reference

| Command | Purpose |
| --- | --- |
| **`ai-commit run`** | Build a message from the staged diff and run **`git commit`**. |
| **`ai-commit init`** | Env merge (including **`.env-example`**), Husky if needed, **`package.json`** when present, hooks. See [flags](#init-flags-and-shortcuts). |
| **`ai-commit prepare-commit-msg <file> [source]`** | Hook: fill an empty message; skips `merge` / `squash`. |
| **`ai-commit lint --edit <file>`** | Hook: commitlint with this package’s default config. |

---

## `package.json` script (example)

```json
{
  "scripts": {
    "commit": "ai-commit run"
  }
}
```

---

## Husky (manual setup)

**`pnpm exec ai-commit init`** configures Husky for you. To add hooks by hand, install Husky (`husky` + `"prepare": "husky"` in `package.json` if needed), then add:

**`.husky/prepare-commit-msg`**

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec ai-commit prepare-commit-msg "$1" "$2"
```

**`.husky/commit-msg`**

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec ai-commit lint --edit "$1"
```

Hooks from **`init`** use **`pnpm exec ai-commit`** when **`pnpm-lock.yaml`** exists; otherwise **`npx --no ai-commit`**. Edit the files if you use another runner.

**Already using Husky?** If **`.husky/_/husky.sh`** exists, **`init`** does not run **`npx husky@9 init`**. **`package.json`** is only amended for missing **`commit`**, **`prepare`**, or **`devDependencies.husky`**. Existing **`.husky/prepare-commit-msg`** and **`.husky/commit-msg`** are not overwritten unless you use **`ai-commit init --force`**.

---

## commitlint without a second install

Use **`ai-commit lint --edit`** from hooks (see above).

To **extend** the preset in your own `commitlint.config.js`:

```js
module.exports = {
  extends: ["@verndale/ai-commit"],
  rules: {
    // optional overrides
  },
};
```

Shared constants (types, line limits):

```js
const rules = require("@verndale/ai-commit/rules");
```

---

## Development (this repository)

```bash
corepack enable
pnpm install
```

Copy **`.env-example`** to `.env` / `.env.local` and set **`OPENAI_API_KEY`**. After staging, **`pnpm commit`** runs **`node ./bin/cli.js run`**; published installs use the **`ai-commit`** binary under **`node_modules/.bin`**. Local **`.husky`** hooks use **`pnpm exec ai-commit`**.

### Repository automation

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`.github/workflows/commitlint.yml`](./.github/workflows/commitlint.yml) | PRs to `main`, pushes to non-`main` | Commitlint on PR range or last push |
| [`.github/workflows/pr.yml`](./.github/workflows/pr.yml) | Pushes (not `main`), `workflow_dispatch` | **`pnpm run pr:create`** ([**`@verndale/ai-pr`**](https://www.npmjs.com/package/@verndale/ai-pr)); workflow sets **`PR_HEAD_BRANCH`** / **`PR_BASE_BRANCH`**. Use secret **`PR_BOT_TOKEN`** if branch protection requires it. |
| [`.github/workflows/release.yml`](./.github/workflows/release.yml) | Push to **`main`** | **semantic-release** — version, `CHANGELOG.md`, tag, npm publish, GitHub Release |

**Local `pnpm run pr:create`:** set **`GH_TOKEN`** / **`GITHUB_TOKEN`** and **`PR_BASE_BRANCH`** / **`PR_HEAD_BRANCH`** as needed.

---

## Publishing (maintainers)

Releases run via **[semantic-release](https://github.com/semantic-release/semantic-release)** on push to **`main`** ([`.releaserc.json`](.releaserc.json), [`tools/semantic-release-notes.cjs`](./tools/semantic-release-notes.cjs)).

### Secrets and registry

- **`NPM_TOKEN`** (repo or org secret) — must **`npm publish`** in CI **without** an interactive OTP. The Release workflow sets **`NPM_TOKEN`** and **`NODE_AUTH_TOKEN`** from it.
  - **If the job fails with `EOTP` / “one-time password”:** 2FA is enforced on publish and the token cannot skip OTP. Fix in one of these ways:
    - **Classic token:** [npmjs.com](https://www.npmjs.com/) → **Access Tokens** → **Generate New Token** (classic) → type **Automation** (not “Publish”). Store as **`NPM_TOKEN`**.
    - **Granular token:** **New Granular Access Token** → enable **Bypass two-factor authentication (2FA)**. Under **Packages and scopes**, **Read and write** for **`@verndale/ai-commit`**. Leave **Allowed IP ranges** empty unless required (Actions egress is not a single fixed IP).
  - Or finish **[Trusted Publishing](https://docs.npmjs.com/trusted-publishers)** for this repo and package (OIDC); you may still need npm-side setup—see npm’s docs for your account.
- **`GITHUB_TOKEN`** — Provided by Actions. Checkout and **`@semantic-release/git`** use **`SEMANTIC_RELEASE_TOKEN`** when set; otherwise **`GITHUB_TOKEN`**.

**npm provenance:** [`.releaserc.json`](.releaserc.json) sets **`"provenance": true`** on **`@semantic-release/npm`**, which matches **npm Trusted Publishing** from this GitHub repo. On [npmjs.com](https://www.npmjs.com/), enable **Trusted Publishing** for this package linked to **`verndale/ai-commit`** (or your fork). If publish fails until that works, finish Trusted Publishing or temporarily set **`"provenance": false`** in **`.releaserc.json`** (you lose the provenance badge).

### Branch protection

semantic-release pushes a **release commit** and **tag** back to **`main`** via **`@semantic-release/git`**. If **`main`** is protected and the default token cannot push, either allow **GitHub Actions** to bypass protection for this repository, or add a PAT (classic: **`repo`**; fine-grained: **Contents** read/write) as **`SEMANTIC_RELEASE_TOKEN`**. The Release workflow passes **`SEMANTIC_RELEASE_TOKEN || GITHUB_TOKEN`** to checkout and to semantic-release as **`GITHUB_TOKEN`**.

### Commits that produce releases

**Conventional Commits** on **`main`** drive the analyzer (patch / minor / major) using each commit’s **first line**; PR bodies do not replace that.

With default [`.releaserc.json`](.releaserc.json) (no custom **`releaseRules`**), types like **`chore`**, **`docs`**, **`ci`**, **`style`**, **`test`**, **`build`** do **not** bump version or update **`CHANGELOG.md`**. For user-facing releases, use **`feat`**, **`fix`**, **`perf`**, **`revert`**, or breaking markers. With **squash merge**, the merged message is usually the **PR title**—keep it commitlint-clean.

To release from **`chore`**/**`docs`**-only merges, maintainers can add **`releaseRules`** to **`@semantic-release/commit-analyzer`** in **`.releaserc.json`**; the default skips those types so releases stay signal-heavy.

Tag-only npm publish was removed in favor of this flow to avoid double publishes. **Local try:** `pnpm release` (needs tokens and git state; use a fork or **`--dry-run`** as appropriate).

---

## License

MIT — see [LICENSE](./LICENSE).
