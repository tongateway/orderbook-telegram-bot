/**
 * Coins API Client
 *
 * Handles operations related to cryptocurrency coins
 */

import { ApiClient } from '../client';
import { Coin, CoinsListParams } from '../types';

export class CoinsClient {
  constructor(private client: ApiClient) {}

  /**
   * Get a list of coins with pagination and sorting
   *
   * @param params - Query parameters for filtering and pagination
   * @returns List of coins
   *
   * @example
   * ```ts
   * const coins = await coinsClient.list({
   *   limit: 10,
   *   offset: 0,
   *   sort: '-cnt_orders', // Sort by order count descending
   *   order: 'desc'
   * });
   * ```
   */
  async list(params?: CoinsListParams): Promise<Coin[]> {
    const response = await this.client.get<{ coins: Coin[] }>('/coins', params);
    return response.coins || [];
  }

  /**
   * Get a specific coin by ID
   *
   * @param id - Coin identifier
   * @returns Coin details
   *
   * @example
   * ```ts
   * const coin = await coinsClient.get('1');
   * console.log(coin.name, coin.symbol);
   * ```
   */
  async get(id: string | number): Promise<Coin> {
    return this.client.get<Coin>(`/coins/${id}`);
  }

  /**
   * Search coins by symbol or name
   *
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Matching coins
   *
   * @example
   * ```ts
   * const btcCoins = await coinsClient.search('BTC', 5);
   * ```
   */
  async search(query: string, limit: number = 10): Promise<Coin[]> {
    // Get all coins and filter client-side
    // Note: This is a helper method. For production, the API should support search
    const coins = await this.list({ limit: 100 });
    const lowerQuery = query.toLowerCase();

    return coins
      .filter(
        (coin) =>
          coin.symbol?.toLowerCase().includes(lowerQuery) ||
          coin.name?.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit);
  }
}
