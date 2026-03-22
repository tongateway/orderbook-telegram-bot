# Database Structure

This directory contains all Prisma-related files for the Telegram Trading Bot.

## Files

- `schema.prisma` - Database schema definition (optimized)
- `seed.ts` - Database seeding script
- `migrations/` - Database migration history

## Database Models

### User
Stores Telegram user information and wallet connections.
- `id` - Auto-incrementing primary key
- `telegramId` - Unique Telegram user ID (indexed)
- `username` - Telegram username
- `walletAddress` - Connected TON wallet address
- `walletType` - Type of wallet (Tonkeeper, MyTonWallet, etc.)
- `connectedAt` - When the wallet was connected
- `createdAt` - User registration timestamp
- `updatedAt` - Last update timestamp

### Order
Stores trading orders (limit and market orders).
**Uses PostgreSQL enums for type safety**
- `id` - Auto-incrementing primary key
- `userId` - Foreign key to User (cascade delete)
- `orderId` - Unique order identifier (string)
- `pair` - Trading pair (e.g., "TON/USDT") (indexed)
- `side` - OrderSide enum (BUY, SELL)
- `orderType` - OrderType enum (LIMIT, MARKET)
- `amount` - Order amount
- `price` - Order price (nullable for market orders)
- `filledAmount` - Amount filled so far (default: 0)
- `status` - OrderStatus enum (OPEN, PARTIAL, FILLED, CANCELLED) (indexed, default: OPEN)
- `transactionHash` - Blockchain transaction hash
- `createdAt` - Order creation timestamp (indexed)
- `updatedAt` - Auto-updated timestamp

**Indexes:** userId, status, pair, createdAt

### Trade
Records executed trades.
**Uses PostgreSQL enums for type safety**
- `id` - Auto-incrementing primary key
- `userId` - Foreign key to User (cascade delete)
- `orderId` - Order ID reference (string, nullable)
- `orderDbId` - Foreign key to Order table (nullable, set null on delete)
- `pair` - Trading pair (indexed)
- `side` - OrderSide enum (BUY, SELL)
- `amount` - Trade amount
- `price` - Execution price
- `fee` - Trading fee (default: 0)
- `transactionHash` - Blockchain transaction hash
- `executedAt` - Trade execution timestamp (indexed)

**Indexes:** userId, pair, executedAt

## PostgreSQL Enums

The schema uses native PostgreSQL enums for type safety and better performance:

```sql
OrderSide: BUY, SELL
OrderType: LIMIT, MARKET
OrderStatus: OPEN, PARTIAL, FILLED, CANCELLED
```

## Session Management

**Note:** The Session table has been removed. Use Telegraf's built-in session middleware instead:

```typescript
import { session } from 'telegraf';

bot.use(session());

// In handlers:
ctx.session.state = UserState.ENTERING_AMOUNT;
ctx.session.pendingOrder = { ... };
```

## Available Scripts

### Generate Prisma Client
```bash
yarn db:generate
```

### Create and Apply Migrations
```bash
yarn db:migrate
```

### Open Prisma Studio (Database GUI)
```bash
yarn db:studio
```

### Seed Database
```bash
yarn db:seed
```

### Reset Database (Dangerous!)
```bash
yarn db:reset
```

### Format Schema File
```bash
yarn db:format
```

## Database Setup

1. Start PostgreSQL (using Docker):
```bash
docker-compose up -d
```

2. Generate Prisma Client:
```bash
yarn db:generate
```

3. Run migrations:
```bash
yarn db:migrate
```

4. (Optional) Seed the database:
```bash
yarn db:seed
```

## Connection

The database connection is configured via the `DATABASE_URL` environment variable in `.env`:

```
DATABASE_URL=postgresql://vibe_user:vibe_password@localhost:5432/vibe_kanban
```

## Development Workflow

1. Modify `schema.prisma` to make schema changes
2. Run `yarn db:migrate` to create and apply migrations
3. Prisma Client is automatically regenerated
4. Update your TypeScript code to use the new schema
