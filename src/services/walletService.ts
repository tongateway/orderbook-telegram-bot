/**
 * Wallet Service
 *
 * Manages wallet data including balances, jettons, orders, and statistics
 * Uses Redis for caching
 */

import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import { config } from '../utils/config';
import { WalletBalance, JettonBalance, WalletStats, WalletOrder } from '../types';
import {
  getCached,
  setCached,
  deleteCached,
  deleteMultipleCached,
  CacheKeys,
  deleteCachedByPattern,
} from './redisService';
import { getOrdersByUserAddress } from './open4devService';
import { getUserJettonBalance, formatJettonBalance } from '../utils/jettonHelper';
import { getTokenPrices } from './priceService';
import { normalizeTokenSymbol } from '../utils/tokenSymbol';

// Supported jettons configuration
// These are jetton master contract addresses
// Update these with correct addresses for your network (mainnet/testnet)
const SUPPORTED_JETTONS = {
  TON: {
    symbol: 'TON',
    name: 'Toncoin',
    decimals: 9,
    address: null, // Native coin
  },
  NOT: {
    symbol: 'NOT',
    name: 'Notcoin',
    decimals: 9,
    // Mainnet: EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT
    address: config.tonNetwork === 'mainnet'
      ? 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT'
      : null, // Testnet address (if available)
  },
  BUILD: {
    symbol: 'BUILD',
    name: 'BUILD Token',
    decimals: 9,
    address: config.tonNetwork === 'mainnet'
      ? 'EQBYnUrIlwBrWqp_rl-VxeSBvTR2VmTfC4ManQ657n_BUILD'
      : null,
  },
  DOGS: {
    symbol: 'DOGS',
    name: 'Dogs',
    decimals: 9,
    // Open4Dev coin ton_raw_address
    address: config.tonNetwork === 'mainnet'
      ? '0:afc49cb8786f21c87045b19ede78fc6b46c51048513f8e9a6d44060199c1bf0c'
      : null,
  },
  PX: {
    symbol: 'PX',
    name: 'Not Pixel',
    decimals: 9,
    // Open4Dev coin ton_raw_address
    address: config.tonNetwork === 'mainnet'
      ? '0:78db4c90b19a1b19ccb45580df48a1e91b6410970fa3d5ffed3eed49e3cf08ff'
      : null,
  },
  XAUT0: {
    symbol: 'XAUT0',
    name: 'Tether Gold Tokens',
    decimals: 6,
    // Open4Dev coin ton_raw_address
    address: config.tonNetwork === 'mainnet'
      ? '0:3547f2ee4022c794c80ea354b81bb63b5b571dd05ac091b035d19abbadd74ac6'
      : null,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    // Mainnet jUSDT address
    address: config.tonNetwork === 'mainnet'
      ? 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
      : null, // Testnet address
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    // Update with actual USDC jetton master address when available
    address: config.tonNetwork === 'mainnet'
      ? null // Add mainnet address when available
      : null, // Add testnet address when available
  },
};

// TonCenter v3 API base URL
function getTonCenterV3BaseUrl(): string {
  return config.tonNetwork === 'mainnet'
    ? 'https://toncenter.com/api/v3'
    : 'https://testnet.toncenter.com/api/v3';
}

/**
 * Get TON balance for an address using TonCenter v3 API
 */
async function getTonBalance(address: string): Promise<string> {
  try {
    // Convert raw address to user-friendly format for API
    const addr = Address.parse(address);
    const friendlyAddress = addr.toString({ bounceable: true, urlSafe: true });

    const baseUrl = getTonCenterV3BaseUrl();
    const url = `${baseUrl}/account?address=${friendlyAddress}`;

    const headers: Record<string, string> = {};
    if (config.tonApiKey && config.tonApiKey.trim() !== '') {
      headers['X-API-Key'] = config.tonApiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`TonCenter API error: ${response.status}`);
    }

    const data = await response.json() as { balance?: string };

    // Validate balance is a valid numeric string before BigInt conversion
    const balanceStr = data.balance || '0';
    if (!/^\d+$/.test(balanceStr)) {
      console.error(`Invalid balance format received: ${balanceStr}`);
      return '0';
    }

    const balanceNano = BigInt(balanceStr);

    // Convert nano TON to TON
    return (Number(balanceNano) / 1_000_000_000).toFixed(9);
  } catch (error) {
    console.error('Error fetching TON balance:', error);
    // Return '0' on error instead of throwing to allow other balances to still be fetched
    return '0';
  }
}

/**
 * Get jetton balance for an address
 *
 * Uses TON SDK to query the jetton wallet contract for the actual balance
 *
 * @param walletAddress - User's wallet address
 * @param jettonConfig - Jetton configuration with master contract address
 * @returns Jetton balance information
 */
async function getJettonBalance(
  walletAddress: string,
  jettonConfig: typeof SUPPORTED_JETTONS.NOT
): Promise<JettonBalance> {
  try {
    // If no jetton master address is configured, return zero balance
    if (!jettonConfig.address) {
      return {
        symbol: jettonConfig.symbol,
        name: jettonConfig.name,
        balance: '0',
        decimals: jettonConfig.decimals,
        address: jettonConfig.address || undefined,
      };
    }

    // Get the actual jetton balance from the blockchain
    const balanceBigInt = await getUserJettonBalance(
      jettonConfig.address,
      walletAddress
    );

    // Format the balance to human-readable string
    const formattedBalance = formatJettonBalance(balanceBigInt, jettonConfig.decimals);

    return {
      symbol: jettonConfig.symbol,
      name: jettonConfig.name,
      balance: formattedBalance,
      decimals: jettonConfig.decimals,
      address: jettonConfig.address,
    };
  } catch (error) {
    console.error(`Error fetching ${jettonConfig.symbol} balance:`, error);
    // Return zero balance on error
    return {
      symbol: jettonConfig.symbol,
      name: jettonConfig.name,
      balance: '0',
      decimals: jettonConfig.decimals,
      address: jettonConfig.address || undefined,
    };
  }
}

/**
 * Get all balances for a wallet (TON + jettons)
 */
export async function getWalletBalance(
  address: string,
  useCache: boolean = true,
  skipPrices: boolean = false
): Promise<WalletBalance> {
  // Check cache first
  if (useCache) {
    const cached = await getCached<WalletBalance>(CacheKeys.walletBalance(address));
    if (cached) {
      return cached;
    }
  }

  try {
    // Get TON balance, prices, and all jetton balances in parallel
    const jettonEntries = Object.entries(SUPPORTED_JETTONS).filter(([symbol]) => symbol !== 'TON');

    const [tonBalance, prices, ...jettonResults] = await Promise.all([
      getTonBalance(address),
      skipPrices
        ? Promise.resolve({} as Record<string, number>)
        : getTokenPrices(),
      ...jettonEntries.map(([, config]) =>
        getJettonBalance(address, config)
      ),
    ]);

    // Process jetton balances with prices
    const jettonBalances: JettonBalance[] = jettonResults.map((jettonBalance, index) => {
      const [symbol] = jettonEntries[index];
      const price = prices[symbol];
      if (price !== undefined) {
        jettonBalance.price = price;
        jettonBalance.valueUsd = parseFloat(jettonBalance.balance) * price;
      }
      return jettonBalance;
    });

    // Calculate total USD value
    const tonValue = prices.TON ? parseFloat(tonBalance) * prices.TON : 0;
    const jettonsValue = jettonBalances.reduce((sum, j) => sum + (j.valueUsd || 0), 0);
    const totalValueUsd = tonValue + jettonsValue;

    const walletBalance: WalletBalance = {
      address,
      ton: tonBalance,
      jettons: jettonBalances,
      totalValueUsd,
      updatedAt: new Date(),
    };

    // Cache the result
    await setCached(CacheKeys.walletBalance(address), walletBalance, config.redisTtl);

    return walletBalance;
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    throw error;
  }
}

/**
 * Get specific jetton balance
 */
export async function getJettonBalanceBySymbol(
  address: string,
  symbol: string,
  useCache: boolean = true
): Promise<JettonBalance | null> {
  const upperSymbol = normalizeTokenSymbol(symbol);

  if (!SUPPORTED_JETTONS[upperSymbol as keyof typeof SUPPORTED_JETTONS]) {
    throw new Error(`Unsupported jetton: ${symbol}`);
  }

  // Check cache first
  if (useCache) {
    const cached = await getCached<JettonBalance>(
      CacheKeys.walletJettonBalance(address, upperSymbol)
    );
    if (cached) {
      return cached;
    }
  }

  const jettonConfig = SUPPORTED_JETTONS[upperSymbol as keyof typeof SUPPORTED_JETTONS];
  const balance = await getJettonBalance(address, jettonConfig);

  // Cache the result
  await setCached(
    CacheKeys.walletJettonBalance(address, upperSymbol),
    balance,
    config.redisTtl
  );

  return balance;
}

/**
 * Get balance for a single token (faster than getWalletBalance for single token)
 */
export async function getSingleTokenBalance(address: string, symbol: string): Promise<number> {
  const upperSymbol = normalizeTokenSymbol(symbol);

  if (upperSymbol === 'TON') {
    const tonBalance = await getTonBalance(address);
    return parseFloat(tonBalance);
  }

  const jettonConfig = SUPPORTED_JETTONS[upperSymbol as keyof typeof SUPPORTED_JETTONS];
  if (!jettonConfig || !jettonConfig.address) {
    return 0;
  }

  const balance = await getJettonBalance(address, jettonConfig);
  return parseFloat(balance.balance);
}

/**
 * Update wallet balance (force refresh)
 */
export async function updateWalletBalance(address: string): Promise<WalletBalance> {
  // Build list of cache keys to delete
  const keysToDelete = [
    CacheKeys.walletBalance(address),
    ...Object.keys(SUPPORTED_JETTONS).map(symbol =>
      CacheKeys.walletJettonBalance(address, symbol)
    ),
  ];

  // Delete all caches in one pipeline call (efficient batch delete)
  await deleteMultipleCached(keysToDelete);

  // Fetch fresh data
  return getWalletBalance(address, false);
}

/**
 * Get wallet orders from Open4Dev API
 */
export async function getWalletOrders(
  address: string,
  useCache: boolean = true
): Promise<{ open: WalletOrder[]; closed: WalletOrder[] }> {
  // Check cache first
  if (useCache) {
    const cachedOpen = await getCached<WalletOrder[]>(CacheKeys.walletOpenOrders(address));
    const cachedClosed = await getCached<WalletOrder[]>(
      CacheKeys.walletClosedOrders(address)
    );

    if (cachedOpen && cachedClosed) {
      return { open: cachedOpen, closed: cachedClosed };
    }
  }

  try {
    // Fetch user orders via service layer (includes unit normalization from base units)
    const userOrders = await getOrdersByUserAddress(address);

    // Separate into open and closed
    const openStatuses = ['created', 'deployed', 'pending_match'];
    const closedStatuses = ['completed', 'cancelled', 'failed'];

    const openOrders: WalletOrder[] = userOrders
      .filter((order) => openStatuses.includes(order.status))
      .map((order) => ({
        orderId: order.id,
        status: order.status,
        type: order.type || 'UNKNOWN',
        fromCoin: order.from_coin_id?.toString() || '',
        toCoin: order.to_coin_id?.toString() || '',
        amount: order.amount || 0,
        priceRate: order.price_rate,
        createdAt: order.created_at || '',
        deployedAt: order.deployed_at,
      }));

    const closedOrders: WalletOrder[] = userOrders
      .filter((order) => closedStatuses.includes(order.status))
      .map((order) => ({
        orderId: order.id,
        status: order.status,
        type: order.type || 'UNKNOWN',
        fromCoin: order.from_coin_id?.toString() || '',
        toCoin: order.to_coin_id?.toString() || '',
        amount: order.amount || 0,
        priceRate: order.price_rate,
        createdAt: order.created_at || '',
        deployedAt: order.deployed_at,
        completedAt: order.deployed_at, // Adjust based on actual API field
      }));

    // Cache the results
    await setCached(CacheKeys.walletOpenOrders(address), openOrders, config.redisTtl);
    await setCached(CacheKeys.walletClosedOrders(address), closedOrders, config.redisTtl);

    return { open: openOrders, closed: closedOrders };
  } catch (error) {
    console.error('Error fetching wallet orders:', error);
    throw error;
  }
}

/**
 * Get wallet statistics
 */
export async function getWalletStats(
  address: string,
  useCache: boolean = true
): Promise<WalletStats> {
  // Check cache first
  if (useCache) {
    const cached = await getCached<WalletStats>(CacheKeys.walletStats(address));
    if (cached) {
      return cached;
    }
  }

  try {
    const { open, closed } = await getWalletOrders(address, useCache);

    // Calculate total volume from completed orders
    const totalVolume = closed
      .filter((order) => order.status === 'completed')
      .reduce((sum, order) => sum + order.amount, 0);

    const stats: WalletStats = {
      address,
      totalOrders: open.length + closed.length,
      openOrders: open.length,
      closedOrders: closed.length,
      totalVolume,
      totalTrades: closed.filter((order) => order.status === 'completed').length,
      updatedAt: new Date(),
    };

    // Cache the stats
    await setCached(CacheKeys.walletStats(address), stats, config.redisTtl);

    return stats;
  } catch (error) {
    console.error('Error calculating wallet stats:', error);
    throw error;
  }
}

/**
 * Update wallet statistics (force refresh)
 */
export async function updateWalletStats(address: string): Promise<WalletStats> {
  // Delete caches in one batch (efficient)
  await deleteMultipleCached([
    CacheKeys.walletStats(address),
    CacheKeys.walletOpenOrders(address),
    CacheKeys.walletClosedOrders(address),
  ]);

  // Fetch fresh data
  return getWalletStats(address, false);
}

/**
 * Update all wallet data (balances, orders, stats)
 */
export async function updateAllWalletData(address: string): Promise<{
  balance: WalletBalance;
  orders: { open: WalletOrder[]; closed: WalletOrder[] };
  stats: WalletStats;
}> {
  // Clear all caches for this wallet
  await deleteCachedByPattern(`wallet:${address}:*`);

  // Fetch all data fresh
  const [balance, orders, stats] = await Promise.all([
    getWalletBalance(address, false),
    getWalletOrders(address, false),
    getWalletStats(address, false),
  ]);

  return { balance, orders, stats };
}

/**
 * Get supported jettons list
 */
export function getSupportedJettons(): Array<{
  symbol: string;
  name: string;
  decimals: number;
  address: string | null;
}> {
  return Object.values(SUPPORTED_JETTONS);
}
