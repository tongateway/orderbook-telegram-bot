import { Context, Markup } from 'telegraf';
import { getOrCreateUser, disconnectUserWallet } from '../services/userService';
import { disconnectWallet, warmupConnection } from '../services/tonConnectService';
import { getUserOrderHistory, getOrdersByUserAddress, getAvailableCoins, getAllVaults } from '../services/open4devService';
import { UserState } from '../types';
import { resetSessionState } from './sessionManager';
import { Order as ApiOrder, OrderStatus as ApiOrderStatus, Coin, Vault } from '../sdk/types';
import { formatUsd, formatWalletAddress, formatShortAddress } from '../utils/formatters';
import { getStatusEmoji, formatTokenSymbol } from '../constants/tokens';
import { requireWallet, replyOrEdit, formatWalletBalances } from './helpers';
import { Address } from '@ton/core';

export async function handleStart(ctx: Context) {
  const telegramId = ctx.from?.id;
  const username = ctx.from?.username;

  if (!telegramId) {
    return ctx.reply('Unable to identify user.');
  }

  const user = await getOrCreateUser(telegramId, username);

  // Show main menu for everyone
  let menuText: string;
  const buttons: any[][] = [
    [Markup.button.callback('📈 Market Data', 'orderbook')],
    [Markup.button.callback('➕ New Order', 'new_order'), Markup.button.callback('📋 My Orders', 'orders')],
  ];

  if (user.walletAddress) {
    const shortAddr = formatShortAddress(user.walletAddress);
    menuText = `Hey <code>${shortAddr}</code>

What would you like to do? <i>(🔬 Beta)</i>`;
    buttons.push([Markup.button.callback('ℹ️ About', 'about')]);
  } else {
    menuText = `Welcome to TON Order Book Trading Bot! <i>(🔬 Beta)</i>

What would you like to do?`;
    buttons.push([Markup.button.callback('🔗 Connect Wallet', 'connect_wallet')]);
    buttons.push([Markup.button.callback('ℹ️ About', 'about')]);
  }

  await ctx.reply(
    menuText,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    }
  );
}

export async function handleConnect(ctx: Context) {
  await ctx.reply(
    'Select your wallet:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Tonkeeper', 'wallet_tonkeeper')],
      [Markup.button.callback('MyTonWallet', 'wallet_mytonwallet')],
      [Markup.button.callback('Telegram Wallet', 'wallet_telegram')],
    ])
  );
}

export async function handleBalance(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await requireWallet(ctx, telegramId);
  if (!user) return;

  const { balanceText, shortAddr } = await formatWalletBalances(user.walletAddress!);

  const balanceMessage = `<b>💰 Balance</b>

<code>${shortAddr}</code>

${balanceText}`;

  const balanceKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'balance')],
    [Markup.button.callback('◀️ Back', 'main_menu')],
  ]);

  await replyOrEdit(ctx, balanceMessage, { parse_mode: 'HTML', ...balanceKeyboard });
}

export async function handleTrade(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Trade menu is accessible to everyone
  // Wallet check happens when creating new order
  const user = await getOrCreateUser(telegramId);

  // Pre-warm TonConnect connection if wallet connected
  if (user.walletAddress) {
    warmupConnection(telegramId);
  }

  const tradeMessage = `<b>Trade</b>\n\nBrowse pairs or create a new order`;
  const tradeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📈 Market Data', 'orderbook')],
    [Markup.button.callback('➕ New order', 'new_order')],
    [Markup.button.callback('◀️ Back', 'main_menu')],
  ]);

  await replyOrEdit(ctx, tradeMessage, { parse_mode: 'HTML', ...tradeKeyboard });
}

export async function handleOrders(ctx: Context, page: number = 1, showCompleted: boolean = false) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await requireWallet(ctx, telegramId);
  if (!user) return;

  const ORDERS_PER_PAGE = 5;

  try {
    // Fetch all orders from Open4Dev API
    const [allOrders, coins] = await Promise.all([
      getOrdersByUserAddress(user.walletAddress!),
      getAvailableCoins(500),
    ]);

    const getFillMetrics = (order: ApiOrder) => {
      const currentAmount = order.amount ?? 0;
      const initialAmount = order.initial_amount ?? currentAmount;
      const swappedAmount = initialAmount > 0 ? Math.max(0, initialAmount - currentAmount) : 0;
      const filledPercent = initialAmount > 0 ? (swappedAmount / initialAmount) * 100 : 0;
      const displayFilledPercent = Number(filledPercent.toFixed(2));

      return {
        currentAmount,
        initialAmount,
        swappedAmount,
        filledPercent,
        displayFilledPercent,
      };
    };

    // Filter orders based on showCompleted flag.
    // For active orders, hide fully-filled entries based on the same
    // rounded percentage used in UI rendering.
    const orders = showCompleted
      ? allOrders.filter((o) => o.status === 'completed' || o.status === 'cancelled')
      : allOrders.filter((o) => {
          if (o.status !== 'deployed' && o.status !== 'pending_match') return false;
          const metrics = getFillMetrics(o);
          // Hide exhausted orders and anything shown as 100.00% filled.
          if (metrics.initialAmount <= 0) return false;
          if (metrics.displayFilledPercent >= 100) return false;
          if (metrics.currentAmount <= 0) return false;
          return true;
        });

    // Create a map of coin IDs to symbols for display
    const coinMap = new Map<number, Coin>();
    coins.forEach((coin) => coinMap.set(coin.id, coin));

    if (orders.length === 0) {
      const emptyMessage = showCompleted
        ? 'You have no completed orders.'
        : 'You have no active orders.';
      const toggleButton = showCompleted
        ? Markup.button.callback('Show Active', 'orders_active')
        : Markup.button.callback('Show Completed', 'orders_completed');

      return replyOrEdit(
        ctx,
        emptyMessage,
        Markup.inlineKeyboard([
          [toggleButton],
          [Markup.button.callback('◀️ Main Menu', 'main_menu')],
        ])
      );
    }

    // Calculate pagination
    const totalPages = Math.ceil(orders.length / ORDERS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
    const endIndex = Math.min(startIndex + ORDERS_PER_PAGE, orders.length);
    const pageOrders = orders.slice(startIndex, endIndex);

    const orderTypeText = showCompleted ? 'Completed Orders' : 'Active Orders';
    let orderText = `Your ${orderTypeText} (${orders.length})\n`;
    if (totalPages > 1) {
      orderText += `Page ${currentPage} of ${totalPages}\n`;
    }
    orderText += '\n';

    const buttons: any[] = [];

    for (const order of pageOrders) {
      // Use order ID for callbacks (Telegram has 64 byte limit for callback data)
      // The closeOrder handler will fetch the order_address from API when needed
      const orderId = order.id?.toString() || '';
      const shortId = orderId.slice(-4) || 'unknown';

      // Get coin symbols for the pair (coin_id 0 = TON)
      const fromCoinId = order.from_coin_id ?? -1;
      const toCoinId = order.to_coin_id ?? -1;
      const fromSymbol = fromCoinId === 0
        ? 'TON'
        : formatTokenSymbol(coinMap.get(fromCoinId)?.symbol || '???');
      const toSymbol = toCoinId === 0
        ? 'TON'
        : formatTokenSymbol(coinMap.get(toCoinId)?.symbol || '???');

      const orderType = order.type?.toUpperCase() || 'LIMIT';
      const { initialAmount, swappedAmount, filledPercent } = getFillMetrics(order);
      const priceRate = order.price_rate ?? 0;
      const statusEmoji = getStatusEmoji(order.status);

      // Calculate expected receive amount based on initial amount (100% output)
      const expectedReceive = initialAmount * priceRate;

      // Format numbers
      const initialAmountStr = initialAmount > 0 ? initialAmount.toFixed(4) : '—';
      const expectedStr = expectedReceive > 0.01
        ? expectedReceive.toFixed(2)
        : expectedReceive > 0 ? expectedReceive.toFixed(6) : '—';
      const filledStr = filledPercent.toFixed(2);
      const swappedStr = swappedAmount > 0 ? swappedAmount.toFixed(4) : '0';

      // Status text based on order status
      const statusText = order.status === 'pending_match' ? 'Pending'
        : order.status === 'deployed' ? 'Active'
        : order.status === 'completed' ? 'Completed'
        : order.status === 'cancelled' ? 'Cancelled'
        : order.status;

      orderText += `${statusEmoji} <b>Order ${statusText}</b> (#${orderId})\n`;
      orderText += `${fromSymbol} -> ${toSymbol}\n`;
      orderText += `Filled: ${filledStr}% (${swappedStr} ${fromSymbol} swapped)\n`;
      orderText += `Given: ${initialAmountStr} ${fromSymbol} (rate ${priceRate.toFixed(6)})\n`;
      orderText += `Est. Output: ${expectedStr} ${toSymbol}\n\n`;

      // Add cancel button only for active orders (not for completed/cancelled)
      if (!showCompleted && orderId) {
        buttons.push([
          Markup.button.callback(
            `Cancel #${shortId}`,
            `cancel_order_${orderId}`
          ),
        ]);
      }
    }

    // Add pagination buttons if needed
    if (totalPages > 1) {
      const paginationRow = [];
      if (currentPage > 1) {
        paginationRow.push(Markup.button.callback('< Prev', `orders_page_${currentPage - 1}_${showCompleted ? 'completed' : 'active'}`));
      }
      paginationRow.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'orders_page_info'));
      if (currentPage < totalPages) {
        paginationRow.push(Markup.button.callback('Next >', `orders_page_${currentPage + 1}_${showCompleted ? 'completed' : 'active'}`));
      }
      buttons.push(paginationRow);
    }

    // Add toggle button for Active/Completed
    const toggleButton = showCompleted
      ? Markup.button.callback('Show Active', 'orders_active')
      : Markup.button.callback('Show Completed', 'orders_completed');
    buttons.push([toggleButton]);
    buttons.push([Markup.button.callback('◀️ Main Menu', 'main_menu')]);

    await replyOrEdit(ctx, orderText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  } catch (error) {
    console.error('Error fetching orders:', error);
    await replyOrEdit(
      ctx,
      'Failed to fetch orders. Please try again.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Retry', 'orders')],
        [Markup.button.callback('Main Menu', 'main_menu')],
      ])
    );
  }
}

export async function handleHistory(ctx: Context, offset: number = 0) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await requireWallet(ctx, telegramId);
  if (!user) return;

  const limit = 5;

  try {
    const orders = await getUserOrderHistory(user.walletAddress!, {
      limit: limit + 1, // Fetch one extra to check if there are more
      offset,
    });

    const hasMore = orders.length > limit;
    const displayOrders = orders.slice(0, limit);

    if (displayOrders.length === 0 && offset === 0) {
      return replyOrEdit(
        ctx,
        'You have no order history.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Create Order', 'trade')],
          [Markup.button.callback('Main Menu', 'main_menu')],
        ])
      );
    }

    let historyText = `Order History (${offset + 1}-${offset + displayOrders.length}):\n\n`;

    for (const order of displayOrders) {
      const statusEmoji = getStatusEmoji(order.status);
      const orderType = order.type?.toUpperCase() || 'N/A';
      const amount = order.amount?.toFixed(4) || 'N/A';
      const priceRate = order.price_rate?.toFixed(6) || 'N/A';
      const date = order.created_at
        ? new Date(order.created_at).toLocaleDateString()
        : 'N/A';

      historyText += `${statusEmoji} ${orderType}\n`;
      historyText += `Amount: ${amount}\n`;
      historyText += `Price: ${priceRate}\n`;
      historyText += `Status: ${order.status}\n`;
      historyText += `Date: ${date}\n\n`;
    }

    // Build pagination buttons
    const buttons: any[][] = [];

    const navButtons: any[] = [];
    if (offset > 0) {
      navButtons.push(Markup.button.callback('< Prev', `history_page_${Math.max(0, offset - limit)}`));
    }
    if (hasMore) {
      navButtons.push(Markup.button.callback('Next >', `history_page_${offset + limit}`));
    }
    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }

    buttons.push([Markup.button.callback('Main Menu', 'main_menu')]);

    await replyOrEdit(ctx, historyText, Markup.inlineKeyboard(buttons));
  } catch (error) {
    console.error('Error fetching order history:', error);
    await replyOrEdit(
      ctx,
      'Failed to fetch order history. Please try again.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Retry', 'history')],
        [Markup.button.callback('Main Menu', 'main_menu')],
      ])
    );
  }
}

export async function handleHelp(ctx: Context) {
  const helpMessage = `
TON Order Book Trading Bot - Help

Available Commands:
/start - Start the bot and connect wallet
/connect - Connect your TON wallet
/balance - View your wallet balance
/trade - Open trading interface
/orders - View your active orders
/history - View trading history
/disconnect - Disconnect your wallet
/help - Show this help message

How to Trade:
1. Connect your TON wallet
2. Use /trade to select a trading pair
3. Choose Buy or Sell
4. Enter amount and price
5. Confirm the order
6. Sign the transaction in your wallet

Need help? Contact support.
  `;

  await replyOrEdit(
    ctx,
    helpMessage,
    Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'main_menu')]])
  );
}

export async function handleVaults(ctx: Context) {
  try {
    const [vaults, coins] = await Promise.all([
      getAllVaults(),
      getAvailableCoins(500),
    ]);

    if (!vaults || vaults.length === 0) {
      return ctx.reply('No vaults found.');
    }

    // Build a map: normalized minter address -> coin symbol
    const minterToCoin = new Map<string, string>();
    for (const coin of coins) {
      const addr = coin.address || coin.ton_raw_address;
      if (addr) {
        try {
          const normalized = Address.parse(addr).toRawString().toLowerCase();
          minterToCoin.set(normalized, coin.symbol?.toUpperCase() || '???');
        } catch {
          minterToCoin.set(addr.toLowerCase(), coin.symbol?.toUpperCase() || '???');
        }
      }
    }

    let text = '🏦 <b>Vaults</b>\n\n';

    for (const vault of vaults) {
      const vaultType = vault.type?.toUpperCase() || '???';

      // Resolve coin symbol
      let coinSymbol = vaultType === 'TON' ? 'TON' : '???';
      if (vaultType !== 'TON' && vault.jetton_minter_address) {
        try {
          const normalizedMinter = Address.parse(vault.jetton_minter_address).toRawString().toLowerCase();
          coinSymbol = minterToCoin.get(normalizedMinter) || '???';
        } catch {
          coinSymbol = minterToCoin.get(vault.jetton_minter_address.toLowerCase()) || '???';
        }
      }

      // Format the vault address as friendly (EQ...) if possible
      let displayAddress = vault.address;
      try {
        displayAddress = Address.parse(vault.address).toString({ bounceable: true });
      } catch {
        // keep raw
      }

      text += `<b>${coinSymbol}</b> (${vaultType})\n`;
      text += `<code>${displayAddress}</code>\n\n`;
    }

    return ctx.reply(text, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('[vaults command] Error fetching vaults:', error);
    return ctx.reply('Failed to fetch vaults. Please try again later.');
  }
}

export async function handleDisconnect(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return ctx.reply('Unable to identify user.');
  }

  const user = await getOrCreateUser(telegramId);

  if (!user.walletAddress) {
    return ctx.reply(
      'No wallet is currently connected.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Connect Wallet', 'connect_wallet')],
      ])
    );
  }

  const walletAddr = formatWalletAddress(user.walletAddress);

  // Disconnect from TonConnect
  try {
    await disconnectWallet(telegramId);
  } catch (error) {
    console.error(`[disconnect command] Error disconnecting wallet:`, error);
  }

  // Clear wallet from database
  await disconnectUserWallet(user.id);

  await ctx.reply(
    `Wallet disconnected.\n\n<code>${walletAddr}</code>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Connect Wallet', 'connect_wallet')],
      ]),
    }
  );
}

export async function showMainMenu(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    // Reset session when returning to main menu
    resetSessionState(telegramId);
  }

  // Get user to show wallet info
  let menuText = 'What would you like to do? <i>(🔬 Beta)</i>';
  const buttons: any[][] = [
    [Markup.button.callback('📈 Market Data', 'orderbook')],
    [Markup.button.callback('➕ New Order', 'new_order'), Markup.button.callback('📋 My Orders', 'orders')],
  ];

  if (telegramId) {
    const user = await getOrCreateUser(telegramId);
    if (user.walletAddress) {
      const shortAddr = formatShortAddress(user.walletAddress);
      menuText = `Hey <code>${shortAddr}</code>

What would you like to do? <i>(🔬 Beta)</i>`;
      buttons.push([Markup.button.callback('ℹ️ About', 'about')]);
    } else {
      buttons.push([Markup.button.callback('🔗 Connect Wallet', 'connect_wallet')]);
      buttons.push([Markup.button.callback('ℹ️ About', 'about')]);
    }
  }

  const keyboard = Markup.inlineKeyboard(buttons);
  await replyOrEdit(ctx, menuText, { parse_mode: 'HTML', ...keyboard });
}

export async function handleAbout(ctx: Context) {
  const aboutMessage = `<b>ℹ️ About</b>

This is a decentralized trading bot powered by open-source smart contracts on the TON blockchain.

<b>Features:</b>
• Decentralized order book
• Non-custodial trading
• On-chain settlement

<b>GitHub:</b>
<a href="https://github.com/open4dev/order-book">github.com/open4dev/order-book</a>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Back', 'main_menu')],
  ]);

  await replyOrEdit(ctx, aboutMessage, { parse_mode: 'HTML', ...keyboard });
}
