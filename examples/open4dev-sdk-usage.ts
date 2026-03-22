/**
 * Open4Dev SDK Usage Examples
 *
 * This file demonstrates how to use the Open4Dev SDK in your application
 */

import { createOpen4DevClient } from '../src/sdk';
import {
  getAvailableCoins,
  getOrderBookForPair,
  getMarketStats,
  getAllVaults,
} from '../src/services/open4devService';

// Example 1: Direct SDK usage
async function directSdkExample() {
  console.log('\n=== Direct SDK Usage Example ===\n');

  // Initialize the client
  const client = createOpen4DevClient({
    apiKey: process.env.OPEN4DEV_API_KEY || '',
  });

  try {
    // Get list of coins
    console.log('Fetching coins...');
    const coins = await client.coins.list({ limit: 5 });
    console.log(`Found ${coins.length} coins:`);
    coins.forEach((coin) => {
      console.log(`  - ${coin.name} (${coin.symbol})`);
    });

    // Get a specific coin
    if (coins.length > 0) {
      console.log('\nFetching first coin details...');
      const firstCoin = await client.coins.get(coins[0].id);
      console.log(`Coin: ${firstCoin.name} (${firstCoin.symbol})`);
      console.log(`Orders count: ${firstCoin.cnt_orders}`);
    }

    // Get orders
    console.log('\nFetching orders...');
    const orders = await client.orders.list({
      limit: 5,
      sort: '-created_at',
    });
    console.log(`Found ${orders.length} orders:`);
    orders.forEach((order) => {
      console.log(
        `  - Order ${order.id}: ${order.status} | Amount: ${order.amount} | Price: ${order.price_rate}`
      );
    });

    // Get vaults
    console.log('\nFetching vaults...');
    const vaults = await client.vaults.list({ limit: 5 });
    console.log(`Found ${vaults.length} vaults:`);
    vaults.forEach((vault) => {
      console.log(`  - Vault ${vault.id}: Type ${vault.type}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: Service layer usage (recommended)
async function servicLayerExample() {
  console.log('\n=== Service Layer Usage Example ===\n');

  try {
    // Get available coins using the service
    console.log('Getting available coins...');
    const coins = await getAvailableCoins(10);
    console.log(`Found ${coins.length} coins`);

    if (coins.length >= 2) {
      const fromCoin = coins[0];
      const toCoin = coins[1];

      console.log(`\nGetting order book for ${fromCoin.symbol}/${toCoin.symbol}...`);
      const orderBook = await getOrderBookForPair(fromCoin.id, toCoin.id);
      console.log(`Bids: ${orderBook.bids.length}, Asks: ${orderBook.asks.length}`);

      console.log(`\nGetting market stats for ${fromCoin.symbol}/${toCoin.symbol}...`);
      const stats = await getMarketStats(fromCoin.id, toCoin.id);
      console.log('Market Statistics:');
      console.log(`  Total Orders: ${stats.totalOrders}`);
      console.log(`  Completed Orders: ${stats.completedOrders}`);
      console.log(`  Active Orders: ${stats.activeOrders}`);
      console.log(`  Average Price: ${stats.averagePrice.toFixed(4)}`);
      console.log(`  Total Volume: ${stats.totalVolume.toFixed(2)}`);
    }

    // Get vaults
    console.log('\nGetting vaults...');
    const vaults = await getAllVaults(5);
    console.log(`Found ${vaults.length} vaults`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 3: Error handling
async function errorHandlingExample() {
  console.log('\n=== Error Handling Example ===\n');

  const client = createOpen4DevClient({
    apiKey: process.env.OPEN4DEV_API_KEY || '',
  });

  try {
    // Try to get a non-existent order
    await client.orders.get('non-existent-order-id');
  } catch (error: any) {
    console.log('Caught error:', error.name);
    console.log('Error message:', error.message);
    if (error.statusCode) {
      console.log('Status code:', error.statusCode);
    }
  }
}

// Example 4: Pagination
async function paginationExample() {
  console.log('\n=== Pagination Example ===\n');

  const client = createOpen4DevClient({
    apiKey: process.env.OPEN4DEV_API_KEY || '',
  });

  try {
    const limit = 10;
    let offset = 0;
    let page = 1;

    while (true) {
      console.log(`\nFetching page ${page}...`);
      const orders = await client.orders.list({ offset, limit });

      if (orders.length === 0) {
        console.log('No more orders found');
        break;
      }

      console.log(`Page ${page}: ${orders.length} orders`);
      orders.forEach((order, index) => {
        console.log(`  ${offset + index + 1}. Order ${order.id} - ${order.status}`);
      });

      offset += limit;
      page++;

      // Stop after 3 pages for demo purposes
      if (page > 3) {
        console.log('\nStopping after 3 pages...');
        break;
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 5: Filtering and sorting
async function filteringExample() {
  console.log('\n=== Filtering and Sorting Example ===\n');

  const client = createOpen4DevClient({
    apiKey: process.env.OPEN4DEV_API_KEY || '',
  });

  try {
    // Get completed orders sorted by creation date
    console.log('Getting completed orders...');
    const completedOrders = await client.orders.getByStatus('completed', 10);
    console.log(`Found ${completedOrders.length} completed orders`);

    // Get orders within a price range
    console.log('\nGetting orders within price range 0.5-1.5...');
    const priceRangeOrders = await client.orders.getByPriceRange(0.5, 1.5, {
      limit: 10,
    });
    console.log(`Found ${priceRangeOrders.length} orders in price range`);

    // Get orders within an amount range
    console.log('\nGetting large orders (amount > 100)...');
    const largeOrders = await client.orders.getByAmountRange(100, 999999, {
      limit: 10,
    });
    console.log(`Found ${largeOrders.length} large orders`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Main function to run all examples
async function main() {
  console.log('Open4Dev SDK Usage Examples');
  console.log('============================');

  if (!process.env.OPEN4DEV_API_KEY) {
    console.error('\nError: OPEN4DEV_API_KEY environment variable is not set');
    console.error('Please add it to your .env file');
    process.exit(1);
  }

  // Run examples
  await directSdkExample();
  await servicLayerExample();
  await errorHandlingExample();
  await paginationExample();
  await filteringExample();

  console.log('\n✓ All examples completed!');
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export {
  directSdkExample,
  servicLayerExample,
  errorHandlingExample,
  paginationExample,
  filteringExample,
};
