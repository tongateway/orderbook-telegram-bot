import { Address } from '@ton/core';

/**
 * Format USD value with appropriate decimal places
 */
export function formatUsd(value: number | undefined): string {
  if (value === undefined) return '';
  if (value >= 1000) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 0.01) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

/**
 * Format token amount with reasonable decimals based on size
 */
export function formatTokenAmount(amount: number): string {
  if (amount >= 1000) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (amount >= 1) {
    return amount.toFixed(4);
  }
  if (amount >= 0.0001) {
    return amount.toFixed(6);
  }
  return amount.toFixed(9);
}

/**
 * Format wallet address to full unbounceable format
 */
export function formatWalletAddress(walletAddress: string): string {
  try {
    const addr = Address.parse(walletAddress);
    return addr.toString({ bounceable: false, urlSafe: true });
  } catch {
    return walletAddress;
  }
}

/**
 * Format address to short display format (first 6 + last 4 chars)
 */
export function formatShortAddress(address: string): string {
  const formatted = formatWalletAddress(address);
  return `${formatted.slice(0, 6)}....${formatted.slice(-4)}`;
}

/**
 * Clean up error messages for user-friendly display
 */
export function cleanErrorMessage(errorMessage: string): string {
  const colonIndex = errorMessage.lastIndexOf(': ');
  if (colonIndex !== -1 && errorMessage.includes('Error')) {
    return errorMessage.substring(colonIndex + 2);
  }
  return errorMessage;
}
