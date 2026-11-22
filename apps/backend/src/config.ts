import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * The application's single configuration path (AR-16): environment variables only.
 * In Home Assistant mode, ha-app/run.sh maps app options and Supervisor service
 * credentials onto exactly these variables.
 */
export interface Config {
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
  };
  readonly dataDir: string;
  readonly frontendDir: string;
  readonly sessionSecret: string;
  readonly initialAdminPassword: string | undefined;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly seedDemo: boolean;
  /** AR-26: product version baked into the image (BUILD_VERSION → APP_VERSION); `dev` locally. */
  readonly version: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** A semver-like version label (e.g. `0.8.0`, `0.8.0-rc.1`) or `dev`. */
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Database names we create ourselves – must be a plain identifier (AR-12). */
const DB_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/** The Home Assistant recorder database must never be touched (AR-12). */
const FORBIDDEN_DB_NAMES = new Set([
  'homeassistant',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
]);

function port(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`${key} must be a port number, got "${raw}"`);
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') throw new ConfigError(`${key} is required`);
  return value;
}

export interface LoadConfigResult {
  readonly config: Config;
  readonly warnings: readonly string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadConfigResult {
  const warnings: string[] = [];

  const database = env.DB_NAME || 'simpleinvoice';
  if (!DB_NAME_PATTERN.test(database)) {
    throw new ConfigError(`DB_NAME may only contain letters, digits and "_", got "${database}"`);
  }
  if (FORBIDDEN_DB_NAMES.has(database.toLowerCase())) {
    throw new ConfigError(`DB_NAME "${database}" is reserved and must not be used by this app`);
  }

  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }

  const version = env.APP_VERSION || 'dev';
  if (!VERSION_PATTERN.test(version)) {
    throw new ConfigError(`APP_VERSION must be a version such as 0.8.0, got "${version}"`);
  }

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret === '') {
    sessionSecret = randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET not set – generated a temporary one; sessions end on restart.');
  } else if (sessionSecret.length < 32) {
    throw new ConfigError('SESSION_SECRET must be at least 32 characters long');
  }

  const config: Config = {
    db: {
      host: required(env, 'DB_HOST'),
      port: port(env, 'DB_PORT', 3306),
      user: required(env, 'DB_USER'),
      password: env.DB_PASSWORD ?? '',
      database,
    },
    dataDir: path.resolve(env.DATA_DIR || './.data'),
    frontendDir: path.resolve(
      env.FRONTEND_DIR || path.join(import.meta.dirname, '../../frontend/dist'),
    ),
    sessionSecret,
    initialAdminPassword: env.INITIAL_ADMIN_PASSWORD || undefined,
    port: port(env, 'PORT', 8099),
    logLevel: logLevel as Config['logLevel'],
    seedDemo: env.SEED_DEMO === 'true',
    version,
  };
  return { config, warnings };
}
