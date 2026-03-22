/**
 * Jetton Helper Utilities
 *
 * Helper functions for interacting with TON Jetton contracts
 * Based on TEP-74 (Jetton Standard)
 */

import { Address, beginCell, Cell, TonClient } from '@ton/ton';
import { config } from './config';

// Singleton TonClient instance for connection reuse
let tonClientInstance: TonClient | null = null;

// Cache for jetton wallet addresses (they don't change)
// Key: `${jettonMasterAddress}:${ownerAddress}`, Value: jetton wallet address
const jettonWalletAddressCache = new Map<string, string>();

/**
 * Get TON client instance (singleton for connection reuse)
 */
function getTonClient(): TonClient {
  if (!tonClientInstance) {
    const endpoint =
      config.tonNetwork === 'mainnet'
        ? 'https://toncenter.com/api/v2/jsonRPC'
        : 'https://testnet.toncenter.com/api/v2/jsonRPC';

    tonClientInstance = new TonClient({
      endpoint,
      apiKey: config.tonApiKey || undefined,
    });
  }
  return tonClientInstance;
}

/**
 * Calculate jetton wallet address for a user
 *
 * Uses the get_wallet_address method of the jetton master contract
 * Results are cached since wallet addresses don't change
 *
 * @param jettonMasterAddress - Address of the jetton master contract
 * @param ownerAddress - Address of the wallet owner
 * @returns Jetton wallet address for the owner
 */
export async function getJettonWalletAddress(
  jettonMasterAddress: string,
  ownerAddress: string
): Promise<string> {
  // Check cache first
  const cacheKey = `${jettonMasterAddress}:${ownerAddress}`;
  const cached = jettonWalletAddressCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const client = getTonClient();

    // Parse addresses
    const masterAddr = Address.parse(jettonMasterAddress);
    const ownerAddr = Address.parse(ownerAddress);

    // Build the get_wallet_address query
    // This calls the get_wallet_address get-method on the jetton master contract
    const response = await client.runMethod(masterAddr, 'get_wallet_address', [
      {
        type: 'slice',
        cell: beginCell().storeAddress(ownerAddr).endCell(),
      },
    ]);

    // Parse the response
    const walletAddressSlice = response.stack.readAddress();
    const walletAddress = walletAddressSlice.toString();

    // Cache the result
    jettonWalletAddressCache.set(cacheKey, walletAddress);

    return walletAddress;
  } catch (error) {
    console.error('Error getting jetton wallet address:', error);
    throw new Error(`Failed to get jetton wallet address: ${error}`);
  }
}

/**
 * Get jetton balance for a wallet
 *
 * Calls the get_wallet_data method on the jetton wallet contract
 *
 * @param jettonWalletAddress - Address of the jetton wallet
 * @returns Balance as a bigint
 */
export async function getJettonWalletBalance(
  jettonWalletAddress: string
): Promise<bigint> {
  try {
    const client = getTonClient();

    // Parse address
    const walletAddr = Address.parse(jettonWalletAddress);

    // Call get_wallet_data to get balance
    const response = await client.runMethod(walletAddr, 'get_wallet_data', []);

    // Parse response: (int balance, slice owner, slice jetton, cell jetton_wallet_code)
    const balance = response.stack.readBigNumber();

    return balance;
  } catch (error) {
    console.error('Error getting jetton wallet balance:', error);
    // Return 0 if wallet doesn't exist or error occurs
    return BigInt(0);
  }
}

/**
 * Get jetton balance for a user's wallet
 *
 * This is a convenience method that combines getting the jetton wallet address
 * and querying the balance
 *
 * @param jettonMasterAddress - Address of the jetton master contract
 * @param ownerAddress - Address of the wallet owner
 * @returns Balance as a bigint
 */
export async function getUserJettonBalance(
  jettonMasterAddress: string,
  ownerAddress: string
): Promise<bigint> {
  try {
    // Get the jetton wallet address for this user
    const jettonWalletAddress = await getJettonWalletAddress(
      jettonMasterAddress,
      ownerAddress
    );

    // Get the balance from the jetton wallet
    const balance = await getJettonWalletBalance(jettonWalletAddress);

    return balance;
  } catch (error) {
    console.error('Error getting user jetton balance:', error);
    return BigInt(0);
  }
}

/**
 * Convert human-readable amount to token units based on decimals
 *
 * This is the inverse of formatJettonBalance. Use this when you need to convert
 * a user-entered amount to the smallest token unit (e.g., 1.5 USDT with 6 decimals -> 1500000)
 *
 * @param amount - Human-readable amount (e.g., "1.5" or 1.5)
 * @param decimals - Number of decimals for the token (e.g., 6 for USDT, 9 for TON)
 * @returns Amount in smallest token units as bigint
 */
export function toTokenUnits(amount: string | number, decimals: number): bigint {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount;

  // Handle empty or invalid input
  if (!amountStr || amountStr.trim() === '') {
    return BigInt(0);
  }

  // Split into whole and fractional parts
  const parts = amountStr.split('.');
  const wholePart = parts[0] || '0';
  let fractionalPart = parts[1] || '';

  // Pad or truncate fractional part to match decimals
  if (fractionalPart.length < decimals) {
    fractionalPart = fractionalPart.padEnd(decimals, '0');
  } else if (fractionalPart.length > decimals) {
    fractionalPart = fractionalPart.slice(0, decimals);
  }

  // Combine whole and fractional parts
  const combined = wholePart + fractionalPart;

  // Remove leading zeros (except for "0")
  const trimmed = combined.replace(/^0+/, '') || '0';

  return BigInt(trimmed);
}

/**
 * Format jetton balance to human-readable string
 *
 * @param balance - Balance as bigint
 * @param decimals - Number of decimals for the jetton
 * @returns Formatted balance string
 */
export function formatJettonBalance(balance: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = balance / divisor;
  const fractionalPart = balance % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  if (trimmedFractional === '') {
    return wholePart.toString();
  }

  return `${wholePart}.${trimmedFractional}`;
}

/**
 * Get jetton metadata from master contract
 *
 * @param jettonMasterAddress - Address of the jetton master contract
 * @returns Jetton metadata (if available)
 */
export async function getJettonMetadata(jettonMasterAddress: string): Promise<{
  totalSupply: bigint;
  mintable: boolean;
  adminAddress: string | null;
} | null> {
  try {
    const client = getTonClient();
    const masterAddr = Address.parse(jettonMasterAddress);

    // Call get_jetton_data
    const response = await client.runMethod(masterAddr, 'get_jetton_data', []);

    // Parse response: (int total_supply, int mintable, slice admin_address, cell jetton_content, cell jetton_wallet_code)
    const totalSupply = response.stack.readBigNumber();
    const mintable = response.stack.readBoolean();
    const adminAddress = response.stack.readAddressOpt();

    return {
      totalSupply,
      mintable,
      adminAddress: adminAddress?.toString() || null,
    };
  } catch (error) {
    console.error('Error getting jetton metadata:', error);
    return null;
  }
}

/**
 * Verify if an address is a valid jetton master contract
 *
 * @param address - Address to verify
 * @returns True if it's a valid jetton master contract
 */
export async function isValidJettonMaster(address: string): Promise<boolean> {
  try {
    const metadata = await getJettonMetadata(address);
    return metadata !== null;
  } catch (error) {
    return false;
  }
}
