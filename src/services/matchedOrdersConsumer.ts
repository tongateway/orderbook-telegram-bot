/**
 * Matched Orders Consumer
 *
 * Consumes Redis stream 'matched_orders' and sends Telegram notifications
 * to users when their orders are swapped/matched.
 */

import type { Telegraf } from 'telegraf';
import { Address } from '@ton/core';
import { getRedisClient, getStreamClient, connectRedis } from './redisService';
import { prisma } from '../database/prisma';
import { getSwapNotificationMessage } from '../bot/messages/swapNotification';

const STREAM_NAME = 'matched_orders';
const CONSUMER_GROUP = 'telegram_notifications';
const CONSUMER_NAME = `consumer_${process.pid}`;

export interface MatchedOrderData {
  order_id: string;
  order_address: string;
  from_coin_id: string;
  to_coin_id: string;
  amount: string; // New order amount after swap
  price_rate: string;
  wallet_id: string;
  wallet_address: string; // Raw format
  vault_id: string;
  swap_amount: string;
  parsed_at: string;
  status: string; // New order status
}

/**
 * Parse Redis stream message fields into MatchedOrderData
 */
function parseStreamMessage(fields: string[]): MatchedOrderData {
  const data: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }

  // Stream only sends one coin ID (the non-TON one)
  // If from_coin_id is present, to_coin_id is TON (0) and vice versa
  const fromCoinId = data.from_coin_id || '0';
  const toCoinId = data.to_coin_id || '0';

  return {
    order_id: data.order_id || '',
    order_address: data.order_address || '',
    from_coin_id: fromCoinId,
    to_coin_id: toCoinId,
    amount: data.amount || '0',
    price_rate: data.price_rate || '0',
    wallet_id: data.wallet_id || '',
    wallet_address: data.wallet_address || '',
    vault_id: data.vault_id || '',
    swap_amount: data.swap_amount || '0',
    parsed_at: data.parsed_at || '',
    status: data.status || '',
  };
}

/**
 * Normalize TON address to raw format for comparison
 */
function normalizeAddress(address: string): string | null {
  try {
    return Address.parse(address).toRawString().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Find user by wallet address (supports both raw and friendly formats)
 */
async function findUserByWalletAddress(walletAddress: string) {
  // Try to find user with exact match first
  let user = await prisma.user.findFirst({
    where: { walletAddress },
  });

  if (!user) {
    // Try case-insensitive search as fallback
    user = await prisma.user.findFirst({
      where: {
        walletAddress: {
          mode: 'insensitive',
          equals: walletAddress,
        },
      },
    });
  }

  // If still not found, try normalizing the address to raw format
  if (!user) {
    const normalizedAddress = normalizeAddress(walletAddress);
    if (normalizedAddress) {
      user = await prisma.user.findFirst({
        where: {
          walletAddress: {
            mode: 'insensitive',
            equals: normalizedAddress,
          },
        },
      });
    }
  }

  return user;
}

/**
 * Process a single matched order message
 */
async function processMatchedOrder(
  bot: Telegraf,
  messageId: string,
  data: MatchedOrderData
): Promise<boolean> {
  try {
    console.log(`Processing matched order: ${data.order_id}`);

    // Find user by wallet address
    const user = await findUserByWalletAddress(data.wallet_address);

    if (!user) {
      console.log(`User not found for wallet: ${data.wallet_address}`);
      return true; // ACK the message even if user not found
    }

    // Send Telegram notification
    const message = await getSwapNotificationMessage(data);

    await bot.telegram.sendMessage(Number(user.telegramId), message.text, {
      parse_mode: 'HTML',
    });

    console.log(
      `Notification sent to user ${user.telegramId} for order ${data.order_id}`
    );
    return true;
  } catch (error) {
    console.error(`Error processing matched order ${data.order_id}:`, error);
    return false;
  }
}

/**
 * Create consumer group if it doesn't exist
 */
async function ensureConsumerGroup(): Promise<void> {
  const redis = getRedisClient();

  try {
    await redis.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '$', 'MKSTREAM');
    console.log(`Created consumer group '${CONSUMER_GROUP}' for stream '${STREAM_NAME}'`);
  } catch (error: any) {
    // BUSYGROUP error means group already exists - that's fine
    if (!error.message?.includes('BUSYGROUP')) {
      throw error;
    }
    console.log(`Consumer group '${CONSUMER_GROUP}' already exists`);
  }
}

// Counter for trim operations (trim every N batches to reduce Redis calls)
let processedBatches = 0;
const TRIM_EVERY_N_BATCHES = 10;
const MAX_STREAM_LENGTH = 1000;

/**
 * Main consumer loop
 * Uses dedicated stream client to avoid blocking cache operations
 */
async function consumeLoop(bot: Telegraf): Promise<void> {
  // Use dedicated stream client for blocking operations
  // This prevents BLOCK from stalling cache reads/writes on main client
  const streamRedis = getStreamClient();
  const mainRedis = getRedisClient(); // For non-blocking ops like xack

  while (true) {
    try {
      // Read messages from the stream with blocking (5 second timeout)
      // Using dedicated client so this doesn't block cache operations
      const result = await streamRedis.xreadgroup(
        'GROUP',
        CONSUMER_GROUP,
        CONSUMER_NAME,
        'COUNT',
        '10',
        'BLOCK',
        '5000',
        'STREAMS',
        STREAM_NAME,
        '>'
      );

      if (result && result.length > 0) {
        const [, messages] = result[0] as [string, [string, string[]][]];

        for (const [messageId, fields] of messages) {
          const data = parseStreamMessage(fields);
          const success = await processMatchedOrder(bot, messageId, data);

          if (success) {
            // Acknowledge the message (use main client for non-blocking ops)
            await mainRedis.xack(STREAM_NAME, CONSUMER_GROUP, messageId);
          }
        }

        // Auto-trim stream periodically to prevent unbounded growth
        processedBatches++;
        if (processedBatches >= TRIM_EVERY_N_BATCHES) {
          processedBatches = 0;
          try {
            await mainRedis.xtrim(STREAM_NAME, 'MAXLEN', '~', MAX_STREAM_LENGTH);
          } catch (trimError) {
            console.error('Error trimming stream:', trimError);
          }
        }
      }
    } catch (error) {
      console.error('Error in matched orders consumer loop:', error);
      // Wait before retrying on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Start the matched orders consumer
 */
export async function startMatchedOrdersConsumer(bot: Telegraf): Promise<void> {
  try {
    console.log('Starting matched orders consumer...');

    // Ensure Redis is connected
    await connectRedis();

    // Create consumer group
    await ensureConsumerGroup();

    // Note: We don't process pending messages on startup to avoid duplicate notifications
    // Old pending messages are considered stale and should be manually cleared if needed

    // Start consuming in background
    consumeLoop(bot).catch((error) => {
      console.error('Matched orders consumer crashed:', error);
    });

    console.log('Matched orders consumer started successfully');
  } catch (error) {
    console.error('Failed to start matched orders consumer:', error);
    throw error;
  }
}

/**
 * Process pending messages (messages that were read but not acknowledged)
 */
export async function processPendingMessages(bot: Telegraf): Promise<void> {
  const redis = getRedisClient();

  try {
    // Read pending messages for this consumer
    const pending = await redis.xpending(
      STREAM_NAME,
      CONSUMER_GROUP,
      '-',
      '+',
      '100',
      CONSUMER_NAME
    );

    if (!pending || pending.length === 0) {
      return;
    }

    console.log(`Found ${pending.length} pending messages to process`);

    // Claim and process pending messages
    for (const [messageId] of pending as [string, string, number, number][]) {
      const claimed = await redis.xclaim(
        STREAM_NAME,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        0,
        messageId
      );

      if (claimed && claimed.length > 0) {
        const [, fields] = claimed[0] as [string, string[]];
        const data = parseStreamMessage(fields);
        const success = await processMatchedOrder(bot, messageId, data);

        if (success) {
          await redis.xack(STREAM_NAME, CONSUMER_GROUP, messageId);
        }
      }
    }
  } catch (error) {
    console.error('Error processing pending messages:', error);
  }
}
