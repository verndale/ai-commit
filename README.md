# @verndale/ai-commit

AI-assisted [Conventional Commits](https://www.conventionalcommits.org/) with **bundled [commitlint](https://commitlint.js.org/)** so generated messages match the same rules enforced in Git hooks.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| **Node.js** | `>=24.14.0` (see `engines` in `package.json`) |
| **Package manager** | This repo uses **pnpm**. Enable with [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`. |

---

## Quick start

Do this **from the directory that contains your app’s `package.json`** (in a monorepo that is often **not** the git repository root).

1. **Add the dependency**

   ```bash
   pnpm add -D @verndale/ai-commit
   ```

   npm and Yarn work too (`npm install -D @verndale/ai-commit`). Where this doc says `pnpm exec`, use `npx`, `yarn exec`, or your usual equivalent.

2. **Run init** (merges env files, configures Husky when needed, writes hooks, updates `package.json` when applicable)

   ```bash
   pnpm exec ai-commit init
   ```

3. **Install dependencies** if init changed `package.json` or ran Husky for the first time — init prints a line like:

   `Next: run \`pnpm install\` …` or `Next: run \`cd … && pnpm install\` …`

   Run that command (it picks **pnpm** / **npm** / **yarn** / **bun** from the nearest lockfile).

4. **Set your API key** in **`.env`** and/or **`.env.local`** (same directory as that `package.json`):

   ```bash
   OPENAI_API_KEY=sk-...
   ```

   If both files define a key, **`.env.local`** wins.

---

## How paths work

| Term | Meaning |
| --- | --- |
| **Package root** | First directory **with `package.json`**, walking up from your current directory toward the git root. If none is found, the current working directory is used. Env files and `package.json` edits use this directory. |
| **Git root** | `git rev-parse --show-toplevel`. Husky and hook files live here (or under `core.hooksPath`). |

If package root and git root differ, hook scripts **`cd`** into the package root before running `ai-commit`.

---

## What `ai-commit init` does (default)

**Environment**

- Merges ai-commit-related keys into **`.env.local`** if that file exists; otherwise into **`.env`** (creates **`.env`** from the bundled template if missing). If **`.env.local`** exists, **`.env`** is not written for this merge.
- **`--force`** never wholesale-replaces **`.env.local`** (append / document keys only).
- Also updates the **example env file** on disk: prefers **`.env.example`**, then **`.env-example`**, else creates **`.env.example`**. If both **`.env.example`** and **`.env-example`** exist, **`.env.example`** is used and a warning is printed.
- The **npm package** still ships the hyphenated template as [`.env-example`](.env-example).

**Husky**

- If **`.husky/_/husky.sh`** is missing under the resolved hooks directory, runs **`npx husky@9 init`** at the **git root**.
- Hooks directory: Git’s **`core.hooksPath`** (relative to the git root), or **`<git-root>/.husky`**. Invalid or out-of-repo paths fall back to **`.husky`** at the git root with a warning.

**`package.json` (at package root)**

- Adds **`commit`**, **`prepare`**, and **`devDependencies.husky`** when missing.

**Hook files**

- Writes **`prepare-commit-msg`** and **`commit-msg`** in the hooks directory.
- Removes Husky’s **default** **`.husky/pre-commit`** when it is only `npm` / `pnpm` / `yarn` **`test`** (so commits are not blocked by tests). Custom **pre-commit** files are left alone.

---

## Init flags

| Flag | Behavior |
| --- | --- |
| *(none)* | Full setup: env files + Husky + hooks + `package.json` updates when applicable. |
| **`--env-only`** | Only env / example-file merges — **no** Git hooks or Husky. |
| **`--husky`** | Husky + hooks only — **skips** `package.json` merges. Use **`--workspace`** with **`--husky`** if you also need **`package.json`** updated again. |
| **`--force`** | Replaces **`.env`** (when it is the merge target) and the resolved example file with the bundled template (**destructive**), and can overwrite existing hook files. Does **not** wholesale-replace **`.env.local`**. |

### When behavior differs

| Situation | What happens |
| --- | --- |
| **Not in a git repository** | Env files under the current directory are updated; init reports that Git / Husky / hooks were skipped. |
| **Monorepo (package not at repo root)** | Run init from the **package folder** that has `package.json` and depends on `@verndale/ai-commit`. Hooks stay at the repo root; generated scripts `cd` into your package first. |
| **`.env.local` exists** | Ai-commit keys are merged **only** into **`.env.local`**; **`.env`** is not created or updated for that merge. |
| **Without `--force`** | Missing keys are **appended** to the env merge target and example file; existing values are not wiped. |

---

## Command cheat sheet

```bash
pnpm add -D @verndale/ai-commit
pnpm exec ai-commit init
# Follow the printed "Next: run …" line if shown, then set OPENAI_API_KEY in .env or .env.local
```

Optional:

```bash
pnpm exec ai-commit init --env-only   # env only, no hooks
pnpm exec ai-commit init --husky      # hooks + Husky; skips package.json merge
pnpm exec ai-commit init --force      # overwrite env/hooks per flag rules
```

---

## Environment variables

| Variable | Purpose |
| --- | --- |
| **`OPENAI_API_KEY`** | Required for **`ai-commit run`** and for AI-backed **`prepare-commit-msg`** when you want generation. |
| **`COMMIT_AI_MODEL`** | Optional model id (default **`gpt-4o-mini`**). |

**Load order:** **`.env`**, then **`.env.local`** (later file wins on duplicate keys).

**Comments:** On merge, init may add a `# @verndale/ai-commit — …` line above assignments when missing; it does not remove existing comments.

**Optional keys for other tools:** `PR_*` for [`@verndale/ai-pr`](https://www.npmjs.com/package/@verndale/ai-pr); `RELEASE_NOTES_AI_*` for [`tools/semantic-release-notes.cjs`](./tools/semantic-release-notes.cjs); use **`GH_TOKEN`** or **`GITHUB_TOKEN`** for GitHub API calls outside Actions.

---

## Commit policy (v2)

- **Mandatory scope** — Headers look like `type(scope): Subject` or `type(scope)!:` when breaking. Scope is derived from staged paths ([`lib/core/message-policy.js`](lib/core/message-policy.js)), with fallback from `package.json` (e.g. `ai-commit`).
- **Types** — `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Subject** — Imperative, Beams-style (first word capitalized), max **50** characters, no trailing period.
- **Body / footer** — Wrap at **72** characters when present.
- **Issues** — If branch or diff mentions `#123`, footers may add `Refs #n` / `Closes #n` (no invented numbers).
- **Breaking changes** — Only when policy detects governance-related files (commitlint, Husky, this package’s rules/preset); otherwise `!` and `BREAKING CHANGE:` are stripped.
- **Staged diff for AI** — Lockfiles and common binary globs are excluded from the text sent to the model ([`lib/core/git.js`](lib/core/git.js)); path detection still uses the full staged file list.

**Semver:** v2 tightens commitlint (mandatory scope, stricter lengths). If you extend this preset, review [`lib/rules.js`](lib/rules.js) and adjust overrides as needed.

---

## CLI reference

| Command | Purpose |
| --- | --- |
| **`ai-commit run`** | Build a message from the staged diff and run **`git commit`**. |
| **`ai-commit init`** | Merge env files; configure Husky and hooks; update `package.json` when applicable. See [Init flags](#init-flags). |
| **`ai-commit prepare-commit-msg <file> [source]`** | Hook: fill an empty message; skips `merge` / `squash`. |
| **`ai-commit lint --edit <file>`** | Hook: run commitlint with this package’s default config. |

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

**`pnpm exec ai-commit init`** sets up Husky for you. To add hooks manually, install **`husky`** and ensure **`"prepare": "husky"`** in `package.json`, then add:

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

**Generated hooks** use **`pnpm exec ai-commit`** when **`pnpm-lock.yaml`** exists at the **package root**; otherwise **`npx --no ai-commit`**. In a monorepo, hooks **`cd`** from the git root into the package directory first. Edit the scripts if you use another runner.

**Default `pre-commit`:** Husky’s init often adds **`.husky/pre-commit`** with only **`pnpm test`** (or **`npm test`** / **`yarn test`**), which can block **`git commit`**. Each **`ai-commit init`** removes **only** that stock one-liner (or the same command behind a minimal **`husky.sh`** wrapper). If you add other lines (e.g. lint-staged), the file is unchanged.

**Already using Husky?** If **`.husky/_/husky.sh`** exists, **`npx husky@9 init`** is not run again. **`package.json`** is only amended for missing **`commit`**, **`prepare`**, or **`devDependencies.husky`**. Existing **`prepare-commit-msg`** and **`commit-msg`** hooks are not overwritten unless you use **`ai-commit init --force`**.

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

## GitHub Actions (CI snippet)

Use commitlint in **your** workflow — nothing calls back to this repository’s pipelines. After `pnpm add -D @verndale/ai-commit`, add a root **`commitlint.config.cjs`** (or `.js`) that **`extends: ["@verndale/ai-commit"]`** as above. **`@commitlint/cli`** is a dependency of this package, so `pnpm exec commitlint` works after install.

Save as **`.github/workflows/commitlint.yml`** (or merge the job into an existing workflow). Adjust **`branches`** / **`branches-ignore`** if your default branch is not **`main`**.

```yaml
name: Commit message lint

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, edited]
  push:
    branches-ignore:
      - main

jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "24.14.0"

      - name: Enable pnpm via Corepack
        run: corepack enable && corepack prepare pnpm@10.11.0 --activate

      - name: Get pnpm store path
        id: pnpm-cache
        run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_OUTPUT

      - name: Cache pnpm store
        uses: actions/cache@v4
        with:
          path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint PR title (squash merge becomes the commit on main)
        if: github.event_name == 'pull_request'
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: |
          printf '%s\n' "$PR_TITLE" | pnpm exec commitlint --verbose

      - name: Lint commit messages (PR range)
        if: github.event_name == 'pull_request'
        run: |
          pnpm exec commitlint \
            --from "${{ github.event.pull_request.base.sha }}" \
            --to "${{ github.event.pull_request.head.sha }}" \
            --verbose

      - name: Lint last commit (push)
        if: github.event_name == 'push'
        run: |
          pnpm exec commitlint --from=HEAD~1 --to=HEAD --verbose
```

**Workflow notes**

| Topic | Detail |
| --- | --- |
| **Node** | Use a version that satisfies **`engines.node`** (see [Requirements](#requirements)). |
| **npm or Yarn** | Replace Corepack + pnpm with your install (`npm ci`, `yarn install --immutable`, etc.) and use **`npx --no commitlint`** or **`yarn exec commitlint`**. |
| **Config path** | If commitlint cannot find your config, add **`--config path/to/commitlint.config.cjs`** to each invocation. |
| **Same rules as hooks** | Matches **`.husky/commit-msg`** when it runs **`ai-commit lint --edit`** — both use the **`@verndale/ai-commit`** preset. |

---

## Contributing

Local development, workflows in this repo, and publishing are documented in [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](./LICENSE).
