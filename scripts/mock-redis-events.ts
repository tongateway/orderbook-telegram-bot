/**
 * Mock Redis Events Script
 *
 * Pushes mock matched order events into Redis stream for local testing.
 * Usage: npx ts-node scripts/mock-redis-events.ts [options]
 *
 * Options:
 *   --count=N       Number of events to push (default: 1)
 *   --interval=N    Interval between events in ms (default: 1000)
 *   --wallet=ADDR   Specific wallet address to use
 *   --status=STATUS Order status (default: FILLED)
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const STREAM_NAME = 'matched_orders';

interface MockEventOptions {
  count: number;
  interval: number;
  walletAddress?: string;
  status: string;
}

function parseArgs(): MockEventOptions {
  const args = process.argv.slice(2);
  const options: MockEventOptions = {
    count: 1,
    interval: 1000,
    status: 'FILLED',
  };

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      options.count = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--interval=')) {
      options.interval = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--wallet=')) {
      options.walletAddress = arg.split('=')[1];
    } else if (arg.startsWith('--status=')) {
      options.status = arg.split('=')[1];
    }
  }

  return options;
}

function generateMockOrderId(): string {
  return `mock-order-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateMockAddress(): string {
  // Generate a mock TON-like address
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let address = 'EQ';
  for (let i = 0; i < 46; i++) {
    address += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return address;
}

function generateMockEvent(options: MockEventOptions, index: number) {
  const orderId = generateMockOrderId();
  const walletAddress = options.walletAddress || generateMockAddress();

  // Mock coin IDs (1 = TON-like, 2 = USDT-like)
  const fromCoinId = Math.random() > 0.5 ? '1' : '2';
  const toCoinId = fromCoinId === '1' ? '2' : '1';

  // Mock amounts
  const swapAmount = (Math.random() * 100 + 1).toFixed(6);
  const priceRate = (Math.random() * 5 + 0.1).toFixed(9);
  const amount = (parseFloat(swapAmount) * parseFloat(priceRate)).toFixed(6);

  return {
    order_id: orderId,
    order_address: generateMockAddress(),
    from_coin_id: fromCoinId,
    to_coin_id: toCoinId,
    amount,
    price_rate: priceRate,
    wallet_id: `wallet-${Math.random().toString(36).substring(7)}`,
    wallet_address: walletAddress,
    vault_id: `vault-${Math.random().toString(36).substring(7)}`,
    swap_amount: swapAmount,
    parsed_at: new Date().toISOString(),
    status: options.status,
  };
}

async function pushEvent(redis: Redis, event: Record<string, string>): Promise<string> {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(event)) {
    fields.push(key, value);
  }

  const messageId = await redis.xadd(STREAM_NAME, '*', ...fields);
  return messageId!;
}

async function main() {
  const options = parseArgs();

  console.log('Mock Redis Events Script');
  console.log('========================');
  console.log(`Stream: ${STREAM_NAME}`);
  console.log(`Events to push: ${options.count}`);
  console.log(`Interval: ${options.interval}ms`);
  console.log(`Status: ${options.status}`);
  if (options.walletAddress) {
    console.log(`Wallet: ${options.walletAddress}`);
  }
  console.log('');

  // Connect to Redis
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    console.log('Connected to Redis');
    console.log('');

    for (let i = 0; i < options.count; i++) {
      const event = generateMockEvent(options, i);
      const messageId = await pushEvent(redis, event);

      console.log(`[${i + 1}/${options.count}] Pushed event:`);
      console.log(`  Message ID: ${messageId}`);
      console.log(`  Order ID: ${event.order_id}`);
      console.log(`  Wallet: ${event.wallet_address}`);
      console.log(`  Swap: ${event.swap_amount} (coin ${event.from_coin_id} -> ${event.to_coin_id})`);
      console.log(`  Status: ${event.status}`);
      console.log('');

      if (i < options.count - 1) {
        await new Promise((resolve) => setTimeout(resolve, options.interval));
      }
    }

    console.log('Done! All events pushed successfully.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log('Disconnected from Redis');
  }
}

main();
