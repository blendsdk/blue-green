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

/**
 * Matches ${NAME} where NAME is a typical env-var identifier.
 *
 * The leading character must be a letter or underscore; subsequent characters
 * may also be digits. Bare `$NAME` (no braces) is intentionally NOT matched so
 * literal `$` characters in values never trigger a false substitution (AR #7).
 */
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
    // silently-empty host/secret (AR #8). Naming the variable makes the failure
    // diagnosable at a glance in CI logs.
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
 * Object keys are NOT substituted — only values (AR #3). The input is not
 * mutated; a new structure is returned.
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
    // Keys are copied verbatim; only values are recursed into (AR #3).
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolvePlaceholders(v, context);
    }
    return out as T;
  }
  // numbers, booleans, null — unchanged
  return value;
}
