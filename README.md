# TON Order Book Trading Bot (MVP)

A Telegram bot that enables users to perform order book trading on the TON blockchain.

**Try it:** [@tgw_dex_bot](https://t.me/tgw_dex_bot)

## Features (MVP)

- Wallet connection via TON Connect
- View balance
- Create limit orders (Buy/Sell)
- Create market orders
- View active orders
- Cancel orders
- Match orders
- View trading history
- State management for order flows
- **Order Service** - Complete TON blockchain message building for order creation

## Prerequisites

- Node.js 20+
- A Telegram Bot Token (from [@BotFather](https://t.me/botfather))

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env` and update `TELEGRAM_BOT_TOKEN` with your bot token from BotFather
   - Other variables can remain as defaults for testing

3. Run database migrations:
```bash
npx prisma migrate dev
```

4. Build TypeScript:
```bash
npm run build
```

## Running the Bot

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## Bot Commands

- `/start` - Welcome message and wallet connection
- `/connect` - Connect TON wallet
- `/balance` - View wallet balance
- `/trade` - Open trading interface
- `/orders` - View active orders
- `/history` - View trading history
- `/help` - Show help information

## Project Structure

```
src/
├── bot/
│   ├── index.ts             # Bot initialization
│   ├── commands.ts          # Command handlers
│   ├── callbacks.ts         # Inline button callbacks
│   └── messages/            # Message templates
├── database/
│   └── prisma.ts            # Database client
├── services/
│   ├── userService.ts       # User management
│   ├── orderService.ts      # Order database operations
│   ├── tonOrderService.ts   # TON message building (NEW)
│   ├── orderCreationService.ts # High-level order management (NEW)
│   ├── tonConnectService.ts # Wallet connection
│   └── open4devService.ts   # Open4Dev API integration
├── sdk/
│   └── ...                  # Open4Dev SDK
├── types/
│   └── index.ts             # TypeScript types
├── utils/
│   └── config.ts            # Configuration
└── index.ts                 # Application entry point

order-book/                   # Order-book smart contracts (gitignored)
├── contracts/               # Tolk smart contracts
├── wrappers/                # TypeScript contract wrappers
└── scripts/                 # Deployment scripts

docs/
└── ORDER_SERVICE.md         # Order service documentation (NEW)

examples/
├── open4dev-sdk-usage.ts    # SDK usage examples
└── order-creation-usage.ts  # Order creation examples (NEW)
```

## Order Service

The bot includes a comprehensive **Order Service** for creating and managing orders on the TON blockchain:

### Features
- ✅ Build TON messages for order creation (TON → Jetton)
- ✅ Build Jetton transfer messages for order creation (Jetton → TON/Jetton)
- ✅ Order cancellation messages
- ✅ Order matching messages
- ✅ Integration with order-book smart contracts
- ✅ TonConnect transaction signing
- ✅ Price rate and slippage calculations
- ✅ Gas fee estimation

### Quick Start

```typescript
import { createNewOrder } from './services/orderCreationService';

// Create a limit order: 10 TON → USDT at 3.5 USDT per TON
const result = await createNewOrder({
  telegramId: 123456789,
  userAddress: 'EQD...',
  fromCoinId: 1, // TON
  toCoinId: 2, // USDT
  amount: 10,
  price: 3.5,
  slippagePercent: 2,
  orderType: 'LIMIT',
});
```

### Documentation

See [docs/ORDER_SERVICE.md](docs/ORDER_SERVICE.md) for complete documentation and examples.

### Contract Integration

The service integrates with the order-book smart contracts from the `order-book` repository:
- **Order Contract**: Manages individual orders with matching logic
- **Vault Contract**: Holds assets and creates orders
- **VaultFactory**: Deploys new vaults

## Implementation Status

### ✅ Implemented
1. **TON Connect Integration**: Fully implemented with wallet connection and transaction signing
2. **Order Service**: Complete message building for all order operations
3. **Open4Dev API Integration**: SDK for fetching coins, orders, and vaults
4. **Database**: Full order and trade tracking

### 🔄 Partial Implementation
1. **Vault Discovery**: Needs API endpoint for vault addresses
2. **Jetton Wallet Address Calculation**: Requires contract code query
3. **Market Price Fetching**: Needs real-time price data from API

### 📋 TODO
1. **Order Address Calculation**: Deterministic address generation
2. **Real-time Order Updates**: WebSocket integration
3. **Advanced Order Types**: Stop-loss, take-profit, etc.

## Next Steps (Post-MVP)

1. Integrate actual TON Connect SDK for wallet connections
2. Connect to Order Book API (open4dev)
3. Implement real TON blockchain balance queries
4. Add transaction signing and submission
5. Implement WebSocket for real-time order book updates
6. Add market orders
7. Deploy with webhooks instead of long polling

## Database

The bot uses SQLite (via Prisma) with the following models:
- `User` - Telegram users and wallet connections
- `Order` - Trading orders
- `Trade` - Executed trades
- `Session` - User session state

View schema: `prisma/schema.prisma`

## Documentation

- [APP_LOGIC.md](APP_LOGIC.md) - Application logic and architecture
- [docs/ORDER_SERVICE.md](docs/ORDER_SERVICE.md) - Order service documentation
- [examples/order-creation-usage.ts](examples/order-creation-usage.ts) - Order service examples

## License

ISC
