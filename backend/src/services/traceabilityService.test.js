import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  sha256,
  hashPayload,
  computeBlockHash,
  signBlock,
  verifySignature,
  buildPayload,
  EVENT_TYPES,
} from './traceabilityService.js';

describe('traceabilityService — canonical JSON', () => {
  it('serializes primitives deterministically', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('abc')).toBe('"abc"');
  });

  it('sorts object keys alphabetically', () => {
    const a = canonicalize({ b: 2, a: 1, c: 3 });
    const b = canonicalize({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":3}');
  });

  it('recurses into nested objects and arrays', () => {
    const payload = { list: [{ z: 1, a: 2 }], meta: { y: 1, x: 2 } };
    expect(canonicalize(payload)).toBe('{"list":[{"a":2,"z":1}],"meta":{"x":2,"y":1}}');
  });

  it('preserves array order (arrays are ordered data)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('traceabilityService — hashing', () => {
  it('sha256 produces a 64-char hex digest', () => {
    const h = sha256('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hashPayload is insensitive to property insertion order', () => {
    const p1 = { crop_year: 2026, crop_type: 'wheat', grade: '1 CWRS' };
    const p2 = { grade: '1 CWRS', crop_type: 'wheat', crop_year: 2026 };
    expect(hashPayload(p1)).toBe(hashPayload(p2));
  });

  it('hashPayload changes when any field changes', () => {
    const base = { crop_year: 2026, bushels: 1000 };
    const tampered = { crop_year: 2026, bushels: 1001 };
    expect(hashPayload(base)).not.toBe(hashPayload(tampered));
  });
});

describe('traceabilityService — block hashing', () => {
  it('computeBlockHash is deterministic given the same inputs', () => {
    const ts = '2026-03-15T12:00:00.000Z';
    const h1 = computeBlockHash({ blockIndex: 0, payloadHash: 'abc', previousHash: '0', timestamp: ts });
    const h2 = computeBlockHash({ blockIndex: 0, payloadHash: 'abc', previousHash: '0', timestamp: ts });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeBlockHash changes when previous_hash changes (chain integrity)', () => {
    const ts = '2026-03-15T12:00:00.000Z';
    const h1 = computeBlockHash({ blockIndex: 1, payloadHash: 'abc', previousHash: 'prev1', timestamp: ts });
    const h2 = computeBlockHash({ blockIndex: 1, payloadHash: 'abc', previousHash: 'prev2', timestamp: ts });
    expect(h1).not.toBe(h2);
  });
});

describe('traceabilityService — HMAC signatures', () => {
  it('signBlock produces a verifiable signature', () => {
    const blockHash = sha256('some-block');
    const sig = signBlock(blockHash);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySignature(blockHash, sig)).toBe(true);
  });

  it('verifySignature rejects a tampered block hash', () => {
    const sig = signBlock(sha256('original'));
    expect(verifySignature(sha256('tampered'), sig)).toBe(false);
  });

  it('verifySignature rejects a missing signature', () => {
    expect(verifySignature('abc', null)).toBe(false);
    expect(verifySignature('abc', '')).toBe(false);
  });
});

describe('traceabilityService — payload normalization', () => {
  it('buildPayload strips null/undefined/empty fields', () => {
    const result = buildPayload({
      event_type: 'HARVEST',
      crop_year: 2026,
      crop_type: 'wheat',
      variety: null,
      grade: '',
      bushels: undefined,
      notes: 'first block',
    });
    expect(result).toEqual({
      event_type: 'HARVEST',
      crop_year: 2026,
      crop_type: 'wheat',
      notes: 'first block',
    });
  });

  it('buildPayload normalizes timestamp to ISO string', () => {
    const result = buildPayload({
      event_type: 'SHIP',
      event_timestamp: new Date('2026-03-15T12:00:00Z'),
    });
    expect(result.event_timestamp).toBe('2026-03-15T12:00:00.000Z');
  });

  it('buildPayload ignores non-whitelisted fields (prevents hash drift)', () => {
    const result = buildPayload({
      event_type: 'HARVEST',
      crop_year: 2026,
      crop_type: 'wheat',
      internal_debug: 'should not be hashed',
      random_field: 42,
    });
    expect(result).not.toHaveProperty('internal_debug');
    expect(result).not.toHaveProperty('random_field');
  });
});

describe('traceabilityService — event types', () => {
  it('exposes a frozen list of valid event types', () => {
    expect(EVENT_TYPES).toContain('HARVEST');
    expect(EVENT_TYPES).toContain('SHIP');
    expect(EVENT_TYPES).toContain('RECEIVE');
    expect(EVENT_TYPES).toContain('BLEND');
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true);
  });
});
