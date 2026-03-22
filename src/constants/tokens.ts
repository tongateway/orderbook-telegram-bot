import { formatTokenSymbol, normalizeTokenSymbol } from '../utils/tokenSymbol';

/**
 * Token decimals by symbol
 * USDT and USDC use 6 decimals, TON and other tokens use 9 decimals
 */
export const TOKEN_DECIMALS: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  TON: 9,
  NOT: 9,
  BUILD: 9,
  DOGS: 9,
  PX: 9,
  XAUT0: 6,
};

export function getTokenDecimals(symbol: string): number {
  return TOKEN_DECIMALS[normalizeTokenSymbol(symbol)] ?? 9;
}

/**
 * Token emoji by symbol
 */
export const TOKEN_EMOJI: Record<string, string> = {
  TON: '💎',
  NOT: '🐾',
  BUILD: '🔨',
  DOGS: '🐶',
  PX: '🟨',
  XAUT0: '🥇',
  USDT: '💵',
  USDC: '💵',
};

export function getTokenEmoji(symbol: string): string {
  return TOKEN_EMOJI[normalizeTokenSymbol(symbol)] ?? '🪙';
}

/**
 * Order status emoji mapping
 */
export const STATUS_EMOJI: Record<string, string> = {
  completed: '✅',
  deployed: '⏳',
  pending_match: '⏳',
  cancelled: '❌',
  failed: '⚠️',
  created: '📝',
  closed: '🔒',
};

export function getStatusEmoji(status: string): string {
  return STATUS_EMOJI[status] ?? '📋';
}

/**
 * Available tokens for trading
 */
export const AVAILABLE_TOKENS = ['TON', 'NOT', 'USDT', 'BUILD', 'DOGS', 'PX', 'XAUt'];

/**
 * Supported trading pairs
 */
export const SUPPORTED_PAIRS = [
  'TON/USDT',
  'NOT/USDT',
  'TON/NOT',
  'TON/BUILD',
  'BUILD/USDT',
  'TON/DOGS',
  'TON/PX',
  'TON/XAUt',
];

export { formatTokenSymbol, normalizeTokenSymbol };
