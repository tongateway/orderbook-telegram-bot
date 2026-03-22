import { Context, Markup } from 'telegraf';
import { getOrCreateUser, disconnectUserWallet, updateUserWallet } from '../services/userService';
import { closeOrder } from '../services/orderCreationService';
import { getOrdersForPairBySymbol, getAvailableCoins } from '../services/open4devService';
import { getPairStats, formatVolume } from '../services/marketStatsService';
import { getWalletBalance } from '../services/walletService';
import { getCached, setCached, CacheKeys } from '../services/redisService';
import { getCachedMarketOrders, MarketOrdersData } from '../services/marketOrdersCronService';
import { UserState, OrderSide, OrderType } from '../types';
import {
  handleTrade,
  handleOrders,
  handleHistory,
  handleHelp,
  showMainMenu,
  handleStart,
  handleAbout,
} from './commands';
import {
  generateWalletConnection,
  generateQRCodeBuffer,
  disconnectWallet,
  isWalletConnected,
  getWalletAddress,
  warmupConnection,
} from '../services/tonConnectService';
import { updateSession, getSession } from './sessionManager';
import { formatUsd, formatShortAddress } from '../utils/formatters';
import { AVAILABLE_TOKENS, getStatusEmoji } from '../constants/tokens';
import { showConnectedWalletMenu, buildTokenButtons, extractMessageId, replyOrEdit, requireWallet } from './helpers';

export async function handleConnectWallet(ctx: Context) {
  await ctx.answerCbQuery('Select your wallet');
  await ctx.editMessageText(
    'Select your wallet:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Tonkeeper', 'wallet_tonkeeper')],
      [Markup.button.callback('MyTonWallet', 'wallet_mytonwallet')],
      [Markup.button.callback('Telegram Wallet', 'wallet_telegram')],
    ])
  );
}

export async function handleDisconnectWallet(ctx: Context) {
  await ctx.answerCbQuery('Confirm disconnect');
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId);

  if (!user.walletAddress) {
    await ctx.editMessageText(
      'No wallet is currently connected.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Connect Wallet', 'connect_wallet')],
      ])
    );
    return;
  }

  // Show confirmation dialog
  const shortAddress = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
  await ctx.editMessageText(
    `Are you sure you want to disconnect wallet ${shortAddress}?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, Disconnect', 'confirm_disconnect_wallet')],
      [Markup.button.callback('Cancel', 'main_menu')],
    ])
  );
}

export async function handleConfirmDisconnectWallet(ctx: Context) {
  await ctx.answerCbQuery('Wallet disconnected');
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await getOrCreateUser(telegramId);

  if (!user.walletAddress) {
    await ctx.editMessageText(
      'No wallet is currently connected.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Connect Wallet', 'connect_wallet')],
      ])
    );
    return;
  }

  // Disconnect from TonConnect
  try {
    await disconnectWallet(telegramId);
  } catch (error) {
    console.error(`[handleConfirmDisconnectWallet] Error disconnecting wallet:`, error);
  }

  // Clear wallet from database
  await disconnectUserWallet(user.id);

  // Delete the current message and show the welcome message for new users
  await ctx.deleteMessage();
  await handleStart(ctx);
}

export async function handleCancelWalletConnect(ctx: Context) {
  await ctx.answerCbQuery('Connection cancelled');

  // Clean up TonConnect instance to stop bridge reconnection attempts
  const telegramId = ctx.from?.id;
  if (telegramId) {
    try {
      await disconnectWallet(telegramId);
    } catch (error) {
      console.error(`[handleCancelWalletConnect] Error disconnecting wallet:`, error);
    }
  }

  // Delete the QR code photo message
  await ctx.deleteMessage();
  // Show wallet selection list
  await ctx.reply(
    'Select your wallet:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Tonkeeper', 'wallet_tonkeeper')],
      [Markup.button.callback('MyTonWallet', 'wallet_mytonwallet')],
      [Markup.button.callback('Telegram Wallet', 'wallet_telegram')],
    ])
  );
}

export async function handleWalletSelection(ctx: Context, walletType: string) {
  await ctx.answerCbQuery(`Connecting to ${walletType}...`);
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  // Delete the "Select your wallet" message before sending the QR code photo
  // (Telegram doesn't allow editing text messages to include photos)
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted, continue anyway
    console.log('[handleWalletSelection] Could not delete previous message:', error);
  }

  // TODO: Implement Telegraf session middleware
  // ctx.session.state = UserState.CONNECTING_WALLET;

  try {
    // Store QR message ID in a variable that will be set after sending
    let qrMessageId: number | undefined;

    // ✅ Define listener callbacks FIRST (before generating connection)
    const onConnected = async (address: string) => {
      // Wallet connected successfully
      try {
        console.log(`[handleWalletSelection] Wallet connected callback triggered for ${address}`);
        const user = await getOrCreateUser(telegramId);
        await updateUserWallet(user.id, address, walletType);
        updateSession(telegramId, { state: UserState.IDLE });

        // Delete the QR code photo message
        if (qrMessageId) {
          try {
            await ctx.telegram.deleteMessage(chatId, qrMessageId);
          } catch (err) {
            console.log('[handleWalletSelection] Could not delete QR message:', err);
          }
        }

        // Show main menu with wallet info (use reply since QR message was deleted)
        await showConnectedWalletMenu(ctx, address, true);
      } catch (error) {
        console.error('[handleWalletSelection] Error updating wallet connection:', error);
      }
    };

    const onDisconnected = async () => {
      // Wallet disconnected - edit the QR message
      try {
        console.log(`[handleWalletSelection] Wallet disconnected callback triggered`);
        if (qrMessageId) {
          await ctx.telegram.editMessageCaption(
            chatId,
            qrMessageId,
            undefined,
            '❌ Wallet connection was cancelled or disconnected.',
            Markup.inlineKeyboard([[Markup.button.callback('Try Again', 'connect_wallet')]])
          );
        }
      } catch (error) {
        console.error('[handleWalletSelection] Error handling wallet disconnect:', error);
      }
    };

    // ✅ Generate wallet connection with listener callbacks (listener will be set up BEFORE connect())
    const { universalLink, qrCodeDataUrl, tcLink } = await generateWalletConnection(
      telegramId,
      walletType,
      onConnected,
      onDisconnected
    );

    console.log('QR code data URL length:', qrCodeDataUrl.length);

    // Generate QR code buffer for Telegram using tc:// link (wallets can scan it)
    const qrCodeBuffer = await generateQRCodeBuffer(tcLink);

    console.log('QR code buffer size:', qrCodeBuffer.length);

    const message = `
🔗 Connect your ${walletType}

Scan the QR code below with your wallet app or click "Open Wallet" button:
    `;

    // Send QR code as photo with message and button
    const qrMessage = await ctx.replyWithPhoto(
      { source: qrCodeBuffer },
      {
        caption: message,
        ...Markup.inlineKeyboard([
          [Markup.button.url('Open Wallet', universalLink)],
          [Markup.button.callback('Cancel', 'cancel_wallet_connect')],
        ]),
      }
    );

    // Store the QR message ID after sending
    qrMessageId = qrMessage.message_id;

    // Edge case: if the user connected very quickly (before qrMessageId was set),
    // reflect the connected state now.
    try {
      if (isWalletConnected(telegramId)) {
        const address = getWalletAddress(telegramId);
        if (address && qrMessageId) {
          const user = await getOrCreateUser(telegramId);
          await updateUserWallet(user.id, address, walletType);
          updateSession(telegramId, { state: UserState.IDLE });

          // Delete the QR code photo message
          try {
            await ctx.telegram.deleteMessage(chatId, qrMessageId);
          } catch (err) {
            console.log('[handleWalletSelection] Could not delete QR message:', err);
          }

          // Show main menu with wallet info (use reply since QR message was deleted)
          await showConnectedWalletMenu(ctx, address, true);
        }
      }
    } catch (error) {
      console.error('[handleWalletSelection] Post-send connected-state update failed:', error);
    }
  } catch (error) {
    console.error('Error generating wallet connection:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    await ctx.reply(
      'Failed to generate wallet connection. Please try again.',
      Markup.inlineKeyboard([[Markup.button.callback('Back', 'connect_wallet')]])
    );
  }
}

export async function handleSimulateConnect(ctx: Context, walletType: string) {
  await ctx.answerCbQuery('Simulating connection...');
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Simulate wallet connection with a test address
  const testAddress = 'EQ' + 'A'.repeat(46);

  const { updateUserWallet } = await import('../services/userService');
  const user = await getOrCreateUser(telegramId);
  await updateUserWallet(user.id, testAddress, walletType);
  // TODO: Implement Telegraf session middleware
  // ctx.session.state = UserState.IDLE;

  await ctx.editMessageText(
    `Wallet Connected Successfully!\n\nWallet: ${testAddress.slice(0, 8)}...${testAddress.slice(-6)}\nType: ${walletType}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Balance', 'balance')],
      [Markup.button.callback('Trade', 'trade')],
      [Markup.button.callback('Orders', 'orders')],
    ])
  );
}

export async function handleTradingPair(ctx: Context, pair: string) {
  await ctx.answerCbQuery(`Loading ${pair}...`);
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Parse pair into symbols (e.g., "BUILD/TON" -> ["BUILD", "TON"])
  const [fromSymbol, toSymbol] = pair.split('/');

  // Fetch orders from API - need both deployed and pending_match statuses
  // Also need both directions: fromSymbol->toSymbol AND toSymbol->fromSymbol
  let ordersMessage = '';
  try {
    const [deployedForward, pendingForward, deployedReverse, pendingReverse] = await Promise.all([
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'deployed', 500),
      getOrdersForPairBySymbol(fromSymbol, toSymbol, 'pending_match', 500),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'deployed', 500),
      getOrdersForPairBySymbol(toSymbol, fromSymbol, 'pending_match', 500),
    ]);
    const allOrders = [...deployedForward, ...pendingForward, ...deployedReverse, ...pendingReverse];

    if (allOrders.length > 0) {
      // Forward orders (fromSymbol -> toSymbol) are asks (selling fromSymbol)
      // Reverse orders (toSymbol -> fromSymbol) are bids (buying fromSymbol)
      const asks = [...deployedForward, ...pendingForward];
      const bids = [...deployedReverse, ...pendingReverse];

      ordersMessage = '\nOrder Book:\n';

      if (asks.length > 0) {
        ordersMessage += 'Asks:\n';
        asks.slice(0, 5).forEach((order) => {
          const price = order.price_rate?.toFixed(4) || '—';
          const amount = order.amount?.toFixed(2) || '—';
          ordersMessage += `${price} | ${amount} ${fromSymbol}\n`;
        });
      } else {
        ordersMessage += 'Asks: No orders\n';
      }

      ordersMessage += '\n';

      if (bids.length > 0) {
        ordersMessage += 'Bids:\n';
        bids.slice(0, 5).forEach((order) => {
          const price = order.price_rate?.toFixed(4) || '—';
          const amount = order.amount?.toFixed(2) || '—';
          ordersMessage += `${price} | ${amount} ${fromSymbol}\n`;
        });
      } else {
        ordersMessage += 'Bids: No orders\n';
      }
    } else {
      ordersMessage = '\nNo active orders for this pair.';
    }
  } catch (error) {
    console.error('[handleTradingPair] Error fetching orders:', error);
    ordersMessage = '\nFailed to load orders.';
  }

  const orderBookMessage = `Trading Panel
Pair: ${pair}
${ordersMessage}`;

  await ctx.editMessageText(
    orderBookMessage,
    Markup.inlineKeyboard([
      [Markup.button.callback('Buy', `order_buy_${pair}`)],
      [Markup.button.callback('Sell', `order_sell_${pair}`)],
      [Markup.button.callback('Refresh', `pair_${pair.toLowerCase().replace('/', '_')}`)],
      [Markup.button.callback('Back', 'trade')],
    ])
  );
}

export async function handleOrderSide(
  ctx: Context,
  side: 'buy' | 'sell',
  pair: string
) {
  await ctx.answerCbQuery(`${side === 'buy' ? 'Buying' : 'Selling'}...`);
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  // Parse pair to get base and quote currencies (e.g., "NOT/USDT" -> ["NOT", "USDT"])
  const [baseCurrency, quoteCurrency] = pair.split('/');

  // For buy orders: user enters amount in quote currency (what they spend)
  // For sell orders: user enters amount in base currency (what they sell)
  const amountCurrency = side === 'buy' ? quoteCurrency : baseCurrency;

  // Edit the message to ask for amount
  const message = await ctx.editMessageText(
    `${side.toUpperCase()} ${pair}\n\nPlease enter the amount in ${amountCurrency}:\n\nExample: 10`,
    Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
  );

  // Set session state to expect amount input and store message ID
  // editMessageText returns Message object or true (for inline messages)
  const messageId = typeof message === 'object' && 'message_id' in message
    ? message.message_id
    : undefined;

  updateSession(telegramId, {
    state: UserState.ENTERING_AMOUNT,
    currentPair: pair,
    lastMessageId: messageId,
    chatId: chatId,
    pendingOrder: {
      type: side.toUpperCase() as OrderSide,
      orderType: OrderType.LIMIT,
      pair,
      baseCurrency,
      quoteCurrency,
      amountCurrency,
    },
  });
}

export async function handleCancelOrder(ctx: Context, orderId: string) {
  await ctx.answerCbQuery('Confirm cancellation');

  await ctx.editMessageText(
    `Are you sure you want to cancel order #${orderId.slice(0, 8)}?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, Cancel', `confirm_cancel_${orderId}`)],
      [Markup.button.callback('No', 'orders')],
    ])
  );
}

/**
 * Handle "New Order" button - start the new order creation flow
 * Step 1: Select token you offer
 */
export async function handleNewOrder(ctx: Context) {
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  // Check wallet first, show toast immediately (don't change view)
  const user = await getOrCreateUser(telegramId);
  if (!user.walletAddress) {
    try { await ctx.answerCbQuery('First need to connect wallet'); } catch { /* query expired */ }
    return;
  }

  try { await ctx.answerCbQuery('Select token to sell'); } catch { /* query expired */ }

  // Build token selection buttons (2 per row)
  const tokenButtons: any[][] = [];
  for (let i = 0; i < AVAILABLE_TOKENS.length; i += 2) {
    const row = [];
    row.push(Markup.button.callback(AVAILABLE_TOKENS[i], `offer_token_${AVAILABLE_TOKENS[i]}`));
    if (i + 1 < AVAILABLE_TOKENS.length) {
      row.push(Markup.button.callback(AVAILABLE_TOKENS[i + 1], `offer_token_${AVAILABLE_TOKENS[i + 1]}`));
    }
    tokenButtons.push(row);
  }
  tokenButtons.push([Markup.button.callback('Cancel', 'trade')]);

  const message = await ctx.editMessageText(
    `<b>📝 New Order (1/4)</b>\n\nSelect the token you want to SELL`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(tokenButtons) }
  );

  const messageId = typeof message === 'object' && 'message_id' in message
    ? message.message_id
    : undefined;

  updateSession(telegramId, {
    state: UserState.SELECTING_OFFER_TOKEN,
    lastMessageId: messageId,
    chatId: chatId,
    pendingOrder: {
      type: OrderSide.SELL, // Will be determined by the flow
      orderType: OrderType.LIMIT,
    },
  });
}

/**
 * Handle offer token selection
 * Step 2: Select token you want to get
 */
export async function handleOfferTokenSelection(ctx: Context, token: string) {
  await ctx.answerCbQuery(`Selling ${token}`);
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  const session = getSession(telegramId);

  // Build token selection buttons excluding the selected offer token
  const availableTokens = AVAILABLE_TOKENS.filter(t => t !== token);
  const tokenButtons: any[][] = [];
  for (let i = 0; i < availableTokens.length; i += 2) {
    const row = [];
    row.push(Markup.button.callback(availableTokens[i], `want_token_${availableTokens[i]}`));
    if (i + 1 < availableTokens.length) {
      row.push(Markup.button.callback(availableTokens[i + 1], `want_token_${availableTokens[i + 1]}`));
    }
    tokenButtons.push(row);
  }
  tokenButtons.push([Markup.button.callback('Back', 'new_order')]);

  const message = await ctx.editMessageText(
    `<b>📝 New Order (2/4)</b>\n\nSelect the token you want to GET`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(tokenButtons) }
  );

  const messageId = typeof message === 'object' && 'message_id' in message
    ? message.message_id
    : undefined;

  updateSession(telegramId, {
    state: UserState.SELECTING_WANT_TOKEN,
    lastMessageId: messageId,
    chatId: chatId,
    pendingOrder: {
      ...session.pendingOrder,
      type: OrderSide.SELL,
      orderType: OrderType.LIMIT,
      offerToken: token,
    },
  });
}

/**
 * Handle want token selection
 * Step 3: Enter amount of offer token
 */
export async function handleWantTokenSelection(ctx: Context, token: string) {
  await ctx.answerCbQuery('Loading balance...');
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  // Pre-warm TonConnect connection in background
  // By the time user fills in amount and confirms, connection should be ready
  warmupConnection(telegramId);

  const session = getSession(telegramId);
  const offerToken = session.pendingOrder?.offerToken || 'TOKEN';

  // Get user's balance for the offer token only (not all tokens)
  let balance = 0;
  try {
    const user = await getOrCreateUser(telegramId);
    if (user.walletAddress) {
      const { getSingleTokenBalance } = await import('../services/walletService');
      balance = await getSingleTokenBalance(user.walletAddress, offerToken);
    }
  } catch (error) {
    console.error('Error fetching balance for amount buttons:', error);
  }

  // Calculate percentage amounts
  const amount10 = balance * 0.1;
  const amount25 = balance * 0.25;

  // Format amounts for display
  const formatAmount = (amt: number) => amt >= 1 ? amt.toFixed(2) : amt.toFixed(4);

  // Build keyboard with amount buttons (one per row)
  const keyboard = [];
  if (balance > 0) {
    keyboard.push([Markup.button.callback(`1 ${offerToken}`, `set_offer_amount:1`)]);
    keyboard.push([Markup.button.callback(`10% (${formatAmount(amount10)} ${offerToken})`, `set_offer_amount:${amount10}`)]);
    keyboard.push([Markup.button.callback(`25% (${formatAmount(amount25)} ${offerToken})`, `set_offer_amount:${amount25}`)]);
  }
  keyboard.push([Markup.button.callback('Cancel', 'trade')]);

  const message = await ctx.editMessageText(
    `<b>📝 New Order (3/4)</b>\n\nXX ${offerToken} -> XX ${token}\n\nEnter the amount of ${offerToken} you want to SELL:`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) }
  );

  const messageId = typeof message === 'object' && 'message_id' in message
    ? message.message_id
    : undefined;

  updateSession(telegramId, {
    state: UserState.ENTERING_OFFER_AMOUNT,
    lastMessageId: messageId,
    chatId: chatId,
    pendingOrder: {
      type: session.pendingOrder?.type || OrderSide.SELL,
      orderType: session.pendingOrder?.orderType || OrderType.LIMIT,
      offerToken: session.pendingOrder?.offerToken,
      wantToken: token,
    },
  });
}

/**
 * Handle offer amount selection from quick buttons
 * Proceeds to Step 4: Enter want amount
 */
export async function handleSetOfferAmount(ctx: Context, amount: string) {
  await ctx.answerCbQuery('Amount set');
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId) return;

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) return;

  const session = getSession(telegramId);
  const offerToken = session.pendingOrder?.offerToken || 'TOKEN';
  const wantToken = session.pendingOrder?.wantToken || 'TOKEN';

  // Proceed to step 4 - enter want amount
  const message = await ctx.editMessageText(
    `<b>📝 New Order (4/4)</b>\n\n${parsedAmount} ${offerToken} -> XX ${wantToken}\n\nEnter the amount of ${wantToken} you want to RECEIVE:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Use Market Price', 'use_market_price')],
        [Markup.button.callback('Cancel', 'trade')],
      ]),
    }
  );

  const messageId = typeof message === 'object' && 'message_id' in message
    ? message.message_id
    : undefined;

  updateSession(telegramId, {
    state: UserState.ENTERING_WANT_AMOUNT,
    lastMessageId: messageId,
    chatId: chatId,
    pendingOrder: {
      type: session.pendingOrder?.type || OrderSide.SELL,
      orderType: session.pendingOrder?.orderType || OrderType.LIMIT,
      offerToken: session.pendingOrder?.offerToken,
      wantToken: session.pendingOrder?.wantToken,
      offerAmount: parsedAmount,
    },
  });
}

export async function handleConfirmCancelOrder(ctx: Context, orderId: string) {
  await ctx.answerCbQuery('Cancelling order...');

  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.editMessageText(
      'Unable to identify user. Please try again.',
      Markup.inlineKeyboard([[Markup.button.callback('Back to Orders', 'orders')]])
    );
    return;
  }

  try {
    // Show "Processing..." message before triggering the transaction
    await ctx.editMessageText(
      `Cancelling order #${orderId.slice(0, 8)}...\n\nPlease confirm the transaction in your wallet.`,
      Markup.inlineKeyboard([])
    );

    const result = await closeOrder(telegramId, orderId);

    if (result.success) {
      await ctx.editMessageText(
        `Order #${orderId.slice(0, 8)} has been cancelled.`,
        Markup.inlineKeyboard([[Markup.button.callback('View Orders', 'orders')]])
      );
    } else {
      await ctx.editMessageText(
        `Failed to cancel order: ${result.error || 'Unknown error'}`,
        Markup.inlineKeyboard([[Markup.button.callback('Back to Orders', 'orders')]])
      );
    }
  } catch (error) {
    console.error('Error cancelling order:', error);
    await ctx.editMessageText(
      'Failed to cancel order. Please try again.',
      Markup.inlineKeyboard([[Markup.button.callback('Back to Orders', 'orders')]])
    );
  }
}

// Supported trading pairs for order-book
const SUPPORTED_PAIRS = ['NOT/TON', 'NOT/USDT', 'BUILD/TON', 'BUILD/USDT', 'TON/DOGS', 'TON/PX', 'TON/XAUt'];

/**
 * Handle Order-book button - show pair selection
 */
export async function handleOrderBook(ctx: Context) {
  await ctx.answerCbQuery('Loading market data...');

  const message = `<b>📈 Market Data</b>\n\nSelect a trading pair`;

  // Build pair buttons
  const pairButtons = SUPPORTED_PAIRS.map(pair => [
    Markup.button.callback(
      pair === 'BUILD/TON' ? `🔥 ${pair}` : pair,
      `orderbook_pair_${pair.replace('/', '_')}`
    )
  ]);
  pairButtons.push([Markup.button.callback('◀️ Back', 'main_menu')]);

  await ctx.editMessageText(message, { parse_mode: 'HTML', ...Markup.inlineKeyboard(pairButtons) });
}

/**
 * Get market orders data from Redis cache (populated by background cron)
 * Returns cached data or throws if not available
 */
async function getMarketOrdersData(fromSymbol: string, toSymbol: string): Promise<MarketOrdersData> {
  const cached = await getCachedMarketOrders(fromSymbol, toSymbol);
  if (cached) {
    console.log(`[getMarketOrdersData] Using cached data for ${fromSymbol}/${toSymbol}`);
    return cached;
  }

  // Cache miss - should rarely happen since cron keeps it warm
  console.warn(`[getMarketOrdersData] Cache miss for ${fromSymbol}/${toSymbol} - cron may not be running`);

  // Return empty data structure instead of making API calls
  return {
    sellOrdersCount: 0,
    sellTotalAmount: 0,
    sellOrders24h: 0,
    sellAmount24h: 0,
    buyOrdersCount: 0,
    buyTotalAmount: 0,
    buyOrders24h: 0,
    buyAmount24h: 0,
    swappedOrdersCount: 0,
    swappedFromAmount: 0,
    swappedToAmount: 0,
    cachedAt: 0,
  };
}

/**
 * Handle Order-book pair selection - show orders for specific pair
 */
export async function handleOrderBookPair(ctx: Context, pair: string) {
  await ctx.answerCbQuery(`Loading ${pair.replace('_', '/')}...`);

  // Parse pair (e.g., "NOT_TON" -> ["NOT", "TON"])
  const [fromSymbol, toSymbol] = pair.split('_');
  const displayPair = `${fromSymbol}/${toSymbol}`;

  let ordersMessage = '';
  try {
    // Get cached market orders data
    const data = await getMarketOrdersData(fromSymbol, toSymbol);

    // Build message with clean format
    ordersMessage = `<b>📊 Market — ${fromSymbol}/${toSymbol}</b>\n\n`;

    // SELL side (selling fromSymbol for toSymbol)
    ordersMessage += `🔴 <b>SELL (${fromSymbol})</b>\n`;
    ordersMessage += `├ Orders: ${data.sellOrdersCount}`;
    if (data.sellOrders24h > 0) ordersMessage += ` <i>(+${data.sellOrders24h} today)</i>`;
    ordersMessage += `\n`;
    ordersMessage += `└ Amount: ${formatVolume(data.sellTotalAmount)} ${fromSymbol}`;
    if (data.sellAmount24h > 0) ordersMessage += ` <i>(+${formatVolume(data.sellAmount24h)})</i>`;
    ordersMessage += `\n\n`;

    // BUY side (selling toSymbol for fromSymbol)
    ordersMessage += `🟢 <b>BUY (${toSymbol})</b>\n`;
    ordersMessage += `├ Orders: ${data.buyOrdersCount}`;
    if (data.buyOrders24h > 0) ordersMessage += ` <i>(+${data.buyOrders24h} today)</i>`;
    ordersMessage += `\n`;
    ordersMessage += `└ Amount: ${formatVolume(data.buyTotalAmount)} ${toSymbol}`;
    if (data.buyAmount24h > 0) ordersMessage += ` <i>(+${formatVolume(data.buyAmount24h)})</i>`;
    ordersMessage += `\n\n`;

    // SWAPPED (completed orders)
    ordersMessage += `✅ <b>SWAPPED</b>\n`;
    ordersMessage += `├ Orders: ${data.swappedOrdersCount}\n`;
    ordersMessage += `├ ${fromSymbol}: ${formatVolume(data.swappedFromAmount)}\n`;
    ordersMessage += `└ ${toSymbol}: ${formatVolume(data.swappedToAmount)}`;
  } catch (error) {
    console.error('[handleOrderBookPair] Error fetching orders:', error);
    ordersMessage = `📊 Market — ${fromSymbol}/${toSymbol}\n\nFailed to load orders.`;
  }

  const message = ordersMessage;

  try {
    await ctx.editMessageText(
      message,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ New order', 'new_order')],
          [Markup.button.callback('🔄 Refresh', `orderbook_pair_${pair}`)],
          [Markup.button.callback('◀️ Back', 'orderbook')],
        ])
      }
    );
  } catch (error: unknown) {
    // Ignore "message is not modified" error - this happens when content hasn't changed
    if (error instanceof Error && error.message.includes('message is not modified')) {
      console.log('[handleOrderBookPair] Message content unchanged, skipping update');
    } else {
      throw error;
    }
  }
}

export async function setupCallbacks(bot: any) {
  // Main menu callbacks
  bot.action('main_menu', showMainMenu);
  bot.action('about', handleAbout);
  bot.action('trade', handleTrade);
  bot.action('orders', async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      const user = await getOrCreateUser(telegramId);
      if (!user.walletAddress) {
        try { await ctx.answerCbQuery('First need to connect wallet'); } catch { /* query expired */ }
        return;
      }
    }
    try { await ctx.answerCbQuery('Loading orders...'); } catch { /* query expired */ }
    await handleOrders(ctx);
  });
  bot.action('orders_active', async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      const user = await getOrCreateUser(telegramId);
      if (!user.walletAddress) {
        try { await ctx.answerCbQuery('First need to connect wallet'); } catch { /* query expired */ }
        return;
      }
    }
    try { await ctx.answerCbQuery('Loading active orders...'); } catch { /* query expired */ }
    await handleOrders(ctx, 1, false);
  });
  bot.action('orders_completed', async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      const user = await getOrCreateUser(telegramId);
      if (!user.walletAddress) {
        try { await ctx.answerCbQuery('First need to connect wallet'); } catch { /* query expired */ }
        return;
      }
    }
    try { await ctx.answerCbQuery('Loading completed orders...'); } catch { /* query expired */ }
    await handleOrders(ctx, 1, true);
  });
  bot.action('history', (ctx: Context) => handleHistory(ctx));
  bot.action('help', handleHelp);

  // Wallet connection
  bot.action('connect_wallet', handleConnectWallet);
  bot.action('disconnect_wallet', handleDisconnectWallet);
  bot.action('confirm_disconnect_wallet', handleConfirmDisconnectWallet);
  bot.action('cancel_wallet_connect', handleCancelWalletConnect);
  bot.action('wallet_tonkeeper', (ctx: Context) =>
    handleWalletSelection(ctx, 'Tonkeeper')
  );
  bot.action('wallet_mytonwallet', (ctx: Context) =>
    handleWalletSelection(ctx, 'MyTonWallet')
  );
  bot.action('wallet_telegram', (ctx: Context) =>
    handleWalletSelection(ctx, 'Telegram Wallet')
  );
  bot.action(/simulate_connect_(.+)/, (ctx: any) => {
    const walletType = ctx.match?.[1];
    if (walletType) handleSimulateConnect(ctx, walletType);
  });

  // New order flow
  bot.action('new_order', handleNewOrder);
  bot.action(/offer_token_(.+)/, (ctx: any) => {
    const token = ctx.match?.[1];
    if (token) handleOfferTokenSelection(ctx, token);
  });
  bot.action(/want_token_(.+)/, (ctx: any) => {
    const token = ctx.match?.[1];
    if (token) handleWantTokenSelection(ctx, token);
  });
  bot.action(/set_offer_amount:(.+)/, (ctx: any) => {
    const amount = ctx.match?.[1];
    if (amount) handleSetOfferAmount(ctx, amount);
  });

  // Order-book
  bot.action('orderbook', handleOrderBook);
  bot.action(/orderbook_pair_(.+)/, (ctx: any) => {
    const pair = ctx.match?.[1];
    if (pair) handleOrderBookPair(ctx, pair);
  });

  // Trading pairs - support both static and dynamic pair actions
  bot.action('pair_not_usdt', (ctx: Context) =>
    handleTradingPair(ctx, 'NOT/USDT')
  );
  bot.action('pair_build_ton', (ctx: Context) =>
    handleTradingPair(ctx, 'BUILD/TON')
  );
  bot.action('pair_build_not', (ctx: Context) =>
    handleTradingPair(ctx, 'BUILD/NOT')
  );
  // Dynamic pair handler for refresh (e.g., pair_build_ton)
  bot.action(/pair_([a-z]+)_([a-z]+)/i, (ctx: any) => {
    const base = ctx.match?.[1]?.toUpperCase();
    const quote = ctx.match?.[2]?.toUpperCase();
    if (base && quote) handleTradingPair(ctx, `${base}/${quote}`);
  });

  // Order actions
  bot.action(/order_(buy|sell)_(.+)/, (ctx: any) => {
    const side = ctx.match?.[1] as 'buy' | 'sell';
    const pair = ctx.match?.[2];
    if (side && pair) handleOrderSide(ctx, side, pair);
  });

  // Cancel order
  bot.action(/cancel_order_(.+)/, (ctx: any) => {
    const orderId = ctx.match?.[1];
    if (orderId) handleCancelOrder(ctx, orderId);
  });
  bot.action(/confirm_cancel_(.+)/, (ctx: any) => {
    const orderId = ctx.match?.[1];
    if (orderId) handleConfirmCancelOrder(ctx, orderId);
  });

  // Confirm order (both old flow and new flow)
  // Answer callback immediately before dynamic import to avoid timeout
  bot.action('confirm_order', async (ctx: Context) => {
    try { await ctx.answerCbQuery('Processing order...'); } catch { /* timeout ok */ }
    const { handleConfirmOrder } = await import('./messages');
    await handleConfirmOrder(ctx);
  });
  bot.action('confirm_new_order', async (ctx: Context) => {
    try { await ctx.answerCbQuery('Confirming order...'); } catch { /* timeout ok */ }
    const { handleConfirmNewOrder } = await import('./messages');
    await handleConfirmNewOrder(ctx);
  });

  // Use market price
  bot.action('use_market_price', async (ctx: Context) => {
    const { handleUseMarketPrice } = await import('./messages');
    await handleUseMarketPrice(ctx);
  });

  // History pagination
  bot.action(/history_page_(\d+)/, async (ctx: any) => {
    await ctx.answerCbQuery('Loading page...');
    const offset = parseInt(ctx.match?.[1] || '0', 10);
    await handleHistory(ctx, offset);
  });

  // Orders pagination
  bot.action(/orders_page_(\d+)_(active|completed)/, async (ctx: any) => {
    await ctx.answerCbQuery('Loading page...');
    const page = parseInt(ctx.match?.[1] || '1', 10);
    const showCompleted = ctx.match?.[2] === 'completed';
    await handleOrders(ctx, page, showCompleted);
  });
  bot.action('orders_page_info', async (ctx: any) => {
    await ctx.answerCbQuery('Page info');
  });
}
