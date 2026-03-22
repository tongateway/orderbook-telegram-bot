/**
 * Order Creation Service
 *
 * High-level service that integrates TON order message building with
 * Open4Dev API and database operations
 */

import {
  buildTonOrderMessage,
  buildJettonOrderMessage,
  buildCloseOrderMessage,
  buildMatchOrderMessage,
  sendOrderTransaction,
  calculatePriceRate,
  calculateSlippage,
  CreateOrderParams,
  MatchOrderParams,
} from './tonOrderService';
import {
  getVaultById,
  getCoinById,
  getOrderById as getApiOrderById,
  getVaultAddressByCoinSymbol,
} from './open4devService';
import { config } from '../utils/config';
import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import { getWalletAddress } from './tonConnectService';
import {
  getTokenDecimals,
  GAS_FEES,
  SLIPPAGE_CONSTANTS,
  FEE_CONSTANTS,
  getTotalFeePercent,
} from '../utils/tokenConstants';

/**
 * Order creation request (user-friendly parameters)
 */
export interface OrderCreationRequest {
  telegramId: number;
  userAddress: string;
  fromCoinId: number; // Source coin ID from Open4Dev API
  toCoinId: number; // Destination coin ID from Open4Dev API
  amount: number; // Amount in human-readable format
  price?: number; // Price for limit orders (optional for market orders)
  slippagePercent?: number; // Slippage tolerance in percent (default 2%)
  orderType: 'LIMIT' | 'MARKET';
}

/**
 * Order creation result
 */
export interface OrderCreationResult {
  success: boolean;
  transactionHash?: string;
  orderAddress?: string;
  message?: string;
  error?: string;
}

interface OnChainOrderState {
  owner: string;
  amount: bigint;
  hasFromJetton: boolean;
}

let tonClient: TonClient | null = null;

function getTonClient(): TonClient {
  if (tonClient) {
    return tonClient;
  }

  const endpoint = config.tonNetwork === 'mainnet'
    ? 'https://toncenter.com/api/v2/jsonRPC'
    : 'https://testnet.toncenter.com/api/v2/jsonRPC';

  tonClient = new TonClient({
    endpoint,
    apiKey: config.tonApiKey || undefined,
  });

  return tonClient;
}

function normalizeRawAddress(address: string): string | null {
  try {
    return Address.parse(address).toRawString();
  } catch {
    return null;
  }
}

async function getOnChainOrderState(orderAddress: string): Promise<OnChainOrderState> {
  const client = getTonClient();
  const result = await client.runMethod(Address.parse(orderAddress), 'getData');

  const owner = result.stack.readAddress().toRawString();
  result.stack.readAddress(); // vault
  result.stack.readAddress(); // oppositeVault

  const exchangeInfo = result.stack.readCell().asSlice();
  const fromJettonRef = exchangeInfo.loadMaybeRef();
  exchangeInfo.loadMaybeRef(); // toJetton
  const amount = exchangeInfo.loadCoins();

  return {
    owner,
    amount,
    hasFromJetton: fromJettonRef !== null,
  };
}

/**
 * Create a new order
 *
 * This is the main function for creating orders. It:
 * 1. Fetches coin and vault data from Open4Dev API
 * 2. Builds the appropriate TON message
 * 3. Sends the transaction via TonConnect
 * 4. Saves the order to the database
 *
 * @param request - Order creation request
 * @returns Order creation result
 */
export async function createNewOrder(
  request: OrderCreationRequest
): Promise<OrderCreationResult> {
  try {
    const {
      telegramId,
      userAddress,
      fromCoinId,
      toCoinId,
      amount,
      price,
      slippagePercent = SLIPPAGE_CONSTANTS.DEFAULT_PERCENT,
      orderType,
    } = request;

    // Validate inputs
    if (amount <= 0) {
      return {
        success: false,
        error: 'Amount must be greater than 0',
      };
    }

    if (orderType === 'LIMIT' && !price) {
      return {
        success: false,
        error: 'Price is required for limit orders',
      };
    }

    // Fetch coin information from Open4Dev API
    const fromCoin = await getCoinById(fromCoinId);
    const toCoin = await getCoinById(toCoinId);

    console.log(`Creating order: ${amount} ${fromCoin.symbol} → ${toCoin.symbol}`);

    // Determine if this is a TON order or Jetton order
    const isTonOrder = fromCoin.symbol === 'TON' || !fromCoin.address;
    const isToTon = toCoin.symbol === 'TON' || !toCoin.address;

    // Calculate price rate
    let priceRate: number;
    if (orderType === 'LIMIT' && price) {
      priceRate = price;
    } else {
      // For market orders, use current market price (would need to fetch from API)
      // For now, throw an error as we need market price data
      return {
        success: false,
        error: 'Market orders require current price data from API',
      };
    }

    // Get vault addresses for both sending and receiving coins
    const [vaultAddress, oppositeVaultAddress] = await Promise.all([
      getVaultAddressForCoin(fromCoinId),
      getVaultAddressForCoin(toCoinId),
    ]);

    if (!vaultAddress) {
      return {
        success: false,
        error: `No vault found for coin ${fromCoin.symbol}`,
      };
    }

    if (!oppositeVaultAddress) {
      return {
        success: false,
        error: `No vault found for coin ${toCoin.symbol}`,
      };
    }

    // Get decimals for both tokens (USDT/USDC use 6, others use 9)
    const fromDecimals = getTokenDecimals(fromCoin.symbol);
    const toDecimals = getTokenDecimals(toCoin.symbol);

    // Calculate effective slippage: user slippage + total fees
    // This is required because the blockchain validates slippage against the final amount after fees
    const totalFeePercent = getTotalFeePercent();
    const effectiveSlippage = slippagePercent + totalFeePercent;

    // Build order parameters with correct decimals
    const orderParams: CreateOrderParams = {
      userAddress,
      vaultAddress,
      oppositeVaultAddress,
      amount: amount.toString(),
      priceRate: calculatePriceRate(priceRate, toDecimals, fromDecimals).toString(),
      slippage: calculateSlippage(effectiveSlippage).toString(),
      toJettonMinter: isToTon ? null : toCoin.address!,
      fromDecimals,
      toDecimals,
    };

    // Build message based on order type
    let message;
    if (isTonOrder) {
      // TON → Jetton order
      message = buildTonOrderMessage(orderParams);
    } else {
      // Jetton → TON/Jetton order
      // Get user's jetton wallet address
      const jettonWalletAddress = await getJettonWalletAddress(userAddress, fromCoin.address!);

      orderParams.fromJettonWallet = jettonWalletAddress;
      orderParams.forwardTonAmount = GAS_FEES.DEFAULT_FORWARD_AMOUNT;

      message = buildJettonOrderMessage(orderParams);
    }

    console.log('Order message built:', message);

    // Send transaction via TonConnect
    const txResult = await sendOrderTransaction(telegramId, message);

    console.log('Transaction sent:', txResult);

    // Order will be loaded via API from blockchain, not saved to local DB
    console.log('Transaction sent successfully, order will be loaded via API');

    return {
      success: true,
      transactionHash: txResult.boc,
      message: `Order created successfully: ${amount} ${fromCoin.symbol} → ${toCoin.symbol}`,
    };
  } catch (error) {
    console.error('Error creating order:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Close/cancel an existing order
 *
 * Sends a CloseOrder transaction (opcode 0x52e80bac) to the order contract.
 * The transaction must be sent from the order owner's wallet.
 *
 * @param telegramId - User's Telegram ID
 * @param orderIdOrAddress - Order ID (numeric) or blockchain address of the order contract
 * @returns Result of the close operation
 */
export async function closeOrder(
  telegramId: number,
  orderIdOrAddress: string
): Promise<OrderCreationResult> {
  try {
    if (!orderIdOrAddress) {
      return {
        success: false,
        error: 'Order ID or address is required',
      };
    }

    let orderAddress = orderIdOrAddress;
    let fromCoinId: number | undefined;

    // Check if this is an order ID (numeric) or an address (starts with 0: or EQ/UQ)
    const isOrderId = /^\d+$/.test(orderIdOrAddress);

    if (isOrderId) {
      console.log(`[closeOrder] Fetching order details for ID: ${orderIdOrAddress}`);

      // Fetch order from API to get the blockchain address
      const order = await getApiOrderById(orderIdOrAddress);

      if (!order.order_address) {
        return {
          success: false,
          error: 'Order does not have a blockchain address yet',
        };
      }

      orderAddress = order.order_address;
      fromCoinId = order.from_coin_id;
      console.log(`[closeOrder] Got order_address from API: ${orderAddress}`);
    }

    // Validate that the order address is parseable by @ton/core
    try {
      Address.parse(orderAddress);
    } catch {
      console.error(`[closeOrder] Invalid order address format: "${orderAddress}"`);
      return {
        success: false,
        error: `Invalid order address format: ${orderAddress}`,
      };
    }

    console.log(`[closeOrder] Closing order at address: ${orderAddress} for user: ${telegramId}`);

    let onChainState: OnChainOrderState | null = null;
    try {
      onChainState = await getOnChainOrderState(orderAddress);
      console.log(
        `[closeOrder] On-chain state: owner=${onChainState.owner}, amount=${onChainState.amount.toString()}, hasFromJetton=${onChainState.hasFromJetton}`
      );

      const connectedWallet = getWalletAddress(telegramId);
      const normalizedConnected = connectedWallet ? normalizeRawAddress(connectedWallet) : null;
      const normalizedOwner = normalizeRawAddress(onChainState.owner);

      if (normalizedConnected && normalizedOwner && normalizedConnected !== normalizedOwner) {
        return {
          success: false,
          error: 'This order belongs to a different wallet. Reconnect the correct wallet and try again.',
        };
      }

      if (onChainState.amount <= 0n) {
        return {
          success: false,
          error: 'This order has no remaining amount to cancel (already matched/closed).',
        };
      }
    } catch (onChainError) {
      console.warn(
        `[closeOrder] Failed to read on-chain order state for ${orderAddress}, continuing without pre-check:`,
        onChainError
      );
    }

    const isJettonOrder = onChainState
      ? onChainState.hasFromJetton
      : (fromCoinId !== undefined ? fromCoinId !== 0 : true);

    // Jetton-origin closes need more attached TON to pass full order -> vault close flow.
    const closeGasTon = isJettonOrder ? '0.11' : '0.06';

    // Build close order message (0x52e80bac opcode with dynamic close gas)
    const message = buildCloseOrderMessage(orderAddress, closeGasTon);

    console.log(
      `[closeOrder] Sending CloseOrder transaction to: ${message.to} with gas=${closeGasTon} TON`
    );

    // Send transaction via TonConnect
    // The wallet will prompt the user to sign the transaction
    const txResult = await sendOrderTransaction(telegramId, message);

    console.log(`[closeOrder] Transaction sent successfully: ${txResult.boc}`);

    return {
      success: true,
      transactionHash: txResult.boc,
      orderAddress,
      message: 'Order cancellation transaction sent',
    };
  } catch (error) {
    console.error('[closeOrder] Error closing order:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Match two orders
 *
 * @param telegramId - User's Telegram ID (matcher)
 * @param myOrderId - ID of user's order from Open4Dev API
 * @param anotherOrderId - ID of the order to match with
 * @param amount - Amount to match
 * @returns Result of the match operation
 */
export async function matchOrders(
  telegramId: number,
  myOrderId: string,
  anotherOrderId: string,
  amount: number
): Promise<OrderCreationResult> {
  try {
    // Fetch order details from Open4Dev API
    const myOrder = await getApiOrderById(myOrderId);
    const anotherOrder = await getApiOrderById(anotherOrderId);

    if (!myOrder.order_address || !anotherOrder.order_address) {
      return {
        success: false,
        error: 'Order addresses not found',
      };
    }

    // Build match order parameters
    const matchParams: MatchOrderParams = {
      myOrderAddress: myOrder.order_address,
      anotherVault: anotherOrder.vault_address || '', // Would need to be fetched
      anotherOrderOwner: anotherOrder.user_address || '',
      anotherOrder: anotherOrder.order_address,
      createdAt: anotherOrder.deployed_at
        ? Math.floor(new Date(anotherOrder.deployed_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      amount: amount.toString(),
    };

    // Build match order message
    const message = buildMatchOrderMessage(matchParams);

    // Send transaction
    const txResult = await sendOrderTransaction(telegramId, message);

    return {
      success: true,
      transactionHash: txResult.boc,
      message: 'Orders matched successfully',
    };
  } catch (error) {
    console.error('Error matching orders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Helper: Get vault address for a specific coin
 *
 * @param coinId - Coin ID from Open4Dev API
 * @returns Vault address or null if not found
 */
async function getVaultAddressForCoin(coinId: number): Promise<string | null> {
  try {
    // First, get the coin symbol from the API
    const coin = await getCoinById(coinId);
    if (!coin?.symbol) {
      console.error(`Coin with ID ${coinId} not found or has no symbol`);
      return null;
    }

    // Use the new function to get vault by coin symbol
    return await getVaultAddressByCoinSymbol(coin.symbol);
  } catch (error) {
    console.error('Error getting vault address:', error);
    return null;
  }
}

/**
 * Helper: Get jetton wallet address for a user
 *
 * This calculates the deterministic jetton wallet address for a user
 * based on the jetton minter address
 *
 * @param userAddress - User's wallet address
 * @param jettonMinterAddress - Jetton minter contract address
 * @returns Jetton wallet address
 */
async function getJettonWalletAddress(
  userAddress: string,
  jettonMinterAddress: string
): Promise<string> {
  // In a real implementation, this would:
  // 1. Query the jetton minter contract to get the wallet code
  // 2. Calculate the wallet address deterministically
  // 3. Or query the API for the wallet address

  // For now, return a placeholder
  // TODO: Implement proper jetton wallet address calculation
  throw new Error('Jetton wallet address calculation not implemented');
}

/**
 * Helper: Validate order parameters
 *
 * @param request - Order creation request
 * @returns Validation result with error message if invalid
 */
export function validateOrderRequest(
  request: OrderCreationRequest
): { valid: boolean; error?: string } {
  if (request.amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }

  if (request.orderType === 'LIMIT' && !request.price) {
    return { valid: false, error: 'Price is required for limit orders' };
  }

  if (request.orderType === 'LIMIT' && request.price && request.price <= 0) {
    return { valid: false, error: 'Price must be greater than 0' };
  }

  if (request.slippagePercent && (request.slippagePercent < 0 || request.slippagePercent > 100)) {
    return { valid: false, error: 'Slippage must be between 0 and 100 percent' };
  }

  return { valid: true };
}
