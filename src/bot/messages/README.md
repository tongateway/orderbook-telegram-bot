# Bot Message Templates

This directory contains all message templates for the Telegram bot. Each template returns formatted text and inline keyboard buttons ready to be sent to users.

## Structure

```
messages/
├── index.ts           # Main export file
├── welcome.ts         # Welcome/start messages
├── createOrder.ts     # Order creation flow
├── myOrders.ts        # User orders list with pagination
└── orderBook.ts       # Order book display
```

## Usage Examples

### 1. Welcome Message (No Wallet)

```typescript
import { getWelcomeMessage } from './bot/messages';

const message = getWelcomeMessage({ username: 'Alice' });

// Send to Telegram
await bot.telegram.sendMessage(chatId, message.text, {
  reply_markup: message.keyboard
});
```

**Output:**
```
Hi, Alice!

I'm the TON Order Book Trading Bot. I help you trade tokens on the TON blockchain using a decentralized order book.

To get started, you need to connect your TON wallet.

[🔗 Connect Wallet] [❓ Help]
```

### 2. Welcome Message (Wallet Connected)

```typescript
import { getWelcomeMessageWithWallet } from './bot/messages';

const message = getWelcomeMessageWithWallet(
  {
    address: 'EQCx...ABC',
    shortAddress: 'EQCx...ABC'
  },
  { username: 'Alice' }
);

await bot.telegram.sendMessage(chatId, message.text, {
  reply_markup: message.keyboard
});
```

**Output:**
```
Welcome back, Alice!

Wallet: EQCx...ABC

What would you like to do?

[📊 Create Order] [📋 My Orders]
[📖 Order Book] [💰 Balance]
[⚙️ Settings] [🔌 Disconnect]
```

### 3. Create Order Form

```typescript
import { getCreateOrderMessage } from './bot/messages';

// Initial empty form
const message = getCreateOrderMessage({
  formData: {},
  currentPrice: 2.45,
  availableBalance: { base: 100, quote: 500 }
});

// Partially filled form
const message2 = getCreateOrderMessage({
  formData: {
    pair: 'TON/USDT',
    side: 'BUY',
    type: 'LIMIT',
    amount: 10
  },
  currentPrice: 2.45,
  availableBalance: { base: 100, quote: 500 }
});

// Edit the message as user fills in fields
await bot.telegram.editMessageText(
  chatId,
  messageId,
  undefined,
  message.text,
  { reply_markup: message.keyboard }
);
```

**Output (partially filled):**
```
📝 Create Order

Pair: TON/USDT
Current Price: 2.4500

━━━━━━━━━━━━━━━━━━━━
Side: 📈 BUY
Type: LIMIT
Amount: 10
Price: Not set
━━━━━━━━━━━━━━━━━━━━

Available:
TON: 100.0000
USDT: 500.0000

[💵 Set Price]
[❌ Cancel]
[🔄 Reset]
```

### 4. My Orders List

```typescript
import { getMyOrdersMessage } from './bot/messages';

const orders = [
  {
    id: 'order_123456',
    pair: 'TON/USDT',
    side: 'BUY',
    type: 'LIMIT',
    amount: 10,
    filledAmount: 0,
    price: 2.45,
    status: 'OPEN',
    createdAt: new Date()
  },
  // ... more orders
];

const message = getMyOrdersMessage({
  orders,
  page: 1,
  itemsPerPage: 3
});

await bot.telegram.sendMessage(chatId, message.text, {
  reply_markup: message.keyboard
});
```

**Output:**
```
📋 My Orders (5)

Page 1 of 2

1. Order #123456
━━━━━━━━━━━━━━━━━━━━
📈 BUY LIMIT
Pair: TON/USDT
Price: 2.4500
Amount: 10.0000
Status: 🟢 OPEN
━━━━━━━━━━━━━━━━━━━━

[❌ #1] [❌ #2] [❌ #3]
[Next ▶️] [1/2]
[🔄 Refresh] [📊 New Order]
[🏠 Main Menu]
```

### 5. Order Book Display

```typescript
import { getOrderBookMessage } from './bot/messages';

const orderBookData = {
  pair: 'TON/USDT',
  lastPrice: 2.45,
  priceChange24h: 5.2,
  volume24h: 150000,
  asks: [
    { price: 2.46, amount: 100 },
    { price: 2.47, amount: 250 },
    { price: 2.48, amount: 500 }
  ],
  bids: [
    { price: 2.44, amount: 150 },
    { price: 2.43, amount: 300 },
    { price: 2.42, amount: 450 }
  ]
};

const message = getOrderBookMessage({
  orderBook: orderBookData,
  selectedPair: 'TON/USDT',
  depth: 5
});

await bot.telegram.sendMessage(chatId, message.text, {
  reply_markup: message.keyboard
});
```

**Output:**
```
📖 Order Book: TON/USDT

Last Price: 2.4500 📈 +5.20%
24h Volume: 150.00K

━━━━━━━━━━━━━━━━━━━━

📉 Asks (Sell Orders)
━━━━━━━━━━━━━━━━━━━━
Price       | Amount
━━━━━━━━━━━━━━━━━━━━
2.4800      | 500.00
2.4700      | 250.00
2.4600      | 100.00

    Spread: 0.0200 (0.81%)

📈 Bids (Buy Orders)
━━━━━━━━━━━━━━━━━━━━
Price       | Amount
━━━━━━━━━━━━━━━━━━━━
2.4400      | 150.00
2.4300      | 300.00
2.4200      | 450.00

━━━━━━━━━━━━━━━━━━━━

[📈 Quick Buy] [📉 Quick Sell]
[🔀 Change Pair] [🔄 Refresh]
[5] [10] [20]
[🏠 Main Menu]
```

## Message Editing Pattern

All messages are designed to be edited dynamically. Use Telegram's `editMessageText` to update messages:

```typescript
// Initial send
const msg = await bot.telegram.sendMessage(chatId, message.text, {
  reply_markup: message.keyboard
});

// Later edit the same message
const updatedMessage = getCreateOrderMessage({
  formData: updatedFormData
});

await bot.telegram.editMessageText(
  chatId,
  msg.message_id,
  undefined,
  updatedMessage.text,
  { reply_markup: updatedMessage.keyboard }
);
```

## Callback Data Format

The templates use specific callback data patterns:

- `connect_wallet` - Connect wallet button
- `create_order` - Create new order
- `list_orders` - View my orders
- `order_book` - View order book
- `order_side_buy` / `order_side_sell` - Select order side
- `order_type_limit` / `order_type_market` - Select order type
- `cancel_order_{orderId}` - Cancel specific order
- `orderbook_pair_{pair}` - Select trading pair
- `orders_page_{pageNum}` - Navigate order pages

## TypeScript Types

All message functions are fully typed. Import types as needed:

```typescript
import type {
  OrderFormData,
  Order,
  OrderBookData,
  OrderStatus,
  OrderSide,
  OrderType
} from './bot/messages';
```

## Notes

- All price/amount values should be numbers, not strings
- Messages are designed for Telegram's message length limits
- Inline keyboards support up to 8 buttons per row (templates use max 3)
- All emojis are carefully chosen for clarity
- Pagination automatically handles empty states
