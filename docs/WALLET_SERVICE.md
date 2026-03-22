# Wallet Service Documentation

Comprehensive wallet service with Redis caching for balances, jettons, orders, and statistics.

## Features

- **Balance Management**: Get TON and jetton balances
- **Jetton Support**: NOT, BUILD, TON, USDT, USDC
- **Order Tracking**: View open and closed orders
- **Statistics**: Track order count, volume, and trades
- **Redis Caching**: Fast data retrieval with automatic caching
- **Auto-refresh**: Force update methods to refresh cached data

## Table of Contents

- [Setup](#setup)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Caching Strategy](#caching-strategy)
- [Best Practices](#best-practices)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Redis

Using Docker Compose (recommended):

```bash
docker-compose up -d redis
```

Or using Docker directly:

```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

### 3. Configure Environment

Add to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TTL=300

# Open4Dev API (required for orders)
OPEN4DEV_API_KEY=your_api_key_here
OPEN4DEV_API_URL=https://api.open4dev.xyz/api/v1

# TON Network
TON_NETWORK=testnet
TON_API_KEY=your_ton_api_key
```

### 4. Initialize Redis Connection

```typescript
import { connectRedis } from './services/redisService';

await connectRedis();
```

## Configuration

### Supported Jettons

Currently supported jettons (configurable in `src/services/walletService.ts`):

| Symbol | Name | Decimals | Network |
|--------|------|----------|---------|
| TON | Toncoin | 9 | Native |
| NOT | Notcoin | 9 | Jetton |
| BUILD | BUILD | 9 | Jetton |
| USDT | Tether USD | 6 | Jetton |
| USDC | USD Coin | 6 | Jetton |

### Cache TTL

Default cache TTL is 5 minutes (300 seconds). Configure via `REDIS_TTL` environment variable.

## API Reference

### Get Wallet Balance

Get all balances (TON + jettons) for a wallet address.

```typescript
import { getWalletBalance } from './services/walletService';

const balance = await getWalletBalance(walletAddress, useCache);
```

**Parameters:**
- `address` (string): Wallet address
- `useCache` (boolean, optional): Use cached data. Default: `true`

**Returns:**
```typescript
{
  address: string;
  ton: string;
  jettons: JettonBalance[];
  totalValueUsd?: number;
  updatedAt: Date;
}
```

**Example:**
```typescript
const balance = await getWalletBalance('EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2');
console.log(`TON: ${balance.ton}`);
console.log(`Jettons: ${balance.jettons.length}`);
```

### Get Jetton Balance

Get balance for a specific jetton.

```typescript
import { getJettonBalanceBySymbol } from './services/walletService';

const balance = await getJettonBalanceBySymbol(walletAddress, 'USDT', useCache);
```

**Parameters:**
- `address` (string): Wallet address
- `symbol` (string): Jetton symbol (NOT, BUILD, USDT, USDC)
- `useCache` (boolean, optional): Use cached data. Default: `true`

**Returns:**
```typescript
{
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  address?: string;
  price?: number;
  valueUsd?: number;
}
```

### Get Wallet Orders

Get open and closed orders for a wallet.

```typescript
import { getWalletOrders } from './services/walletService';

const { open, closed } = await getWalletOrders(walletAddress, useCache);
```

**Parameters:**
- `address` (string): Wallet address
- `useCache` (boolean, optional): Use cached data. Default: `true`

**Returns:**
```typescript
{
  open: WalletOrder[];
  closed: WalletOrder[];
}
```

**Order Object:**
```typescript
{
  orderId: string;
  status: string;
  type: string;
  fromCoin: string;
  toCoin: string;
  amount: number;
  priceRate?: number;
  createdAt: string;
  deployedAt?: string;
  completedAt?: string;
}
```

### Get Wallet Statistics

Get aggregated statistics for a wallet.

```typescript
import { getWalletStats } from './services/walletService';

const stats = await getWalletStats(walletAddress, useCache);
```

**Parameters:**
- `address` (string): Wallet address
- `useCache` (boolean, optional): Use cached data. Default: `true`

**Returns:**
```typescript
{
  address: string;
  totalOrders: number;
  openOrders: number;
  closedOrders: number;
  totalVolume: number;
  totalTrades: number;
  updatedAt: Date;
}
```

### Update Wallet Balance

Force refresh wallet balance (clears cache).

```typescript
import { updateWalletBalance } from './services/walletService';

const freshBalance = await updateWalletBalance(walletAddress);
```

### Update Wallet Stats

Force refresh wallet statistics (clears cache).

```typescript
import { updateWalletStats } from './services/walletService';

const freshStats = await updateWalletStats(walletAddress);
```

### Update All Wallet Data

Force refresh all wallet data (balance, orders, stats).

```typescript
import { updateAllWalletData } from './services/walletService';

const { balance, orders, stats } = await updateAllWalletData(walletAddress);
```

### Get Supported Jettons

Get list of all supported jettons.

```typescript
import { getSupportedJettons } from './services/walletService';

const jettons = getSupportedJettons();
```

**Returns:**
```typescript
Array<{
  symbol: string;
  name: string;
  decimals: number;
  address: string | null;
}>
```

## Usage Examples

### Basic Balance Check

```typescript
import { connectRedis } from './services/redisService';
import { getWalletBalance } from './services/walletService';

// Connect to Redis
await connectRedis();

// Get balance
const balance = await getWalletBalance('EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2');

console.log(`TON Balance: ${balance.ton}`);
balance.jettons.forEach(jetton => {
  console.log(`${jetton.symbol}: ${jetton.balance}`);
});
```

### Check Specific Jetton

```typescript
const usdtBalance = await getJettonBalanceBySymbol(
  walletAddress,
  'USDT'
);

console.log(`USDT Balance: ${usdtBalance.balance}`);
```

### Get Order History

```typescript
const { open, closed } = await getWalletOrders(walletAddress);

console.log(`Open Orders: ${open.length}`);
console.log(`Order History: ${closed.length}`);

// Show recent closed orders
closed.slice(0, 5).forEach(order => {
  console.log(`${order.orderId}: ${order.status} - ${order.amount}`);
});
```

### Dashboard Data

```typescript
// Get all data for a wallet dashboard
const [balance, { open, closed }, stats] = await Promise.all([
  getWalletBalance(walletAddress),
  getWalletOrders(walletAddress),
  getWalletStats(walletAddress)
]);

console.log('Wallet Dashboard:');
console.log(`TON: ${balance.ton}`);
console.log(`Open Orders: ${open.length}`);
console.log(`Total Volume: ${stats.totalVolume}`);
console.log(`Total Trades: ${stats.totalTrades}`);
```

### Periodic Updates

```typescript
// Update wallet data every 5 minutes
setInterval(async () => {
  const { balance, stats } = await updateAllWalletData(walletAddress);

  console.log(`[${new Date().toISOString()}] Updated`);
  console.log(`TON: ${balance.ton}`);
  console.log(`Open Orders: ${stats.openOrders}`);
}, 300000); // 5 minutes
```

## Caching Strategy

### Cache Keys

```typescript
wallet:{address}:balance          // Full balance data
wallet:{address}:jetton:{symbol}  // Individual jetton balance
wallet:{address}:orders:open      // Open orders
wallet:{address}:orders:closed    // Closed orders
wallet:{address}:stats            // Statistics
```

### Cache Invalidation

Cache is automatically invalidated when:
- Using update methods (`updateWalletBalance`, `updateWalletStats`, etc.)
- TTL expires (default: 5 minutes)

Manual cache invalidation:

```typescript
import { deleteCached, CacheKeys } from './services/redisService';

// Clear specific cache
await deleteCached(CacheKeys.walletBalance(address));

// Clear all wallet caches
await deleteCachedByPattern(`wallet:${address}:*`);
```

### Performance

- **Cached requests**: < 10ms
- **Fresh requests**: 200-500ms (depending on network)
- **Recommended TTL**: 300 seconds (5 minutes) for balance data

## Best Practices

### 1. Use Caching for Frequent Reads

```typescript
// Good: Uses cache for repeated calls
const balance1 = await getWalletBalance(address); // Fresh fetch
const balance2 = await getWalletBalance(address); // Cache hit (fast)
```

### 2. Force Refresh on User Action

```typescript
// User clicks "Refresh" button
const freshBalance = await updateWalletBalance(address);
```

### 3. Handle Errors Gracefully

```typescript
try {
  const balance = await getWalletBalance(address);
} catch (error) {
  console.error('Failed to fetch balance:', error);
  // Fallback to cached data or show error to user
}
```

### 4. Batch Operations

```typescript
// Good: Parallel fetching
const [balance, orders, stats] = await Promise.all([
  getWalletBalance(address),
  getWalletOrders(address),
  getWalletStats(address)
]);

// Bad: Sequential fetching
const balance = await getWalletBalance(address);
const orders = await getWalletOrders(address);
const stats = await getWalletStats(address);
```

### 5. Monitor Cache Hit Rate

```typescript
import { existsInCache, CacheKeys } from './services/redisService';

const key = CacheKeys.walletBalance(address);
const isCached = await existsInCache(key);

console.log(`Cache ${isCached ? 'HIT' : 'MISS'}`);
```

## Troubleshooting

### Redis Connection Error

```
Error: Redis connection error: connect ECONNREFUSED
```

**Solution**: Ensure Redis is running:
```bash
docker-compose up -d redis
# or
docker ps | grep redis
```

### Missing Jetton Balances

Currently, jetton balance fetching returns mock data. To implement real jetton balances:

1. Query the jetton master contract for the user's jetton wallet address
2. Query the jetton wallet contract for the balance
3. Use TON SDK methods to parse the response

See `src/services/walletService.ts` for implementation details.

### Cache Not Working

Check Redis connection:
```bash
redis-cli ping
# Should return: PONG
```

Check cache TTL:
```typescript
import { getTTL, CacheKeys } from './services/redisService';

const ttl = await getTTL(CacheKeys.walletBalance(address));
console.log(`TTL: ${ttl} seconds`);
```

## Development

### Running Examples

```bash
# Run wallet service examples
npm run dev -- examples/wallet-service-usage.ts
```

### Testing

```bash
# Install dependencies
npm install

# Start services
docker-compose up -d

# Run tests
npm test
```

## Production Considerations

1. **API Keys**: Secure your Open4Dev and TON API keys
2. **Redis**: Use Redis Cluster or Redis Sentinel for high availability
3. **Monitoring**: Monitor cache hit rates and response times
4. **Rate Limiting**: Implement rate limiting for API calls
5. **Error Handling**: Implement circuit breakers for external API calls
6. **Jetton Addresses**: Update jetton contract addresses for mainnet

## Related Documentation

- [Open4Dev SDK Documentation](../src/sdk/README.md)
- [Redis Service](../src/services/redisService.ts)
- [Wallet Service](../src/services/walletService.ts)
