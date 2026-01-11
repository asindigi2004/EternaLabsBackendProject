import dotenv from 'dotenv';

dotenv.config();

/**
 * Application Configuration
 * Centralized configuration system - all hardcoded values moved here
 * All values can be overridden via environment variables
 */

export interface DexConfig {
  name: string;
  minPrice: number;
  maxPrice: number;
}

export interface ProcessingDelays {
  routingMin: number;
  routingMax: number;
  buildingMin: number;
  buildingMax: number;
  submittedMin: number;
  submittedMax: number;
  quoteFetchMin: number;
  quoteFetchMax: number;
}

export interface QueueConfig {
  name: string;
  concurrency: number;
  maxAttempts: number;
  backoffDelay: number;
  backoffType: 'exponential' | 'fixed';
  limiterMax: number;
  limiterDuration: number;
  removeOnCompleteAge: number;
  removeOnCompleteCount: number;
  removeOnFailAge: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: number;
}

export interface AppConfig {
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
  database: DatabaseConfig;
  redis: RedisConfig;
  queue: QueueConfig;
  dex: {
    dexes: DexConfig[];
    quoteFetchDelay: {
      min: number;
      max: number;
    };
  };
  order: {
    processingDelays: ProcessingDelays;
    successRate: number; // 0.0 to 1.0 (0.9 = 90% success rate)
    cacheTtl: number; // Redis cache TTL in seconds
    defaultLimit: number; // Default limit for order queries
  };
  websocket: {
    orderStatusChannelPrefix: string;
    orderCachePrefix: string;
    replayDelayMs: number;
    bufferTtlMs: number;
  };
}

/**
 * Parse environment variable as number with default
 */
function getNumberEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse environment variable as float with default
 */
function getFloatEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse environment variable as boolean with default
 */
function getBooleanEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse DEX configuration from environment
 * Format: DEX_NAMES=Raydium,Meteora
 *         DEX_RAYDIUM_MIN_PRICE=0.98
 *         DEX_RAYDIUM_MAX_PRICE=1.02
 *         DEX_METEORA_MIN_PRICE=0.97
 *         DEX_METEORA_MAX_PRICE=1.05
 */
function parseDexConfig(): DexConfig[] {
  const dexNames = process.env.DEX_NAMES?.split(',').map((n) => n.trim()) || ['Raydium', 'Meteora'];
  
  return dexNames.map((name) => {
    const upperName = name.toUpperCase().replace(/\s+/g, '_');
    return {
      name,
      minPrice: getFloatEnv(`DEX_${upperName}_MIN_PRICE`, name === 'Raydium' ? 0.98 : 0.97),
      maxPrice: getFloatEnv(`DEX_${upperName}_MAX_PRICE`, name === 'Raydium' ? 1.02 : 1.05),
    };
  });
}

/**
 * Application configuration object
 * All values can be overridden via environment variables
 */
export const config: AppConfig = {
  server: {
    port: getNumberEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: getNumberEnv('DB_PORT', 5432),
    name: process.env.DB_NAME || 'order_engine',
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'password',
    maxConnections: getNumberEnv('DB_MAX_CONNECTIONS', 20),
    idleTimeoutMillis: getNumberEnv('DB_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getNumberEnv('DB_CONNECTION_TIMEOUT_MS', 2000),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: getNumberEnv('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: getNumberEnv('REDIS_MAX_RETRIES', 3),
  },
  queue: {
    name: process.env.QUEUE_NAME || 'orders',
    concurrency: getNumberEnv('QUEUE_CONCURRENCY', 10),
    maxAttempts: getNumberEnv('QUEUE_MAX_ATTEMPTS', 3),
    backoffDelay: getNumberEnv('QUEUE_BACKOFF_DELAY_MS', 2000),
    backoffType: (process.env.QUEUE_BACKOFF_TYPE as 'exponential' | 'fixed') || 'exponential',
    limiterMax: getNumberEnv('QUEUE_LIMITER_MAX', 100),
    limiterDuration: getNumberEnv('QUEUE_LIMITER_DURATION_MS', 1000),
    removeOnCompleteAge: getNumberEnv('QUEUE_REMOVE_ON_COMPLETE_AGE_SEC', 3600),
    removeOnCompleteCount: getNumberEnv('QUEUE_REMOVE_ON_COMPLETE_COUNT', 1000),
    removeOnFailAge: getNumberEnv('QUEUE_REMOVE_ON_FAIL_AGE_SEC', 86400),
  },
  dex: {
    dexes: parseDexConfig(),
    quoteFetchDelay: {
      min: getNumberEnv('DEX_QUOTE_FETCH_DELAY_MIN_MS', 100),
      max: getNumberEnv('DEX_QUOTE_FETCH_DELAY_MAX_MS', 300),
    },
  },
  order: {
    processingDelays: {
      routingMin: getNumberEnv('ORDER_ROUTING_DELAY_MIN_MS', 500),
      routingMax: getNumberEnv('ORDER_ROUTING_DELAY_MAX_MS', 1000),
      buildingMin: getNumberEnv('ORDER_BUILDING_DELAY_MIN_MS', 1000),
      buildingMax: getNumberEnv('ORDER_BUILDING_DELAY_MAX_MS', 2000),
      submittedMin: getNumberEnv('ORDER_SUBMITTED_DELAY_MIN_MS', 500),
      submittedMax: getNumberEnv('ORDER_SUBMITTED_DELAY_MAX_MS', 1500),
      quoteFetchMin: getNumberEnv('ORDER_QUOTE_FETCH_DELAY_MIN_MS', 100),
      quoteFetchMax: getNumberEnv('ORDER_QUOTE_FETCH_DELAY_MAX_MS', 300),
    },
    successRate: getFloatEnv('ORDER_SUCCESS_RATE', 0.9), // 90% success rate
    cacheTtl: getNumberEnv('ORDER_CACHE_TTL_SEC', 3600),
    defaultLimit: getNumberEnv('ORDER_DEFAULT_LIMIT', 100),
  },
  websocket: {
    orderStatusChannelPrefix: process.env.WS_ORDER_STATUS_CHANNEL_PREFIX || 'order',
    orderCachePrefix: process.env.WS_ORDER_CACHE_PREFIX || 'order',
    // Replay delay between statuses when replaying from DB (ms)
    replayDelayMs: getNumberEnv('WS_REPLAY_DELAY_MS', 50),
    // In-memory buffer TTL for recent status updates (ms)
    bufferTtlMs: getNumberEnv('WS_BUFFER_TTL_MS', 1000 * 60 * 60),
  },
};

/**
 * Validate configuration
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Validate success rate
  if (config.order.successRate < 0 || config.order.successRate > 1) {
    errors.push('ORDER_SUCCESS_RATE must be between 0 and 1');
  }

  // Validate DEX prices
  config.dex.dexes.forEach((dex) => {
    if (dex.minPrice >= dex.maxPrice) {
      errors.push(`DEX ${dex.name}: minPrice must be less than maxPrice`);
    }
    if (dex.minPrice < 0 || dex.maxPrice < 0) {
      errors.push(`DEX ${dex.name}: prices must be positive`);
    }
  });

  // Validate delays
  const delays = config.order.processingDelays;
  if (delays.routingMin >= delays.routingMax) {
    errors.push('ORDER_ROUTING_DELAY_MIN_MS must be less than ORDER_ROUTING_DELAY_MAX_MS');
  }
  if (delays.buildingMin >= delays.buildingMax) {
    errors.push('ORDER_BUILDING_DELAY_MIN_MS must be less than ORDER_BUILDING_DELAY_MAX_MS');
  }
  if (delays.submittedMin >= delays.submittedMax) {
    errors.push('ORDER_SUBMITTED_DELAY_MIN_MS must be less than ORDER_SUBMITTED_DELAY_MAX_MS');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Validate on import
validateConfig();
