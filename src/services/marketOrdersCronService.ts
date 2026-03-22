/**
 * Market Orders CRON Service
 *
 * Periodically refreshes market orders data in Redis cache
 * so Market displays always read from cache without API calls
 */

import { getOrdersForPairBySymbol } from './open4devService';
import { getCached, setCached, CacheKeys } from './redisService';

// Refresh interval: 25 seconds
const ORDERS_REFRESH_INTERVAL = 25 * 1000;

// Cache TTL: 60 seconds (longer than refresh interval for safety)
const ORDERS_CACHE_TTL = 60;

// Supported trading pairs to refresh
const SUPPORTED_PAIRS = ['NOT/TON', 'NOT/USDT', 'BUILD/TON', 'BUILD/USDT', 'TON/DOGS', 'TON/PX', 'TON/XAUt'];

let cronInterval: NodeJS.Timeout | null = null;

export interface MarketOrdersData {
  sellOrdersCount: number;
  sellTotalAmount: number;
  sellOrders24h: number;
  sellAmount24h: number;
  buyOrdersCount: number;
  buyTotalAmount: number;
  buyOrders24h: number;
  buyAmount24h: number;
  swappedOrdersCount: number;
  swappedFromAmount: number;
  swappedToAmount: number;
  cachedAt: number;
}

/**
 * Fetch and cache market orders data for a single pair
 */
async function refreshPairOrders(fromSymbol: string, toSymbol: string): Promise<boolean> {
  const cacheKey = CacheKeys.marketOrders(`${fromSymbol}/${toSymbol}`);

  try {
    // Fetch active orders and completed orders
    const [
      deployedForward, pendingForward, deployedReverse, pendingReverse,
      completedForward, completedReverse
    ] = await Promise.all([
      // Active orders
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'deployed', 500),
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'pending_match', 500),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'deployed', 500),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'pending_match', 500),
      // Completed orders
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'completed', 500),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'completed', 500),
    ]);

    // Client-side filter to ensure only active orders
    const isActiveOrder = (order: any) => order.status === 'deployed' || order.status === 'pending_match';

    const asks = [...deployedForward, ...pendingForward].filter(isActiveOrder);
    const bids = [...deployedReverse, ...pendingReverse].filter(isActiveOrder);

    // Calculate totals for active orders
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const isRecent = (order: any) => {
      const createdAt = order.created_at ? new Date(order.created_at) : null;
      return createdAt && createdAt >= twentyFourHoursAgo;
    };

    const sellRecent = asks.filter(isRecent);
    const buyRecent = bids.filter(isRecent);

    // Calculate completed/swapped stats using initial_amount
    const allCompleted = [...completedForward, ...completedReverse];
    const swappedFromAmount = completedForward.reduce((sum, order) => sum + (order.initial_amount || order.amount || 0), 0);
    const swappedToAmount = completedReverse.reduce((sum, order) => sum + (order.initial_amount || order.amount || 0), 0);

    const data: MarketOrdersData = {
      sellOrdersCount: asks.length,
      sellTotalAmount: asks.reduce((sum, order) => sum + (order.amount || 0), 0),
      sellOrders24h: sellRecent.length,
      sellAmount24h: sellRecent.reduce((sum, order) => sum + (order.amount || 0), 0),
      buyOrdersCount: bids.length,
      buyTotalAmount: bids.reduce((sum, order) => sum + (order.amount || 0), 0),
      buyOrders24h: buyRecent.length,
      buyAmount24h: buyRecent.reduce((sum, order) => sum + (order.amount || 0), 0),
      swappedOrdersCount: allCompleted.length,
      swappedFromAmount,
      swappedToAmount,
      cachedAt: Date.now(),
    };

    // Cache with 60 second TTL
    await setCached(cacheKey, data, ORDERS_CACHE_TTL);

    return true;
  } catch (error) {
    console.error(`[MarketOrdersCron] Error refreshing ${fromSymbol}/${toSymbol}:`, error);
    return false;
  }
}

/**
 * Refresh market orders for all supported pairs
 */
async function refreshAllMarketOrders(): Promise<void> {
  const startTime = Date.now();
  let successCount = 0;

  // Refresh all pairs sequentially to avoid API rate limits
  for (const pair of SUPPORTED_PAIRS) {
    const [fromSymbol, toSymbol] = pair.split('/');
    const success = await refreshPairOrders(fromSymbol, toSymbol);
    if (success) successCount++;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[MarketOrdersCron] Refreshed ${successCount}/${SUPPORTED_PAIRS.length} pairs in ${elapsed}ms`);
}

/**
 * Get cached market orders data for a pair
 * Returns null if not cached
 */
export async function getCachedMarketOrders(fromSymbol: string, toSymbol: string): Promise<MarketOrdersData | null> {
  const cacheKey = CacheKeys.marketOrders(`${fromSymbol}/${toSymbol}`);
  return getCached<MarketOrdersData>(cacheKey);
}

/**
 * Start the market orders refresh CRON job
 * Refreshes orders immediately and then every 25 seconds
 */
export function startMarketOrdersCron(): void {
  if (cronInterval) {
    console.log('[MarketOrdersCron] Already running');
    return;
  }

  console.log('[MarketOrdersCron] Starting market orders refresh CRON (every 25s)');

  // Initial refresh on startup
  refreshAllMarketOrders().then(() => {
    console.log('[MarketOrdersCron] Initial cache populated');
  });

  // Schedule periodic refresh
  cronInterval = setInterval(async () => {
    await refreshAllMarketOrders();
  }, ORDERS_REFRESH_INTERVAL);
}

/**
 * Stop the market orders refresh CRON job
 */
export function stopMarketOrdersCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[MarketOrdersCron] Stopped');
  }
}
