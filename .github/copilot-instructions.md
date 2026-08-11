<!-- PURPOSE: Systems-level context for GitHub Copilot (IDE completions and Web PR Reviews). -->
<!-- This file is automatically read by GitHub Copilot in both VS Code and github.com PR reviews. -->
<!-- It provides project-specific conventions, architectural patterns, and guardrails. -->

# Copilot Instructions — @openlytic/auth

## Project Persona

This is the **authentication library** for Openlytic — a TypeScript + TypeORM port of Gain.io's `@gainhq/auth` npm package. It is a **pure logic package**: it owns no database tables and no entities. The consuming app (the Openlytic backend API server) defines the TypeORM entities and hands the library repository accessors by entity name (the analog of `sequelize.models.<name>`).

The library covers: password policy + hashing (bcrypt, 10 rounds), email verification via 6-digit OTP tokens, login/logout, access + refresh JWT token issuance/rotation/revocation, email/password change, and forgot-password flows. Emails are **stubbed** (logged via `notification.service.ts`) — real SES/email-service delivery is wired in the consuming app.

The public API surface is a single barrel (`src/index.ts`). The library runs on **Node 20+, TypeScript, TypeORM 0.3 (peer/consumer-provided)**, and compiles to **CommonJS** (`dist/`).

---

## Architecture Overview

```
src/
├── index.ts                    # Public barrel — the ONLY entry point consumers import
├── common.service.ts           # bcrypt helpers, password policy, JWT sign/verify, validateProps
├── repository.ts               # configureRepositoryAccessor(name, tx) + getRepository(name, tx)
│                               #   + structural model interfaces (UserModel, AuthTokenModel, ...)
├── user.service.ts             # register/verify/resend, login/logout, change email/password, forgot password
├── auth-token.service.ts       # token CRUD, create/verify/refresh/revoke token pairs
├── verification-token.service.ts # 6-digit OTP create/read/update/delete + send-notification stub wiring
└── notification.service.ts     # STUB — logs { event, to_email, org_id, variables }; returns fake MessageId
```

### Repository accessor (the `sequelize.models` equivalent)

The library **never imports entity classes**. The consumer registers a name→repository accessor once at boot:

```typescript
configureRepositoryAccessor((name, transaction) => {
  const map = { user: UserEntity, auth_token: AuthTokenEntity, verification_token: VerificationTokenEntity }
  return transaction ? transaction.getRepository(map[name]) : dataSource.getRepository(map[name])
})
```

Services then resolve repositories by name: `getRepository('user', transaction)`. The model interfaces in `repository.ts` (`UserModel`, `AuthTokenModel`, `VerificationTokenModel`) are **structural** — they describe the fields auth touches; the consumer's real entities must expose at least those fields.

---

## Style Guide

### Formatting (enforced by ESLint + Prettier)

- **No semicolons** (`semi: false` via prettier config)
- **Single quotes**
- **2-space indentation**
- **No trailing commas** (`trailingComma: 'none'`)
- **120-character print width**
- **`prefer-const`**, **`object-shorthand`**, concise arrow bodies (`as-needed`)
- **Organized imports** (prettier-plugin-organize-imports) — alphabetical

### Naming Conventions

| Element               | Convention       | Example                                  |
| --------------------- | ---------------- | ---------------------------------------- |
| Files                 | kebab-case       | `user.service.ts`, `auth-token.service.ts` |
| Variables & functions | camelCase        | `createAuthTokensForUser`, `getAUser`    |
| Constants             | UPPER_SNAKE_CASE | `ACCESS_TOKEN_EXPIRY`, `PASSWORD_DID_NOT_CONFORM_OUR_POLICY` |
| Error messages        | UPPER_SNAKE i18n codes | `USER_IS_NOT_FOUND`, `OTP_IS_EXPIRED` |
| Params/props          | **snake_case** (Gain contract, kept verbatim) | `user_id`, `custom_claims`, `access_token`, `new_email`, `old_passwords` |
| DB columns/tables     | snake_case (owned by the consumer) | `user`, `auth_token`, `verification_token` |

> The snake_case param/prop contract is a **hard API contract** mirrored from Gain.io — do not camelCase it.

### Import Rules (CRITICAL — inverse of the API server)

- **Relative imports only** (`./common.service`, `../...`). The package compiles to CJS `dist/` that Node consumes directly, so `src/` aliases or extensionless `src/...` paths **break at runtime** (`ERR_MODULE_NOT_FOUND`).
- **No file extension** in imports.
- **Barrel first**: import cross-service functions from `./index` or the direct service file — never create import cycles between services.

### Export Rules

- **Named exports** only — services export `export const createX = ...`.
- **Type exports** for every params interface used by consumers (`RegisterPasswordParams`, `LoginParams`, etc.).
- **`src/index.ts`** is the public surface: re-export every service function, its params types, the accessor types (`AuthEntityName`, `AuthRepositoryAccessor`), and the model interfaces.
- **Never export** implementation details (notification stub internals, repository module internals) that consumers shouldn't touch — except `configureRepositoryAccessor` + `getRepository`.

---

## Architectural Patterns

### Service Layer Separation

- **`common.service.ts`** — stateless helpers: `generateHashPassword`, `compareHashPassword`, `checkPasswordPolicy` (min 8, upper+lower+digit+symbol), `checkOldPasswords` (last 3), `generateJWTToken`/`decodeJWTToken`/`verifyJWTToken` (iss/sub/aud/jti claims, `JWT_SECRET`), `validateProps` (required/type field validation), `getRandomNumber/String`, `getAppURL`.
- **Services** — business logic. Every public function accepts `params` as the **first** arg and an optional `transaction?: EntityManager` as the **last** arg. All writes go through `getRepository(name, transaction)`.
- **`repository.ts`** — the DI seam + structural model interfaces. Do not put business logic here.

### Transaction Pattern

Every function that writes takes `transaction?: EntityManager` and threads it into **every** `getRepository(name, transaction)` call. The consumer decides whether to run inside a transaction (its resolvers wrap mutations in `useTransaction()`). The library stays agnostic — transaction is always optional.

### Error Handling Pattern

- Throw `new Error('UPPER_SNAKE_CODE')` — stable i18n keys mirroring Gain.io (e.g. `PASSWORD_IS_INCORRECT`, `USER_IS_ALREADY_VERIFIED`, `TOO_MANY_RESEND_VERIFICATION_REQUESTS`).
- Some flows return `{ success: boolean, message: string }` instead of throwing (e.g. `verifyTokenForUser` returns `INVALID_TOKEN`/`false`, `logoutAUser` returns `LOGGED_OUT`/`true`). Keep those exact shapes — consumers branch on `success`.

### JWT Contract

- `generateJWTToken(claims, expiry)` sets `iss`/`sub`/`aud`/`jti` + claims.
- Access token claims: `sub` = `app_user_id || contact_id || user_id`, plus `contact_id`/`user_id`/`org_id`/`org_brand_id`/`offer_id`/`roles`.
- Refresh tokens carry only `sub` + identity fields; `refreshAuthTokensForUser` re-fetches the user by `user_id`, validates `status === 'active'`, **deletes the old row**, then issues a new pair (rotation).
- Env: `ACCESS_TOKEN_EXPIRY` (default `1d`), `REFRESH_TOKEN_EXPIRY` (default `30d`), `JWT_SECRET`, `APPLICATION_TOKEN`, `APP_URL`.

### Verification Token (OTP) Contract

- 6-digit numeric OTP (`getRandomNumber(6)`), `expired_at = NOW() + INTERVAL '5 minutes'`, status `cancelled | unverified | verified`.
- Types: `forgot_password`, `resend_forgot_password`, `resend_user_verification`, `user_verification`.
- Rate limit: max 3 send/resend per email per 10 minutes → `TOO_MANY_*_REQUESTS`.
- `createAVerificationTokenAndSendNotification` maps type → notification event and calls the stub `sendNotification` (logs `{ event, to_email, org_id, variables }`). The stub returns a fake `{ MessageId: 'stubbed-...' }`.

---

## PR Review Guardrails

### DO NOT Refactor

1. **The snake_case contract** (`user_id`, `access_token`, `custom_claims`, `new_email`, `old_passwords`, etc.) — a hard API contract mirrored verbatim from Gain.io; consumers (API server resolvers) depend on it.
2. **`configureRepositoryAccessor` / `getRepository(name, tx)`** — the `sequelize.models.<name>` DI seam. Do not import entity classes into the package or replace with class-keyed lookups.
3. **Relative imports + CJS build** (`tsconfig.build.json` `module: CommonJS`) — switching to `src/` aliases or ESM output breaks `dist/` consumers at runtime (`ERR_MODULE_NOT_FOUND`).
4. **UPPER_SNAKE error messages** — stable i18n keys; consumers map them to user-facing text.
5. **`bcryptjs` (pure JS) over `bcrypt`** (native) — keeps installs dependency-free on CI/lambdas.
6. **No entities/tables in the package** — the library is logic-only; entities live in the consumer. Keep `user`/`auth_token`/`verification_token` tables out of this repo.

### ALWAYS Flag

1. **Missing `transaction` parameter** on any function that performs writes, or a `getRepository(name, ...)` write call that drops the threaded transaction.
2. **CamelCasing the snake_case API contract** (e.g. renaming `user_id` → `userId` in params or return shapes).
3. **Absolute `src/` alias imports or ESM output** — runtime breakage for CJS consumers.
4. **Semicolons, double quotes, or trailing commas** (prettier rules).
5. **Error messages that are not UPPER_SNAKE codes** or that leak dynamic user input.
6. **A change that silently alters a return shape** (`success`/`message` objects, sanitized user objects) — consumers branch on these.
7. **Secrets in code** — `JWT_SECRET`, `APPLICATION_TOKEN` etc. come from env only; never hardcode.

---

## Tech Debt & Legacy Warnings

1. **TypeORM 0.3**: `Repository<unknown>` — services cast row results to the model interfaces (`UserModel`, `VerificationTokenModel`, ...). Keep casts at the repository call boundary.
2. **`old_passwords` is a `simple-array`** — a JSON text column. Password history keeps the **last 3** (`slice(1, 3)` then append the new hash).
3. **`notification.service.ts` is a stub** — real SES/email-service wiring is a later branch in the API server. Do not "improve" the stub into a real client here.
4. **User statuses**: `active | inactive | invited | unverified`. Login requires `active`; register-with-verification lands in `unverified`.
5. **`pg` is deliberately NOT a dependency** — the consumer provides the driver. Adding `pg`/`postgres` to this package is a mistake.

---

## Technology Stack Reference

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Runtime        | Node.js 20+                                  |
| Language       | TypeScript (tsc for build → CommonJS `dist/`)|
| Database       | TypeORM 0.3 (entities owned by the consumer) |
| Auth           | jsonwebtoken, bcryptjs                       |
| Lint           | ESLint 8 + Prettier                          |
| Package Manager| pnpm                                         |

---

## Self-Maintenance — Keeping This File Current

<!-- LAST AUDITED: 2026-08-12 -->

This file is the single source of truth for Copilot and agent behavior. **Agents MUST update this file as part of any change that alters the facts documented here.** Do not treat this file as read-only — it is a living document.

### When to Update (Triggers)

| Trigger                            | What to Update                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| **New service function added**     | Update the public surface list in "Architecture Overview".                                         |
| **New dependency introduced**      | Add a row to "Technology Stack Reference" if foundational; add a "Tech Debt" entry if it has quirks.|
| **Error code / return shape change** | Update "Error Handling Pattern" / "ALWAYS Flag" and any affected contract section.                 |
| **New "DO NOT Refactor" guardrail** | Add a numbered item to "PR Review Guardrails → DO NOT Refactor" with a clear rationale.            |
| **Formatting/lint rule change**    | Update "Formatting" under "Style Guide".                                                           |
| **Env var added/removed**          | Update the "JWT Contract" env list.                                                                |

### How to Update

1. **Inline edit** — modify the specific section, table row, or code example. Do not append a changelog.
2. **Update the `LAST AUDITED` date** in the HTML comment above this section to the current date.
3. **Run `pnpm run lint`** after saving.
4. **Commit this file alongside the code changes** that triggered the update — never in a separate PR.

### Periodic Audit

When an agent detects staleness during normal work, fix it immediately:

- Architecture tree entries for files/directories added or removed
- Exports listed in "Architecture Overview" that no longer match `src/index.ts`
- Tech stack versions that differ from `package.json`
- Contract sections (snake_case, error codes, return shapes) that drifted from the actual services
