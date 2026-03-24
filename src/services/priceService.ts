/**
 * Price Service
 *
 * Fetches token prices from CoinGecko API to calculate USD values
 * Includes rate limit handling and fallback caching
 */

import { getCached, setCached, CacheKeys } from './redisService';
import {
  COINGECKO_TOKEN_IDS,
  PRICE_CONSTANTS,
} from '../utils/tokenConstants';
import { normalizeTokenSymbol } from '../utils/tokenSymbol';
import { config } from '../utils/config';

interface PriceData {
  [symbol: string]: number;
}

// In-memory fallback prices (updated on successful fetch)
let fallbackPrices: PriceData = {
  USDT: 1,
  TON: 5.0,   // Approximate fallback
  NOT: 0.007, // Approximate fallback
};

// Track rate limit status
let rateLimitedUntil = 0;

// Cache TTL: 1 minute - prices are refreshed every 30s by CRON
const PRICE_CACHE_TTL = 60;

/**
 * Fetch token prices from CoinGecko
 */
export async function getTokenPrices(): Promise<PriceData> {
  // Check cache first
  const cacheKey = 'prices:all';
  const cached = await getCached<PriceData>(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if we're rate limited
  const now = Date.now();
  if (now < rateLimitedUntil) {
    // Return fallback prices while rate limited
    return fallbackPrices;
  }

  const prices: PriceData = {
    USDT: 1, // USDT is always $1
  };

  try {
    const ids = Object.entries(COINGECKO_TOKEN_IDS)
      .filter(([symbol]) => symbol !== 'USDT')
      .map(([, id]) => id)
      .join(',');

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      rateLimitedUntil = Date.now() + waitSeconds * 1000;
      console.warn(`CoinGecko rate limited. Retry after ${waitSeconds}s`);

      // Cache fallback prices to avoid hammering the API
      await setCached(cacheKey, fallbackPrices, Math.min(waitSeconds, PRICE_CACHE_TTL));
      return fallbackPrices;
    }

    if (response.ok) {
      const data = (await response.json()) as Record<string, { usd?: number }>;

      // Map CoinGecko IDs back to symbols
      for (const [symbol, id] of Object.entries(COINGECKO_TOKEN_IDS)) {
        if (symbol === 'USDT') continue;
        if (data[id]?.usd) {
          prices[symbol] = data[id].usd;
        }
      }

      // Update fallback prices with fresh data
      fallbackPrices = { ...prices };
    }
  } catch (error) {
    console.error('Error fetching prices from CoinGecko:', error);
    // Return fallback on error
    return fallbackPrices;
  }

  // Fetch AGNT price from order book
  const agntPrice = await fetchAgntPrice(prices);
  if (agntPrice) {
    prices.AGNT = agntPrice;
    fallbackPrices.AGNT = agntPrice;
  }

  // Cache the prices with longer TTL
  await setCached(cacheKey, prices, PRICE_CACHE_TTL);

  return prices;
}

/**
 * Get price for a specific token
 */
export async function getTokenPrice(symbol: string): Promise<number | null> {
  const prices = await getTokenPrices();
  return prices[normalizeTokenSymbol(symbol)] ?? null;
}

/**
 * Calculate USD value for a token amount
 */
export async function calculateUsdValue(
  symbol: string,
  amount: number
): Promise<number | null> {
  const price = await getTokenPrice(symbol);
  if (price === null) return null;
  return amount * price;
}

/**
 * Format USD value for display
 */
export function formatUsdValue(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

/**
 * Get exchange rate between two tokens
 * Returns how many toTokens you get for 1 fromToken
 */
export async function getMarketRate(
  fromSymbol: string,
  toSymbol: string
): Promise<number | null> {
  const prices = await getTokenPrices();
  const fromPrice = prices[normalizeTokenSymbol(fromSymbol)];
  const toPrice = prices[normalizeTokenSymbol(toSymbol)];

  if (!fromPrice || !toPrice) return null;

  // Rate = fromPrice / toPrice
  // e.g., if TON = $5 and NOT = $0.01, then 1 TON = 500 NOT
  return fromPrice / toPrice;
}

/**
 * Calculate amount to receive based on market price
 */
export async function calculateMarketAmount(
  fromSymbol: string,
  fromAmount: number,
  toSymbol: string
): Promise<number | null> {
  const rate = await getMarketRate(fromSymbol, toSymbol);
  if (rate === null) return null;
  return fromAmount * rate;
}

/**
 * Fetch AGNT price from Open4Dev order book API.
 * Takes the average mid-price (in USD) across pairs that have orders on both sides.
 */
async function fetchAgntPrice(knownPrices: PriceData): Promise<number | null> {
  try {
    const res = await fetch(
      `${config.open4devApiUrl}/coins/price?symbol=AGNT`,
      {
        headers: {
          'X-Api-Key': config.open4devApiKey || '',
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const pairs: any[] = data?.pairs || [];
    const coinDecimals = data?.coin?.decimals ?? 9;

    let totalUsdPrice = 0;
    let validPairs = 0;

    for (const pair of pairs) {
      // Skip pairs without orders on both sides
      if (!pair.ask_order_count || !pair.bid_order_count) continue;
      if (!pair.mid_price) continue;

      const counterSymbol = normalizeTokenSymbol(pair.counter_coin_symbol);
      const counterUsdPrice = knownPrices[counterSymbol];
      if (!counterUsdPrice) continue;

      const counterDecimals = pair.counter_coin_decimals ?? 9;

      // mid_price is in 18-decimal fixed-point: how many counter units per 1 AGNT base unit
      // Real price = mid_price / 10^18 * 10^coinDecimals / 10^counterDecimals
      const midPrice = Number(pair.mid_price) / 1e18;
      const adjustedRate = midPrice * Math.pow(10, coinDecimals) / Math.pow(10, counterDecimals);
      const usdPrice = adjustedRate * counterUsdPrice;

      if (usdPrice > 0 && isFinite(usdPrice)) {
        totalUsdPrice += usdPrice;
        validPairs++;
      }
    }

    if (validPairs === 0) return null;
    return totalUsdPrice / validPairs;
  } catch (error) {
    console.error('[PriceCache] Failed to fetch AGNT price:', error);
    return null;
  }
}

/**
 * Refresh price cache - called by CRON job
 * Forces a fresh fetch from CoinGecko and updates cache
 * Returns true on success, false on failure
 */
export async function refreshPriceCache(): Promise<boolean> {
  const cacheKey = 'prices:all';

  // Check if we're rate limited
  const now = Date.now();
  if (now < rateLimitedUntil) {
    console.log('[PriceCache] Still rate limited, skipping refresh');
    return false;
  }

  const prices: PriceData = {
    USDT: 1,
  };

  try {
    const ids = Object.entries(COINGECKO_TOKEN_IDS)
      .filter(([symbol]) => symbol !== 'USDT')
      .map(([, id]) => id)
      .join(',');

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      rateLimitedUntil = Date.now() + waitSeconds * 1000;
      console.warn(`[PriceCache] Rate limited. Retry after ${waitSeconds}s`);
      return false;
    }

    if (!response.ok) {
      console.error(`[PriceCache] API error: ${response.status}`);
      return false;
    }

    const data = (await response.json()) as Record<string, { usd?: number }>;

    for (const [symbol, id] of Object.entries(COINGECKO_TOKEN_IDS)) {
      if (symbol === 'USDT') continue;
      if (data[id]?.usd) {
        prices[symbol] = data[id].usd;
      }
    }

    // Fetch AGNT price from order book
    const agntPrice = await fetchAgntPrice(prices);
    if (agntPrice) {
      prices.AGNT = agntPrice;
    }

    // Update fallback prices
    fallbackPrices = { ...prices };

    // Update cache
    await setCached(cacheKey, prices, PRICE_CACHE_TTL);

    console.log('[PriceCache] Refreshed:', Object.keys(prices).join(', '));
    return true;
  } catch (error) {
    console.error('[PriceCache] Refresh failed:', error);
    return false;
  }
}
