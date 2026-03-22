/**
 * Wallet Service Usage Examples
 *
 * Demonstrates how to use the wallet service with Redis caching
 */

import { connectRedis, disconnectRedis } from '../src/services/redisService';
import {
  getWalletBalance,
  getJettonBalanceBySymbol,
  updateWalletBalance,
  getWalletOrders,
  getWalletStats,
  updateWalletStats,
  updateAllWalletData,
  getSupportedJettons,
} from '../src/services/walletService';

// Example wallet address (replace with actual address)
const EXAMPLE_WALLET_ADDRESS = 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2';

// Example 1: Get wallet balance with all jettons
async function getBalanceExample() {
  console.log('\n=== Get Wallet Balance Example ===\n');

  try {
    console.log(`Fetching balance for wallet: ${EXAMPLE_WALLET_ADDRESS}`);

    const balance = await getWalletBalance(EXAMPLE_WALLET_ADDRESS);

    console.log('\nWallet Balance:');
    console.log(`Address: ${balance.address}`);
    console.log(`TON: ${balance.ton} TON`);
    console.log(`Updated: ${balance.updatedAt}`);

    console.log('\nJetton Balances:');
    balance.jettons.forEach((jetton) => {
      console.log(`  ${jetton.symbol} (${jetton.name}): ${jetton.balance}`);
    });

    // Second call will use cache
    console.log('\nFetching again (should use cache)...');
    const cachedBalance = await getWalletBalance(EXAMPLE_WALLET_ADDRESS);
    console.log('Cache hit! Same data returned instantly.');
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: Get specific jetton balance
async function getJettonExample() {
  console.log('\n=== Get Specific Jetton Balance Example ===\n');

  try {
    const jettons = ['NOT', 'BUILD', 'USDT', 'USDC'];

    for (const symbol of jettons) {
      console.log(`\nFetching ${symbol} balance...`);
      const balance = await getJettonBalanceBySymbol(EXAMPLE_WALLET_ADDRESS, symbol);

      if (balance) {
        console.log(`${balance.symbol}: ${balance.balance} (${balance.name})`);
        console.log(`Decimals: ${balance.decimals}`);
        if (balance.address) {
          console.log(`Contract: ${balance.address}`);
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 3: Get wallet orders
async function getOrdersExample() {
  console.log('\n=== Get Wallet Orders Example ===\n');

  try {
    console.log(`Fetching orders for wallet: ${EXAMPLE_WALLET_ADDRESS}`);

    const { open, closed } = await getWalletOrders(EXAMPLE_WALLET_ADDRESS);

    console.log(`\nOpen Orders: ${open.length}`);
    open.forEach((order, index) => {
      console.log(`  ${index + 1}. ${order.orderId}`);
      console.log(`     Status: ${order.status}`);
      console.log(`     Type: ${order.type}`);
      console.log(`     Amount: ${order.amount}`);
      console.log(`     Pair: ${order.fromCoin} -> ${order.toCoin}`);
      if (order.priceRate) {
        console.log(`     Price: ${order.priceRate}`);
      }
    });

    console.log(`\nClosed Orders: ${closed.length}`);
    closed.slice(0, 5).forEach((order, index) => {
      console.log(`  ${index + 1}. ${order.orderId}`);
      console.log(`     Status: ${order.status}`);
      console.log(`     Amount: ${order.amount}`);
      console.log(`     Created: ${order.createdAt}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 4: Get wallet statistics
async function getStatsExample() {
  console.log('\n=== Get Wallet Statistics Example ===\n');

  try {
    console.log(`Fetching stats for wallet: ${EXAMPLE_WALLET_ADDRESS}`);

    const stats = await getWalletStats(EXAMPLE_WALLET_ADDRESS);

    console.log('\nWallet Statistics:');
    console.log(`Total Orders: ${stats.totalOrders}`);
    console.log(`Open Orders: ${stats.openOrders}`);
    console.log(`Closed Orders: ${stats.closedOrders}`);
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Total Volume: ${stats.totalVolume.toFixed(2)}`);
    console.log(`Updated: ${stats.updatedAt}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 5: Update wallet balance (force refresh)
async function updateBalanceExample() {
  console.log('\n=== Update Wallet Balance Example ===\n');

  try {
    console.log('Getting current balance...');
    const oldBalance = await getWalletBalance(EXAMPLE_WALLET_ADDRESS);
    console.log(`Current TON balance: ${oldBalance.ton}`);

    console.log('\nForcing balance update...');
    const newBalance = await updateWalletBalance(EXAMPLE_WALLET_ADDRESS);
    console.log(`Updated TON balance: ${newBalance.ton}`);
    console.log(`Updated at: ${newBalance.updatedAt}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 6: Update all wallet data
async function updateAllDataExample() {
  console.log('\n=== Update All Wallet Data Example ===\n');

  try {
    console.log('Updating all wallet data (balance, orders, stats)...');

    const { balance, orders, stats } = await updateAllWalletData(EXAMPLE_WALLET_ADDRESS);

    console.log('\nUpdated Balance:');
    console.log(`TON: ${balance.ton}`);
    console.log(`Jettons: ${balance.jettons.length}`);

    console.log('\nUpdated Orders:');
    console.log(`Open: ${orders.open.length}`);
    console.log(`Closed: ${orders.closed.length}`);

    console.log('\nUpdated Stats:');
    console.log(`Total Orders: ${stats.totalOrders}`);
    console.log(`Total Volume: ${stats.totalVolume.toFixed(2)}`);

    console.log('\n✓ All data updated successfully!');
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 7: Get supported jettons
async function getSupportedJettonsExample() {
  console.log('\n=== Supported Jettons Example ===\n');

  const jettons = getSupportedJettons();

  console.log('Supported Jettons:');
  jettons.forEach((jetton, index) => {
    console.log(`\n${index + 1}. ${jetton.name} (${jetton.symbol})`);
    console.log(`   Decimals: ${jetton.decimals}`);
    if (jetton.address) {
      console.log(`   Address: ${jetton.address}`);
    } else {
      console.log(`   (Native coin)`);
    }
  });
}

// Example 8: Periodic balance update
async function periodicUpdateExample() {
  console.log('\n=== Periodic Update Example ===\n');

  console.log('Starting periodic balance updates (every 30 seconds)...');
  console.log('Press Ctrl+C to stop\n');

  let updateCount = 0;

  const interval = setInterval(async () => {
    try {
      updateCount++;
      console.log(`\n[Update ${updateCount}] ${new Date().toISOString()}`);

      const balance = await updateWalletBalance(EXAMPLE_WALLET_ADDRESS);
      console.log(`TON Balance: ${balance.ton}`);

      const stats = await updateWalletStats(EXAMPLE_WALLET_ADDRESS);
      console.log(`Open Orders: ${stats.openOrders}`);
      console.log(`Total Volume: ${stats.totalVolume.toFixed(2)}`);

      // Stop after 3 updates for demo
      if (updateCount >= 3) {
        console.log('\n✓ Demo complete. Stopping periodic updates.');
        clearInterval(interval);
        await cleanup();
      }
    } catch (error) {
      console.error('Error during update:', error);
    }
  }, 30000); // 30 seconds

  // Keep the process running
  process.on('SIGINT', async () => {
    console.log('\n\nStopping periodic updates...');
    clearInterval(interval);
    await cleanup();
  });
}

// Cleanup function
async function cleanup() {
  console.log('\nCleaning up...');
  await disconnectRedis();
  console.log('Disconnected from Redis');
  process.exit(0);
}

// Main function
async function main() {
  console.log('Wallet Service Usage Examples');
  console.log('==============================');

  try {
    // Connect to Redis
    console.log('\nConnecting to Redis...');
    await connectRedis();
    console.log('✓ Connected to Redis');

    // Run examples
    await getSupportedJettonsExample();
    await getBalanceExample();
    await getJettonExample();
    await getOrdersExample();
    await getStatsExample();
    await updateBalanceExample();
    await updateAllDataExample();

    // Uncomment to run periodic update example
    // await periodicUpdateExample();

    console.log('\n✓ All examples completed!');
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    // Cleanup
    await cleanup();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export {
  getBalanceExample,
  getJettonExample,
  getOrdersExample,
  getStatsExample,
  updateBalanceExample,
  updateAllDataExample,
  getSupportedJettonsExample,
  periodicUpdateExample,
};
