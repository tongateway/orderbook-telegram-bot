/**
 * Price CRON Service
 *
 * Periodically refreshes coin prices in Redis cache
 * to ensure fast price lookups during order creation
 */

import { refreshPriceCache } from './priceService';

// Refresh interval: 30 seconds
const PRICE_REFRESH_INTERVAL = 30 * 1000;

let cronInterval: NodeJS.Timeout | null = null;

/**
 * Start the price refresh CRON job
 * Refreshes prices immediately and then every 30 seconds
 */
export function startPriceRefreshCron(): void {
  if (cronInterval) {
    console.log('[PriceCron] Already running');
    return;
  }

  console.log('[PriceCron] Starting price refresh CRON (every 30s)');

  // Initial refresh on startup
  refreshPriceCache().then((success) => {
    if (success) {
      console.log('[PriceCron] Initial price cache populated');
    } else {
      console.warn('[PriceCron] Initial refresh failed, will retry in 30s');
    }
  });

  // Schedule periodic refresh
  cronInterval = setInterval(async () => {
    await refreshPriceCache();
  }, PRICE_REFRESH_INTERVAL);
}

/**
 * Stop the price refresh CRON job
 */
export function stopPriceRefreshCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[PriceCron] Stopped');
  }
}
