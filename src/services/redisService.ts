/**
 * Redis Service
 *
 * Manages Redis connection and provides caching utilities
 */

import Redis from 'ioredis';
import { config } from '../utils/config';

// Redis client instances
let redisClient: Redis | null = null;
let streamClient: Redis | null = null; // Dedicated client for blocking stream operations

/**
 * Get Redis connection options
 */
function getRedisOptions(name: string = 'main'): any {
  const options: any = {
    host: config.redisHost,
    port: config.redisPort,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    // Connection optimization for speed
    keepAlive: 5000,            // TCP keepalive every 5 seconds
    connectTimeout: 3000,       // 3 second connection timeout
    commandTimeout: name === 'stream' ? 10000 : 5000, // Shorter timeout for cache ops
    enableReadyCheck: false,    // Skip ready check for faster startup
    enableOfflineQueue: true,   // Queue commands while reconnecting
    lazyConnect: false,         // Connect immediately on init
    // Socket optimizations
    noDelay: true,              // Disable Nagle's algorithm for lower latency
    dropBufferSupport: true,    // Faster string handling
  };

  if (config.redisPassword) {
    options.password = config.redisPassword;
  }

  if (config.redisTls) {
    options.tls = {};
  }

  return options;
}

/**
 * Initialize Redis client
 */
export function initializeRedis(): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(getRedisOptions('main'));

  redisClient.on('error', (error) => {
    console.error('Redis connection error:', error);
  });

  redisClient.on('connect', () => {
    console.log('Redis connected successfully');
  });

  redisClient.on('reconnecting', (delay: number) => {
    console.log(`Redis reconnecting in ${delay}ms...`);
  });

  redisClient.on('close', () => {
    console.warn('Redis connection closed');
  });

  return redisClient;
}

/**
 * Get dedicated Redis client for blocking stream operations
 * This prevents BLOCK commands from stalling cache operations
 */
export function getStreamClient(): Redis {
  if (streamClient) {
    return streamClient;
  }

  streamClient = new Redis(getRedisOptions('stream'));

  streamClient.on('error', (error) => {
    console.error('Redis stream client error:', error);
  });

  streamClient.on('connect', () => {
    console.log('Redis stream client connected');
  });

  return streamClient;
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
}

/**
 * Connect to Redis (ensures connection is ready)
 */
export async function connectRedis(): Promise<void> {
  const client = getRedisClient();

  // If already connected or connecting, wait for ready state
  if (client.status === 'ready') {
    return;
  }

  // If connecting, wait for it to be ready
  if (client.status === 'connecting' || client.status === 'connect') {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // If disconnected, reconnect
  if (client.status === 'end' || client.status === 'close') {
    await client.connect();
  }
}

/**
 * Disconnect from Redis
 */
export async function disconnectRedis(): Promise<void> {
  const disconnectPromises: Promise<string>[] = [];

  if (redisClient) {
    disconnectPromises.push(redisClient.quit());
    redisClient = null;
  }

  if (streamClient) {
    disconnectPromises.push(streamClient.quit());
    streamClient = null;
  }

  if (disconnectPromises.length > 0) {
    await Promise.all(disconnectPromises);
  }
}

/**
 * Cache key builders
 */
export const CacheKeys = {
  walletBalance: (address: string) => `wallet:${address}:balance`,
  walletJettonBalance: (address: string, jettonSymbol: string) =>
    `wallet:${address}:jetton:${jettonSymbol}`,
  walletOrders: (address: string) => `wallet:${address}:orders`,
  walletOpenOrders: (address: string) => `wallet:${address}:orders:open`,
  walletClosedOrders: (address: string) => `wallet:${address}:orders:closed`,
  walletStats: (address: string) => `wallet:${address}:stats`,
  coinData: (coinId: string) => `coin:${coinId}`,
  orderBook: (fromCoin: string, toCoin: string) => `orderbook:${fromCoin}:${toCoin}`,
  allVaults: () => `vaults:all`,
  allCoins: () => `coins:all`,
  vaultByCoinSymbol: (symbol: string) => `vault:coin:${symbol.toLowerCase()}`,
  marketStats: (pair: string) => `market:stats:${pair.replace('/', '_').toLowerCase()}`,
  marketOrders: (pair: string) => `market:orders:${pair.replace('/', '_').toLowerCase()}`,
};

/**
 * Get cached data
 */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    console.error(`Error getting cached data for key ${key}:`, error);
    return null;
  }
}

/**
 * Set cached data with TTL
 */
export async function setCached<T>(
  key: string,
  data: T,
  ttl: number = config.redisTtl
): Promise<void> {
  try {
    const client = getRedisClient();
    await client.setex(key, ttl, JSON.stringify(data));
  } catch (error) {
    console.error(`Error setting cached data for key ${key}:`, error);
  }
}

/**
 * Delete cached data
 */
export async function deleteCached(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(key);
  } catch (error) {
    console.error(`Error deleting cached data for key ${key}:`, error);
  }
}

/**
 * Delete cached data by pattern using SCAN (non-blocking)
 * Uses cursor-based iteration to avoid blocking Redis server
 */
export async function deleteCachedByPattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient();
    let cursor = '0';
    const keysToDelete: string[] = [];

    // Use SCAN to find keys matching pattern (non-blocking)
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    // Delete in batches using pipeline for efficiency
    if (keysToDelete.length > 0) {
      const pipeline = client.pipeline();
      for (const key of keysToDelete) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }
  } catch (error) {
    console.error(`Error deleting cached data by pattern ${pattern}:`, error);
  }
}

/**
 * Check if key exists in cache
 */
export async function existsInCache(key: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`Error checking cache existence for key ${key}:`, error);
    return false;
  }
}

/**
 * Get TTL for a key
 */
export async function getTTL(key: string): Promise<number> {
  try {
    const client = getRedisClient();
    return await client.ttl(key);
  } catch (error) {
    console.error(`Error getting TTL for key ${key}:`, error);
    return -1;
  }
}

/**
 * Increment a counter
 */
export async function incrementCounter(key: string, amount: number = 1): Promise<number> {
  try {
    const client = getRedisClient();
    return await client.incrby(key, amount);
  } catch (error) {
    console.error(`Error incrementing counter for key ${key}:`, error);
    return 0;
  }
}

/**
 * Get multiple keys at once
 */
export async function getMultipleCached<T>(keys: string[]): Promise<(T | null)[]> {
  try {
    const client = getRedisClient();
    const values = await client.mget(...keys);
    return values.map((value) => (value ? JSON.parse(value) : null));
  } catch (error) {
    console.error('Error getting multiple cached data:', error);
    return keys.map(() => null);
  }
}

/**
 * Delete multiple keys at once using pipeline (efficient batch delete)
 */
export async function deleteMultipleCached(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  try {
    const client = getRedisClient();
    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.del(key);
    }
    await pipeline.exec();
  } catch (error) {
    console.error('Error deleting multiple cached keys:', error);
  }
}
