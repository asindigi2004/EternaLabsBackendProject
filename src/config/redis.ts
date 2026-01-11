import Redis from 'ioredis';
import { config } from './app';

// Note: dotenv is loaded in app.ts, no need to load here

/**
 * Redis client configuration
 * Used for BullMQ job queue and active order tracking
 * All configuration loaded from centralized config system
 */
export const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  // BullMQ requires maxRetriesPerRequest to be null
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

/**
 * Redis config for general client (not BullMQ)
 * Uses configured maxRetriesPerRequest
 */
export const redisClientConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Create Redis connection for BullMQ (export config for BullMQ, instance for direct use)
export const redisConnection = new Redis(redisConfig);

// Create a separate Redis client for general operations (uses different config)
export const redisClient = new Redis(redisClientConfig);

// Handle Redis connection events
redisConnection.on('connect', () => {
  console.log('Redis connection established');
});

redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connection established');
});

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    await redisConnection.ping();
    console.log('Redis connection successful');
    return true;
  } catch (error) {
    console.error('Redis connection failed:', error);
    return false;
  }
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedisConnections(): Promise<void> {
  await redisConnection.quit();
  await redisClient.quit();
  console.log('Redis connections closed');
}
