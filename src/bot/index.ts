import { Telegraf } from 'telegraf';
import { config } from '../utils/config';
import {
  handleStart,
  handleDisconnect,
  handleVaults,
  handleStats,
} from './commands';
import { setupCallbacks } from './callbacks';
import { handleTextMessage } from './messages';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  // Set bot commands (visible in Telegram menu)
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Main menu' },
    { command: 'stats', description: 'Order book statistics' },
    { command: 'vaults', description: 'Show vault addresses' },
    { command: 'disconnect', description: 'Disconnect wallet' },
  ]);

  // Command handlers
  bot.command('start', handleStart);
  bot.command('stats', handleStats);
  bot.command('vaults', handleVaults);
  bot.command('disconnect', handleDisconnect);

  // Setup callback handlers
  setupCallbacks(bot);

  // Text message handler
  bot.on('text', handleTextMessage);

  // Error handling
  bot.catch((err: any, ctx: any) => {
    // Check if it's a network timeout error
    const isNetworkError = err?.code === 'ETIMEDOUT' ||
                           err?.code === 'ECONNRESET' ||
                           err?.code === 'ENOTFOUND' ||
                           err?.type === 'system';

    if (isNetworkError) {
      console.error('Bot network error (non-fatal):', err?.code || err?.type, err?.message);
      // Don't try to reply on network errors - it might also fail
      return;
    }

    console.error('Bot error:', err);

    // Try to notify user, but don't crash if this also fails
    try {
      ctx.reply('An error occurred. Please try again or use /help.').catch(() => {
        // Silently ignore if reply fails
      });
    } catch {
      // Silently ignore
    }
  });

  return bot;
}
