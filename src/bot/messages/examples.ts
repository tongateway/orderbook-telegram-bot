/**
 * Example usage of message templates with Telegraf bot
 *
 * These examples show how to integrate the message templates
 * with a real Telegram bot using Telegraf library.
 */

import { Context, Telegraf } from 'telegraf';
import {
  getWelcomeMessage,
  getWelcomeMessageWithWallet,
  getCreateOrderMessage,
  getMyOrdersMessage,
  getOrderBookMessage,
  type OrderFormData
} from './index';
import { getOrCreateUser } from '../../services/userService';
import { getOrdersByUserAddress, getCachedCoins, getOrderBookForPair } from '../../services/open4devService';
import type { Order } from './myOrders';

// Example: Initialize bot
const bot = new Telegraf('YOUR_BOT_TOKEN');

// ====================
// Example 1: /start command handler
// ====================
bot.command('start', async (ctx: Context) => {
  // Check if user has connected wallet (pseudo-code)
  const user = await getUser(ctx.from?.id);

  if (!user?.walletAddress) {
    // No wallet connected
    const message = getWelcomeMessage({
      username: ctx.from?.first_name
    });

    await ctx.reply(message.text, {
      reply_markup: message.keyboard
    });
  } else {
    // Wallet already connected
    const message = getWelcomeMessageWithWallet(
      {
        address: user.walletAddress,
        shortAddress: formatAddress(user.walletAddress)
      },
      { username: ctx.from?.first_name }
    );

    await ctx.reply(message.text, {
      reply_markup: message.keyboard
    });
  }
});

// ====================
// Example 2: Create Order flow
// ====================
bot.action('create_order', async (ctx: Context) => {
  // Initialize empty order form
  const formData: OrderFormData = {};

  const message = getCreateOrderMessage({
    formData,
    currentPrice: 2.45,
    availableBalance: {
      base: 100,
      quote: 500
    }
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// User selects BUY side
bot.action('order_side_buy', async (ctx: Context) => {
  // Get current form data from session/database
  const formData = await getOrderFormData(ctx.from?.id);
  formData.side = 'BUY';
  await saveOrderFormData(ctx.from?.id, formData);

  const message = getCreateOrderMessage({
    formData,
    currentPrice: 2.45,
    availableBalance: {
      base: 100,
      quote: 500
    }
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// User selects LIMIT type
bot.action('order_type_limit', async (ctx: Context) => {
  const formData = await getOrderFormData(ctx.from?.id);
  formData.type = 'LIMIT';
  await saveOrderFormData(ctx.from?.id, formData);

  const message = getCreateOrderMessage({
    formData,
    currentPrice: 2.45,
    availableBalance: {
      base: 100,
      quote: 500
    }
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// ====================
// Example 3: My Orders with pagination
// ====================
bot.action('list_orders', async (ctx: Context) => {
  const userId = ctx.from?.id;
  const orders = await getUserOrders(userId);

  const message = getMyOrdersMessage({
    orders,
    page: 1,
    itemsPerPage: 3
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// Handle pagination
bot.action(/orders_page_(\d+)/, async (ctx) => {
  const match = ctx.match;
  const page = parseInt(match[1], 10);

  const userId = ctx.from?.id;
  const orders = await getUserOrders(userId);

  const message = getMyOrdersMessage({
    orders,
    page,
    itemsPerPage: 3
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// ====================
// Example 4: Order Book
// ====================
bot.action('order_book', async (ctx: Context) => {
  const availablePairs = ['TON/USDT', 'TON/USDC', 'BTC/USDT'];

  // Show pair selection first
  const message = getOrderBookMessage({
    availablePairs
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// User selects a pair
bot.action(/orderbook_pair_(.+)/, async (ctx) => {
  const match = ctx.match;
  const pair = match[1];

  // Fetch order book data from API
  const orderBookData = await fetchOrderBook(pair);

  const message = getOrderBookMessage({
    orderBook: orderBookData,
    selectedPair: pair,
    depth: 5
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// Change order book depth
bot.action(/orderbook_depth_(\d+)/, async (ctx) => {
  const match = ctx.match;
  const depth = parseInt(match[1], 10);

  // Get current pair from session
  const pair = await getCurrentPair(ctx.from?.id);
  const orderBookData = await fetchOrderBook(pair);

  const message = getOrderBookMessage({
    orderBook: orderBookData,
    selectedPair: pair,
    depth
  });

  await ctx.editMessageText(message.text, {
    reply_markup: message.keyboard
  });
});

// ====================
// Helper functions (pseudo-code)
// ====================

async function getUser(telegramId?: number): Promise<{ walletAddress?: string } | null> {
  // Fetch user from database
  return null;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function getOrderFormData(telegramId?: number): Promise<OrderFormData> {
  // Fetch from session/database
  return {};
}

async function saveOrderFormData(telegramId: number | undefined, formData: OrderFormData) {
  // Save to session/database
}

async function getUserOrders(telegramId?: number): Promise<Order[]> {
  if (!telegramId) return [];

  // Get user to find their connected wallet address
  const user = await getOrCreateUser(telegramId);
  if (!user.walletAddress) return [];

  // Fetch orders from Open4Dev API filtered by wallet address
  const apiOrders = await getOrdersByUserAddress(user.walletAddress);

  // Map API orders to the Order format expected by getMyOrdersMessage
  return apiOrders.map((order) => ({
    id: order.id,
    pair: order.title || `${order.from_coin_id}/${order.to_coin_id}`,
    side: (order.type?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL') as Order['side'],
    type: 'LIMIT' as Order['type'],
    amount: order.amount || 0,
    filledAmount: 0,
    price: order.price_rate,
    status: mapApiStatusToOrderStatus(order.status),
    createdAt: order.created_at ? new Date(order.created_at) : new Date(),
  }));
}

function mapApiStatusToOrderStatus(apiStatus?: string): Order['status'] {
  switch (apiStatus) {
    case 'deployed':
    case 'pending_match':
      return 'OPEN';
    case 'completed':
      return 'FILLED';
    case 'cancelled':
    case 'failed':
      return 'CANCELLED';
    default:
      return 'OPEN';
  }
}

async function fetchOrderBook(pair: string) {
  // Parse the trading pair (e.g., "TON/USDT" -> ["TON", "USDT"])
  const [baseSymbol, quoteSymbol] = pair.split('/');
  if (!baseSymbol || !quoteSymbol) {
    return { pair, asks: [], bids: [], lastPrice: 0, priceChange24h: 0, volume24h: 0 };
  }

  // Get coin IDs from symbols
  const coins = await getCachedCoins();
  const baseCoin = coins.find(c => c.symbol?.toUpperCase() === baseSymbol.toUpperCase());
  const quoteCoin = coins.find(c => c.symbol?.toUpperCase() === quoteSymbol.toUpperCase());

  if (!baseCoin || !quoteCoin) {
    console.log(`[fetchOrderBook] Coins not found: base=${baseSymbol}, quote=${quoteSymbol}`);
    return { pair, asks: [], bids: [], lastPrice: 0, priceChange24h: 0, volume24h: 0 };
  }

  // Fetch order book from API
  const orderBook = await getOrderBookForPair(baseCoin.id, quoteCoin.id);

  // Transform orders to OrderBookEntry format
  const asks = orderBook.asks.map(order => ({
    price: order.price_rate || 0,
    amount: order.amount || 0,
  })).sort((a, b) => a.price - b.price); // Lowest price first for asks

  const bids = orderBook.bids.map(order => ({
    price: order.price_rate || 0,
    amount: order.amount || 0,
  })).sort((a, b) => b.price - a.price); // Highest price first for bids

  // Calculate last price from most recent trade or best bid/ask midpoint
  let lastPrice = 0;
  if (bids.length > 0 && asks.length > 0) {
    lastPrice = (bids[0].price + asks[0].price) / 2;
  } else if (bids.length > 0) {
    lastPrice = bids[0].price;
  } else if (asks.length > 0) {
    lastPrice = asks[0].price;
  }

  // Calculate 24h volume from completed orders
  const volume24h = [...orderBook.bids, ...orderBook.asks]
    .reduce((sum, order) => sum + (order.amount || 0), 0);

  return {
    pair,
    asks,
    bids,
    lastPrice,
    priceChange24h: 0, // Would need historical data to calculate
    volume24h,
  };
}

async function getCurrentPair(telegramId?: number): Promise<string> {
  // Get from session
  return 'TON/USDT';
}

// Start the bot
// bot.launch();
