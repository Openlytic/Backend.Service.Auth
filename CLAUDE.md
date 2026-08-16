# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Deep conventions live in [`.github/copilot-instructions.md`](.github/copilot-instructions.md)** (style, naming, contracts, PR review, self-maintenance). **[`.agents/instructions.md`](.agents/instructions.md)** holds agent-behavior rules (planning, scope, model tiering). This file is the orientation layer — commands + big-picture architecture. On any conflict, copilot-instructions wins on conventions.

## Commands

Package manager: **pnpm** (repo lockfile is `pnpm-lock.yaml`). This is a **TypeScript** package compiled to **CommonJS** for `dist/` consumption by the API server.

```bash
pnpm install                # install
pnpm run lint               # eslint --quiet . --ignore-pattern build/ --ignore-pattern dist/
pnpm run lint-fix           # eslint --fix
pnpm run typecheck          # tsc --noEmit
pnpm run build              # prebuild (lint + typecheck) then tsc -p tsconfig.build.json → dist/ (CJS)
```

- **No test framework is configured.** Verify with `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and (when touching DB flows) a live smoke test against the API server's Postgres using consumer-defined entities.
- husky: `pre-commit` runs lint + lint-staged (prettier on staged files); `pre-push` runs build (skippable via `BUILD_ON_PRE_PUSH=false` in `.env`/`.env.local`).
- **CI:** `.github/workflows/test.yml` (PRs to `master`/`release`) runs gitleaks + `pnpm i --frozen-lockfile` + `pnpm run build`. `.github/workflows/publish.yml` (push to `release`) builds and `pnpm publish`es `@openlytic/auth` to npm (`NPM_TOKEN`). The API server consumes this package via a `file:../Backend.Service.Auth` sibling dependency that CI checks out and builds.

## Architecture (big picture)

**`@openlytic/auth`** — a pure-logic auth package, a TypeScript + TypeORM port of Gain.io's `@gainhq/auth`. **It owns no entities and no tables**; the consuming API server registers TypeORM entities and hands the library a repository accessor by entity name (the analog of `sequelize.models.<name>`).

### Public surface — `src/index.ts`

The only entry point consumers import. Re-exports:

- Service functions + params interfaces: `user.service.ts`, `auth-token.service.ts`, `verification-token.service.ts`
- Accessor types: `configureRepositoryAccessor`, `getRepository`, `AuthEntityName`, `AuthRepositoryAccessor`
- Structural model interfaces: `UserModel`, `AuthTokenModel`, `VerificationTokenModel`
- Common helpers: `generateHashPassword`, `compareHashPassword`, `checkPasswordPolicy`, `checkOldPasswords`, `generateJWTToken`/`decodeJWTToken`/`verifyJWTToken`, `validateProps`, `getRandomNumber`/`getRandomString`, `getAppURL`/`getAppDomain`/`getAppName`
- `sendNotification` (stub)

### Repository accessor — `src/repository.ts`

Consumers configure once at boot:

```typescript
configureRepositoryAccessor((name, transaction) => {
  const map = { user: UserEntity, auth_token: AuthTokenEntity, verification_token: VerificationTokenEntity }
  return transaction ? transaction.getRepository(map[name]) : dataSource.getRepository(map[name])
})
```

Services call `getRepository('user', transaction)` etc. — never import entity classes. The model interfaces are structural views of what auth touches; the consumer's entities must expose at least those fields.

### Service conventions

- **Params first, `transaction?: EntityManager` last** — every function takes it and threads it into every write.
- **snake_case contract verbatim** (`user_id`, `custom_claims`, `access_token`, `new_email`, `old_passwords`) — a hard API contract mirrored from Gain.io.
- **`Error('UPPER_SNAKE_CODE')`** for thrown errors (`USER_IS_NOT_FOUND`, `OTP_IS_EXPIRED`, `PASSWORD_DID_NOT_CONFORM_OUR_POLICY`); some flows return `{ success, message }` instead — consumers branch on `success`.
- **`repository.ts` returns `Repository<unknown>`** — cast row results to the model interfaces at the call boundary.

### Flows covered

- Registration: `registerPassword` (bcrypt 10 rounds, policy = min 8 + upper/lower/digit/symbol) → `verifyUserEmail` (6-digit OTP, 5-min expiry) → active
- Resend verification (max 3/10min), change email (`changeEmailByUser`/`verifyChangeEmailByUser`/`cancelChangeEmailByUser`/`changeEmailByAdmin`), forgot password (+retry/verify)
- Login (`loginAUser`, `loginAnApplication` for public/service/organization app tokens), logout (user + admin), token verify, refresh (rotation: deletes old row), change password (user + admin, last-3 history)
- Password history via `old_passwords` simple-array, `slice(1, 3)` keeps last 3

### Cross-cutting things that bite (read before editing)

- **Relative imports only** — `src/` aliases or ESM output break `dist/` at runtime (`ERR_MODULE_NOT_FOUND`). Build is CJS (`tsconfig.build.json`, `module: CommonJS`).
- **`notification.service.ts` is a stub** — logs `{ event, to_email, org_id, variables }`, returns fake `MessageId`. Real email delivery is wired in the API server later.
- **`pg` is deliberately absent** — the consumer provides the driver.
- **User statuses**: `active | inactive | invited | unverified`. Login requires `active`; register-with-verification lands in `unverified`.

### Env — `.env.sample`

`JWT_SECRET`, `ACCESS_TOKEN_EXPIRY` (default `1d`), `REFRESH_TOKEN_EXPIRY` (default `30d`), `APPLICATION_TOKEN`, `APP_URL`. Env is read directly via `process.env` (no dotenv loader — the consumer sets these).

## Adding a function / module

1. Add logic to the appropriate service (`common.service.ts` for pure helpers).
2. Export the function and its params interface from `src/index.ts`.
3. If it touches a table, use `getRepository('<name>', transaction)` + cast to the model interface; extend the model interface in `repository.ts` if a new field is needed.
4. Per copilot-instructions self-maintenance: update the instruction docs in the **same commit** when adding a function / contract / env var.

## Do NOT change

- `configureRepositoryAccessor` / `getRepository(name, tx)` seam; the snake_case contract; UPPER_SNAKE error codes; the relative-import + CJS build setup.
- `src/index.ts` export shape without updating both this file and copilot-instructions.
- The `notification.service.ts` stub into a real email client.
- Add `pg`/`postgres` as a dependency.

## Automation in this repo

Two layers keep context fresh — both **safe no-ops** if the underlying tool isn't installed:

**Claude Code hooks** (`.claude/settings.json`, `PostToolUse` on `Write|Edit`):

| Hook                     | Action                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `check-config-change.sh` | Edited a config file → reminds to update the instruction docs                             |
| `lint-on-change.sh`      | Edited a `.ts`/`.js` → runs local ESLint on it inline                                     |
| `track-changes.sh`       | Logs structural edits to `.claude/changes.md` (git-ignored; **read it at session start**) |
| `regen-graph.sh`         | Edited `src/**.{ts,tsx,js}` → `graphify update .` (background)                            |

**Git hooks** (husky): `graphify update .` after each commit (`.husky/post-commit`), on branch switch (`.husky/post-checkout`, branch checkouts only), after a merge/pull (`.husky/post-merge`), plus `pnpm install` after branch checkouts.

**Knowledge graph (graphify)** — optional per-machine power tool:

```bash
pipx install graphifyy && graphify install --platform claude
```

Query it: `graphify query "..."`, `graphify explain "X"`, `graphify affected "fn()"` (blast-radius). Output (`graphify-out/`) is git-ignored.
