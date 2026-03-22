/**
 * Market Statistics Service
 *
 * Collects and stores market statistics for trading pairs:
 * - 24h Volume
 * - Last Trade
 * - Liquidity Depth
 */

import { prisma } from '../database/prisma';
import { getCached, setCached, CacheKeys } from './redisService';
import { getOrdersForPairBySymbol, getCachedCoins, getCompletedOrdersForPair } from './open4devService';

export interface PairStats {
  pair: string;
  volume24h: number;
  tradeCount24h: number;
  lastTradePrice: number | null;
  lastTradeTime: Date | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  liquidityDepth: number;
  openOrdersCount: number;
}

/**
 * Get market statistics for a trading pair
 * Fetches from cache first, then calculates if needed
 */
export async function getPairStats(pair: string): Promise<PairStats> {
  // Try cache first (60 second TTL)
  const cacheKey = CacheKeys.marketStats(pair);
  const cached = await getCached<PairStats>(cacheKey);
  if (cached) {
    return cached;
  }

  // Calculate fresh stats
  const stats = await calculatePairStats(pair);

  // Cache for 60 seconds
  await setCached(cacheKey, stats, 60);

  return stats;
}

/**
 * Get adjusted coin ID for API calls (TON uses coin_id=0 in orders)
 */
function getTonAdjustedCoinId(symbol: string, coin: { id: number } | undefined): number | null {
  if (symbol.toUpperCase() === 'TON') {
    return 0; // TON always uses coin_id 0 in orders
  }
  return coin?.id ?? null;
}

/**
 * Calculate statistics for a trading pair
 */
async function calculatePairStats(pair: string): Promise<PairStats> {
  const [fromSymbol, toSymbol] = pair.split('/');

  // Get coin IDs for API calls
  const coins = await getCachedCoins();
  const fromCoin = coins.find(c => c.symbol?.toUpperCase() === fromSymbol.toUpperCase());
  const toCoin = coins.find(c => c.symbol?.toUpperCase() === toSymbol.toUpperCase());

  // Get adjusted coin IDs (TON = 0)
  const fromCoinId = getTonAdjustedCoinId(fromSymbol, fromCoin);
  const toCoinId = getTonAdjustedCoinId(toSymbol, toCoin);

  // Default stats
  const stats: PairStats = {
    pair,
    volume24h: 0,
    tradeCount24h: 0,
    lastTradePrice: null,
    lastTradeTime: null,
    highPrice24h: null,
    lowPrice24h: null,
    liquidityDepth: 0,
    openOrdersCount: 0,
  };

  try {
    // 1. Calculate Liquidity Depth and Open Orders Count from active orders
    const [deployedForward, pendingForward, deployedReverse, pendingReverse] = await Promise.all([
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'deployed', 100),
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'pending_match', 100),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'deployed', 100),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'pending_match', 100),
    ]);

    const allActiveOrders = [...deployedForward, ...pendingForward, ...deployedReverse, ...pendingReverse];

    // Liquidity depth = sum of all order amounts
    stats.liquidityDepth = allActiveOrders.reduce((sum, order) => sum + (order.amount || 0), 0);

    // Open orders count
    stats.openOrdersCount = allActiveOrders.length;

    // 2. Get completed orders for volume and last trade
    if (fromCoinId !== null && toCoinId !== null) {
      // Fetch completed orders from both directions using adjusted coin IDs
      const [completedForward, completedReverse] = await Promise.all([
        getCompletedOrdersForPair(fromCoinId, toCoinId, 100),
        getCompletedOrdersForPair(toCoinId, fromCoinId, 100),
      ]);

      const completedOrders = [...completedForward, ...completedReverse];

      // Filter to last 24 hours
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const recent24h = completedOrders.filter(order => {
        const deployedAt = order.deployed_at ? new Date(order.deployed_at) : null;
        return deployedAt && deployedAt >= twentyFourHoursAgo;
      });

      // Calculate 24h metrics
      stats.tradeCount24h = recent24h.length;
      stats.volume24h = recent24h.reduce((sum, order) => sum + (order.amount || 0), 0);

      // Find last trade (most recent completed order)
      const sortedByTime = completedOrders
        .filter(order => order.deployed_at)
        .sort((a, b) => {
          const aTime = new Date(a.deployed_at!).getTime();
          const bTime = new Date(b.deployed_at!).getTime();
          return bTime - aTime; // Descending order
        });

      if (sortedByTime.length > 0) {
        const lastTrade = sortedByTime[0];
        stats.lastTradePrice = lastTrade.price_rate || null;
        stats.lastTradeTime = lastTrade.deployed_at ? new Date(lastTrade.deployed_at) : null;
      }

      // Calculate high/low prices for 24h
      const pricesIn24h = recent24h
        .map(order => order.price_rate)
        .filter((price): price is number => price !== undefined && price !== null);

      if (pricesIn24h.length > 0) {
        stats.highPrice24h = Math.max(...pricesIn24h);
        stats.lowPrice24h = Math.min(...pricesIn24h);
      }
    }

    // 3. Save to database for historical tracking
    await saveStats(stats);

  } catch (error) {
    console.error(`[calculatePairStats] Error calculating stats for ${pair}:`, error);
  }

  return stats;
}

/**
 * Save statistics to database
 */
async function saveStats(stats: PairStats): Promise<void> {
  try {
    await prisma.marketStats.upsert({
      where: { pair: stats.pair },
      update: {
        volume24h: stats.volume24h,
        tradeCount24h: stats.tradeCount24h,
        lastTradePrice: stats.lastTradePrice,
        lastTradeTime: stats.lastTradeTime,
        highPrice24h: stats.highPrice24h,
        lowPrice24h: stats.lowPrice24h,
        liquidityDepth: stats.liquidityDepth,
        openOrdersCount: stats.openOrdersCount,
      },
      create: {
        pair: stats.pair,
        volume24h: stats.volume24h,
        tradeCount24h: stats.tradeCount24h,
        lastTradePrice: stats.lastTradePrice,
        lastTradeTime: stats.lastTradeTime,
        highPrice24h: stats.highPrice24h,
        lowPrice24h: stats.lowPrice24h,
        liquidityDepth: stats.liquidityDepth,
        openOrdersCount: stats.openOrdersCount,
      },
    });
  } catch (error) {
    console.error(`[saveStats] Error saving stats for ${stats.pair}:`, error);
  }
}

/**
 * Get stored statistics from database (fallback when API is unavailable)
 */
export async function getStoredStats(pair: string): Promise<PairStats | null> {
  try {
    const stored = await prisma.marketStats.findUnique({
      where: { pair },
    });

    if (!stored) return null;

    return {
      pair: stored.pair,
      volume24h: stored.volume24h,
      tradeCount24h: stored.tradeCount24h,
      lastTradePrice: stored.lastTradePrice,
      lastTradeTime: stored.lastTradeTime,
      highPrice24h: stored.highPrice24h,
      lowPrice24h: stored.lowPrice24h,
      liquidityDepth: stored.liquidityDepth,
      openOrdersCount: stored.openOrdersCount,
    };
  } catch (error) {
    console.error(`[getStoredStats] Error getting stored stats for ${pair}:`, error);
    return null;
  }
}

/**
 * Format volume for display
 */
export function formatVolume(volume: number): string {
  if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(2)}M`;
  } else if (volume >= 1000) {
    return `${(volume / 1000).toFixed(2)}K`;
  } else {
    return volume.toFixed(2);
  }
}

/**
 * Update stats when a trade is executed (called from order matching)
 */
export async function recordTrade(pair: string, price: number, amount: number): Promise<void> {
  try {
    // Invalidate cache
    const cacheKey = CacheKeys.marketStats(pair);
    await setCached(cacheKey, null, 1); // Effectively delete by setting very short TTL

    // Update database
    const existing = await prisma.marketStats.findUnique({
      where: { pair },
    });

    if (existing) {
      await prisma.marketStats.update({
        where: { pair },
        data: {
          lastTradePrice: price,
          lastTradeTime: new Date(),
          volume24h: existing.volume24h + amount,
          tradeCount24h: existing.tradeCount24h + 1,
          highPrice24h: existing.highPrice24h ? Math.max(existing.highPrice24h, price) : price,
          lowPrice24h: existing.lowPrice24h ? Math.min(existing.lowPrice24h, price) : price,
        },
      });
    } else {
      await prisma.marketStats.create({
        data: {
          pair,
          lastTradePrice: price,
          lastTradeTime: new Date(),
          volume24h: amount,
          tradeCount24h: 1,
          highPrice24h: price,
          lowPrice24h: price,
          liquidityDepth: 0,
        },
      });
    }
  } catch (error) {
    console.error(`[recordTrade] Error recording trade for ${pair}:`, error);
  }
}
