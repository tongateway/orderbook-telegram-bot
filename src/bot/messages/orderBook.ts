/**
 * Order Book message template
 * Shows classic order book view with pair selection
 */

export interface OrderBookEntry {
  price: number;
  amount: number;
  total?: number;
}

export interface OrderBookData {
  pair: string;
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  lastPrice?: number;
  priceChange24h?: number;
  volume24h?: number;
  liquidityDepth?: number;
}

export interface OrderBookMessageOptions {
  orderBook?: OrderBookData;
  availablePairs?: string[];
  selectedPair?: string;
  depth?: number;
}

/**
 * Get order book message
 * @param depth - Number of price levels to show (default: 5)
 */
export function getOrderBookMessage(options: OrderBookMessageOptions) {
  const { orderBook, availablePairs, selectedPair, depth = 5 } = options;

  // If no pair selected, show pair selection
  if (!selectedPair || !orderBook) {
    return getPairSelectionMessage(availablePairs || []);
  }

  // Parse BASE/QUOTE from pair
  const [base, quote] = orderBook.pair.split('/');

  // Build order book display with new format
  let text = `📊 Market Depth — ${base}/${quote}\n\n`;

  // Sell Orders (Asks) - display from lowest to highest
  text += 'Sell Orders (Asks)\n';
  const displayAsks = orderBook.asks.slice(0, depth).reverse();
  if (displayAsks.length === 0) {
    text += 'No sell orders\n';
  } else {
    displayAsks.forEach(ask => {
      text += formatOrderBookEntry(ask);
    });
  }

  text += '\n';

  // Buy Orders (Bids) - display from highest to lowest
  text += 'Buy Orders (Bids)\n';
  const displayBids = orderBook.bids.slice(0, depth);
  if (displayBids.length === 0) {
    text += 'No buy orders\n';
  } else {
    displayBids.forEach(bid => {
      text += formatOrderBookEntry(bid);
    });
  }

  text += '\n';

  // Metrics section
  text += 'Metrics\n';

  // Spread calculation
  if (orderBook.asks.length > 0 && orderBook.bids.length > 0) {
    const bestAsk = orderBook.asks[0].price;
    const bestBid = orderBook.bids[0].price;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestAsk * 100).toFixed(2);
    text += `• Spread: ${spread.toFixed(4)} (${spreadPercent}%)\n`;
  } else {
    text += '• Spread: —\n';
  }

  // Last Trade
  if (orderBook.lastPrice) {
    text += `• Last Trade: ${orderBook.lastPrice.toFixed(4)}\n`;
  } else {
    text += '• Last Trade: —\n';
  }

  // 24h Volume
  if (orderBook.volume24h) {
    text += `• 24h Volume: ${formatVolume(orderBook.volume24h)}\n`;
  } else {
    text += '• 24h Volume: —\n';
  }

  // Liquidity Depth
  if (orderBook.liquidityDepth) {
    text += `• Liquidity Depth: ${formatVolume(orderBook.liquidityDepth)}`;
  } else {
    text += '• Liquidity Depth: —';
  }

  // Build keyboard
  const keyboard: any[][] = [];

  // Quick action buttons
  keyboard.push([
    { text: '📈 Quick Buy', callback_data: `quick_buy_${selectedPair}` },
    { text: '📉 Quick Sell', callback_data: `quick_sell_${selectedPair}` }
  ]);

  // Pair and refresh buttons
  keyboard.push([
    { text: '🔀 Change Pair', callback_data: 'orderbook_select_pair' },
    { text: '🔄 Refresh', callback_data: `orderbook_refresh_${selectedPair}` }
  ]);

  // Depth options
  keyboard.push([
    { text: depth === 5 ? '• 5 •' : '5', callback_data: 'orderbook_depth_5' },
    { text: depth === 10 ? '• 10 •' : '10', callback_data: 'orderbook_depth_10' },
    { text: depth === 20 ? '• 20 •' : '20', callback_data: 'orderbook_depth_20' }
  ]);

  // Navigation
  keyboard.push([
    { text: '🏠 Main Menu', callback_data: 'main_menu' }
  ]);

  return {
    text,
    keyboard: {
      inline_keyboard: keyboard
    }
  };
}

/**
 * Format individual order book entry
 */
function formatOrderBookEntry(entry: OrderBookEntry): string {
  const priceStr = entry.price.toFixed(4).padEnd(11);
  const amountStr = entry.amount.toFixed(2);
  return `${priceStr} | ${amountStr}\n`;
}

/**
 * Format volume for display
 */
function formatVolume(volume: number): string {
  if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(2)}M`;
  } else if (volume >= 1000) {
    return `${(volume / 1000).toFixed(2)}K`;
  } else {
    return volume.toFixed(2);
  }
}

/**
 * Pair selection message
 */
function getPairSelectionMessage(availablePairs: string[]) {
  let text = '🔀 Select Trading Pair\n\n';

  if (availablePairs.length === 0) {
    text += 'No trading pairs available at the moment.';
  } else {
    text += 'Choose a pair to view the order book:';
  }

  // Build keyboard with pairs
  const keyboard: any[][] = [];

  // Add pairs in rows of 2
  for (let i = 0; i < availablePairs.length; i += 2) {
    const row = [];
    row.push({
      text: availablePairs[i],
      callback_data: `orderbook_pair_${availablePairs[i]}`
    });

    if (i + 1 < availablePairs.length) {
      row.push({
        text: availablePairs[i + 1],
        callback_data: `orderbook_pair_${availablePairs[i + 1]}`
      });
    }

    keyboard.push(row);
  }

  // Add navigation
  keyboard.push([
    { text: '🏠 Main Menu', callback_data: 'main_menu' }
  ]);

  return {
    text,
    keyboard: {
      inline_keyboard: keyboard
    }
  };
}

/**
 * Get market summary for a trading pair
 */
export function getMarketSummaryMessage(orderBook: OrderBookData) {
  const changeEmoji = (orderBook.priceChange24h || 0) >= 0 ? '📈' : '📉';
  const changeColor = (orderBook.priceChange24h || 0) >= 0 ? '🟢' : '🔴';

  let text = `📊 Market Summary: ${orderBook.pair}\n\n`;
  text += '━━━━━━━━━━━━━━━━━━━━\n';

  if (orderBook.lastPrice) {
    text += `Last Price: ${orderBook.lastPrice.toFixed(4)}\n`;
  }

  if (orderBook.priceChange24h !== undefined) {
    text += `24h Change: ${changeColor} ${orderBook.priceChange24h >= 0 ? '+' : ''}${orderBook.priceChange24h.toFixed(2)}% ${changeEmoji}\n`;
  }

  if (orderBook.volume24h) {
    text += `24h Volume: ${formatVolume(orderBook.volume24h)}\n`;
  }

  // Best bid/ask
  if (orderBook.bids.length > 0) {
    text += `\nBest Bid: ${orderBook.bids[0].price.toFixed(4)}\n`;
  }

  if (orderBook.asks.length > 0) {
    text += `Best Ask: ${orderBook.asks[0].price.toFixed(4)}\n`;
  }

  // Spread
  if (orderBook.asks.length > 0 && orderBook.bids.length > 0) {
    const spread = orderBook.asks[0].price - orderBook.bids[0].price;
    const spreadPercent = (spread / orderBook.asks[0].price * 100).toFixed(2);
    text += `Spread: ${spread.toFixed(4)} (${spreadPercent}%)\n`;
  }

  text += '━━━━━━━━━━━━━━━━━━━━';

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '📖 View Order Book', callback_data: `orderbook_pair_${orderBook.pair}` },
          { text: '📊 Trade', callback_data: 'create_order' }
        ],
        [
          { text: '🏠 Main Menu', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}
