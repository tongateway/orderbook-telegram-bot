/**
 * Welcome message templates for /start command
 */

export interface WelcomeMessageOptions {
  username?: string;
}

/**
 * Welcome message for users without connected wallet
 */
export function getWelcomeMessage(options: WelcomeMessageOptions = {}) {
  const greeting = options.username ? `Hi, ${options.username}!` : 'Welcome!';

  return {
    text: `${greeting}

I'm the TON Order Book Trading Bot. I help you trade tokens on the TON blockchain using a decentralized order book.

To get started, you need to connect your TON wallet.`,

    keyboard: {
      inline_keyboard: [
        [{ text: '🔗 Connect Wallet', callback_data: 'connect_wallet' }],
        [{ text: '❓ Help', callback_data: 'help' }]
      ]
    }
  };
}

export interface WalletInfo {
  address: string;
  shortAddress?: string;
}

/**
 * Welcome message for users with connected wallet
 */
export function getWelcomeMessageWithWallet(
  walletInfo: WalletInfo,
  options: WelcomeMessageOptions = {}
) {
  const greeting = options.username ? `Welcome back, ${options.username}!` : 'Welcome back!';
  const displayAddress = walletInfo.shortAddress ||
    `${walletInfo.address.slice(0, 6)}...${walletInfo.address.slice(-4)}`;

  return {
    text: `${greeting}

Wallet: ${displayAddress}

What would you like to do?`,

    keyboard: {
      inline_keyboard: [
        [
          { text: '📊 Create Order', callback_data: 'create_order' },
          { text: '📋 My Orders', callback_data: 'list_orders' }
        ],
        [
          { text: '📖 Order Book', callback_data: 'order_book' },
          { text: '💰 Balance', callback_data: 'balance' }
        ],
        [
          { text: '⚙️ Settings', callback_data: 'settings' },
          { text: '🔌 Disconnect', callback_data: 'disconnect_wallet' }
        ]
      ]
    }
  };
}
