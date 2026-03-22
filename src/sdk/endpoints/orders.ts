/**
 * Orders API Client
 *
 * Handles operations related to trading orders
 */

import { ApiClient } from '../client';
import { Order, OrdersListParams, OrderStatus } from '../types';

/**
 * API response format for orders (PascalCase fields)
 */
interface OrderApiResponse {
  ID?: number;
  CreatedAt?: string;
  DeployedAt?: string;
  Status?: string;
  Type?: string;
  Amount?: number;
  InitialAmount?: number;
  PriceRate?: number;
  FromCoinID?: number;
  ToCoinID?: number;
  Slippage?: number;
  UserAddress?: string;
  RawAddress?: string; // Order contract address
  OwnerRawAddress?: string; // User's wallet address
  UserID?: number;
  WalletID?: number;
  VaultID?: number;
  Title?: string;
  [key: string]: any;
}

/**
 * Normalize order from API response to internal format
 *
 * API returns snake_case fields with 'raw_address' being the order contract address
 */
function normalizeOrder(apiOrder: OrderApiResponse): Order {
  // API uses 'raw_address' for the order contract address (blockchain address)
  // This is the address we need to send CloseOrder transactions to
  const orderAddress = apiOrder.raw_address || apiOrder.RawAddress || '';

  return {
    id: String(apiOrder.ID || apiOrder.id || ''),
    created_at: apiOrder.CreatedAt || apiOrder.created_at,
    deployed_at: apiOrder.DeployedAt || apiOrder.deployed_at,
    status: (apiOrder.Status || apiOrder.status || 'created') as Order['status'],
    type: apiOrder.Type || apiOrder.type,
    amount: apiOrder.Amount ?? apiOrder.amount,
    initial_amount: apiOrder.InitialAmount ?? apiOrder.initial_amount,
    price_rate: apiOrder.PriceRate ?? apiOrder.price_rate,
    from_coin_id: apiOrder.FromCoinID ?? apiOrder.from_coin_id,
    to_coin_id: apiOrder.ToCoinID ?? apiOrder.to_coin_id,
    slippage: apiOrder.Slippage ?? apiOrder.slippage,
    user_address: apiOrder.UserAddress || apiOrder.user_address,
    order_address: orderAddress, // Order contract address (from raw_address)
    user_id: apiOrder.UserID ?? apiOrder.user_id,
    wallet_id: apiOrder.WalletID ?? apiOrder.wallet_id,
    vault_id: apiOrder.VaultID ?? apiOrder.vault_id,
    title: apiOrder.Title || apiOrder.title,
  };
}

export class OrdersClient {
  constructor(private client: ApiClient) {}

  /**
   * Get a list of orders with extensive filtering options
   *
   * @param params - Query parameters for filtering, pagination, and sorting
   * @returns List of orders
   *
   * @example
   * ```ts
   * // Get all completed orders for a specific trading pair
   * const orders = await ordersClient.list({
   *   from_coin_id: 1,
   *   to_coin_id: 2,
   *   status: 'completed',
   *   limit: 20,
   *   sort: '-created_at' // Most recent first
   * });
   * ```
   *
   * @example
   * ```ts
   * // Get orders within a price range
   * const orders = await ordersClient.list({
   *   min_price_rate: 0.5,
   *   max_price_rate: 1.5,
   *   min_amount: 100
   * });
   * ```
   */
  async list(params?: OrdersListParams): Promise<Order[]> {
    const response = await this.client.get<{ orders: OrderApiResponse[] }>('/orders', params);
    return (response.orders || []).map(normalizeOrder);
  }

  /**
   * Get a specific order by ID
   *
   * @param id - Order identifier
   * @returns Order details
   *
   * @example
   * ```ts
   * const order = await ordersClient.get('order-123');
   * console.log(order.status, order.amount);
   * ```
   */
  async get(id: string): Promise<Order> {
    const response = await this.client.get<OrderApiResponse>(`/orders/${id}`);
    return normalizeOrder(response);
  }

  /**
   * Get orders by status
   *
   * @param status - Order status to filter by
   * @param limit - Maximum number of results
   * @returns Orders with the specified status
   *
   * @example
   * ```ts
   * const pendingOrders = await ordersClient.getByStatus('pending_match');
   * ```
   */
  async getByStatus(status: OrderStatus, limit: number = 50): Promise<Order[]> {
    return this.list({ status, limit });
  }

  /**
   * Get orders for a specific trading pair
   *
   * @param fromCoinId - Source coin ID
   * @param toCoinId - Destination coin ID
   * @param params - Additional filtering parameters
   * @returns Orders for the trading pair
   *
   * @example
   * ```ts
   * const orders = await ordersClient.getByTradingPair(1, 2, {
   *   status: 'deployed',
   *   sort: '-price_rate'
   * });
   * ```
   */
  async getByTradingPair(
    fromCoinId: number,
    toCoinId: number,
    params?: Omit<OrdersListParams, 'from_coin_id' | 'to_coin_id'>
  ): Promise<Order[]> {
    return this.list({
      from_coin_id: fromCoinId,
      to_coin_id: toCoinId,
      ...params,
    });
  }

  /**
   * Get active orders (deployed or pending_match)
   *
   * @param params - Additional filtering parameters
   * @returns Active orders
   *
   * @example
   * ```ts
   * const activeOrders = await ordersClient.getActive({ limit: 100 });
   * ```
   */
  async getActive(params?: Omit<OrdersListParams, 'status'>): Promise<Order[]> {
    // Note: This gets pending_match orders. For multiple statuses, make separate calls
    return this.list({
      status: 'pending_match',
      ...params,
    });
  }

  /**
   * Get orders within a price range
   *
   * @param minPrice - Minimum price rate
   * @param maxPrice - Maximum price rate
   * @param params - Additional filtering parameters
   * @returns Orders within the price range
   *
   * @example
   * ```ts
   * const orders = await ordersClient.getByPriceRange(0.9, 1.1);
   * ```
   */
  async getByPriceRange(
    minPrice: number,
    maxPrice: number,
    params?: Omit<OrdersListParams, 'min_price_rate' | 'max_price_rate'>
  ): Promise<Order[]> {
    return this.list({
      min_price_rate: minPrice,
      max_price_rate: maxPrice,
      ...params,
    });
  }

  /**
   * Get orders within an amount range
   *
   * @param minAmount - Minimum order amount
   * @param maxAmount - Maximum order amount
   * @param params - Additional filtering parameters
   * @returns Orders within the amount range
   *
   * @example
   * ```ts
   * const largeOrders = await ordersClient.getByAmountRange(1000, 10000);
   * ```
   */
  async getByAmountRange(
    minAmount: number,
    maxAmount: number,
    params?: Omit<OrdersListParams, 'min_amount' | 'max_amount'>
  ): Promise<Order[]> {
    return this.list({
      min_amount: minAmount,
      max_amount: maxAmount,
      ...params,
    });
  }

  /**
   * Get orders by owner wallet address
   *
   * @param ownerAddress - Owner's raw wallet address
   * @param params - Additional filtering parameters
   * @returns Orders belonging to the owner
   *
   * @example
   * ```ts
   * const userOrders = await ordersClient.getByOwner('0:abc123...', {
   *   status: 'completed',
   *   sort: '-created_at',
   *   limit: 20
   * });
   * ```
   */
  async getByOwner(
    ownerAddress: string,
    params?: Omit<OrdersListParams, 'owner_raw_address'>
  ): Promise<Order[]> {
    return this.list({
      owner_raw_address: ownerAddress,
      ...params,
    });
  }
}
