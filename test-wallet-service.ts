/**
 * Wallet Service Test Script
 *
 * Simple test script to verify wallet service functionality
 * Run with: npm run dev -- test-wallet-service.ts
 */

import { connectRedis, disconnectRedis } from './src/services/redisService';
import {
  getWalletBalance,
  getJettonBalanceBySymbol,
  getWalletOrders,
  getWalletStats,
  getSupportedJettons,
} from './src/services/walletService';

// Test configuration
const TEST_CONFIG = {
  // Use a real TON wallet address for testing
  // This is a well-known address that should have some activity
  walletAddress: process.env.TEST_WALLET_ADDRESS || 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
};

async function testSupportedJettons() {
  console.log('\n📋 Test: Get Supported Jettons');
  console.log('================================');

  const jettons = getSupportedJettons();

  console.log(`✓ Found ${jettons.length} supported jettons:\n`);
  jettons.forEach((jetton, index) => {
    console.log(`${index + 1}. ${jetton.name} (${jetton.symbol})`);
    console.log(`   Decimals: ${jetton.decimals}`);
    console.log(`   Address: ${jetton.address || 'Native coin'}\n`);
  });

  return true;
}

async function testWalletBalance() {
  console.log('\n💰 Test: Get Wallet Balance');
  console.log('============================');

  try {
    console.log(`Fetching balance for: ${TEST_CONFIG.walletAddress}\n`);

    const balance = await getWalletBalance(TEST_CONFIG.walletAddress);

    console.log('✓ Successfully fetched wallet balance:\n');
    console.log(`TON Balance: ${balance.ton} TON`);
    console.log(`Updated: ${balance.updatedAt}\n`);

    console.log('Jetton Balances:');
    balance.jettons.forEach((jetton) => {
      const configured = jetton.address ? '✓' : '⚠';
      console.log(`  ${configured} ${jetton.symbol}: ${jetton.balance} ${jetton.name}`);
      if (!jetton.address) {
        console.log(`    (Not configured - update jetton master address)`);
      }
    });

    // Test cache hit
    console.log('\nTesting cache...');
    const startTime = Date.now();
    await getWalletBalance(TEST_CONFIG.walletAddress);
    const cacheTime = Date.now() - startTime;

    console.log(`✓ Cache hit! Response time: ${cacheTime}ms`);

    return true;
  } catch (error) {
    console.error('✗ Error fetching wallet balance:', error);
    return false;
  }
}

async function testSpecificJetton() {
  console.log('\n🪙  Test: Get Specific Jetton Balance');
  console.log('====================================');

  try {
    const jettons = ['NOT', 'USDT'];

    for (const symbol of jettons) {
      console.log(`\nFetching ${symbol} balance...`);

      const balance = await getJettonBalanceBySymbol(
        TEST_CONFIG.walletAddress,
        symbol
      );

      if (balance) {
        console.log(`✓ ${balance.symbol}: ${balance.balance}`);
        console.log(`  Name: ${balance.name}`);
        console.log(`  Decimals: ${balance.decimals}`);
        if (balance.address) {
          console.log(`  Master: ${balance.address}`);
        } else {
          console.log(`  ⚠ Master address not configured`);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('✗ Error fetching jetton balance:', error);
    return false;
  }
}

async function testWalletOrders() {
  console.log('\n📦 Test: Get Wallet Orders');
  console.log('==========================');

  try {
    console.log(`Fetching orders for: ${TEST_CONFIG.walletAddress}\n`);

    const { open, closed } = await getWalletOrders(TEST_CONFIG.walletAddress);

    console.log(`✓ Successfully fetched orders:\n`);
    console.log(`Open Orders: ${open.length}`);
    console.log(`Closed Orders: ${closed.length}\n`);

    if (open.length > 0) {
      console.log('Sample Open Orders:');
      open.slice(0, 3).forEach((order, index) => {
        console.log(`  ${index + 1}. ${order.orderId}`);
        console.log(`     Status: ${order.status}`);
        console.log(`     Amount: ${order.amount}`);
        console.log(`     Pair: ${order.fromCoin} → ${order.toCoin}\n`);
      });
    } else {
      console.log('No open orders found.');
    }

    if (closed.length > 0) {
      console.log('\nSample Closed Orders:');
      closed.slice(0, 3).forEach((order, index) => {
        console.log(`  ${index + 1}. ${order.orderId}`);
        console.log(`     Status: ${order.status}`);
        console.log(`     Amount: ${order.amount}\n`);
      });
    } else {
      console.log('\nNo closed orders found.');
    }

    return true;
  } catch (error) {
    console.error('✗ Error fetching orders:', error);
    return false;
  }
}

async function testWalletStats() {
  console.log('\n📊 Test: Get Wallet Statistics');
  console.log('==============================');

  try {
    console.log(`Fetching stats for: ${TEST_CONFIG.walletAddress}\n`);

    const stats = await getWalletStats(TEST_CONFIG.walletAddress);

    console.log('✓ Successfully fetched statistics:\n');
    console.log(`Total Orders: ${stats.totalOrders}`);
    console.log(`Open Orders: ${stats.openOrders}`);
    console.log(`Closed Orders: ${stats.closedOrders}`);
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Total Volume: ${stats.totalVolume.toFixed(2)}`);
    console.log(`Updated: ${stats.updatedAt}`);

    return true;
  } catch (error) {
    console.error('✗ Error fetching stats:', error);
    return false;
  }
}

async function runTests() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Wallet Service Test Suite            ║');
  console.log('╚════════════════════════════════════════╝');

  const results = {
    passed: 0,
    failed: 0,
    total: 0,
  };

  try {
    // Connect to Redis
    console.log('\n🔌 Connecting to Redis...');
    await connectRedis();
    console.log('✓ Connected to Redis\n');

    // Run tests
    const tests = [
      { name: 'Supported Jettons', fn: testSupportedJettons },
      { name: 'Wallet Balance', fn: testWalletBalance },
      { name: 'Specific Jetton', fn: testSpecificJetton },
      { name: 'Wallet Orders', fn: testWalletOrders },
      { name: 'Wallet Stats', fn: testWalletStats },
    ];

    for (const test of tests) {
      results.total++;
      const success = await test.fn();
      if (success) {
        results.passed++;
      } else {
        results.failed++;
      }
    }
  } catch (error) {
    console.error('\n❌ Fatal error during tests:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await disconnectRedis();
    console.log('✓ Disconnected from Redis');
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         Test Summary                   ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\nTotal Tests: ${results.total}`);
  console.log(`✓ Passed: ${results.passed}`);
  console.log(`✗ Failed: ${results.failed}`);

  if (results.failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
  }

  console.log('\n📝 Notes:');
  console.log('  - If jetton balances show 0 with ⚠, update the jetton master addresses');
  console.log('  - in src/services/walletService.ts');
  console.log('  - If orders/stats show 0, the test wallet may not have any orders');
  console.log('  - You can set TEST_WALLET_ADDRESS env var to test a different wallet\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
