# Env Resolver: Inventory & Config Env-Var Substitution

> **Document**: 03-env-resolver.md
> **Parent**: [Index](00-index.md)

## Overview

A small, shared, recursive resolver that replaces `${VAR}` tokens in every string
value of a parsed JSON structure, using a caller-supplied context. It is wired
into both `readInventory()` and config resolution, providing the single uniform
mechanism (AR #1, AR #3).

## Architecture

### Current Architecture

- `config.ts` resolves `{ENV}` / `{env}` via two `.replace()` calls.
- `inventory.ts` does no substitution.

### Proposed Changes

- New module `src/deploy-cli/lib/env-resolve.ts` exporting `resolvePlaceholders`.
- `config.ts` builds a context and calls the resolver, dropping the bespoke
  replaces.
- `inventory.ts` calls the resolver on the parsed object after `JSON.parse`.

## Implementation Details

### New module: `src/deploy-cli/lib/env-resolve.ts`

```ts
/**
 * Deploy CLI — Uniform ${VAR} placeholder resolution.
 *
 * Provides a single recursive substitution mechanism used by both
 * deploy-inventory.json and deploy-config.json. Every string value may contain
 * ${VAR} tokens, which are replaced from a caller-supplied context map.
 *
 * Syntax: braced ${NAME} only (AR #7). A referenced variable that is missing or
 * empty is a hard error (AR #8). Strings with no ${...} token are returned
 * unchanged. There is no escape syntax (AR #12).
 *
 * @module lib/env-resolve
 */

/** Matches ${NAME} where NAME is a typical env-var identifier. */
const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replace every ${VAR} in a single string using the context.
 *
 * @param input - The raw string possibly containing ${VAR} tokens
 * @param context - Map of variable name → value
 * @returns The string with all placeholders substituted
 * @throws Error if a referenced variable is missing or empty
 */
export function resolveString(
  input: string,
  context: Record<string, string | undefined>,
): string {
  return input.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const value = context[name];
    // Treat missing OR empty as an error — a deploy must never proceed with a
    // silently-empty host/secret (AR #8).
    if (value === undefined || value === '') {
      throw new Error(
        `Unresolved placeholder "\${${name}}": environment variable ` +
        `"${name}" is not set (or is empty).`,
      );
    }
    return value;
  });
}

/**
 * Recursively resolve ${VAR} placeholders in every string value of a parsed
 * JSON structure (objects, arrays, strings). Non-string scalars pass through.
 *
 * Object keys are NOT substituted — only values (AR #3).
 *
 * @param value - Parsed JSON value (object, array, string, or scalar)
 * @param context - Map of variable name → value
 * @returns A new structure with all string values resolved
 * @throws Error if any referenced variable is missing or empty
 */
export function resolvePlaceholders<T>(
  value: T,
  context: Record<string, string | undefined>,
): T {
  if (typeof value === 'string') {
    return resolveString(value, context) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholders(item, context)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolvePlaceholders(v, context);
    }
    return out as T;
  }
  // numbers, booleans, null — unchanged
  return value;
}
```

### `config.ts` integration

`readConfig()` stays a pure read. The resolution happens where the environment
(and thus the prefix) is known — `resolveConfigEntries()` and `getEnvDefaults()`.
A shared helper builds the context and resolves the whole entry/defaults:

```ts
import { resolvePlaceholders } from './env-resolve.ts';

/** Build the resolution context for a config environment. */
function configContext(prefix: string, environment: string): Record<string, string | undefined> {
  // ${ENV} → uppercase prefix (e.g. "ACC"); ${env} → environment name;
  // plus all real environment variables. (AR #2)
  return { ...process.env, ENV: prefix, env: environment };
}
```

`resolveConfigEntries()` then maps each entry through `resolvePlaceholders(entry, ctx)`
instead of the two `.replace()` calls. The previous `{ENV}` / `{env}` logic is
deleted (FR-5).

> **Note on `deploy_path`:** previously `deploy_path` was passed through without
> substitution. With the uniform resolver it now also supports `${VAR}`. This is
> a harmless superset — existing static `deploy_path` values are unchanged
> (FR-4).

### `inventory.ts` integration

```ts
import { resolvePlaceholders } from './env-resolve.ts';

// Inside resolveServers()/getSSHOptions path: the environment name is known, so
// resolution is applied per-environment with context { ...process.env, env }.
```

Because `readInventory()` does not know the target environment, resolution is
applied in `resolveServers()` (and the SSH option lookup) where `environment` is
a parameter. Context is `{ ...process.env, env: environment }` (AR #9 — no
`ENV` prefix in inventory). The resolved server list is returned; original
parsed objects are not mutated.

## Integration Points

- `commands/shared.ts` `resolveTargetServers()` already calls `resolveServers()`
  and `getSSHOptions()` — no change needed there; they receive resolved hosts.
- Dry-run logging in `shared.ts` prints `server.host`, so it will show the
  RESOLVED host — a useful confirmation before any real action.

## Error Handling

| Error Case | Handling Strategy | AR Ref |
| ---------- | ----------------- | ------ |
| `${VAR}` references unset/empty var | Throw descriptive error naming the var; command aborts via existing top-level `process.exit(1)` | AR #8 |
| String has no `${...}` | Returned unchanged | AR #3 |
| Literal `${...}` desired | Not supported — out of scope | AR #12 |
| Bare `$VAR` | Not matched (braced-only regex) | AR #7 |

## Testing Requirements

- Spec tests (`env-resolve.spec.test.ts`): static unchanged, single var, multiple
  vars in one string, mixed literal+var, nested object, array of strings, missing
  var error, empty var error, object keys not substituted.
- Integration via `config.test.ts` and `inventory.test.ts` (see testing strategy).
