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

## Publishing (maintainers)

1. Bump version: `pnpm version patch|minor|major` (creates a git tag).
2. `pnpm publish` — CI can publish on tag when `NPM_TOKEN` is configured (see `.github/workflows/publish.yml`).

## License

MIT — see [LICENSE](./LICENSE).
