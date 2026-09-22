# Development & Deployment

How work moves from a local branch to production, and what each branch means.

Project conventions and architecture live in [CLAUDE.md](CLAUDE.md). The task breakdown lives in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). This file covers **branching, environments and
deployment** only.

---

## 1. Deployment Architecture

toke is a client-side application. Vercel hosts static assets and the Next.js SSR shell — there is
no backend, no database server and no API surface. Deployments are therefore cheap, fast and
trivially revertible, which is why the branching model below can stay simple.

| Branch | Vercel environment | URL | Who sees it |
|---|---|---|---|
| `main` | **Production** | production domain | Live users |
| `staging` | Preview (stable branch URL) | `toke-git-staging-<scope>.vercel.app` | Team, pre-release testing |
| `feature/*` | Preview (per push) | `toke-git-feature-<name>-<scope>.vercel.app` | PR reviewers |

Every push to any branch produces a deployment. Two URL forms exist for each:

- **Branch URL** — `toke-git-<branch>-<scope>.vercel.app`. Stable; always points at the newest
  deployment on that branch. Use this for sharing.
- **Deployment URL** — `toke-<hash>-<scope>.vercel.app`. Immutable; pinned to one commit. Use this
  when reporting a bug, so the build can't change underneath the report.

`main` is configured as the Production Branch in Vercel. **Merging to `main` deploys to production
immediately.** There is no manual promotion step unless one is explicitly enabled.

---

## 2. Branching Rules

```
main ──────────●────────────────────●──────────►  production
               ▲                    ▲
               │ PR: release        │ PR: release
               │                    │
staging ───●───┴────●───────────●───┴─────────►  staging preview
           ▲        ▲           ▲
           │ PR     │ PR        │ PR
           │        │           │
feature/a ─┘        │           │
feature/b ──────────┘           │
feature/c ──────────────────────┘
```

**`main` — production.**
Protected. No direct pushes. Only ever receives merges from `staging` via pull request. Every
commit on `main` is a release. Keep its history readable — the log is the release history.

**`staging` — integration.**
Long-lived. Receives merges from `feature/*` via pull request. This is where features meet each
other before they meet users. `staging` should always be deployable; if it isn't, fixing it takes
priority over new work.

**`feature/*` — short-lived.**
Branched off `staging`, merged back into `staging`, then deleted. Keep them small and short —
a branch that lives longer than a few days accumulates merge pain and stops being reviewable.

Use `fix/*` for bug fixes and `chore/*` for tooling and dependency work. Same lifecycle.

### Hotfixes

A production defect that cannot wait for the normal path branches from `main`:

```bash
git checkout main && git pull
git checkout -b fix/critical-thing
# ... fix, PR into main, merge, deploy
git checkout staging && git merge main   # back-merge so staging doesn't regress it
```

**The back-merge is not optional.** Skip it and the next `staging` → `main` release silently reverts
the hotfix.

---

## 3. Developer Lifecycle

### 3.1 Start a feature

```bash
git checkout staging
git pull origin staging
git checkout -b feature/token-binding-panel
```

Always branch from an up-to-date `staging`, never from `main` and never from another feature branch.

### 3.2 Local development

```bash
npm install
npm run env:pull      # vercel env pull .env.local  — see §4
npm run dev
```

`.env.local` is gitignored and must stay that way. It is machine-local and is regenerated from
Vercel, never edited by hand and never committed.

### 3.3 Before opening a PR

```bash
npm run typecheck && npm run lint && npm run test
```

CI runs these plus `build` and `test:e2e`. Running them locally first is faster than waiting for a
red pipeline.

### 3.4 Open the PR

Open `feature/*` → `staging`. Vercel comments on the PR with a Preview URL once the build finishes.

Review the Preview, not just the diff. For toke specifically, the things a diff cannot show you are
the ones most likely to be wrong: canvas rendering, text measurement, imposition geometry and PDF
output. **Export a PDF from the Preview deployment and open it** before approving anything that
touches `engine/pdf`, `engine/text` or `engine/imposition`.

### 3.5 Merge to staging

Squash-merge into `staging` and delete the feature branch. Squashing keeps `staging`'s history one
commit per feature, which makes the eventual release diff legible.

Verify the `staging` Preview after the merge — integration problems surface here, not in the PR.

### 3.6 Release to production

Open `staging` → `main`. The PR diff is the release notes: read it as the complete list of what
users are about to receive.

**Merge-commit this one, do not squash.** A merge commit preserves the individual feature commits on
`main`, which is what makes `git bisect` useful when something breaks in production.

Merging deploys to production. If it goes wrong, use **Instant Rollback** in the Vercel dashboard —
it repoints the production alias at the previous deployment in seconds, with no rebuild. Do that
first, diagnose second.

---

## 4. Environment Variables

toke keeps no secrets: it has no backend, no API keys and no database credentials. Anything in the
client bundle is public by definition. Env vars here are configuration (feature flags, build
metadata), not credentials — and nothing sensitive should ever be added to them.

Vercel scopes variables to three environments: **Production**, **Preview** and **Development**.

```bash
npm run env:pull              # Development scope → .env.local
npm run env:pull:preview      # Preview scope → .env.local
npm run env:list              # what is set, and where
```

`vercel env pull` writes `.env.local`, which **overrides** `.env` and committed `.env.*` files in
Next.js. Re-run it after anyone changes a variable in the dashboard; a stale `.env.local` is a
common and very confusing source of "works on my machine".

Add new variables in the Vercel dashboard, then document them in `.env.example` in the same PR. A
variable that exists in Vercel but not in `.env.example` will be invisible to the next person.

Variables prefixed `NEXT_PUBLIC_` are inlined into the client bundle at build time. Everything in
toke is client-side, so in practice most variables need this prefix — which is another reason none
of them may ever hold a secret.

---

## 5. Manual Vercel Dashboard Setup

These cannot be done from the repository and must be configured once by a project admin.

### 5.1 Link the project

```bash
npm i -g vercel
vercel login
vercel link          # creates .vercel/ — gitignored
```

### 5.2 Production branch

**Settings → Git → Production Branch** → set to `main`.

Confirm it is not left at the Vercel default if the repository's default branch differs. If this is
wrong, merges to `main` will silently deploy to Preview instead of Production.

### 5.3 Custom domain for staging

**Settings → Domains** → add `staging.<yourdomain>` → assign it to the **`staging` branch**.

Gives the team a memorable, stable staging URL instead of the generated `-git-staging-` hostname.
Add the CNAME record Vercel displays at your DNS provider.

Do the same for the production domain, assigned to `main`.

### 5.4 Environment variables

**Settings → Environment Variables.** Set each variable's scope deliberately — a variable added to
Production only will be absent from every Preview build, which usually shows up as an obscure
runtime failure rather than a clear error.

Vercel also supports **branch-scoped Preview variables**, useful if `staging` needs different
configuration from feature-branch previews.

### 5.5 Deployment protection

**Settings → Deployment Protection.** Consider requiring Vercel Authentication on Preview
deployments so unreleased work is not publicly reachable. Note this also blocks unauthenticated
automated access — CI, Playwright and `curl` against Preview URLs need a bypass token.

### 5.6 Branch protection (GitHub, not Vercel)

**Settings → Branches** in GitHub:

- `main` — require a PR, require CI to pass, no force-push, no deletion.
- `staging` — require a PR, require CI to pass.

Without this, the model above is a convention rather than a rule, and someone will eventually push
straight to `main` by accident.

---

## 6. Quick Reference

```bash
# new feature
git checkout staging && git pull origin staging
git checkout -b feature/my-feature

# local
npm run env:pull && npm run dev

# pre-PR
npm run typecheck && npm run lint && npm run test

# release
# PR feature/* → staging   (squash merge)
# PR staging   → main      (merge commit)
```

| Situation | Action |
|---|---|
| Production is broken | Vercel dashboard → Instant Rollback. Diagnose after. |
| Preview build failed | Check the build log in the PR comment before re-running. |
| `staging` is broken | Fix it before merging anything else into it. |
| Hotfix shipped to `main` | Back-merge `main` into `staging` immediately. |
| Env var changed in Vercel | Everyone re-runs `npm run env:pull`. |
