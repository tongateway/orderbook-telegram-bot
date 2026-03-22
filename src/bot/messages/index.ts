/**
 * Telegram Bot Message Templates
 *
 * This module exports all message formatting functions for the Telegram bot.
 * Each message returns a formatted text and inline keyboard that can be sent
 * or edited in Telegram.
 */

// Welcome messages
export {
  getWelcomeMessage,
  getWelcomeMessageWithWallet,
  type WelcomeMessageOptions,
  type WalletInfo
} from './welcome';

// Create order messages
export {
  getCreateOrderMessage,
  getOrderConfirmationMessage,
  type OrderFormData,
  type CreateOrderMessageOptions,
  type OrderSide,
  type OrderType
} from './createOrder';

// My orders messages
export {
  getMyOrdersMessage,
  getOrderCancelConfirmation,
  type Order,
  type MyOrdersMessageOptions,
  type OrderStatus
} from './myOrders';

// Order book messages
export {
  getOrderBookMessage,
  getMarketSummaryMessage,
  type OrderBookEntry,
  type OrderBookData,
  type OrderBookMessageOptions
} from './orderBook';

// Swap notification messages
export {
  getSwapNotificationMessage,
  type SwapNotificationMessage
} from './swapNotification';
