import { Context, Markup } from 'telegraf';
import { getOrCreateUser } from '../services/userService';
import { UserState, OrderSide, OrderType } from '../types';
import { config } from '../utils/config';
import { getSession, updateSession } from './sessionManager';
import {
  getVaultAddressByCoinSymbol,
  getCachedCoins,
} from '../services/open4devService';
import type { Coin } from '../sdk/types';
import {
  buildTonOrderMessage,
  buildJettonOrderMessage,
  sendOrderTransaction,
  calculatePriceRate,
  calculateSlippage,
} from '../services/tonOrderService';
import { getMarketRate } from '../services/priceService';
import { getJettonWalletAddress } from '../utils/jettonHelper';
import { getWalletAddress } from '../services/tonConnectService';
import { formatTokenAmount, cleanErrorMessage } from '../utils/formatters';
import { getTokenDecimals, getTokenEmoji } from '../constants/tokens';
import { getTotalFeePercent } from '../utils/tokenConstants';

export async function handleTextMessage(ctx: Context) {
  const telegramId = ctx.from?.id;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';

  if (!telegramId || !text) return;

  const user = await getOrCreateUser(telegramId);
  const session = getSession(telegramId);

  // Handle input based on current session state
  switch (session.state) {
    case UserState.ENTERING_AMOUNT:
      await handleAmountInput(ctx, text, session);
      break;
    case UserState.ENTERING_PRICE:
      await handlePriceInput(ctx, text, session);
      break;
    // New order flow states
    case UserState.ENTERING_OFFER_AMOUNT:
      await handleOfferAmountInput(ctx, text, session);
      break;
    case UserState.ENTERING_WANT_AMOUNT:
      await handleWantAmountInput(ctx, text, session);
      break;
    default:
      // For unrecognized text, just reply normally as this is not part of a flow
      await ctx.reply('I did not understand that. Use /help to see available commands.');
  }
}

async function handleAmountInput(ctx: Context, text: string, sessionData: any) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !sessionData.chatId || !sessionData.lastMessageId) return;

  // Delete the user's message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted or bot lacks permission
  }

  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      'Invalid amount. Please enter a valid number greater than 0.\n\nPlease try again:',
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
    );
  }

  const amountCurrency = sessionData.pendingOrder?.amountCurrency || 'TON';

  if (amount < config.minOrderAmount) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      `Amount too small. Minimum order amount is ${config.minOrderAmount} ${amountCurrency}.\n\nPlease try again:`,
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
    );
  }

  // Update session with amount and move to next state
  if (sessionData.pendingOrder) {
    sessionData.pendingOrder.amount = amount;
  }

  // Determine price currency (for buy: base/quote price, for sell: quote/base price)
  const baseCurrency = sessionData.pendingOrder?.baseCurrency || 'NOT';
  const quoteCurrency = sessionData.pendingOrder?.quoteCurrency || 'USDT';
  const priceCurrency = quoteCurrency;

  // Edit the message to ask for price
  const message = await ctx.telegram.editMessageText(
    sessionData.chatId,
    sessionData.lastMessageId,
    undefined,
    `Amount: ${amount} ${amountCurrency}\n\nNow enter the price in ${priceCurrency}:\n\nExample: 2.45`,
    Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
  );

  updateSession(telegramId, {
    state: UserState.ENTERING_PRICE,
    pendingOrder: sessionData.pendingOrder,
    lastMessageId: typeof message === 'object' ? message.message_id : undefined,
    chatId: sessionData.chatId,
  });
}

async function handlePriceInput(ctx: Context, text: string, sessionData: any) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !sessionData.chatId || !sessionData.lastMessageId) return;

  // Delete the user's message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted or bot lacks permission
  }

  const price = parseFloat(text);

  if (isNaN(price) || price <= 0) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      'Invalid price. Please enter a valid number greater than 0.\n\nPlease try again:',
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
    );
  }

  // Update session with price
  if (sessionData.pendingOrder) {
    sessionData.pendingOrder.price = price;
  }

  const { pendingOrder } = sessionData;

  // Validate that pendingOrder and required fields exist
  if (!pendingOrder || typeof pendingOrder.amount !== 'number') {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      'Session expired. Please start over.',
      Markup.inlineKeyboard([[Markup.button.callback('Start Over', 'trade')]])
    );
  }

  const amountCurrency = pendingOrder.amountCurrency || 'TON';
  const quoteCurrency = pendingOrder.quoteCurrency || 'USDT';
  const baseCurrency = pendingOrder.baseCurrency || 'NOT';
  const total = pendingOrder.amount * price;

  // For buy: spending amountCurrency to get baseCurrency
  // For sell: selling amountCurrency to get quoteCurrency
  const totalCurrency = pendingOrder.type === 'BUY' ? baseCurrency : quoteCurrency;

  const confirmMessage = `
Confirm Order:

Type: ${pendingOrder.orderType} ${pendingOrder.type}
Pair: ${pendingOrder.pair}
Amount: ${pendingOrder.amount} ${amountCurrency}
Price: ${price} ${quoteCurrency}
Total: ${total.toFixed(2)} ${totalCurrency}
  `;

  // Edit the message to show order confirmation
  const message = await ctx.telegram.editMessageText(
    sessionData.chatId,
    sessionData.lastMessageId,
    undefined,
    confirmMessage,
    Markup.inlineKeyboard([
      [Markup.button.callback('Confirm', 'confirm_order')],
      [Markup.button.callback('Cancel', 'main_menu')],
    ])
  );

  updateSession(telegramId, {
    state: UserState.CONFIRMING_ORDER,
    pendingOrder: sessionData.pendingOrder,
    lastMessageId: typeof message === 'object' ? message.message_id : undefined,
    chatId: sessionData.chatId,
  });
}

export async function handleConfirmOrder(ctx: Context) {
  // Callback already answered in callback setup - skip here to avoid duplicate
  // try { await ctx.answerCbQuery('Processing order...'); } catch { /* already answered */ }

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const session = getSession(telegramId);
  const { pendingOrder } = session;

  if (!pendingOrder || !pendingOrder.amount || !pendingOrder.price || !pendingOrder.pair) {
    await ctx.editMessageText(
      'Invalid order data. Please start over.',
      Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
    );
    updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
    return;
  }

  try {
    const user = await getOrCreateUser(telegramId);

    // Check if wallet is connected - use database wallet first, fall back to in-memory TonConnect
    const userWalletAddress = user.walletAddress || getWalletAddress(telegramId);
    if (!userWalletAddress) {
      await ctx.editMessageText(
        'Wallet not connected. Please connect your wallet first.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Connect Wallet', 'connect_wallet')],
          [Markup.button.callback('Main Menu', 'main_menu')],
        ])
      );
      return;
    }

    // Parse pair (e.g., "NOT/USDT" -> ["NOT", "USDT"])
    const [fromSymbol, toSymbol] = pendingOrder.pair.split('/');

    // Show "Processing..." message
    await ctx.editMessageText(
      `Processing order...\n\nPlease confirm the transaction in your wallet.`,
      Markup.inlineKeyboard([])
    );

    // Determine order direction based on side (BUY = we send quote coin to get base, SELL = we send base to get quote)
    // For BUY NOT/USDT: we send USDT to get NOT
    // For SELL NOT/USDT: we send NOT to get USDT
    const isBuy = pendingOrder.type === OrderSide.BUY;
    const sendCoinSymbol = isBuy ? toSymbol : fromSymbol; // What we're sending
    const receiveCoinSymbol = isBuy ? fromSymbol : toSymbol; // What we're receiving

    // Get vault addresses for both coins (sending and receiving)
    const [vaultAddress, oppositeVaultAddress] = await Promise.all([
      getVaultAddressByCoinSymbol(sendCoinSymbol),
      getVaultAddressByCoinSymbol(receiveCoinSymbol),
    ]);
    if (!vaultAddress) {
      await ctx.editMessageText(
        `Could not find vault for ${sendCoinSymbol}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }
    if (!oppositeVaultAddress) {
      await ctx.editMessageText(
        `Could not find vault for ${receiveCoinSymbol}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }

    // Calculate amount to send
    // For BUY: amount is in base coin (NOT), we need to calculate quote amount (USDT)
    // For SELL: amount is in base coin (NOT), we send that amount
    const sendAmount = isBuy
      ? (pendingOrder.amount * pendingOrder.price).toString() // Total in quote coin
      : pendingOrder.amount.toString(); // Amount in base coin

    // Get coin data from cache (single API call for all coins)
    const coins = await getCachedCoins();
    // TON is the native currency and may not appear in the coins list
    const TON_COIN: Coin = { id: 0, name: 'Toncoin', symbol: 'TON', decimals: 9 };
    const sendCoin = coins.find(c => c.symbol?.toUpperCase() === sendCoinSymbol.toUpperCase())
      ?? (sendCoinSymbol.toUpperCase() === 'TON' ? TON_COIN : undefined);
    const receiveCoin = coins.find(c => c.symbol?.toUpperCase() === receiveCoinSymbol.toUpperCase())
      ?? (receiveCoinSymbol.toUpperCase() === 'TON' ? TON_COIN : undefined);

    if (!sendCoin || !receiveCoin) {
      const missingCoins = [
        !sendCoin ? sendCoinSymbol : null,
        !receiveCoin ? receiveCoinSymbol : null,
      ].filter(Boolean).join(', ');
      await ctx.editMessageText(
        `Could not find coin data for ${missingCoins}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }

    // Get coin addresses (API returns ton_raw_address, not address)
    const sendCoinAddress = sendCoin.ton_raw_address || sendCoin.address;
    const receiveCoinAddress = receiveCoin.ton_raw_address || receiveCoin.address;

    const isTonOrder = sendCoinSymbol.toUpperCase() === 'TON' || !sendCoinAddress;

    // Get decimals for both tokens (USDT/USDC use 6, others use 9)
    const fromDecimals = getTokenDecimals(sendCoinSymbol);
    const toDecimals = getTokenDecimals(receiveCoinSymbol);

    // Build order parameters with correct decimals
    // Effective slippage = user slippage (2%) + total fees (platform + matcher)
    const userSlippage = 2;
    const effectiveSlippage = userSlippage + getTotalFeePercent();

    const orderParams = {
      userAddress: userWalletAddress,
      vaultAddress,
      oppositeVaultAddress,
      amount: sendAmount,
      priceRate: calculatePriceRate(pendingOrder.price, toDecimals, fromDecimals).toString(),
      slippage: calculateSlippage(effectiveSlippage).toString(),
      toJettonMinter: receiveCoinSymbol.toUpperCase() === 'TON' || !receiveCoinAddress ? null : receiveCoinAddress,
      fromDecimals,
      toDecimals,
    };

    let message;
    if (isTonOrder) {
      // TON → Jetton order
      message = buildTonOrderMessage(orderParams);
    } else {
      // Jetton → TON/Jetton order
      // Get user's jetton wallet address
      const jettonWalletAddress = await getJettonWalletAddress(
        sendCoinAddress!,
        userWalletAddress
      );

      message = buildJettonOrderMessage({
        ...orderParams,
        fromJettonWallet: jettonWalletAddress,
        forwardTonAmount: '0.1',
      });
    }

    // Send transaction via TonConnect
    const txResult = await sendOrderTransaction(telegramId, message);

    // Reset session
    updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });

    const amountCurrency = pendingOrder.amountCurrency || 'TON';
    const quoteCurrency = pendingOrder.quoteCurrency || 'USDT';
    const baseCurrency = pendingOrder.baseCurrency || 'NOT';
    const total = pendingOrder.amount * pendingOrder.price;
    const totalCurrency = pendingOrder.type === 'BUY' ? baseCurrency : quoteCurrency;

    const amountEmoji = getTokenEmoji(amountCurrency);
    const totalEmoji = getTokenEmoji(totalCurrency);
    const formattedAmount = formatTokenAmount(pendingOrder.amount);
    const formattedTotal = formatTokenAmount(total);

    await ctx.editMessageText(
      `✅ Order Created\n\n` +
      `${amountEmoji} ${formattedAmount} ${amountCurrency} → ${totalEmoji} ${formattedTotal} ${totalCurrency}\n\n` +
      `Rate: 1 ${amountCurrency} = ${pendingOrder.price} ${quoteCurrency}\n\n` +
      `Sent to blockchain`,
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ New Order', 'new_order')],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')],
      ])
    );
  } catch (error: any) {
    console.error('Error creating order:', error);

    // Get error message and name for better detection
    const errorMessage = error?.message || String(error) || 'Unknown error';
    const errorName = error?.name || '';
    const lowerErrorMessage = errorMessage.toLowerCase();
    const lowerErrorName = errorName.toLowerCase();

    // Check for TonConnect timeout/rejection errors - allow retry
    // TimeoutError from p-timeout has name "TimeoutError"
    const isTransactionError = lowerErrorMessage.includes('rejected') ||
                               lowerErrorMessage.includes('cancelled') ||
                               lowerErrorMessage.includes('timeout') ||
                               lowerErrorMessage.includes('timed out') ||
                               lowerErrorMessage.includes('user declined') ||
                               lowerErrorMessage.includes('request timeout') ||
                               lowerErrorName === 'timeouterror';

    try {
      if (isTransactionError) {
        // Keep session with pendingOrder for retry
        updateSession(telegramId, { state: UserState.CONFIRMING_ORDER });

        const amountCurrency = pendingOrder.amountCurrency || 'TON';
        const quoteCurrency = pendingOrder.quoteCurrency || 'USDT';
        const baseCurrency = pendingOrder.baseCurrency || 'NOT';
        const total = pendingOrder.amount * pendingOrder.price;
        const totalCurrency = pendingOrder.type === 'BUY' ? baseCurrency : quoteCurrency;

        await ctx.editMessageText(
          `Transaction was not confirmed in wallet.\n\n` +
          `Your order details:\n` +
          `Type: ${pendingOrder.orderType} ${pendingOrder.type}\n` +
          `Pair: ${pendingOrder.pair}\n` +
          `Amount: ${pendingOrder.amount} ${amountCurrency}\n` +
          `Price: ${pendingOrder.price} ${quoteCurrency}\n` +
          `Total: ${total.toFixed(2)} ${totalCurrency}\n\n` +
          `Please try again or cancel.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Try Again', 'confirm_order')],
            [Markup.button.callback('Cancel', 'main_menu')],
          ])
        );
      } else if (lowerErrorMessage.includes('not connected')) {
        // Reset session on wallet disconnect
        updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
        await ctx.editMessageText(
          'Wallet disconnected. Please reconnect and try again.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Connect Wallet', 'connect_wallet')],
            [Markup.button.callback('Main Menu', 'main_menu')],
          ])
        );
      } else {
        // Reset session on other errors
        updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
        await ctx.editMessageText(
          `Failed to create order: ${cleanErrorMessage(errorMessage)}`,
          Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
        );
      }
    } catch (editError) {
      // If editing message fails (e.g., message was already modified by /start), try to reply instead
      console.error('Failed to edit message after error:', editError);
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      try {
        await ctx.reply(
          'An issue occurred with your order. Please try again from the main menu.',
          Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
        );
      } catch {
        // Last resort failed - user will need to use /start
      }
    }
  }
}

/**
 * Handle offer amount input in the new order flow
 * Step 3: User enters the amount of token they want to offer
 */
async function handleOfferAmountInput(ctx: Context, text: string, sessionData: any) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !sessionData.chatId || !sessionData.lastMessageId) return;

  // Delete the user's message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted or bot lacks permission
  }

  const amount = parseFloat(text);
  const offerToken = sessionData.pendingOrder?.offerToken || 'TOKEN';
  const wantToken = sessionData.pendingOrder?.wantToken || 'TOKEN';

  if (isNaN(amount) || amount <= 0) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      `Invalid amount. Please enter a valid number greater than 0.\n\nYou offer: ${offerToken}\nYou want: ${wantToken}\n\nPlease try again:`,
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'trade')]])
    );
  }

  if (amount < config.minOrderAmount) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      `Amount too small. Minimum order amount is ${config.minOrderAmount} ${offerToken}.\n\nPlease try again:`,
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'trade')]])
    );
  }

  // Update session with offer amount and move to want amount input
  const message = await ctx.telegram.editMessageText(
    sessionData.chatId,
    sessionData.lastMessageId,
    undefined,
    `<b>📝 New Order (4/4)</b>\n\n${amount} ${offerToken} -> XX ${wantToken}\n\nEnter the amount of ${wantToken} you want to RECEIVE:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Use market price', 'use_market_price')],
        [Markup.button.callback('Cancel', 'trade')],
      ])
    }
  );

  updateSession(telegramId, {
    state: UserState.ENTERING_WANT_AMOUNT,
    pendingOrder: {
      ...sessionData.pendingOrder,
      offerAmount: amount,
    },
    lastMessageId: typeof message === 'object' ? message.message_id : undefined,
    chatId: sessionData.chatId,
  });
}

/**
 * Handle "Use market price" button click
 * Calculates the want amount based on current market prices
 */
export async function handleUseMarketPrice(ctx: Context) {
  await ctx.answerCbQuery('Fetching market price...');

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const session = getSession(telegramId);
  const { pendingOrder, chatId, lastMessageId } = session;

  if (!pendingOrder?.offerToken || !pendingOrder?.wantToken || !pendingOrder?.offerAmount) {
    await ctx.editMessageText(
      'Session expired. Please start over.',
      Markup.inlineKeyboard([[Markup.button.callback('Start Over', 'trade')]])
    );
    updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
    return;
  }

  const offerToken = pendingOrder.offerToken;
  const wantToken = pendingOrder.wantToken;
  const offerAmount = pendingOrder.offerAmount;

  // Get market rate (single Redis read)
  const marketRate = await getMarketRate(offerToken, wantToken);

  if (marketRate === null) {
    await ctx.editMessageText(
      `Could not fetch market price for ${offerToken}/${wantToken}.\n\nPlease enter the amount manually:\n\nYou offer: ${offerAmount} ${offerToken}\nYou want: ${wantToken}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'trade')],
      ])
    );
    return;
  }

  // Calculate market amount from rate (no extra Redis call)
  const marketAmount = offerAmount * marketRate;
  const rateDisplay = marketRate.toFixed(6);

  // Show confirmation message with market price
  const confirmMessage = `<b>✅ Confirm New Order</b>\n\n` +
    `${offerAmount} ${offerToken} -> ${marketAmount.toFixed(6)} ${wantToken}\n` +
    `Rate: 1 ${offerToken} = ${rateDisplay} ${wantToken} (market)\n\n` +
    `Please confirm to proceed with the transaction`;

  const message = await ctx.editMessageText(
    confirmMessage,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Confirm', 'confirm_new_order')],
        [Markup.button.callback('Cancel', 'trade')],
      ]),
    }
  );

  updateSession(telegramId, {
    state: UserState.CONFIRMING_ORDER,
    pendingOrder: {
      ...pendingOrder,
      wantAmount: marketAmount,
      // Calculate price for the transaction
      price: marketAmount / offerAmount,
      // Set pair for compatibility with existing flow
      pair: `${offerToken}/${wantToken}`,
      baseCurrency: offerToken,
      quoteCurrency: wantToken,
      amount: offerAmount,
      amountCurrency: offerToken,
    },
    lastMessageId: typeof message === 'object' ? message.message_id : undefined,
    chatId: chatId,
  });
}

/**
 * Handle want amount input in the new order flow
 * Step 4: User enters the amount of token they want to receive
 * Then show confirmation
 */
async function handleWantAmountInput(ctx: Context, text: string, sessionData: any) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !sessionData.chatId || !sessionData.lastMessageId) return;

  // Delete the user's message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Message may already be deleted or bot lacks permission
  }

  const amount = parseFloat(text);
  const offerToken = sessionData.pendingOrder?.offerToken || 'TOKEN';
  const wantToken = sessionData.pendingOrder?.wantToken || 'TOKEN';
  const offerAmount = sessionData.pendingOrder?.offerAmount || 0;

  if (isNaN(amount) || amount <= 0) {
    return ctx.telegram.editMessageText(
      sessionData.chatId,
      sessionData.lastMessageId,
      undefined,
      `Invalid amount. Please enter a valid number greater than 0.\n\nYou offer: ${offerAmount} ${offerToken}\nYou want: ${wantToken}\n\nPlease try again:`,
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'trade')]])
    );
  }

  // Calculate the implied price (rate)
  const impliedPrice = amount / offerAmount;

  // Show confirmation message
  const confirmMessage = `<b>✅ Confirm New Order</b>\n\n` +
    `${offerAmount} ${offerToken} -> ${amount} ${wantToken}\n` +
    `Rate: 1 ${offerToken} = ${impliedPrice.toFixed(6)} ${wantToken}\n\n` +
    `Please confirm to proceed with the transaction`;

  const message = await ctx.telegram.editMessageText(
    sessionData.chatId,
    sessionData.lastMessageId,
    undefined,
    confirmMessage,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Confirm', 'confirm_new_order')],
        [Markup.button.callback('Cancel', 'trade')],
      ]),
    }
  );

  updateSession(telegramId, {
    state: UserState.CONFIRMING_ORDER,
    pendingOrder: {
      ...sessionData.pendingOrder,
      wantAmount: amount,
      // Calculate price for the transaction
      price: impliedPrice,
      // Set pair for compatibility with existing flow
      pair: `${offerToken}/${wantToken}`,
      baseCurrency: offerToken,
      quoteCurrency: wantToken,
      amount: offerAmount,
      amountCurrency: offerToken,
    },
    lastMessageId: typeof message === 'object' ? message.message_id : undefined,
    chatId: sessionData.chatId,
  });
}

/**
 * Handle confirm order for the new flow
 */
export async function handleConfirmNewOrder(ctx: Context) {
  const startTime = Date.now();
  const logTime = (step: string) => console.log(`[handleConfirmNewOrder] ${step} (+${Date.now() - startTime}ms)`);

  // Callback already answered in callback setup - skip here to avoid duplicate
  logTime('Started');

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const session = getSession(telegramId);
  const { pendingOrder } = session;

  if (!pendingOrder || !pendingOrder.offerToken || !pendingOrder.wantToken ||
      !pendingOrder.offerAmount || !pendingOrder.wantAmount) {
    await ctx.editMessageText(
      'Invalid order data. Please start over.',
      Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
    );
    updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
    return;
  }

  try {
    const sendCoinSymbol = pendingOrder.offerToken;
    const receiveCoinSymbol = pendingOrder.wantToken;
    const sendAmount = pendingOrder.offerAmount.toString();

    logTime('Fetching user, vaults, coins...');
    // Fetch user, vaults (send + receive), and coins in parallel for speed
    const [user, vaultAddress, oppositeVaultAddress, coins] = await Promise.all([
      getOrCreateUser(telegramId),
      getVaultAddressByCoinSymbol(sendCoinSymbol),
      getVaultAddressByCoinSymbol(receiveCoinSymbol),
      getCachedCoins(),
    ]);
    logTime('Got user, vaults, coins');

    // Check if wallet is connected
    const userWalletAddress = user.walletAddress || getWalletAddress(telegramId);
    if (!userWalletAddress) {
      await ctx.editMessageText(
        'Wallet not connected. Please connect your wallet first.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Connect Wallet', 'connect_wallet')],
          [Markup.button.callback('Main Menu', 'main_menu')],
        ])
      );
      return;
    }

    if (!vaultAddress) {
      await ctx.editMessageText(
        `Could not find vault for ${sendCoinSymbol}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }

    if (!oppositeVaultAddress) {
      await ctx.editMessageText(
        `Could not find vault for ${receiveCoinSymbol}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }

    // Show "Processing..." message
    logTime('Showing processing message...');
    await ctx.editMessageText(
      `Processing order...\n\nPlease confirm the transaction in your wallet.`,
      Markup.inlineKeyboard([])
    );
    logTime('Processing message shown');
    // TON is the native currency and may not appear in the coins list
    const TON_COIN_FALLBACK: Coin = { id: 0, name: 'Toncoin', symbol: 'TON', decimals: 9 };
    const sendCoin = coins.find(c => c.symbol?.toUpperCase() === sendCoinSymbol.toUpperCase())
      ?? (sendCoinSymbol.toUpperCase() === 'TON' ? TON_COIN_FALLBACK : undefined);
    const receiveCoin = coins.find(c => c.symbol?.toUpperCase() === receiveCoinSymbol.toUpperCase())
      ?? (receiveCoinSymbol.toUpperCase() === 'TON' ? TON_COIN_FALLBACK : undefined);

    if (!sendCoin || !receiveCoin) {
      const missingCoins = [
        !sendCoin ? sendCoinSymbol : null,
        !receiveCoin ? receiveCoinSymbol : null,
      ].filter(Boolean).join(', ');
      await ctx.editMessageText(
        `Could not find coin data for ${missingCoins}. Please try again later.`,
        Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
      );
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      return;
    }

    const sendCoinAddress = sendCoin.ton_raw_address || sendCoin.address;
    const receiveCoinAddress = receiveCoin.ton_raw_address || receiveCoin.address;

    const isTonOrder = sendCoinSymbol.toUpperCase() === 'TON' || !sendCoinAddress;

    // Get decimals for both tokens (USDT/USDC use 6, others use 9)
    const fromDecimals = getTokenDecimals(sendCoinSymbol);
    const toDecimals = getTokenDecimals(receiveCoinSymbol);

    // Calculate price rate from the amounts
    const priceRate = pendingOrder.wantAmount / pendingOrder.offerAmount;

    // Build order parameters with correct decimals
    // Effective slippage = user slippage (2%) + total fees (platform + matcher)
    const userSlippage = 2;
    const effectiveSlippage = userSlippage + getTotalFeePercent();

    const orderParams = {
      userAddress: userWalletAddress,
      vaultAddress,
      oppositeVaultAddress,
      amount: sendAmount,
      priceRate: calculatePriceRate(priceRate, toDecimals, fromDecimals).toString(),
      slippage: calculateSlippage(effectiveSlippage).toString(),
      toJettonMinter: receiveCoinSymbol.toUpperCase() === 'TON' || !receiveCoinAddress ? null : receiveCoinAddress,
      fromDecimals,
      toDecimals,
    };

    let message;
    logTime('Building order message...');
    if (isTonOrder) {
      // TON → Jetton order
      message = buildTonOrderMessage(orderParams);
      logTime('Built TON order message');
    } else {
      // Jetton → TON/Jetton order
      logTime('Fetching jetton wallet address...');
      const jettonWalletAddress = await getJettonWalletAddress(
        sendCoinAddress!,
        userWalletAddress
      );
      logTime('Got jetton wallet address');

      message = buildJettonOrderMessage({
        ...orderParams,
        fromJettonWallet: jettonWalletAddress,
        forwardTonAmount: '0.1',
      });
      logTime('Built jetton order message');
    }

    // Send transaction via TonConnect
    logTime('Calling sendOrderTransaction...');
    await sendOrderTransaction(telegramId, message);
    logTime('Transaction complete');

    // Reset session
    updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });

    const sendEmoji = getTokenEmoji(sendCoinSymbol);
    const receiveEmoji = getTokenEmoji(receiveCoinSymbol);
    const formattedOffer = formatTokenAmount(pendingOrder.offerAmount);
    const formattedWant = formatTokenAmount(pendingOrder.wantAmount);

    await ctx.editMessageText(
      `✅ Order Created\n\n` +
      `${sendEmoji} ${formattedOffer} ${sendCoinSymbol} → ${receiveEmoji} ${formattedWant} ${receiveCoinSymbol}\n\n` +
      `Rate: 1 ${sendCoinSymbol} = ${priceRate.toFixed(6)} ${receiveCoinSymbol}\n\n` +
      `Sent to blockchain`,
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ New Order', 'new_order')],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')],
      ])
    );
  } catch (error: any) {
    console.error('Error creating order:', error);

    // Get error message and name for better detection
    const errorMessage = error?.message || String(error) || 'Unknown error';
    const errorName = error?.name || '';
    const lowerErrorMessage = errorMessage.toLowerCase();
    const lowerErrorName = errorName.toLowerCase();

    // Check for TonConnect timeout/rejection errors - allow retry
    // TimeoutError from p-timeout has name "TimeoutError"
    const isTransactionError = lowerErrorMessage.includes('rejected') ||
                               lowerErrorMessage.includes('cancelled') ||
                               lowerErrorMessage.includes('timeout') ||
                               lowerErrorMessage.includes('timed out') ||
                               lowerErrorMessage.includes('user declined') ||
                               lowerErrorMessage.includes('request timeout') ||
                               lowerErrorName === 'timeouterror';

    try {
      if (isTransactionError) {
        // Keep session with pendingOrder for retry
        updateSession(telegramId, { state: UserState.CONFIRMING_ORDER });

        const offerToken = pendingOrder.offerToken || 'TOKEN';
        const wantToken = pendingOrder.wantToken || 'TOKEN';
        const impliedPrice = pendingOrder.wantAmount / pendingOrder.offerAmount;

        await ctx.editMessageText(
          `Transaction was not confirmed in wallet.\n\n` +
          `Your order details:\n` +
          `You offer: ${pendingOrder.offerAmount} ${offerToken}\n` +
          `You get: ${pendingOrder.wantAmount} ${wantToken}\n` +
          `Rate: 1 ${offerToken} = ${impliedPrice.toFixed(6)} ${wantToken}\n\n` +
          `Please try again or cancel.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Try Again', 'confirm_new_order')],
            [Markup.button.callback('Cancel', 'main_menu')],
          ])
        );
      } else if (lowerErrorMessage.includes('not connected')) {
        // Reset session on wallet disconnect
        updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
        await ctx.editMessageText(
          'Wallet disconnected. Please reconnect and try again.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Connect Wallet', 'connect_wallet')],
            [Markup.button.callback('Main Menu', 'main_menu')],
          ])
        );
      } else {
        // Reset session on other errors
        updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
        await ctx.editMessageText(
          `Failed to create order: ${cleanErrorMessage(errorMessage)}`,
          Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
        );
      }
    } catch (editError) {
      // If editing message fails (e.g., message was already modified by /start), try to reply instead
      console.error('Failed to edit message after error:', editError);
      updateSession(telegramId, { state: UserState.IDLE, pendingOrder: undefined });
      try {
        await ctx.reply(
          'An issue occurred with your order. Please try again from the main menu.',
          Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
        );
      } catch {
        // Last resort failed - user will need to use /start
      }
    }
  }
}
