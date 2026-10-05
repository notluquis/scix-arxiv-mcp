import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

describe('buildServer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not throw when SCIX_API_TOKEN is unset (factory must never throw)', () => {
    vi.stubEnv('SCIX_API_TOKEN', '');
    expect(() => buildServer()).not.toThrow();
  });
});
