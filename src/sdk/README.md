# Open4Dev API SDK

TypeScript SDK for the Open4Dev API (https://api.open4dev.xyz)

## Features

- Full TypeScript support with type definitions
- Promise-based async/await API
- Comprehensive error handling
- Support for all Open4Dev API endpoints:
  - Coins
  - Orders
  - Vaults
- Built-in pagination and filtering
- Optional authentication via API key (works without auth)

## Installation

The SDK is already included in this project under `src/sdk/`.

## Configuration

The Open4Dev API works without authentication. API key is optional:

```env
# Optional - leave empty if you don't have an API key
OPEN4DEV_API_KEY=
OPEN4DEV_API_URL=https://api.open4dev.xyz/api/v1
```

## Quick Start

```typescript
import { createOpen4DevClient } from './sdk';
import { config } from './utils/config';

// Initialize the client (API key is optional)
const client = createOpen4DevClient({
  apiKey: config.open4devApiKey || undefined, // Optional
  baseUrl: config.open4devApiUrl
});

// Use the client
async function example() {
  // Get list of coins
  const coins = await client.coins.list({ limit: 10 });
  console.log(coins);

  // Get specific coin
  const coin = await client.coins.get('1');
  console.log(coin.name, coin.symbol);

  // Get orders with filters
  const orders = await client.orders.list({
    status: 'completed',
    from_coin_id: 1,
    to_coin_id: 2,
    limit: 20
  });
  console.log(orders);

  // Get vaults
  const vaults = await client.vaults.list();
  console.log(vaults);
}
```

## API Reference

### Client Initialization

```typescript
import { createOpen4DevClient } from './sdk';

// With API key (optional)
const client = createOpen4DevClient({
  apiKey: 'your-api-key', // Optional - can be omitted
  baseUrl: 'https://api.open4dev.xyz/api/v1', // optional
  timeout: 30000 // optional, in milliseconds
});

// Without API key (works fine)
const clientNoAuth = createOpen4DevClient({
  baseUrl: 'https://api.open4dev.xyz/api/v1'
});
```

### Coins API

#### List Coins

```typescript
const coins = await client.coins.list({
  offset: 0,
  limit: 10,
  sort: '-cnt_orders', // prefix with '-' for descending
  order: 'desc'
});
```

#### Get Coin by ID

```typescript
const coin = await client.coins.get('1');
```

#### Search Coins

```typescript
const btcCoins = await client.coins.search('BTC', 5);
```

### Orders API

#### List Orders

```typescript
const orders = await client.orders.list({
  offset: 0,
  limit: 20,
  sort: '-created_at',
  order: 'desc',
  from_coin_id: 1,
  to_coin_id: 2,
  status: 'completed',
  min_amount: 100,
  max_amount: 10000,
  min_price_rate: 0.5,
  max_price_rate: 1.5
});
```

#### Get Order by ID

```typescript
const order = await client.orders.get('order-123');
```

#### Get Orders by Status

```typescript
const pendingOrders = await client.orders.getByStatus('pending_match');
```

#### Get Orders by Trading Pair

```typescript
const pairOrders = await client.orders.getByTradingPair(1, 2, {
  status: 'deployed',
  sort: '-price_rate'
});
```

#### Get Active Orders

```typescript
const activeOrders = await client.orders.getActive({ limit: 100 });
```

#### Get Orders by Price Range

```typescript
const orders = await client.orders.getByPriceRange(0.9, 1.1);
```

#### Get Orders by Amount Range

```typescript
const largeOrders = await client.orders.getByAmountRange(1000, 10000);
```

### Vaults API

#### List Vaults

```typescript
const vaults = await client.vaults.list({
  offset: 0,
  limit: 10
});
```

#### Get Vault by ID

```typescript
const vault = await client.vaults.get('vault-123');
```

#### Get Vaults by Type

```typescript
const liquidityVaults = await client.vaults.getByType('liquidity');
```

#### Get Vaults by Factory ID

```typescript
const factoryVaults = await client.vaults.getByFactoryId('factory-123');
```

#### Get All Vaults

```typescript
const vaults = await client.vaults.getAll(10);
```

## Error Handling

The SDK provides custom error types for better error handling:

```typescript
import {
  ApiError,
  AuthenticationError,
  ValidationError,
  NotFoundError
} from './sdk';

try {
  const order = await client.orders.get('non-existent-id');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('Order not found');
  } else if (error instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (error instanceof ValidationError) {
    console.error('Invalid parameters');
  } else if (error instanceof ApiError) {
    console.error(`API error: ${error.message} (status: ${error.statusCode})`);
  }
}
```

## Types

All types are exported from the SDK:

```typescript
import {
  Coin,
  Order,
  OrderStatus,
  Vault,
  CoinsListParams,
  OrdersListParams,
  VaultsListParams
} from './sdk';
```

### Order Status Types

- `created` - Order has been created
- `deployed` - Order has been deployed to the blockchain
- `cancelled` - Order has been cancelled
- `completed` - Order has been fully executed
- `failed` - Order execution failed
- `pending_match` - Order is waiting to be matched

## Advanced Usage

### Custom Requests

For endpoints not yet covered by the SDK, you can use the underlying client:

```typescript
const client = createOpen4DevClient({ apiKey: 'your-key' });
const apiClient = client.getClient();

// Make custom GET request
const data = await apiClient.get('/custom-endpoint', {
  param1: 'value1'
});

// Make custom POST request
const result = await apiClient.post('/custom-endpoint', {
  data: 'value'
});
```

### Pagination

Handle large datasets with pagination:

```typescript
async function getAllCoins() {
  const allCoins = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const coins = await client.coins.list({ offset, limit });
    if (coins.length === 0) break;

    allCoins.push(...coins);
    offset += limit;
  }

  return allCoins;
}
```

## Integration Example

Example service using the SDK:

```typescript
// src/services/open4devService.ts
import { createOpen4DevClient } from '../sdk';
import { config } from '../utils/config';

const client = createOpen4DevClient({
  apiKey: config.open4devApiKey,
  baseUrl: config.open4devApiUrl
});

export async function getAvailableCoins() {
  return client.coins.list({
    limit: 100,
    sort: '-cnt_orders'
  });
}

export async function getOrderBookForPair(fromCoinId: number, toCoinId: number) {
  const orders = await client.orders.getByTradingPair(fromCoinId, toCoinId, {
    status: 'deployed',
    limit: 50
  });

  // Process orders into order book format
  return {
    bids: orders.filter(o => o.type === 'BUY'),
    asks: orders.filter(o => o.type === 'SELL')
  };
}

export async function getUserVaults(userAddress: string) {
  const vaults = await client.vaults.list();
  return vaults; // Filter by user address if needed
}
```

## License

MIT
