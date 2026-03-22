/**
 * Swap Notification Message Template
 *
 * Message shown to users when their order is matched/swapped
 */

import type { MatchedOrderData } from '../../services/matchedOrdersConsumer';
import { getCachedCoins } from '../../services/open4devService';

export interface SwapNotificationMessage {
  text: string;
}

// In-memory cache for coin symbols (populated from API)
let coinSymbolsCache: Map<string, string> = new Map([
  ['0', 'TON'], // TON is always ID 0
]);
let cacheLastUpdated = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get coin symbol from coin ID (with API fallback)
 */
async function getCoinSymbol(coinId: string | number): Promise<string> {
  const id = String(coinId);

  // Check cache first
  if (coinSymbolsCache.has(id)) {
    return coinSymbolsCache.get(id)!;
  }

  // Refresh cache if needed
  const now = Date.now();
  if (now - cacheLastUpdated > CACHE_TTL) {
    try {
      const coins = await getCachedCoins();
      coinSymbolsCache = new Map([['0', 'TON']]);
      for (const coin of coins) {
        coinSymbolsCache.set(String(coin.id), coin.symbol?.toUpperCase() || `#${coin.id}`);
      }
      cacheLastUpdated = now;
    } catch (error) {
      console.error('Failed to refresh coin symbols cache:', error);
    }
  }

  return coinSymbolsCache.get(id) || `#${id}`;
}

/**
 * Format amount based on token type
 * - Stablecoins (USDT, USDC): 2 decimals for display
 * - Other tokens (TON, NOT, BUILD): 4 decimals
 */
function formatAmount(amount: number, symbol?: string): string {
  if (isNaN(amount)) return '0';

  const upperSymbol = symbol?.toUpperCase() || '';
  const isStablecoin = upperSymbol === 'USDT' || upperSymbol === 'USDC';

  if (isStablecoin) {
    return amount.toFixed(2);
  }

  // For other tokens, use 4 decimals
  return amount.toFixed(4);
}

/**
 * Format price rate with 6 decimal places
 */
function formatPriceRate(priceRate: string | number): string {
  const num = typeof priceRate === 'string' ? parseFloat(priceRate) : priceRate;
  if (isNaN(num)) return '0.000000';
  return num.toFixed(6);
}

/**
 * Format timestamp to readable date (Jan 7, 01:46 PM)
 */
function formatTimestamp(timestamp: string | number | undefined): string {
  if (!timestamp) return 'N/A';

  try {
    let date: Date;

    // Handle different timestamp formats
    if (typeof timestamp === 'number') {
      // Unix timestamp (seconds or milliseconds)
      date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
    } else if (typeof timestamp === 'string') {
      // Try parsing as number first (Unix timestamp as string)
      const numTs = Number(timestamp);
      if (!isNaN(numTs) && numTs > 0) {
        date = new Date(numTs > 1e12 ? numTs : numTs * 1000);
      } else {
        // Try parsing as ISO string or other formats
        date = new Date(timestamp);
      }
    } else {
      return 'N/A';
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'N/A';
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'N/A';
  }
}

/**
 * Generate swap notification message
 */
export async function getSwapNotificationMessage(
  data: MatchedOrderData
): Promise<SwapNotificationMessage> {
  const isFullyFilled = data.status.toUpperCase() === 'FILLED' ||
                        data.status.toLowerCase() === 'completed';

  // Handle missing coin IDs - default to TON (0) if not provided
  const fromCoinId = data.from_coin_id || '0';
  const toCoinId = data.to_coin_id || '0';

  // Fetch coin symbols from API
  const [fromSymbol, toSymbol] = await Promise.all([
    getCoinSymbol(fromCoinId),
    getCoinSymbol(toCoinId),
  ]);

  // Short order ID (last 8 chars or full ID if numeric)
  const shortOrderId = data.order_id.length > 8 && isNaN(Number(data.order_id))
    ? data.order_id.slice(-8)
    : data.order_id;

  // Amounts from stream are already human-readable (e.g., "0.020000" = 0.02 TON)
  const swapAmountHuman = parseFloat(data.swap_amount) || 0;
  const remainingAmountHuman = parseFloat(data.amount) || 0;
  const priceRate = parseFloat(data.price_rate) || 0;

  const receivedAmount = swapAmountHuman * priceRate;

  let text = '';

  if (isFullyFilled) {
    text += `🔔 <b>Order Executed</b> (#${shortOrderId})\n\n`;
  } else {
    text += `🔔 <b>Order Executed (Partial)</b> (#${shortOrderId})\n\n`;
  }

  // Show given and received amounts
  text += `💸 Given: ${formatAmount(swapAmountHuman, fromSymbol)} ${fromSymbol}\n`;
  text += `💰 Received: ${formatAmount(receivedAmount, toSymbol)} ${toSymbol}\n`;

  // Remaining amount (only if partial)
  if (!isFullyFilled) {
    text += `📊 Remaining: ${formatAmount(remainingAmountHuman, fromSymbol)} ${fromSymbol}\n`;
  }

  // Timestamp
  text += `\n🕒 ${formatTimestamp(data.parsed_at)}`;

  return { text };
}
