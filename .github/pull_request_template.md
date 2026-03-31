## Conventional commits (required for releases)

If this PR merges with **squash and merge**, the **PR title** becomes the single commit on `main` and must match [Conventional Commits](https://www.conventionalcommits.org/) (same rules as this repo’s commitlint), for example:

`feat(scope): Short imperative subject`

Use a **scope** and a valid type (`feat`, `fix`, `docs`, `chore`, etc.). **semantic-release** reads that line to decide whether to ship a version: with the repo’s default analyzer, **`feat`**, **`fix`**, **`perf`**, **`revert`**, and **breaking** changes trigger semver bumps; types like **`chore`** and **`docs`** do **not** (no `CHANGELOG` / npm release from those alone). For user-visible work you intend to release, prefer **`feat`** or **`fix`** in the PR title. To emit patch releases from `chore`/`docs` would require an explicit **`releaseRules`** change in `.releaserc.json` (maintainer policy).
