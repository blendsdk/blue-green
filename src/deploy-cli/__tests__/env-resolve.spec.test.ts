/**
 * Specification tests for lib/env-resolve.ts — uniform ${VAR} resolution.
 *
 * These tests are derived EXCLUSIVELY from the specification documents:
 *   - plans/inventory-env-substitution/01-requirements.md (FR-1..FR-4)
 *   - plans/inventory-env-substitution/03-env-resolver.md
 *   - plans/inventory-env-substitution/07-testing-strategy.md (ST-1..ST-10)
 *   - plans/inventory-env-substitution/00-ambiguity-register.md (AR #3, #7, #8)
 *
 * They are IMMUTABLE ORACLES: if a test fails after implementation, the
 * implementation is wrong — not the test. Do NOT weaken these assertions to
 * match the implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveString, resolvePlaceholders } from '../lib/env-resolve.ts';

// ── resolveString ───────────────────────────────────────

describe('Specification: env-resolve resolveString', () => {
  // Source: 07-testing-strategy.md ST-1 (FR-4, AR #3)
  it('should return the string unchanged when it contains no token', () => {
    assert.equal(resolveString('deploy@host', {}), 'deploy@host');
  });

  // Source: 07-testing-strategy.md ST-2 (FR-1, FR-2)
  it('should substitute a single ${VAR} from the context', () => {
    assert.equal(resolveString('deploy@${H}', { H: '1.2.3.4' }), 'deploy@1.2.3.4');
  });

  // Source: 07-testing-strategy.md ST-3 (FR-1)
  it('should substitute multiple distinct ${VAR} tokens in one string', () => {
    assert.equal(
      resolveString('${U}@${H}', { U: 'deploy', H: 'x' }),
      'deploy@x',
    );
  });

  // Source: 07-testing-strategy.md ST-4 (FR-1)
  it('should substitute a repeated ${VAR} token every occurrence', () => {
    assert.equal(resolveString('a${X}b${X}c', { X: '-' }), 'a-b-c');
  });

  // Source: 07-testing-strategy.md ST-5 (FR-3, AR #8)
  it('should throw naming the variable when a referenced ${VAR} is missing', () => {
    assert.throws(
      () => resolveString('${MISSING}', {}),
      (err: Error) => {
        assert.ok(err.message.includes('MISSING'), `Expected 'MISSING' in: ${err.message}`);
        return true;
      },
    );
  });

  // Source: 07-testing-strategy.md ST-6 (FR-3, AR #8)
  it('should throw naming the variable when a referenced ${VAR} is empty', () => {
    assert.throws(
      () => resolveString('${EMPTY}', { EMPTY: '' }),
      (err: Error) => {
        assert.ok(err.message.includes('EMPTY'), `Expected 'EMPTY' in: ${err.message}`);
        return true;
      },
    );
  });

  // Source: 07-testing-strategy.md ST-7 (AR #7) — braced-only syntax
  it('should leave a bare $VAR (unbraced) unchanged', () => {
    assert.equal(resolveString('$HOST', { HOST: 'x' }), '$HOST');
  });
});

// ── resolvePlaceholders ─────────────────────────────────

describe('Specification: env-resolve resolvePlaceholders', () => {
  // Source: 07-testing-strategy.md ST-8 (FR-1, FR-4)
  it('should resolve string values and pass non-string scalars through', () => {
    assert.deepEqual(
      resolvePlaceholders({ a: '${X}', b: 2 }, { X: 'v' }),
      { a: 'v', b: 2 },
    );
  });

  // Source: 07-testing-strategy.md ST-9 (FR-1) — arrays of strings
  it('should resolve string values inside arrays', () => {
    assert.deepEqual(
      resolvePlaceholders({ tags: ['${R}', 's'] }, { R: 'eu' }),
      { tags: ['eu', 's'] },
    );
  });

  // Source: 07-testing-strategy.md ST-10 (FR-1, AR #3) — keys not substituted
  it('should NOT substitute object keys, only values', () => {
    assert.deepEqual(
      resolvePlaceholders({ '${K}': 'v' }, { K: 'x' }),
      { '${K}': 'v' },
    );
  });
});
