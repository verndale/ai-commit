# Contributing to `@verndale/ai-commit`

This document is for **working in this repository** (local dev, our GitHub Actions, npm releases). For **installing and using** the published package in your own project, see [README.md](./README.md).

---

## Development

```bash
corepack enable
pnpm install
```

Copy **`.env-example`** to `.env` or `.env.local` and set **`OPENAI_API_KEY`**. After staging, **`pnpm commit`** runs **`node ./bin/cli.js run`**; published installs use the **`ai-commit`** binary under **`node_modules/.bin`**. Local **`.husky`** hooks use **`pnpm exec ai-commit`**.

### Repository automation

To run commitlint-style checks in **another** repository, copy the workflow from [GitHub Actions (CI snippet)](./README.md#github-actions-ci-snippet) in the README (self-contained YAML).

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

- **`NPM_TOKEN`** (repo or org secret) — must allow **`npm publish`** in CI **without** an interactive OTP. The Release workflow sets **`NPM_TOKEN`** and **`NODE_AUTH_TOKEN`** from it.
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
