## Conventional commits (required for releases)

If this PR merges with **squash and merge**, the **PR title** becomes the single commit on `main` and must match [Conventional Commits](https://www.conventionalcommits.org/) (same rules as this repo’s commitlint), for example:

`feat(scope): Short imperative subject`

Use a **scope** and a type such as `feat`, `fix`, `docs`, or `chore`. That message is what **semantic-release** uses to decide version bumps.
