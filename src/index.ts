// Polyfill EventSource for Node.js (required for TonConnect SSE bridge)
import { EventSource } from 'eventsource';
(global as unknown as { EventSource: typeof EventSource }).EventSource = EventSource;

import crypto from 'crypto';
import { createBot } from './bot';
import { connectDatabase, disconnectDatabase } from './database/prisma';
import { validateConfig, config } from './utils/config';
import { startMatchedOrdersConsumer } from './services/matchedOrdersConsumer';
import { disconnectRedis } from './services/redisService';
import { startPriceRefreshCron, stopPriceRefreshCron } from './services/priceCronService';
import { startMarketOrdersCron, stopMarketOrdersCron } from './services/marketOrdersCronService';

// Global error handlers to prevent crashes from unhandled errors
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  const isNetworkError = reason?.code === 'ETIMEDOUT' ||
                         reason?.code === 'ECONNRESET' ||
                         reason?.code === 'ENOTFOUND' ||
                         reason?.type === 'system';

  if (isNetworkError) {
    console.error('Unhandled network error (non-fatal):', reason?.code || reason?.type, reason?.message);
  } else {
    console.error('Unhandled promise rejection:', reason);
  }
});

process.on('uncaughtException', (err: Error) => {
  const isNetworkError = (err as any)?.code === 'ETIMEDOUT' ||
                         (err as any)?.code === 'ECONNRESET' ||
                         (err as any)?.code === 'ENOTFOUND';

  if (isNetworkError) {
    console.error('Uncaught network error (recovering):', (err as any)?.code, err.message);
  } else {
    console.error('Uncaught exception:', err);
    // For non-network errors, exit to allow restart
    process.exit(1);
  }
});

async function main() {
  try {
    console.log('Starting TON Order Book Trading Bot...');

    // Validate configuration
    validateConfig();
    console.log('Configuration validated');

    // Connect to database
    await connectDatabase();

    // Create bot
    const bot = createBot();
    console.log('Bot created successfully');

    // Start matched orders consumer for swap notifications (before bot.launch to ensure it starts)
    startMatchedOrdersConsumer(bot).catch((error) => {
      console.error('Failed to start matched orders consumer:', error);
    });

    // Start price cache CRON (refreshes prices every 30s)
    startPriceRefreshCron();

    // Start market orders cache CRON (refreshes orders every 25s)
    startMarketOrdersCron();

    // Check if webhook mode is configured
    const webhookDomain = config.webhookDomain;
    const webhookPort = config.webhookPort || 3000;

    if (webhookDomain) {
      // Webhook mode - use secret path from env or generate from token hash
      const webhookSecret = config.webhookSecret ||
        crypto.createHash('sha256').update(config.telegramBotToken).digest('hex').slice(0, 32);
      const webhookPath = `/webhook/${webhookSecret}`;

      console.log(`Starting bot in webhook mode on port ${webhookPort}...`);

      await bot.launch({
        webhook: {
          domain: webhookDomain,
          port: webhookPort,
          hookPath: webhookPath,
        },
      });

      console.log(`Bot launched with webhook on ${webhookDomain}`);
    } else {
      // Polling mode (fallback)
      console.log('Starting bot in polling mode...');
      bot.launch().then(() => {
        console.log('Bot launched successfully (polling mode)');
      }).catch((error) => {
        console.error('Bot launch error:', error);
      });
      console.log('Bot launch initiated');
    }

    // Enable graceful stop
    process.once('SIGINT', async () => {
      console.log('SIGINT signal received');
      bot.stop('SIGINT');
      stopPriceRefreshCron();
      stopMarketOrdersCron();
      await disconnectRedis();
      await disconnectDatabase();
    });

    process.once('SIGTERM', async () => {
      console.log('SIGTERM signal received');
      bot.stop('SIGTERM');
      stopPriceRefreshCron();
      stopMarketOrdersCron();
      await disconnectRedis();
      await disconnectDatabase();
    });
  } catch (error) {
    console.error('Failed to start bot:', error);
    try {
      await disconnectDatabase();
    } catch (disconnectError) {
      console.error('Error disconnecting database:', disconnectError);
    }
    process.exit(1);
  }
}

main();
