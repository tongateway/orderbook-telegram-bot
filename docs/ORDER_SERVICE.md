# Order Service Documentation

Complete guide for creating and managing orders on the TON blockchain using the order-book smart contracts.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Services](#services)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Contract Integration](#contract-integration)

## Overview

The Order Service provides a high-level interface for creating, managing, and matching orders on the TON blockchain. It integrates with:

- **Order-book smart contracts** (from `order-book` repository)
- **Open4Dev API** (for coin and vault data)
- **TonConnect** (for wallet integration and transaction signing)
- **PostgreSQL database** (for order tracking)

### Key Features

- ✅ Create limit and market orders
- ✅ Support for TON → Jetton and Jetton → TON/Jetton trades
- ✅ Order cancellation
- ✅ Order matching
- ✅ Automatic message building and transaction signing
- ✅ Database integration for order tracking
- ✅ Slippage protection

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Telegram Bot                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           orderCreationService.ts                           │
│  - createNewOrder()                                         │
│  - closeOrder()                                             │
│  - matchOrders()                                            │
└──────┬────────────────────┬────────────────────┬────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│tonOrderService│  │ open4devService  │  │ orderService │
│  (Messages)   │  │   (API data)     │  │  (Database)  │
└──────┬────────┘  └──────────────────┘  └──────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    TonConnect SDK                            │
│                  (Transaction Signing)                       │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                   TON Blockchain                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │  Vault   │  │  Order   │  │ Jetton   │                 │
│   │ Contract │  │ Contract │  │ Wallet   │                 │
│   └──────────┘  └──────────┘  └──────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

## Services

### 1. tonOrderService.ts

**Purpose:** Low-level service for building TON blockchain messages.

**Key Functions:**
- `buildTonOrderMessage()` - Build message for TON → Jetton orders
- `buildJettonOrderMessage()` - Build message for Jetton → TON/Jetton orders
- `buildCloseOrderMessage()` - Build message to close an order
- `buildMatchOrderMessage()` - Build message to match orders
- `sendOrderTransaction()` - Send transaction via TonConnect
- `calculatePriceRate()` - Convert price to blockchain format
- `calculateSlippage()` - Convert slippage percentage to blockchain format

### 2. orderCreationService.ts

**Purpose:** High-level service integrating all components.

**Key Functions:**
- `createNewOrder()` - Create a new order (end-to-end)
- `closeOrder()` - Close/cancel an order
- `matchOrders()` - Match two orders
- `validateOrderRequest()` - Validate order parameters

### 3. open4devService.ts

**Purpose:** Interact with Open4Dev API for coin and vault data.

**Key Functions:**
- `getCoinById()` - Get coin information
- `getVaultById()` - Get vault information
- `getOrderById()` - Get order information
- `getOrderBookForPair()` - Get order book for a trading pair

## Usage

### Basic Order Creation

```typescript
import { createNewOrder, OrderCreationRequest } from './services/orderCreationService';

// Create a limit order to trade 10 TON for USDT at 3.5 USDT per TON
const request: OrderCreationRequest = {
  telegramId: 123456789,
  userAddress: 'EQD...',
  fromCoinId: 1, // TON
  toCoinId: 2, // USDT
  amount: 10,
  price: 3.5,
  slippagePercent: 2,
  orderType: 'LIMIT',
};

const result = await createNewOrder(request);

if (result.success) {
  console.log('Order created:', result.orderAddress);
} else {
  console.error('Error:', result.error);
}
```

### Order Cancellation

```typescript
import { closeOrder } from './services/orderCreationService';

const result = await closeOrder(
  123456789, // telegramId
  'EQC...' // orderAddress
);

if (result.success) {
  console.log('Order closed successfully');
}
```

### Manual Message Building

```typescript
import {
  buildTonOrderMessage,
  calculatePriceRate,
  calculateSlippage,
} from './services/tonOrderService';

const message = buildTonOrderMessage({
  userAddress: 'EQD...',
  vaultAddress: 'EQC...',
  amount: '10',
  priceRate: calculatePriceRate(3.5).toString(),
  slippage: calculateSlippage(2).toString(),
  toJettonMinter: 'EQB...', // USDT minter
});

// message.to - destination address
// message.value - TON amount in nano
// message.payload - base64 encoded message body
```

## API Reference

### OrderCreationRequest

```typescript
interface OrderCreationRequest {
  telegramId: number;         // User's Telegram ID
  userAddress: string;        // User's TON wallet address
  fromCoinId: number;         // Source coin ID (from Open4Dev API)
  toCoinId: number;           // Destination coin ID
  amount: number;             // Amount in human-readable format
  price?: number;             // Price for limit orders
  slippagePercent?: number;   // Slippage tolerance (default 2%)
  orderType: 'LIMIT' | 'MARKET';
}
```

### CreateOrderParams

```typescript
interface CreateOrderParams {
  userAddress: string;        // User's wallet address
  vaultAddress: string;       // Vault contract address
  amount: string | number;    // Amount to trade
  priceRate: string | number; // Exchange rate (18 decimals)
  slippage: string | number;  // Slippage in nano (uint30)
  toJettonMinter: string | null; // Destination jetton (null for TON)
  fromJettonWallet?: string;  // Source jetton wallet (for jetton orders)
  forwardTonAmount?: string | number; // Forward amount for jetton orders
}
```

### OrderCreationResult

```typescript
interface OrderCreationResult {
  success: boolean;
  transactionHash?: string;   // Transaction hash/BOC
  orderAddress?: string;      // Created order contract address
  message?: string;           // Success message
  error?: string;             // Error message (if failed)
}
```

## Examples

See [examples/order-creation-usage.ts](../examples/order-creation-usage.ts) for comprehensive examples.

### Example 1: Create TON → USDT Order

```typescript
const result = await createNewOrder({
  telegramId: 123456789,
  userAddress: 'EQD...',
  fromCoinId: 1, // TON
  toCoinId: 2, // USDT
  amount: 10,
  price: 3.5, // 1 TON = 3.5 USDT
  slippagePercent: 2,
  orderType: 'LIMIT',
});
```

### Example 2: Create USDT → TON Order

```typescript
const result = await createNewOrder({
  telegramId: 123456789,
  userAddress: 'EQD...',
  fromCoinId: 2, // USDT
  toCoinId: 1, // TON
  amount: 100,
  price: 0.285, // 1 USDT = 0.285 TON
  slippagePercent: 2,
  orderType: 'LIMIT',
});
```

### Example 3: Close Order

```typescript
const result = await closeOrder(123456789, 'EQC...');
```

### Example 4: Match Orders

```typescript
const result = await matchOrders(
  123456789,    // telegramId
  'order-123',  // myOrderId
  'order-456',  // anotherOrderId
  5             // matchAmount
);
```

## Contract Integration

### Order Contract Messages

The service builds messages compatible with the order-book contracts:

#### 1. InitOrder (0x2d0e1e1b)
Initializes an order with amount, price rate, and slippage.

#### 2. CloseOrder (0x52e80bac)
Closes/cancels an existing order.

#### 3. MatchOrder (0x47ff7e25)
Matches the order with another order.

### Vault Contract Messages

#### TonTransfer (0xcbcd047e)
Creates an order by sending TON to a vault.

```
amount: coins
toJetton: Cell<ToJettonInfo>
priceRate: coins
slippage: uint30
```

### Jetton Wallet Messages

#### JettonTransfer (0x0f8a7ea5)
Creates an order by transferring jettons to a vault with forward payload.

```
query_id: uint64
amount: coins
destination: address (vault)
response_destination: address (user)
custom_payload: Maybe ^Cell
forward_ton_amount: coins
forward_payload: ^Cell (contains priceRate, toJettonMinter, slippage)
```

## Price Rate Calculation

The price rate represents the exchange rate between two tokens:

```
priceRate = (toAmount / fromAmount) * 10^18
```

**Example:**
- If 1 TON = 3.5 USDT, then `priceRate = 3.5 * 10^18 = 3500000000000000000`
- If 1 USDT = 0.285 TON, then `priceRate = 0.285 * 10^18 = 285000000000000000`

**Helper function:**
```typescript
const priceRate = calculatePriceRate(3.5); // Returns 3500000000000000000n
```

## Slippage Calculation

Slippage is the acceptable price deviation, stored as a uint30 value:

```
slippage = (percentage / 100) * 10^9
```

**Example:**
- 2% slippage: `0.02 * 10^9 = 20000000`
- 5% slippage: `0.05 * 10^9 = 50000000`

**Helper function:**
```typescript
const slippage = calculateSlippage(2); // Returns 20000000n (2%)
```

## Gas Fees

Estimated gas fees for operations:

- **Create TON order:** ~0.15 TON
- **Create Jetton order:** ~0.15 TON
- **Close order:** ~0.05 TON
- **Match order:** ~0.3 TON

These are included automatically in the message value.

## Error Handling

All service functions return a result object with `success` boolean:

```typescript
const result = await createNewOrder(request);

if (result.success) {
  // Handle success
  console.log('Order created:', result.orderAddress);
} else {
  // Handle error
  console.error('Error:', result.error);
}
```

Common errors:
- "Wallet not connected" - User needs to connect wallet via TonConnect
- "No vault found for coin" - Vault address not configured
- "Amount must be greater than 0" - Invalid order amount
- "Price is required for limit orders" - Missing price for limit order

## Integration with Telegram Bot

Example integration in bot command handler:

```typescript
import { createNewOrder } from '../services/orderCreationService';

bot.command('createorder', async (ctx) => {
  const userId = ctx.from.id;
  const userAddress = await getUserWalletAddress(userId);

  const result = await createNewOrder({
    telegramId: userId,
    userAddress,
    fromCoinId: 1,
    toCoinId: 2,
    amount: 10,
    price: 3.5,
    slippagePercent: 2,
    orderType: 'LIMIT',
  });

  if (result.success) {
    await ctx.reply(`Order created! TX: ${result.transactionHash}`);
  } else {
    await ctx.reply(`Error: ${result.error}`);
  }
});
```

## Future Enhancements

- [ ] Implement jetton wallet address calculation
- [ ] Add market price fetching for market orders
- [ ] Implement order address calculation
- [ ] Add vault discovery from Open4Dev API
- [ ] Support for partial order fills
- [ ] Real-time order status updates
- [ ] Order book visualization
- [ ] Advanced order types (stop-loss, take-profit)

## Related Files

- `src/services/tonOrderService.ts` - Low-level message building
- `src/services/orderCreationService.ts` - High-level order management
- `src/services/open4devService.ts` - API integration
- `src/services/orderService.ts` - Database operations
- `src/services/tonConnectService.ts` - Wallet connection
- `examples/order-creation-usage.ts` - Usage examples
- `order-book/` - Smart contract repository

## Support

For questions or issues, please refer to:
- Order-book contracts: `order-book/contracts/`
- Contract wrappers: `order-book/wrappers/`
- Open4Dev API: https://api.open4dev.xyz
