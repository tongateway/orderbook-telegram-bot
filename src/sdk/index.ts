/**
 * Open4Dev API SDK
 *
 * TypeScript SDK for the Open4Dev API (https://api.open4dev.xyz)
 *
 * @example
 * ```ts
 * import { createOpen4DevClient } from './sdk';
 *
 * const client = createOpen4DevClient({
 *   apiKey: process.env.OPEN4DEV_API_KEY!
 * });
 *
 * // Get coins
 * const coins = await client.coins.list({ limit: 10 });
 *
 * // Get specific coin
 * const btc = await client.coins.get('1');
 *
 * // Get orders with filters
 * const orders = await client.orders.list({
 *   status: 'completed',
 *   from_coin_id: 1,
 *   to_coin_id: 2
 * });
 *
 * // Get vaults
 * const vaults = await client.vaults.list();
 * ```
 */

import { ApiClient, ClientConfig } from './client';
import { CoinsClient } from './endpoints/coins';
import { OrdersClient } from './endpoints/orders';
import { VaultsClient } from './endpoints/vaults';

// Re-export types
export * from './types';
export { ApiClient, ClientConfig } from './client';

/**
 * Open4Dev API Client
 *
 * Main SDK class that provides access to all API endpoints
 */
export class Open4DevClient {
  public coins: CoinsClient;
  public orders: OrdersClient;
  public vaults: VaultsClient;

  private apiClient: ApiClient;

  constructor(config: ClientConfig) {
    this.apiClient = new ApiClient(config);

    // Initialize endpoint clients
    this.coins = new CoinsClient(this.apiClient);
    this.orders = new OrdersClient(this.apiClient);
    this.vaults = new VaultsClient(this.apiClient);
  }

  /**
   * Get the underlying API client for custom requests
   */
  getClient(): ApiClient {
    return this.apiClient;
  }
}

/**
 * Create a new Open4Dev API client
 *
 * @param config - Client configuration
 * @returns Configured Open4Dev client
 *
 * @example
 * ```ts
 * const client = createOpen4DevClient({
 *   apiKey: process.env.OPEN4DEV_API_KEY!,
 *   timeout: 60000 // Optional: 60 seconds timeout
 * });
 * ```
 */
export function createOpen4DevClient(config: ClientConfig): Open4DevClient {
  return new Open4DevClient(config);
}

// Default export
export default Open4DevClient;
