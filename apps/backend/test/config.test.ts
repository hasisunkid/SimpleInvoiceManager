import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { sanitizeIngressPath } from '../src/app.js';

const base = { DB_HOST: 'db', DB_USER: 'u', SESSION_SECRET: 's'.repeat(32) };

describe('loadConfig (AR-16)', () => {
  it('applies defaults', () => {
    const { config, warnings } = loadConfig(base);
    expect(config.db).toMatchObject({
      host: 'db',
      port: 3306,
      user: 'u',
      database: 'simpleinvoice',
    });
    expect(config.port).toBe(8099);
    expect(config.logLevel).toBe('info');
    expect(config.seedDemo).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('requires DB_HOST and DB_USER', () => {
    expect(() => loadConfig({ DB_USER: 'u' })).toThrow(ConfigError);
    expect(() => loadConfig({ DB_HOST: 'db' })).toThrow(ConfigError);
  });

  it.each(['homeassistant', 'HomeAssistant', 'mysql', 'information_schema'])(
    'refuses the reserved database %s (AR-12)',
    (name) => {
      expect(() => loadConfig({ ...base, DB_NAME: name })).toThrow(/reserved/);
    },
  );

  it('refuses database names that are not plain identifiers', () => {
    expect(() => loadConfig({ ...base, DB_NAME: 'a`; DROP DATABASE x; --' })).toThrow(ConfigError);
  });

  it('validates ports, log level and secret length', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, DB_PORT: '70000' })).toThrow(/DB_PORT/);
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/32/);
  });

  it('generates a temporary session secret with a warning when none is set', () => {
    const { config, warnings } = loadConfig({ DB_HOST: 'db', DB_USER: 'u' });
    expect(config.sessionSecret).toHaveLength(64);
    expect(warnings).toHaveLength(1);
  });
});

describe('sanitizeIngressPath (AR-13)', () => {
  it('accepts the HA ingress path and strips trailing slashes', () => {
    expect(sanitizeIngressPath('/api/hassio_ingress/abc123/')).toBe('/api/hassio_ingress/abc123');
    expect(sanitizeIngressPath(['/api/hassio_ingress/x', '/other'])).toBe('/api/hassio_ingress/x');
  });

  it.each([undefined, '', 'https://evil.example/', '/a/../b', '/a;b', '/a"b'])(
    'rejects %s',
    (value) => {
      expect(sanitizeIngressPath(value)).toBe('');
    },
  );
});
