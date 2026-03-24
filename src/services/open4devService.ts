/**
 * Open4Dev API Service
 *
 * Service layer for interacting with the Open4Dev API using the SDK
 */

import { createOpen4DevClient, Coin, Order, Vault } from '../sdk';
import { config } from '../utils/config';
import { getCached, setCached, CacheKeys } from './redisService';
import { Address } from '@ton/core';
import { normalizeTokenSymbol } from '../utils/tokenSymbol';
import { getTokenDecimals } from '../constants/tokens';

/**
 * Normalize a TON address to raw format for comparison
 * Handles both raw (0:...) and friendly (EQ...) address formats
 */
function normalizeAddress(address: string): string {
  try {
    return Address.parse(address).toRawString().toLowerCase();
  } catch {
    // If parsing fails, just lowercase the original
    return address.toLowerCase();
  }
}

// Initialize the Open4Dev client
// Note: API key is optional - Open4Dev API works without authentication
const client = createOpen4DevClient({
  apiKey: config.open4devApiKey || undefined,
  baseUrl: config.open4devApiUrl,
  timeout: 30000, // 30 seconds
});

/**
 * Open4Dev now returns token amounts in base units (nano/smallest units).
 * Keep decimals in-app and normalize to human-readable amounts here.
 *
 * IMPORTANT: this map is coin_id -> token decimals.
 * Update IDs if Open4Dev coin IDs change.
 */
const COIN_DECIMALS_BY_ID: Record<number, number> = {
  0: getTokenDecimals('TON'),
  24: getTokenDecimals('BUILD'),
  107: getTokenDecimals('NOT'),
  149: getTokenDecimals('USDT'),
  1696227: getTokenDecimals('DOGS'),
  1696228: getTokenDecimals('PX'),
  1696229: getTokenDecimals('XAUT0'),
  1696231: getTokenDecimals('AGNT'),
};

const DEFAULT_ORDER_DECIMALS = 9;

function toHumanAmount(value: unknown, decimals: number): number | undefined {
  if (value === null || value === undefined) return undefined;

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return undefined;

  return numericValue / Math.pow(10, decimals);
}

function toHumanPriceRate(
  value: unknown,
  fromDecimals: number,
  toDecimals: number
): number | undefined {
  if (value === null || value === undefined) return undefined;

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return undefined;

  // Reverse tonOrderService.calculatePriceRate scaling:
  // stored = price * 10^(18 + toDecimals - fromDecimals)
  const exponent = 18 + toDecimals - fromDecimals;
  if (exponent >= 0) {
    return numericValue / Math.pow(10, exponent);
  }

  return numericValue * Math.pow(10, -exponent);
}

function normalizeOrderFromBaseUnits(order: Order): Order {
  const fromDecimals = order.from_coin_id !== undefined
    ? (COIN_DECIMALS_BY_ID[order.from_coin_id] ?? DEFAULT_ORDER_DECIMALS)
    : DEFAULT_ORDER_DECIMALS;
  const toDecimals = order.to_coin_id !== undefined
    ? (COIN_DECIMALS_BY_ID[order.to_coin_id] ?? DEFAULT_ORDER_DECIMALS)
    : DEFAULT_ORDER_DECIMALS;

  return {
    ...order,
    amount: toHumanAmount(order.amount, fromDecimals),
    initial_amount: toHumanAmount(order.initial_amount, fromDecimals),
    price_rate: toHumanPriceRate(order.price_rate, fromDecimals, toDecimals),
  };
}

function normalizeOrdersFromBaseUnits(orders: Order[]): Order[] {
  return orders.map(normalizeOrderFromBaseUnits);
}

/**
 * Get all available coins from Open4Dev
 *
 * @param limit - Maximum number of coins to retrieve
 * @returns List of coins sorted by order count
 */
export async function getAvailableCoins(limit: number = 100): Promise<Coin[]> {
  return client.coins.list({
    limit,
  });
}

/**
 * Get a specific coin by ID
 *
 * @param coinId - Coin identifier
 * @returns Coin details
 */
export async function getCoinById(coinId: string | number): Promise<Coin> {
  return client.coins.get(coinId);
}

/**
 * Search for coins by symbol or name
 *
 * @param query - Search query (symbol or name)
 * @param limit - Maximum number of results
 * @returns Matching coins
 */
export async function searchCoins(query: string, limit: number = 10): Promise<Coin[]> {
  return client.coins.search(query, limit);
}

/**
 * Get order book for a trading pair
 *
 * @param fromCoinId - Source coin ID
 * @param toCoinId - Destination coin ID
 * @returns Order book with bids and asks
 */
export async function getOrderBookForPair(
  fromCoinId: number,
  toCoinId: number
): Promise<{ bids: Order[]; asks: Order[] }> {
  // Get deployed orders for the trading pair
  // Note: sort parameter not supported by the API
  const rawOrders = await client.orders.getByTradingPair(fromCoinId, toCoinId, {
    status: 'deployed',
    limit: 100,
  });
  const orders = normalizeOrdersFromBaseUnits(rawOrders);

  // Separate into bids and asks
  // Note: You may need to adjust this based on the actual order type field
  const bids = orders.filter((order) => order.type === 'BUY' || order.type === 'buy');
  const asks = orders.filter((order) => order.type === 'SELL' || order.type === 'sell');

  return { bids, asks };
}

/**
 * Get orders for a trading pair by symbol names
 *
 * @param fromSymbol - Source coin symbol (e.g., 'BUILD')
 * @param toSymbol - Destination coin symbol (e.g., 'TON')
 * @param status - Optional order status filter
 * @param limit - Maximum number of orders
 * @returns Orders for the trading pair
 */
export async function getOrdersForPairBySymbol(
  fromSymbol: string,
  toSymbol: string,
  status?: 'created' | 'deployed' | 'cancelled' | 'completed' | 'failed' | 'pending_match',
  limit: number = 50
): Promise<Order[]> {
  const normalizedFromSymbol = normalizeTokenSymbol(fromSymbol);
  const normalizedToSymbol = normalizeTokenSymbol(toSymbol);

  // Special case: TON uses coin_id 0 in orders, not the coins table ID
  const getTonAdjustedCoinId = (symbol: string, coin: Coin | undefined): number | null => {
    if (normalizeTokenSymbol(symbol) === 'TON') {
      return 0; // TON always uses coin_id 0 in orders
    }
    return coin?.id ?? null;
  };

  // First, get the coin IDs by searching for the symbols
  const coins = await getCachedCoins();

  const fromCoin = coins.find(
    (c) => c.symbol?.toUpperCase() === normalizedFromSymbol
  );
  const toCoin = coins.find(
    (c) => c.symbol?.toUpperCase() === normalizedToSymbol
  );

  // Get adjusted coin IDs (TON = 0)
  const fromCoinId = getTonAdjustedCoinId(normalizedFromSymbol, fromCoin);
  const toCoinId = getTonAdjustedCoinId(normalizedToSymbol, toCoin);

  if (fromCoinId === null || toCoinId === null) {
    const availableSymbols = coins.map(c => c.symbol).join(', ');
    console.log(`[getOrdersForPairBySymbol] Could not find coins: from=${normalizedFromSymbol} (${fromCoinId}), to=${normalizedToSymbol} (${toCoinId})`);
    console.log(`[getOrdersForPairBySymbol] Available coin symbols: ${availableSymbols}`);
    return [];
  }

  // Fetch orders with the coin IDs
  // Note: sort parameter not supported by the API
  console.log(`[getOrdersForPairBySymbol] Fetching orders: from=${normalizedFromSymbol}(${fromCoinId}) to=${normalizedToSymbol}(${toCoinId}) status=${status}`);
  const rawOrders = await client.orders.getByTradingPair(fromCoinId, toCoinId, {
    status,
    limit,
  });
  const orders = normalizeOrdersFromBaseUnits(rawOrders);
  console.log(`[getOrdersForPairBySymbol] Got ${orders.length} orders`);
  return orders;
}

/**
 * Get active orders (deployed or pending match)
 *
 * @param limit - Maximum number of orders
 * @returns List of active orders
 */
export async function getActiveOrders(limit: number = 50): Promise<Order[]> {
  const rawOrders = await client.orders.getActive({ limit });
  return normalizeOrdersFromBaseUnits(rawOrders);
}

/**
 * Get completed orders for a trading pair
 *
 * @param fromCoinId - Source coin ID
 * @param toCoinId - Destination coin ID
 * @param limit - Maximum number of orders
 * @returns List of completed orders
 */
export async function getCompletedOrdersForPair(
  fromCoinId: number,
  toCoinId: number,
  limit: number = 50
): Promise<Order[]> {
  // Note: sort parameter not supported by the API
  const rawOrders = await client.orders.getByTradingPair(fromCoinId, toCoinId, {
    status: 'completed',
    limit,
  });
  return normalizeOrdersFromBaseUnits(rawOrders);
}

/**
 * Get orders by user address
 *
 * @param userAddress - User's wallet address
 * @returns User's orders
 */
export async function getOrdersByUserAddress(userAddress: string): Promise<Order[]> {
  // Normalize address to raw format (0:...) for the API filter
  const normalizedUserAddress = normalizeAddress(userAddress);

  // Use the API's owner_raw_address filter
  const rawOrders = await client.orders.getByOwner(normalizedUserAddress, { limit: 1000 });
  return normalizeOrdersFromBaseUnits(rawOrders);
}

/**
 * Get user's order history with pagination and filtering
 *
 * @param userAddress - User's wallet address
 * @param options - Filtering and pagination options
 * @returns User's order history
 */
export async function getUserOrderHistory(
  userAddress: string,
  options: {
    limit?: number;
    offset?: number;
    status?: 'created' | 'deployed' | 'cancelled' | 'completed' | 'failed' | 'pending_match';
  } = {}
): Promise<Order[]> {
  const { limit = 10, offset = 0, status } = options;

  // Normalize address to raw format (0:...) for the API filter
  const normalizedUserAddress = normalizeAddress(userAddress);

  // Use the API's owner_raw_address filter with pagination
  const rawOrders = await client.orders.getByOwner(normalizedUserAddress, {
    limit,
    offset,
    status,
  });
  return normalizeOrdersFromBaseUnits(rawOrders);
}

/**
 * Get order by ID
 *
 * @param orderId - Order identifier
 * @returns Order details
 */
export async function getOrderById(orderId: string): Promise<Order> {
  const order = await client.orders.get(orderId);
  return normalizeOrderFromBaseUnits(order);
}

/**
 * Get all available vaults
 *
 * @param limit - Maximum number of vaults
 * @returns List of vaults
 */
export async function getAllVaults(limit: number = 100): Promise<Vault[]> {
  return client.vaults.getAll(limit);
}

/**
 * Get a specific vault by ID
 *
 * @param vaultId - Vault identifier
 * @returns Vault details
 */
export async function getVaultById(vaultId: string): Promise<Vault> {
  return client.vaults.get(vaultId);
}

/**
 * Get vaults by factory ID
 *
 * @param factoryId - Factory identifier
 * @returns Vaults from the specified factory
 */
export async function getVaultsByFactoryId(factoryId: number): Promise<Vault[]> {
  return client.vaults.getByFactoryId(factoryId);
}

/**
 * Get all vaults with caching
 *
 * @returns List of all vaults (cached for 5 minutes)
 */
async function getCachedVaults(): Promise<Vault[]> {
  const cacheKey = CacheKeys.allVaults();
  const cached = await getCached<Vault[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const vaults = await client.vaults.getAll(100);
  await setCached(cacheKey, vaults, 300); // Cache for 5 minutes
  return vaults;
}

/**
 * Get all coins with caching
 *
 * @returns List of all coins (cached for 5 minutes)
 */
export async function getCachedCoins(): Promise<Coin[]> {
  const cacheKey = CacheKeys.allCoins();
  const cached = await getCached<Coin[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const coins = await client.coins.list({ limit: 500 });
  await setCached(cacheKey, coins, 300); // Cache for 5 minutes
  return coins;
}

/**
 * Get vault address for a specific coin
 *
 * Searches through all vaults to find one that handles the specified coin.
 * - For TON: matches by vault type === "TON"
 * - For Jettons: matches by comparing the coin's minter address with the vault's jetton_minter_address
 *
 * Results are cached for faster future lookups.
 *
 * @param coinSymbol - Coin symbol (e.g., "TON", "USDT", "NOT")
 * @returns Vault address or null if not found
 */
export async function getVaultAddressByCoinSymbol(coinSymbol: string): Promise<string | null> {
  try {
    const normalizedCoinSymbol = normalizeTokenSymbol(coinSymbol);

    // Check cache first
    const cacheKey = CacheKeys.vaultByCoinSymbol(normalizedCoinSymbol);
    const cached = await getCached<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const vaults = await getCachedVaults();

    // For TON, find the TON vault directly by type
    if (normalizedCoinSymbol === 'TON') {
      const tonVault = vaults.find(
        (v) => v.type?.toUpperCase() === 'TON'
      );
      if (tonVault?.address) {
        await setCached(cacheKey, tonVault.address, 300); // Cache for 5 minutes
        return tonVault.address;
      }
      return null;
    }

    // For Jettons, we need to match by the jetton minter address
    // First, get the coin to find its minter address
    const coins = await getCachedCoins();
    const coin = coins.find(
      (c) => c.symbol?.toUpperCase() === normalizedCoinSymbol
    );

    // API returns ton_raw_address, not address
    const coinAddress = coin?.ton_raw_address || coin?.address;
    if (!coinAddress) {
      console.log(`[getVaultAddressByCoinSymbol] Coin ${normalizedCoinSymbol} not found or has no address`);
      return null;
    }

    // Normalize coin address for comparison (handles raw vs friendly format differences)
    const normalizedCoinAddress = normalizeAddress(coinAddress);

    // Find a Jetton vault that matches the coin's minter address
    const jettonVault = vaults.find(
      (v) => v.type?.toUpperCase() === 'JETTON' &&
             v.jetton_minter_address &&
             normalizeAddress(v.jetton_minter_address) === normalizedCoinAddress
    );

    if (jettonVault?.address) {
      await setCached(cacheKey, jettonVault.address, 300); // Cache for 5 minutes
      return jettonVault.address;
    }

    console.log(`[getVaultAddressByCoinSymbol] No vault found for Jetton ${normalizedCoinSymbol} with minter ${coinAddress} (normalized: ${normalizedCoinAddress})`);
    console.log(`[getVaultAddressByCoinSymbol] Available jetton vaults:`, vaults.filter(v => v.type?.toUpperCase() === 'JETTON').map(v => ({
      address: v.address,
      minter: v.jetton_minter_address,
      normalizedMinter: v.jetton_minter_address ? normalizeAddress(v.jetton_minter_address) : null
    })));
    return null;
  } catch (error) {
    console.error(`Error getting vault for coin ${coinSymbol}:`, error);
    return null;
  }
}

/**
 * Get coin ID by symbol
 *
 * @param symbol - Coin symbol (e.g., "TON", "USDT")
 * @returns Coin ID or null if not found
 */
export async function getCoinIdBySymbol(symbol: string): Promise<number | null> {
  try {
    const normalizedSymbol = normalizeTokenSymbol(symbol);
    const coins = await getCachedCoins();
    const coin = coins.find(
      (c) => c.symbol?.toUpperCase() === normalizedSymbol
    );
    if (!coin) {
      console.log(`[getCoinIdBySymbol] Coin not found for symbol: ${normalizedSymbol}`);
    }
    return coin?.id ?? null;
  } catch (error) {
    console.error(`[getCoinIdBySymbol] Error getting coin ID for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get market statistics for a trading pair
 *
 * @param fromCoinId - Source coin ID
 * @param toCoinId - Destination coin ID
 * @returns Market statistics including volume, avg price, etc.
 */
export async function getMarketStats(
  fromCoinId: number,
  toCoinId: number
): Promise<{
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  averagePrice: number;
  totalVolume: number;
}> {
  // Get all orders for the pair
  const rawOrders = await client.orders.getByTradingPair(fromCoinId, toCoinId, {
    limit: 1000,
  });
  const allOrders = normalizeOrdersFromBaseUnits(rawOrders);

  const completedOrders = allOrders.filter((o) => o.status === 'completed');
  const activeOrders = allOrders.filter(
    (o) => o.status === 'deployed' || o.status === 'pending_match'
  );

  // Calculate statistics
  const totalVolume = completedOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
  const averagePrice =
    completedOrders.reduce((sum, order) => sum + (order.price_rate || 0), 0) /
    (completedOrders.length || 1);

  return {
    totalOrders: allOrders.length,
    completedOrders: completedOrders.length,
    activeOrders: activeOrders.length,
    averagePrice,
    totalVolume,
  };
}

/**
 * Get the SDK client for advanced usage
 *
 * @returns Open4Dev client instance
 */
export function getOpen4DevClient() {
  return client;
}
