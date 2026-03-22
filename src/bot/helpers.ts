import { Context, Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { getOrCreateUser } from '../services/userService';
import { getWalletBalance } from '../services/walletService';
import { getTokenPrice } from '../services/priceService';
import { formatUsd, formatShortAddress } from '../utils/formatters';
import { formatTokenSymbol } from '../constants/tokens';

/**
 * Reply or edit message based on context (callback vs command)
 */
export async function replyOrEdit(
  ctx: Context,
  text: string,
  options?: any
): Promise<Message.TextMessage | true> {
  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, options) as Promise<Message.TextMessage | true>;
  }
  return ctx.reply(text, options);
}

/**
 * Extract message_id from a message response
 */
export function extractMessageId(message: Message.TextMessage | boolean | undefined): number | undefined {
  if (typeof message === 'object' && 'message_id' in message) {
    return message.message_id;
  }
  return undefined;
}

/**
 * Check if wallet is connected, return early with connect prompt if not
 * Returns user if wallet connected, null otherwise (and sends connect prompt)
 */
export async function requireWallet(ctx: Context, telegramId: number) {
  const user = await getOrCreateUser(telegramId);

  if (!user.walletAddress) {
    await replyOrEdit(
      ctx,
      'Please connect your wallet first.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Connect Wallet', 'connect_wallet')],
      ])
    );
    return null;
  }

  return user;
}

/**
 * Format wallet balances for display
 */
export async function formatWalletBalances(walletAddress: string): Promise<{
  balanceText: string;
  shortAddr: string;
}> {
  const shortAddr = formatShortAddress(walletAddress);

  try {
    const [balance, tonPrice] = await Promise.all([
      getWalletBalance(walletAddress),
      getTokenPrice('TON'),
    ]);

    const tonAmount = parseFloat(balance.ton);
    const tonFormatted = tonAmount.toFixed(4);
    const tonUsdValue = tonPrice ? tonAmount * tonPrice : undefined;
    const tonUsdStr = tonUsdValue !== undefined ? formatUsd(tonUsdValue) : '--';

    const notJetton = balance.jettons.find(j => j.symbol === 'NOT');
    const buildJetton = balance.jettons.find(j => j.symbol === 'BUILD');
    const dogsJetton = balance.jettons.find(j => j.symbol === 'DOGS');
    const pxJetton = balance.jettons.find(j => j.symbol === 'PX');
    const xautJetton = balance.jettons.find(j => j.symbol === 'XAUT0');
    const usdtJetton = balance.jettons.find(j => j.symbol === 'USDT');

    const notBalance = notJetton ? parseFloat(notJetton.balance).toFixed(4) : '--';
    const notUsd = notJetton?.valueUsd !== undefined ? formatUsd(notJetton.valueUsd) : '--';

    const buildBalance = buildJetton ? parseFloat(buildJetton.balance).toFixed(4) : '--';
    const buildUsd = buildJetton?.valueUsd !== undefined ? formatUsd(buildJetton.valueUsd) : '--';

    const dogsBalance = dogsJetton ? parseFloat(dogsJetton.balance).toFixed(4) : '--';
    const dogsUsd = dogsJetton?.valueUsd !== undefined ? formatUsd(dogsJetton.valueUsd) : '--';

    const pxBalance = pxJetton ? parseFloat(pxJetton.balance).toFixed(4) : '--';
    const pxUsd = pxJetton?.valueUsd !== undefined ? formatUsd(pxJetton.valueUsd) : '--';

    const xautBalance = xautJetton ? parseFloat(xautJetton.balance).toFixed(4) : '--';
    const xautUsd = xautJetton?.valueUsd !== undefined ? formatUsd(xautJetton.valueUsd) : '--';

    const usdtBalance = usdtJetton ? parseFloat(usdtJetton.balance).toFixed(4) : '--';
    const usdtUsd = usdtJetton?.valueUsd !== undefined ? formatUsd(usdtJetton.valueUsd) : '--';

    const balanceText = `<b>TON</b>   ${tonFormatted}  <i>~$${tonUsdStr}</i>
<b>NOT</b>   ${notBalance}  <i>~$${notUsd}</i>
<b>BUILD</b> ${buildBalance}  <i>~$${buildUsd}</i>
<b>DOGS</b>  ${dogsBalance}  <i>~$${dogsUsd}</i>
<b>PX</b>    ${pxBalance}  <i>~$${pxUsd}</i>
<b>${formatTokenSymbol('XAUT0')}</b>  ${xautBalance}  <i>~$${xautUsd}</i>
<b>USDT</b>  ${usdtBalance}  <i>~$${usdtUsd}</i>`;

    return { balanceText, shortAddr };
  } catch (error) {
    console.error('Error fetching balance:', error);
    return {
      balanceText: `<b>TON</b>   --
<b>NOT</b>   --
<b>BUILD</b> --
<b>DOGS</b>  --
<b>PX</b>    --
<b>${formatTokenSymbol('XAUT0')}</b>  --
<b>USDT</b>  --`,
      shortAddr,
    };
  }
}

/**
 * Show connected wallet menu (same as main menu)
 */
export async function showConnectedWalletMenu(
  ctx: Context,
  walletAddress: string,
  useReply = false
): Promise<void> {
  const shortAddr = formatShortAddress(walletAddress);

  const menuText = `Hey <code>${shortAddr}</code>

What would you like to do? <i>(🔬 Beta)</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📈 Market Data', 'orderbook')],
    [Markup.button.callback('➕ New Order', 'new_order'), Markup.button.callback('📋 My Orders', 'orders')],
    [Markup.button.callback('ℹ️ About', 'about')],
  ]);

  if (useReply) {
    await ctx.reply(menuText, { parse_mode: 'HTML', ...keyboard });
  } else {
    await replyOrEdit(ctx, menuText, { parse_mode: 'HTML', ...keyboard });
  }
}

/**
 * Build token selection buttons
 */
export function buildTokenButtons(
  tokens: string[],
  actionPrefix: string,
  cancelAction: string
) {
  const tokenButtons = tokens.map(token =>
    Markup.button.callback(token, `${actionPrefix}_${token}`)
  );

  // Arrange tokens in rows of 2
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < tokenButtons.length; i += 2) {
    rows.push(tokenButtons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('Cancel', cancelAction)]);

  return Markup.inlineKeyboard(rows);
}
