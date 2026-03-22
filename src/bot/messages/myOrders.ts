/**
 * My Orders list message template with pagination
 */

export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface Order {
  id: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  filledAmount: number;
  price?: number;
  status: OrderStatus;
  createdAt: Date;
}

export interface MyOrdersMessageOptions {
  orders: Order[];
  page?: number;
  itemsPerPage?: number;
}

/**
 * Get my orders list message with pagination
 * Shows maximum 3 orders per page by default
 */
export function getMyOrdersMessage(options: MyOrdersMessageOptions) {
  const { orders, page = 1, itemsPerPage = 3 } = options;

  // Handle empty orders
  if (orders.length === 0) {
    return {
      text: '📋 My Orders\n\nYou have no active orders.',
      keyboard: {
        inline_keyboard: [
          [{ text: '📊 Create Order', callback_data: 'create_order' }],
          [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
        ]
      }
    };
  }

  // Calculate pagination
  const totalPages = Math.ceil(orders.length / itemsPerPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, orders.length);
  const pageOrders = orders.slice(startIndex, endIndex);

  // Build message text
  let text = `📋 My Orders (${orders.length})\n\n`;

  if (totalPages > 1) {
    text += `Page ${currentPage} of ${totalPages}\n\n`;
  }

  // Add each order
  pageOrders.forEach((order, index) => {
    const orderNumber = startIndex + index + 1;
    text += formatOrderDetails(order, orderNumber);

    // Add separator between orders (but not after the last one)
    if (index < pageOrders.length - 1) {
      text += '\n';
    }
  });

  // Build keyboard
  const keyboard: any[][] = [];

  // Add cancel buttons for each order on this page
  const cancelButtons: any[] = [];
  pageOrders.forEach((order, index) => {
    if (order.status === 'OPEN' || order.status === 'PARTIAL') {
      const orderNumber = startIndex + index + 1;
      cancelButtons.push({
        text: `❌ #${orderNumber}`,
        callback_data: `cancel_order_${order.id}`
      });
    }
  });

  // Add cancel buttons in rows of 3
  for (let i = 0; i < cancelButtons.length; i += 3) {
    keyboard.push(cancelButtons.slice(i, i + 3));
  }

  // Add pagination buttons if needed
  if (totalPages > 1) {
    const paginationRow = [];

    if (currentPage > 1) {
      paginationRow.push({
        text: '◀️ Previous',
        callback_data: `orders_page_${currentPage - 1}`
      });
    }

    paginationRow.push({
      text: `${currentPage}/${totalPages}`,
      callback_data: 'orders_page_info'
    });

    if (currentPage < totalPages) {
      paginationRow.push({
        text: 'Next ▶️',
        callback_data: `orders_page_${currentPage + 1}`
      });
    }

    keyboard.push(paginationRow);
  }

  // Add action buttons
  keyboard.push([
    { text: '📊 New Order', callback_data: 'create_order' }
  ]);

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
 * Format individual order details
 */
function formatOrderDetails(order: Order, orderNumber: number): string {
  const sideEmoji = order.side === 'BUY' ? '📈' : '📉';
  const statusEmoji = getStatusEmoji(order.status);

  let text = `${orderNumber}. Order #${order.id.slice(-6)}\n`;
  text += '━━━━━━━━━━━━━━━━━━━━\n';
  text += `${sideEmoji} ${order.side} ${order.type}\n`;
  text += `Pair: ${order.pair}\n`;

  if (order.price) {
    text += `Price: ${order.price.toFixed(4)}\n`;
  }

  text += `Amount: ${order.amount.toFixed(4)}\n`;

  // Show filled amount if partially or fully filled
  if (order.filledAmount > 0) {
    const fillPercentage = order.amount > 0 ? (order.filledAmount / order.amount * 100).toFixed(1) : '0.0';
    text += `Filled: ${order.filledAmount.toFixed(4)} (${fillPercentage}%)\n`;
  }

  // Remaining amount for partial fills
  if (order.status === 'PARTIAL') {
    const remaining = order.amount - order.filledAmount;
    text += `Remaining: ${remaining.toFixed(4)}\n`;
  }

  text += `Status: ${statusEmoji} ${order.status}\n`;
  text += '━━━━━━━━━━━━━━━━━━━━\n';

  return text;
}

/**
 * Get emoji for order status
 */
function getStatusEmoji(status: OrderStatus): string {
  switch (status) {
    case 'OPEN':
      return '🟢';
    case 'PARTIAL':
      return '🟡';
    case 'FILLED':
      return '✅';
    case 'CANCELLED':
      return '❌';
    default:
      return '⚪';
  }
}

/**
 * Order cancellation confirmation message
 */
export function getOrderCancelConfirmation(order: Order) {
  const sideEmoji = order.side === 'BUY' ? '📈' : '📉';

  let text = '⚠️ Cancel Order?\n\n';
  text += `Order #${order.id.slice(-6)}\n`;
  text += `${sideEmoji} ${order.side} ${order.type}\n`;
  text += `Pair: ${order.pair}\n`;
  text += `Amount: ${order.amount.toFixed(4)}\n`;

  if (order.price) {
    text += `Price: ${order.price.toFixed(4)}\n`;
  }

  if (order.filledAmount > 0) {
    text += `\nFilled: ${order.filledAmount.toFixed(4)}\n`;
    const remaining = order.amount - order.filledAmount;
    text += `Remaining: ${remaining.toFixed(4)}\n`;
  }

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '✅ Yes, Cancel', callback_data: `confirm_cancel_${order.id}` },
          { text: '❌ No, Keep It', callback_data: 'orders_refresh' }
        ]
      ]
    }
  };
}
