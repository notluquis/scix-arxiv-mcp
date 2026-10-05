import { afterEach, describe, expect, it } from 'vitest';
import { envSecret, getScixApiKey } from '../src/config.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('envSecret', () => {
  it('treats empty and unsubstituted ${user_config.*} values as unset', () => {
    // A plugin option the user never configured may reach the server as the literal placeholder.
    process.env.X_KEY = '${user_config.semantic_scholar_api_key}';
    expect(envSecret('X_KEY')).toBeUndefined();
    process.env.X_KEY = '  ';
    expect(envSecret('X_KEY')).toBeUndefined();
    delete process.env.X_KEY;
    expect(envSecret('X_KEY')).toBeUndefined();
  });

  it('returns a real value trimmed', () => {
    process.env.X_KEY = '  abc123  ';
    expect(envSecret('X_KEY')).toBe('abc123');
  });

  it('getScixApiKey rejects the placeholder instead of sending it as a bearer token', () => {
    process.env.SCIX_API_TOKEN = '${user_config.scix_api_token}';
    expect(() => getScixApiKey()).toThrow('SCIX_API_TOKEN is not set');
  });
});
