<!-- PURPOSE: Behavioral and planning rules for Antigravity Agent Manager and autonomous coding agents. -->
<!-- This file governs how AI agents plan, execute, and validate multi-file changes in this repository. -->
<!-- Agents MUST read and follow .github/copilot-instructions.md for all style and architectural rules. -->

# Agent Instructions — @openlytic/auth

## Knowledge Inheritance

**Before performing any code generation or modification, agents MUST read and internalize the rules in `.github/copilot-instructions.md`.** That file is the single source of truth for:

- Formatting rules (no semicolons, single quotes, 2-space indent, no trailing commas)
- Naming conventions (snake_case API contract, UPPER_SNAKE error codes, camelCase functions)
- Import rules (**relative imports only** — this package compiles to CJS `dist/`; `src/` aliases break consumers)
- Export rules (named exports only; `src/index.ts` is the public barrel)
- The repository accessor pattern (`configureRepositoryAccessor` / `getRepository(name, tx)`)
- Transaction patterns (optional `transaction?: EntityManager` threaded into every write)
- Error handling (`Error('UPPER_SNAKE_CODE')` — stable i18n keys; `{ success, message }` return shapes)
- The snake_case params contract (mirrored verbatim from Gain.io — never camelCase it)

**If any instruction below conflicts with `.github/copilot-instructions.md`, the copilot-instructions file takes precedence.**

---

## The Planning Protocol

### Mandatory Plan-Before-Edit Rule

For any task that modifies **2 or more files**, the agent MUST output a structured plan in Markdown and wait for user approval before executing changes.

### Plan Format

```markdown
## Change Plan: [Brief Description]

### Affected Files

| #   | File Path                     | Action | Summary                          |
| --- | ----------------------------- | ------ | -------------------------------- |
| 1   | src/{module}.service.ts       | CREATE | New library service function     |
| 2   | src/index.ts                  | MODIFY | Add barrel export                |

### Dependency Order

1. `common.service.ts` helpers first (pure functions)
2. Service (business logic)
3. `src/index.ts` barrel export
4. `package.json` deps / `.env.sample` vars if new env required

### Risks & Assumptions

- [Any assumptions about the Gain.io API contract being mirrored]
- [Any return-shape changes that could break the consuming API server]
```

### Exceptions to Planning

A plan is **not required** for:

- Single-file edits (bug fixes, adding a helper)
- Formatting-only changes
- Adding barrel exports as part of an already-approved plan

---

## Tool Usage Rules

### After Every Code Change

1. **Run the linter**: `pnpm run lint` — all changes must pass ESLint + Prettier before committing
2. **Run the typecheck**: `pnpm run typecheck` (`tsc --noEmit`)
3. **Verify imports**: Confirm all imports are **relative** (no `src/` alias, no extension) — this package is consumed from compiled `dist/`

### Terminal Commands

| Action        | Command                 | Notes                                  |
| ------------- | ----------------------- | -------------------------------------- |
| Install deps  | `pnpm i`                | pnpm (repo lockfile is `pnpm-lock.yaml`)|
| Lint check    | `pnpm run lint`         | ESLint validation                      |
| Lint fix      | `pnpm run lint-fix`     | Auto-fix linting issues                |
| Typecheck     | `pnpm run typecheck`    | `tsc --noEmit`                         |
| Format        | `pnpm run format`       | Prettier format all files              |
| Build         | `pnpm run build`        | prebuild (lint+typecheck) + tsc → dist |

### Common Failure Modes (read before editing)

- **`ERR_MODULE_NOT_FOUND` at runtime** → an import uses `src/` alias or an ESM `module` setting; revert to relative imports and confirm `tsconfig.build.json` uses `module: CommonJS`.
- **`getRepository` throws `REPOSITORY_ACCESSOR_IS_NOT_CONFIGURED`** → expected at unit level; consumers call `configureRepositoryAccessor` at boot. Verify against a live DataSource, not a bare import.
- **Repository returns `unknown`** → cast at the repository call boundary to the model interface (`UserModel`, `AuthTokenModel`, `VerificationTokenModel`); never cast the whole service result.

---

## Scope Limits

### NEVER Modify Without Explicit Permission

| File / Directory              | Reason                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `package.json` (dependencies) | Adding/removing packages requires discussion (e.g. never add `pg`)      |
| `.env.sample`                 | Environment variable template — shared across the team                  |
| `.eslintrc.json`              | Linting rules affect entire codebase                                    |
| `tsconfig.json` / `tsconfig.build.json` | Compiler options (esp. `module: CommonJS`) affect the published output |
| The snake_case API contract   | Hard contract mirrored from Gain.io — consumers depend on it            |

### Safe to Modify Autonomously

| File / Directory                        | Conditions                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `src/{module}.service.ts`               | Follow service patterns; thread `transaction` into every write          |
| `src/repository.ts`                     | Only to add/rename model interfaces or accessor types                   |
| `src/common.service.ts`                 | Pure helpers only; keep bcrypt/JSONwebtoken semantics identical to Gain  |
| `src/index.ts`                          | Adding new barrel exports only                                          |
| `src/notification.service.ts`           | Stub — do not turn into a real email client                             |

---

## Code Generation Rules

### Writing Service Functions

```typescript
// CORRECT: params first, transaction last, name-keyed repository, UPPER_SNAKE error
export const registerPassword = async (
  params: RegisterPasswordParams = {} as RegisterPasswordParams,
  transaction?: EntityManager
) => {
  validateProps(
    [
      { field: 'is_verification_required', required: true, type: 'boolean' },
      { field: 'password', required: true, type: 'string' },
      { field: 'user_id', required: true, type: 'string' }
    ],
    params
  )
  if (params.is_verification_required && !checkPasswordPolicy(params.password)) {
    throw new Error('PASSWORD_DID_NOT_CONFORM_OUR_POLICY')
  }
  const user = await getAUser({ id: params.user_id }, transaction)
  if (!user?.id) throw new Error('USER_DOES_NOT_EXISTS')
  await getRepository('user', transaction).update(user.id, { password: generateHashPassword(params.password) })
}
```

### Writing Params Interfaces

```typescript
// CORRECT: exported interface, snake_case contract, [key: string]: unknown escape hatch when needed
export interface LoginParams {
  custom_claims: { roles: string[]; [key: string]: unknown }
  password: string
  user_id: string
}
```

---

## Error Recovery

If a multi-file change causes lint or runtime errors:

1. **Do not revert all changes** — isolate the failure
2. Run `pnpm run lint` and `pnpm run typecheck` to identify the exact file and line
3. Fix the specific issue (usually a broken relative import, a missing transaction param, or a cast at the repository boundary)
4. Re-run both to confirm the fix
5. If a consumer (API server) broke, run its `pnpm run typecheck` too — return-shape changes ripple there

---

## Self-Maintenance — Keeping Instruction Files Current

<!-- LAST AUDITED: 2026-08-12 -->

Both this file (`.agents/instructions.md`) and `.github/copilot-instructions.md` are **living documents**. Agents MUST update them as part of any change that makes their content inaccurate.

### Triggers and Responsibilities

| Trigger                                   | File to Update                    | Action                                                                                    |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| **New service function added**            | `.github/copilot-instructions.md` | Update the public surface list in "Architecture Overview".                                |
| **New file added to Scope Limits**        | `.agents/instructions.md`         | Add the file to "NEVER Modify" or "Safe to Modify" table with rationale.                  |
| **Terminal command or script changed**    | `.agents/instructions.md`         | Update the "Terminal Commands" table to match `package.json` scripts.                     |
| **New convention or pattern introduced**  | `.github/copilot-instructions.md` | Add to the relevant section (Style Guide, Architectural Patterns, etc.).                  |
| **New "DO NOT Refactor" or "ALWAYS Flag"**| `.github/copilot-instructions.md` | Add a numbered item to the appropriate "PR Review Guardrails" list.                       |
| **API contract (params/return) changed**  | `.github/copilot-instructions.md` | Update the contract sections; the snake_case list and return shapes are consumer-visible. |
| **Code generation pattern changed**       | `.agents/instructions.md`         | Update the code examples to match the new pattern.                                        |
| **Formatting/lint rules changed**         | `.github/copilot-instructions.md` | Update the "Formatting" section to reflect the current ESLint/Prettier config.            |

### Update Protocol

1. **Edit in place** — modify the specific section, table row, count, or code example. Do not append a changelog.
2. **Update the `LAST AUDITED` date** in the HTML comment at the top of this section (and in `.github/copilot-instructions.md` if that file was also updated) to the current date.
3. **Commit instruction file changes alongside the code changes** that triggered them — never in a separate commit or PR.
4. **Run `pnpm run lint`** after editing.

---

## Model Selection & Cost Efficiency (Spawning Sub-Agents)

> Goal: **maximize token/cost efficiency without compromising output.** Default to the **cheapest model that can do the task correctly**, and escalate only when the task genuinely needs stronger reasoning. Never run a flagship model where a cheaper one returns the same result.

### Tier the work to the model

| Tier                | Model (current)     | Use for                                                                                                                   |
| ------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Cheap / scout**   | `claude-haiku-4-5`  | Exploration & file reading, locating code, grep/symbol search, gathering context, enumerating call sites, summarizing files |
| **Default / build** | `claude-sonnet-4-6` | Day-to-day implementation: editing services, adding functions, lint fixing, contract-faithful ports of Gain.io logic        |
| **Strong / judge**  | `claude-opus-4-8`   | Only where it adds real value: cross-package contract decisions, tricky multi-file debugging, security review               |

Always use the current model IDs above; do not hardcode older generations.

### The scout → build → judge pattern

1. **Scout (Haiku):** fan out cheap agents to read relevant files and return a **distilled** summary — paths, signatures, and the few facts that matter.
2. **Build (Sonnet):** hand that distilled context to a Sonnet agent to implement/edit.
3. **Judge (Opus, only if warranted):** escalate only for high-stakes verification — contract changes that ripple to the API server, security, or when Sonnet is uncertain.

### Rules

1. **Start cheap, escalate on signal** — pick the lowest tier that can plausibly succeed; never default to Opus.
2. **Parallelize cheap, serialize expensive** — run many Haiku scouts concurrently; use a single strong agent for final judgment.
3. **Pass distilled context, not raw files** — a scout's job is to shrink context for the next tier.
4. **Right-size — don't over-spawn** — a single-file lookup you can do inline needs no sub-agent.

### Periodic Audit Checks

During normal work, if an agent notices any inconsistencies, it MUST fix them immediately:

- "Architecture Overview" exports that don't match `src/index.ts`
- "Terminal Commands" table entries that don't match `package.json` scripts
- Contract sections (snake_case params, UPPER_SNAKE error codes, return shapes) that drifted from the services
- "Scope Limits" entries for files that have been deleted, renamed, or moved
- Tech stack versions that differ from `package.json` dependencies
