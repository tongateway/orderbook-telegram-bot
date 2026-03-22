/**
 * TON Order Service
 *
 * Service for building TON blockchain messages to create orders on the order-book
 * This service integrates with the order-book smart contracts
 */

import {Address, beginCell, toNano} from '@ton/core';
import { toUserFriendlyAddress as sdkToUserFriendlyAddress } from '@tonconnect/sdk';
import {
  getOrRestoreTonConnect,
  waitForConnection,
  isConnectionReady,
  resetTonConnectRpcRequestCounter,
} from './tonConnectService';
import {toTokenUnits} from '../utils/jettonHelper';
import {
  GAS_FEES,
  PRICE_CONSTANTS,
  SLIPPAGE_CONSTANTS,
  FEE_CONSTANTS,
} from '../utils/tokenConstants';

/**
 * Order creation parameters
 */
export interface CreateOrderParams {
  // Common parameters
  userAddress: string; // User's wallet address
  vaultAddress: string; // Vault contract address
  amount: string | number; // Amount to trade (in tokens)
  priceRate: string | number; // Price rate (exchange rate)
  slippage: string | number; // Slippage tolerance (0-1, e.g., 0.02 for 2%)
  toJettonMinter: string | null; // Address of jetton to receive (null for TON)

  // Decimal configuration for proper amount/price scaling
  fromDecimals?: number; // Decimals for the token being sent (default: 9)
  toDecimals?: number; // Decimals for the token being received (default: 9)

  // Fee configuration (14-bit numerator/denominator fractions)
  providerFee?: string; // Provider fee address
  feeNum?: number; // Fee numerator (0-16383)
  feeDenom?: number; // Fee denominator (0-16383)
  matcherFeeNum?: number; // Matcher fee numerator (0-16383)
  matcherFeeDenom?: number; // Matcher fee denominator (0-16383)

  // Opposite vault (vault for the receiving token)
  oppositeVaultAddress: string; // Vault address for the token being received

  // For jetton orders
  fromJettonWallet?: string; // Jetton wallet address (for jetton → TON/jetton orders)
  forwardTonAmount?: string | number; // TON amount for forward payload
}

/**
 * TON order message (for TON → Jetton trades)
 */
export interface TonOrderMessage {
  to: string; // Vault address
  value: string; // TON amount in nano
  payload: string; // Base64 encoded message body
}

/**
 * Jetton order message (for Jetton → TON/Jetton trades)
 */
export interface JettonOrderMessage {
  to: string; // Jetton wallet address
  value: string; // TON amount for gas
  payload: string; // Base64 encoded message body
}

/**
 * Build a message for creating an order with TON
 * This sends TON to a vault to create an order (TON → Jetton)
 *
 * @param params - Order creation parameters
 * @returns Message ready to be sent via TonConnect
 */
export function buildTonOrderMessage(params: CreateOrderParams): TonOrderMessage {
  const {
    vaultAddress,
    amount,
    priceRate,
    slippage,
    toJettonMinter,
    oppositeVaultAddress,
    fromDecimals = 9, // TON has 9 decimals by default
    providerFee = FEE_CONSTANTS.DEFAULT_PROVIDER_FEE_ADDRESS,
    feeNum = FEE_CONSTANTS.DEFAULT_FEE_NUM,
    feeDenom = FEE_CONSTANTS.DEFAULT_FEE_DENOM,
    matcherFeeNum = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_NUM,
    matcherFeeDenom = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_DENOM,
  } = params;

  if (!toJettonMinter) {
    throw new Error('toJettonMinter is required for TON orders');
  }

  // Convert parameters to bigint using correct decimals
  // Note: amount is in human-readable format, convert using fromDecimals
  // priceRate and slippage are already converted by calculatePriceRate/calculateSlippage
  const amountUnits = typeof amount === 'string' ? toTokenUnits(amount, fromDecimals) : BigInt(amount);
  const priceRateNano = BigInt(priceRate); // Already in correct units, don't convert again
  const slippageValue = BigInt(slippage); // Already in basis points

  // Build fee configuration cell
  // Contains: providerFee address, feeNum (14-bit), feeDenom (14-bit),
  // matcherFeeNum (14-bit), matcherFeeDenom (14-bit)
  const feeConfigCell = beginCell()
    .storeAddress(Address.parse(providerFee))
    .storeUint(feeNum, 14)
    .storeUint(feeDenom, 14)
    .storeUint(matcherFeeNum, 14)
    .storeUint(matcherFeeDenom, 14)
    .endCell();

  // Build message body for Vault.sendCreateOrder
  // struct ( 0xcbcd047e ) TonTransfer {
  //     amount: coins,
  //     toJetton: Cell<ToJettonInfo>
  //     priceRate: coins,
  //     slippage: uint30,
  //     feeInfo: Cell<FeeInfo>
  //     createdAt: uint32
  //     oppositeVault: address
  // }
  const createdAt = Math.floor(Date.now() / 1000);
  const body = beginCell()
    .storeUint(0xcbcd047e, 32) // TonTransfer opcode
    .storeCoins(amountUnits) // amount in token units
    .storeRef(
      beginCell()
        .storeAddress(Address.parse(toJettonMinter))
        .endCell()
    ) // toJetton (ToJettonInfo)
    .storeCoins(priceRateNano) // priceRate
    .storeUint(slippageValue, 30) // slippage (uint30)
    .storeRef(feeConfigCell) // feeConfig reference
    .storeUint(createdAt, 32) // createdAt timestamp
    .storeAddress(Address.parse(oppositeVaultAddress)) // oppositeVault address
    .endCell();

  // Calculate total value: order amount + gas fees
  const totalValue = amountUnits + toNano(GAS_FEES.ORDER_CREATION_TON);

  return {
    to: vaultAddress,
    value: totalValue.toString(),
    payload: body.toBoc().toString('base64'),
  };
}

/**
 * Build a message for creating an order with Jettons
 * This sends jettons to a vault to create an order (Jetton → TON/Jetton)
 *
 * @param params - Order creation parameters
 * @returns Message ready to be sent via TonConnect
 */
export function buildJettonOrderMessage(params: CreateOrderParams): JettonOrderMessage {
  const {
    userAddress,
    vaultAddress,
    amount,
    priceRate,
    slippage,
    toJettonMinter,
    oppositeVaultAddress,
    fromJettonWallet,
    forwardTonAmount = GAS_FEES.DEFAULT_FORWARD_AMOUNT,
    fromDecimals = 9, // Default to 9 decimals (TON-like), but should be 6 for USDT
    providerFee = FEE_CONSTANTS.DEFAULT_PROVIDER_FEE_ADDRESS,
    feeNum = FEE_CONSTANTS.DEFAULT_FEE_NUM,
    feeDenom = FEE_CONSTANTS.DEFAULT_FEE_DENOM,
    matcherFeeNum = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_NUM,
    matcherFeeDenom = FEE_CONSTANTS.DEFAULT_MATCHER_FEE_DENOM,
  } = params;

  if (!fromJettonWallet) {
    throw new Error('fromJettonWallet is required for jetton orders');
  }

  // Convert parameters to bigint using correct decimals
  // Note: amount is in human-readable format, convert using fromDecimals
  // priceRate and slippage are already converted by calculatePriceRate/calculateSlippage
  const jettonAmount = typeof amount === 'string' ? toTokenUnits(amount, fromDecimals) : BigInt(amount);
  const priceRateNano = BigInt(priceRate); // Already in correct units, don't convert again
  const slippageValue = BigInt(slippage); // Already in basis points
  const forwardTonAmountNano = typeof forwardTonAmount === 'string'
    ? toNano(forwardTonAmount)
    : BigInt(forwardTonAmount);

  // Build fee configuration cell
  // Contains: providerFee address, feeNum (14-bit), feeDenom (14-bit),
  // matcherFeeNum (14-bit), matcherFeeDenom (14-bit)
  const feeConfigCell = beginCell()
    .storeAddress(Address.parse(providerFee))
    .storeUint(feeNum, 14)
    .storeUint(feeDenom, 14)
    .storeUint(matcherFeeNum, 14)
    .storeUint(matcherFeeDenom, 14)
    .endCell();

  // Build forward payload for Vault order creation
  // Matches sendCreateOrder structure:
  // struct JettonTransferNotificationPayload {
  //     priceRate: coins
  //     toJetton: Cell<JettonInfo>?  (ref - target jetton minter, null for TON)
  //     slippage: uint30
  //     feeInfo: Cell<FeeInfo>
  //     createdAt: uint32
  //     oppositeVault: address
  // }
  const createdAt = Math.floor(Date.now() / 1000);
  const forwardPayload = beginCell()
    .storeCoins(priceRateNano) // priceRate
    .storeMaybeRef(
      toJettonMinter
        ? beginCell().storeAddress(Address.parse(toJettonMinter)).endCell()
        : null
    ) // toJetton (target jetton minter, null if swapping to TON)
    .storeUint(slippageValue, 30) // slippage (uint30)
    .storeRef(feeConfigCell) // feeInfo reference
    .storeUint(createdAt, 32) // createdAt timestamp
    .storeAddress(Address.parse(oppositeVaultAddress)) // oppositeVault address
    .endCell();

  // Build jetton transfer message
  // This is the standard jetton transfer with forward payload
  // forward_payload is stored as Cell reference (byRef = true) since forwardPayload is a Cell
  const body = beginCell()
    .storeUint(0x0f8a7ea5, 32) // Jetton transfer opcode
    .storeUint(0, 64) // query_id
    .storeCoins(jettonAmount) // jetton amount
    .storeAddress(Address.parse(vaultAddress)) // destination (vault)
    .storeAddress(Address.parse(userAddress)) // response_destination
    .storeMaybeRef(null) // custom_payload
    .storeCoins(forwardTonAmountNano) // forward_ton_amount
    .storeBit(true) // forward_payload is Cell reference
    .storeRef(forwardPayload) // forward_payload as Cell ref
    .endCell();

  // Gas fees for jetton transfer + order creation
  const gasValue = toNano(GAS_FEES.ORDER_CREATION_JETTON);

  return {
    to: fromJettonWallet,
    value: gasValue.toString(),
    payload: body.toBoc().toString('base64'),
  };
}

/**
 * Build a message to close/cancel an order
 *
 * @param orderAddress - Address of the order contract
 * @returns Message ready to be sent via TonConnect
 */
export function buildCloseOrderMessage(
  orderAddress: string,
  gasTon: string = GAS_FEES.ORDER_CLOSURE
): TonOrderMessage {
  // struct ( 0x52e80bac ) CloseOrder {}
  const body = beginCell()
    .storeUint(0x52e80bac, 32) // CloseOrder opcode
    .endCell();

  // Gas fees for order closure
  const gasValue = toNano(gasTon);

  return {
    to: orderAddress,
    value: gasValue.toString(),
    payload: body.toBoc().toString('base64'),
  };
}

/**
 * Build a message to match two orders
 *
 * @param params - Match order parameters
 * @returns Message ready to be sent via TonConnect
 */
export interface MatchOrderParams {
  myOrderAddress: string; // Address of user's order
  anotherVault: string; // Address of the other order's vault
  anotherOrderOwner: string; // Address of the other order's owner
  anotherOrder: string; // Address of the other order contract
  createdAt: number; // Timestamp when the other order was created
  amount: string | number; // Amount to match
}

export function buildMatchOrderMessage(params: MatchOrderParams): TonOrderMessage {
  const {
    myOrderAddress,
    anotherVault,
    anotherOrderOwner,
    anotherOrder,
    createdAt,
    amount,
  } = params;

  const amountNano = typeof amount === 'string' ? toNano(amount) : BigInt(amount);

  // struct ( 0x47ff7e25 ) MatchOrder {
  //     anotherVault: address
  //     anotherOrderOwner: address
  //     anotherOrder: address
  //     createdAt: uint32
  //     amount: coins
  // }
  const body = beginCell()
    .storeUint(0x47ff7e25, 32) // MatchOrder opcode
    .storeAddress(Address.parse(anotherVault))
    .storeAddress(Address.parse(anotherOrderOwner))
    .storeAddress(Address.parse(anotherOrder))
    .storeUint(createdAt, 32)
    .storeCoins(amountNano)
    .endCell();

  // Gas fees for order matching
  const gasValue = toNano(GAS_FEES.ORDER_MATCHING);

  return {
    to: myOrderAddress,
    value: gasValue.toString(),
    payload: body.toBoc().toString('base64'),
  };
}

/**
 * Convert address to bounceable user-friendly format required by TonConnect SDK
 * TonConnect requires addresses in user-friendly format: "EQ..." or "UQ..."
 *
 * @param address - Address in any format (raw or user-friendly)
 * @returns Address in user-friendly format
 */
/**
 * Convert address to user-friendly format using the TonConnect SDK's own encoder.
 * This ensures the checksum/encoding is compatible with the SDK's sendTransaction validation.
 */
function toUserFriendlyAddress(address: string): string {
  try {
    // First normalize to raw format (0:hex) via @ton/core, which handles any input format
    const raw = Address.parse(address).toRawString();
    // Then use the TonConnect SDK's encoder to produce a user-friendly address
    // that passes the SDK's own isValidUserFriendlyAddress check
    return sdkToUserFriendlyAddress(raw);
  } catch (e) {
    console.error(`[toUserFriendlyAddress] Failed to parse address: "${address}"`, e);
    return address;
  }
}

/**
 * Send an order transaction via TonConnect
 *
 * @param telegramId - User's Telegram ID
 * @param message - Order message to send
 * @returns Transaction result
 */
export async function sendOrderTransaction(
  telegramId: number,
  message: TonOrderMessage | JettonOrderMessage
) {
  const startTime = Date.now();
  const logTime = (step: string) => console.log(`[sendOrderTransaction] ${step} (+${Date.now() - startTime}ms)`);

  // Check if connection is already ready (instant)
  if (!isConnectionReady(telegramId)) {
    // Wait for warmup to complete or restore connection (up to 20s)
    logTime('Waiting for connection...');
    const isReady = await waitForConnection(telegramId, 20000);
    logTime(`Connection ready: ${isReady}`);

    if (!isReady) {
      throw new Error('Wallet not connected - please reconnect your wallet');
    }
  } else {
    logTime('Connection already ready');
  }

  logTime('Getting connector...');
  const connector = await getOrRestoreTonConnect(telegramId);
  logTime('Got connector');

  if (!connector.connected) {
    throw new Error('Wallet not connected');
  }

  const walletAppName = connector.wallet?.device?.appName?.toLowerCase() || '';
  const isMyTonWallet = walletAppName.includes('mytonwallet');

  // Convert address to user-friendly format using the TonConnect SDK's own encoder.
  // This guarantees the address passes the SDK's isValidUserFriendlyAddress check.
  logTime('Formatting address...');
  const formattedAddress = toUserFriendlyAddress(message.to);
  logTime(`Address: ${formattedAddress}`);

  const transaction = {
    // Keep TTL at 5 minutes to satisfy strict wallet validators.
    validUntil: Math.floor(Date.now() / 1000) + 300,
    // Don't set `from` — the SDK fills it from connector.account.address (raw format)
    // which the wallet recognizes. Setting it to a user-friendly format causes "Bad request".
    messages: [
      {
        address: formattedAddress,
        amount: message.value,
        payload: message.payload,
      },
    ],
  };

  if (isMyTonWallet) {
    await resetTonConnectRpcRequestCounter(telegramId);
  }

  try {
    logTime('Sending transaction to wallet...');
    // Wrap with our own timeout (60s) to fire BEFORE the SDK's internal p-timeout (90s)
    // This ensures timeout errors are handled consistently here.
    const sdkPromise = connector.sendTransaction(transaction);
    // Swallow any late rejection from the SDK (e.g. 90s p-timeout) after our timeout wins
    sdkPromise.catch(() => {});
    const result = await Promise.race([
      sdkPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Transaction timed out - please confirm in your wallet and try again')), 60000)
      ),
    ]);
    logTime('Transaction confirmed by wallet');
    return result;
  } catch (error) {
    logTime('Transaction failed');
    console.error('Failed to send order transaction:', error);
    throw error;
  }
}

/**
 * Validation error for price rate calculations
 */
export class PriceRateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceRateValidationError';
  }
}

/**
 * Calculate price rate from human-readable price
 *
 * Converts a human-readable exchange rate into blockchain units, adjusting for
 * decimal differences between the source and destination tokens.
 *
 * @example
 * // TON (9 decimals) to USDT (6 decimals) at rate 3.5
 * // "1 TON = 3.5 USDT"
 * calculatePriceRate(3.5, 6, 9) // Returns adjusted bigint
 *
 * @example
 * // USDT (6 decimals) to TON (9 decimals) at rate 0.28
 * // "1 USDT = 0.28 TON"
 * calculatePriceRate(0.28, 9, 6)
 *
 * @param price - Human readable price (e.g., 3.5 meaning "1 fromToken = 3.5 toToken")
 * @param toDecimals - Decimals of the token being received (default: 9)
 * @param fromDecimals - Decimals of the token being sent (default: 9)
 * @returns Price rate in blockchain units (bigint)
 * @throws {PriceRateValidationError} If price or decimals are invalid
 */
export function calculatePriceRate(
  price: number,
  toDecimals: number = PRICE_CONSTANTS.PRICE_RATE_DECIMALS,
  fromDecimals: number = PRICE_CONSTANTS.PRICE_RATE_DECIMALS
): bigint {
  // Validate price
  if (price <= 0) {
    throw new PriceRateValidationError('Price must be greater than 0');
  }
  if (!Number.isFinite(price)) {
    throw new PriceRateValidationError('Price must be a finite number');
  }

  // Validate decimals
  if (fromDecimals < 0 || fromDecimals > PRICE_CONSTANTS.MAX_TOKEN_DECIMALS) {
    throw new PriceRateValidationError(
      `fromDecimals must be between 0 and ${PRICE_CONSTANTS.MAX_TOKEN_DECIMALS}`
    );
  }
  if (toDecimals < 0 || toDecimals > PRICE_CONSTANTS.MAX_TOKEN_DECIMALS) {
    throw new PriceRateValidationError(
      `toDecimals must be between 0 and ${PRICE_CONSTANTS.MAX_TOKEN_DECIMALS}`
    );
  }

  // Convert price to base units (18 decimals)
  const priceRateBase = toTokenUnits(price.toString(), PRICE_CONSTANTS.PRICE_RATE_DECIMALS);

  // Adjust for decimals difference between from and to tokens
  // When fromDecimals > toDecimals: divide to scale down
  // When fromDecimals < toDecimals: multiply to scale up
  if (fromDecimals > toDecimals) {
    const diff = fromDecimals - toDecimals;
    const divisor = BigInt(10 ** diff);
    return priceRateBase / divisor;
  } else if (fromDecimals < toDecimals) {
    const diff = toDecimals - fromDecimals;
    const multiplier = BigInt(10 ** diff);
    return priceRateBase * multiplier;
  }

  // Same decimals, no adjustment needed
  return priceRateBase;
}

/**
 * Validation error for slippage calculations
 */
export class SlippageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlippageValidationError';
  }
}

/**
 * Convert slippage percentage to uint30 value for blockchain storage
 *
 * The slippage value is stored with 9 decimal precision (uint30, max ~10^9).
 *
 * @example
 * calculateSlippage(1)   // 1% -> 10_000_000n (10^7)
 * calculateSlippage(0.5) // 0.5% -> 5_000_000n
 * calculateSlippage(2)   // 2% -> 20_000_000n
 *
 * @param slippagePercent - Slippage in percent (e.g., 1 for 1%, 0.5 for 0.5%)
 * @returns Slippage value for uint30 storage
 * @throws {SlippageValidationError} If slippage is out of valid range
 */
export function calculateSlippage(slippagePercent: number): bigint {
  // Validate slippage range
  if (slippagePercent < SLIPPAGE_CONSTANTS.MIN_PERCENT) {
    throw new SlippageValidationError(
      `Slippage must be at least ${SLIPPAGE_CONSTANTS.MIN_PERCENT}%`
    );
  }
  if (slippagePercent > SLIPPAGE_CONSTANTS.MAX_PERCENT) {
    throw new SlippageValidationError(
      `Slippage must be at most ${SLIPPAGE_CONSTANTS.MAX_PERCENT}%`
    );
  }
  if (!Number.isFinite(slippagePercent)) {
    throw new SlippageValidationError('Slippage must be a finite number');
  }

  // Convert percentage to blockchain units with 9 decimal precision
  // 1% = 10^7, stored in uint30 (max ~10^9)
  // This is equivalent to: slippagePercent * 10^9 / 100
  const slippageUnits = Math.floor(slippagePercent * SLIPPAGE_CONSTANTS.BASIS_POINTS_PER_PERCENT);
  return BigInt(slippageUnits);
}

/**
 * Estimate total cost for creating a TON order
 *
 * @param amount - Order amount in TON (human-readable)
 * @returns Total cost including gas fees (in nanotons)
 */
export function estimateTonOrderCost(amount: string | number): bigint {
  const amountNano = typeof amount === 'string' ? toNano(amount) : BigInt(amount);
  const gasFee = toNano(GAS_FEES.ORDER_CREATION_TON);
  return amountNano + gasFee;
}

/**
 * Estimate gas cost for creating a Jetton order
 *
 * @returns Gas cost in nanotons
 */
export function estimateJettonOrderGas(): bigint {
  return toNano(GAS_FEES.ORDER_CREATION_JETTON);
}
