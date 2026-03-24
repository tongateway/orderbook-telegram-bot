import { normalizeTokenSymbol } from './tokenSymbol';

/**
 * Token Constants
 *
 * Centralized configuration for token-related constants including decimals,
 * CoinGecko IDs, and gas fee estimates.
 */

/**
 * Token decimal configuration
 * Standard TON tokens use 9 decimals, stablecoins (USDT/USDC) use 6
 */
export const TOKEN_DECIMALS: Record<string, number> = {
  TON: 9,
  NOT: 9,
  BUILD: 9,
  DOGS: 9,
  PX: 9,
  XAUT0: 6,
  USDT: 6,
  USDC: 6,
  AGNT: 9,
} as const;

/**
 * Default decimal count for unknown tokens
 */
export const DEFAULT_TOKEN_DECIMALS = 9;

/**
 * CoinGecko token IDs for price fetching
 */
export const COINGECKO_TOKEN_IDS: Record<string, string> = {
  TON: 'the-open-network',
  NOT: 'notcoin',
  BUILD: 'build-4',
  DOGS: 'dogs-2',
  PX: 'not-pixel',
  XAUT0: 'tether-gold-tokens',
  USDT: 'tether',
} as const;

/**
 * Gas fee estimates for various TON operations (in TON)
 * Values aligned with order-book contract gas constants (tests/Helper.ts)
 */
export const GAS_FEES = {
  /** Gas for creating a TON order (GAS_VAULT_TON_TRANSFER = 0.1) */
  ORDER_CREATION_TON: '0.1',
  /** Gas for creating a Jetton order (0.05 transfer + 0.1 forward = 0.15) */
  ORDER_CREATION_JETTON: '0.15',
  /** Gas for closing/canceling an order (GAS_ORDER_CLOSE_ORDER = 0.05) */
  ORDER_CLOSURE: '0.05',
  /** Gas for matching two orders (GAS_ORDER_FULL_MATCH) */
  ORDER_MATCHING: '1.0',
  /** Default forward TON amount for jetton transfers (GAS_VAULT_JETTON_TRANSFER_NOTIFICATION = 0.1) */
  DEFAULT_FORWARD_AMOUNT: '0.1',
} as const;

/**
 * Price-related constants
 */
export const PRICE_CONSTANTS = {
  /** Base decimal precision for price rate calculations */
  PRICE_RATE_DECIMALS: 18,
  /** Maximum valid decimal places for tokens */
  MAX_TOKEN_DECIMALS: 18,
  /** Cache TTL for prices in seconds (5 minutes) */
  PRICE_CACHE_TTL: 300,
} as const;

/**
 * Slippage configuration
 */
export const SLIPPAGE_CONSTANTS = {
  /** Default slippage percentage */
  DEFAULT_PERCENT: 1,
  /** Minimum allowed slippage percentage */
  MIN_PERCENT: 0,
  /** Maximum allowed slippage percentage */
  MAX_PERCENT: 100,
  /** Basis points per percent (100 basis points = 1%) */
  BASIS_POINTS_PER_PERCENT: 10_000_000, // 10^7 (slippage stored as uint30, max ~10^9)
} as const;

/**
 * Fee configuration for order creation
 * Fees are expressed as numerator/denominator fractions (14-bit each)
 */
export const FEE_CONSTANTS = {
  /** Platform fee address */
  DEFAULT_PROVIDER_FEE_ADDRESS: 'UQAlC2mQuumiP1aQ_yMzp1mYUcG8h13Jc4cdmWAhBqaqme0t',
  /** Platform fee numerator (100/10000 = 1%) */
  DEFAULT_FEE_NUM: 100,
  /** Platform fee denominator */
  DEFAULT_FEE_DENOM: 10000,
  /** Matcher fee numerator (200/10000 = 2%) */
  DEFAULT_MATCHER_FEE_NUM: 200,
  /** Matcher fee denominator */
  DEFAULT_MATCHER_FEE_DENOM: 10000,
} as const;

/**
 * Calculate total fee percentage from fee constants
 *
 * The blockchain slippage must include fees, so:
 * effectiveSlippage = userSlippage + totalFeePercent
 *
 * @param feeNum - Platform fee numerator (default: 100)
 * @param feeDenom - Platform fee denominator (default: 10000)
 * @param matcherFeeNum - Matcher fee numerator (default: 200)
 * @param matcherFeeDenom - Matcher fee denominator (default: 10000)
 * @returns Total fee as percentage (e.g., 3 for 3%)
 */
export function getTotalFeePercent(
  feeNum: number = FEE_CONSTANTS.DEFAULT_FEE_NUM,
  feeDenom: number = FEE_CONSTANTS.DEFAULT_FEE_DENOM,
  matcherFeeNum: number = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_NUM,
  matcherFeeDenom: number = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_DENOM
): number {
  const platformFeePercent = (feeNum / feeDenom) * 100;
  const matcherFeePercent = (matcherFeeNum / matcherFeeDenom) * 100;
  return platformFeePercent + matcherFeePercent;
}

/**
 * Get token decimals by symbol
 *
 * @param symbol - Token symbol (e.g., 'TON', 'USDT')
 * @returns Number of decimals for the token
 */
export function getTokenDecimals(symbol: string): number {
  const upperSymbol = normalizeTokenSymbol(symbol);
  return TOKEN_DECIMALS[upperSymbol] ?? DEFAULT_TOKEN_DECIMALS;
}

/**
 * Check if a token uses non-standard (6) decimals
 *
 * @param symbol - Token symbol
 * @returns True if the token uses 6 decimals (stablecoins)
 */
export function isStablecoinDecimals(symbol: string): boolean {
  const decimals = getTokenDecimals(symbol);
  return decimals === 6;
}
