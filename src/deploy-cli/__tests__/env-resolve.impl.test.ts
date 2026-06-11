/**
 * Implementation tests for lib/env-resolve.ts — edge cases and internals.
 *
 * These tests cover boundary conditions and internal behavior derived from the
 * implementation (adjacent tokens, identifier shapes, deep nesting, empty
 * containers, scalar pass-through). They complement the immutable specification
 * tests in env-resolve.spec.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveString, resolvePlaceholders } from '../lib/env-resolve.ts';

// ── resolveString edge cases ────────────────────────────

describe('env-resolve resolveString — edge cases', () => {
  it('should resolve adjacent tokens with no separator', () => {
    assert.equal(
      resolveString('${A}${B}', { A: 'foo', B: 'bar' }),
      'foobar',
    );
  });

  it('should resolve a variable name containing underscores and digits', () => {
    assert.equal(
      resolveString('${ACC_HOST_2}', { ACC_HOST_2: '10.0.0.9' }),
      '10.0.0.9',
    );
  });

  it('should resolve a variable name starting with an underscore', () => {
    assert.equal(resolveString('${_X}', { _X: 'ok' }), 'ok');
  });

  it('should return an empty string unchanged', () => {
    assert.equal(resolveString('', {}), '');
  });

  it('should not match a token whose name starts with a digit', () => {
    // ${1ABC} is not a valid identifier (leading digit), so it is left literal.
    assert.equal(resolveString('${1ABC}', { '1ABC': 'x' }), '${1ABC}');
  });

  it('should leave an unterminated brace sequence unchanged', () => {
    assert.equal(resolveString('${UNCLOSED', { UNCLOSED: 'x' }), '${UNCLOSED');
  });

  it('should substitute a value that itself contains a dollar sign without re-resolving', () => {
    // Replacement is single-pass: a literal "$" in a value is not re-scanned.
    assert.equal(resolveString('${A}', { A: '$B' }), '$B');
  });
});

// ── resolvePlaceholders edge cases ──────────────────────

describe('env-resolve resolvePlaceholders — edge cases', () => {
  it('should resolve deeply nested objects and arrays', () => {
    const input = {
      environments: {
        production: {
          servers: [{ host: 'deploy@${PROD_HOST}', port: 22 }],
        },
      },
    };
    const result = resolvePlaceholders(input, { PROD_HOST: '10.0.3.10' });
    assert.deepEqual(result, {
      environments: {
        production: {
          servers: [{ host: 'deploy@10.0.3.10', port: 22 }],
        },
      },
    });
  });

  it('should return an empty object unchanged', () => {
    assert.deepEqual(resolvePlaceholders({}, {}), {});
  });

  it('should return an empty array unchanged', () => {
    assert.deepEqual(resolvePlaceholders([], {}), []);
  });

  it('should pass through null, numbers, and booleans untouched', () => {
    assert.deepEqual(
      resolvePlaceholders({ a: null, b: 1, c: true }, {}),
      { a: null, b: 1, c: true },
    );
  });

  it('should not mutate the original input object', () => {
    const input = { host: 'deploy@${H}' };
    resolvePlaceholders(input, { H: 'x' });
    assert.equal(input.host, 'deploy@${H}', 'original must be unchanged');
  });

  it('should throw when a nested string references a missing variable', () => {
    assert.throws(
      () => resolvePlaceholders({ a: { b: '${MISSING}' } }, {}),
      (err: Error) => {
        assert.ok(err.message.includes('MISSING'));
        return true;
      },
    );
  });
});
