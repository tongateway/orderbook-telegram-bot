/**
 * Create order message template
 */

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface OrderFormData {
  pair?: string;
  side?: OrderSide;
  type?: OrderType;
  amount?: number;
  price?: number;
}

export interface CreateOrderMessageOptions {
  formData: OrderFormData;
  currentPrice?: number;
  availableBalance?: {
    base: number;
    quote: number;
  };
}

/**
 * Create order form message - shows order information and setup buttons
 * This message will be edited as user fills in required fields
 */
export function getCreateOrderMessage(options: CreateOrderMessageOptions) {
  const { formData, currentPrice, availableBalance } = options;

  // Build the message text
  let text = '📝 Create Order\n\n';

  // Pair selection
  if (formData.pair) {
    text += `Pair: ${formData.pair}\n`;
  } else {
    text += 'Pair: Not selected\n';
  }

  // Current market price (if available)
  if (currentPrice) {
    text += `Current Price: ${currentPrice.toFixed(4)}\n\n`;
  } else {
    text += '\n';
  }

  // Order details section
  text += '━━━━━━━━━━━━━━━━━━━━\n';

  // Side
  if (formData.side) {
    const sideEmoji = formData.side === 'BUY' ? '📈' : '📉';
    text += `Side: ${sideEmoji} ${formData.side}\n`;
  } else {
    text += 'Side: Not selected\n';
  }

  // Type
  if (formData.type) {
    text += `Type: ${formData.type}\n`;
  } else {
    text += 'Type: Not selected\n';
  }

  // Amount
  if (formData.amount !== undefined) {
    text += `Amount: ${formData.amount}\n`;
  } else {
    text += 'Amount: Not set\n';
  }

  // Price (for limit orders)
  if (formData.type === 'LIMIT') {
    if (formData.price !== undefined) {
      text += `Price: ${formData.price}\n`;
    } else {
      text += 'Price: Not set\n';
    }
  }

  text += '━━━━━━━━━━━━━━━━━━━━\n';

  // Total calculation
  if (formData.amount && (formData.price || formData.type === 'MARKET')) {
    const estimatedPrice = formData.price || currentPrice || 0;
    const total = formData.amount * estimatedPrice;
    text += `\nEstimated Total: ${total.toFixed(4)}\n`;
  }

  // Available balance
  if (availableBalance) {
    text += `\nAvailable:\n`;
    if (formData.pair) {
      const [base, quote] = formData.pair.split('/');
      text += `${base}: ${availableBalance.base.toFixed(4)}\n`;
      text += `${quote}: ${availableBalance.quote.toFixed(4)}\n`;
    }
  }

  // Build keyboard based on form state
  const keyboard: any[][] = [];

  // Row 1: Pair selection (if not selected)
  if (!formData.pair) {
    keyboard.push([
      { text: '🔀 Select Pair', callback_data: 'order_select_pair' }
    ]);
  }

  // Row 2: Side selection
  if (formData.pair && !formData.side) {
    keyboard.push([
      { text: '📈 Buy', callback_data: 'order_side_buy' },
      { text: '📉 Sell', callback_data: 'order_side_sell' }
    ]);
  }

  // Row 3: Order type selection
  if (formData.side && !formData.type) {
    keyboard.push([
      { text: '📊 Limit', callback_data: 'order_type_limit' },
      { text: '⚡ Market', callback_data: 'order_type_market' }
    ]);
  }

  // Row 4: Amount and Price setup
  if (formData.type) {
    const setupRow = [];

    if (formData.amount === undefined) {
      setupRow.push({ text: '💰 Set Amount', callback_data: 'order_set_amount' });
    } else {
      setupRow.push({ text: '💰 Edit Amount', callback_data: 'order_set_amount' });
    }

    if (formData.type === 'LIMIT') {
      if (formData.price === undefined) {
        setupRow.push({ text: '💵 Set Price', callback_data: 'order_set_price' });
      } else {
        setupRow.push({ text: '💵 Edit Price', callback_data: 'order_set_price' });
      }
    }

    keyboard.push(setupRow);
  }

  // Row 5: Action buttons (if form is complete)
  const isComplete = formData.pair && formData.side && formData.type &&
                     formData.amount !== undefined &&
                     (formData.type === 'MARKET' || formData.price !== undefined);

  if (isComplete) {
    keyboard.push([
      { text: '✅ Confirm Order', callback_data: 'order_confirm' },
      { text: '❌ Cancel', callback_data: 'order_cancel' }
    ]);
  } else {
    keyboard.push([
      { text: '❌ Cancel', callback_data: 'order_cancel' }
    ]);
  }

  // Row 6: Reset button (if partially filled)
  if (formData.side || formData.type || formData.amount !== undefined || formData.price !== undefined) {
    keyboard.push([
      { text: '🔄 Reset', callback_data: 'order_reset' }
    ]);
  }

  return {
    text,
    keyboard: {
      inline_keyboard: keyboard
    }
  };
}

/**
 * Order confirmation message before final submission
 */
export function getOrderConfirmationMessage(formData: Required<Omit<OrderFormData, 'price'>> & { price?: number }) {
  const sideEmoji = formData.side === 'BUY' ? '📈' : '📉';
  const total = formData.type === 'MARKET'
    ? 'Market price'
    : (formData.amount * (formData.price || 0)).toFixed(4);

  let text = '⚠️ Confirm Your Order\n\n';
  text += '━━━━━━━━━━━━━━━━━━━━\n';
  text += `Pair: ${formData.pair}\n`;
  text += `Side: ${sideEmoji} ${formData.side}\n`;
  text += `Type: ${formData.type}\n`;
  text += `Amount: ${formData.amount}\n`;

  if (formData.type === 'LIMIT' && formData.price) {
    text += `Price: ${formData.price}\n`;
  }

  text += `Total: ${total}\n`;
  text += '━━━━━━━━━━━━━━━━━━━━\n\n';
  text += 'Please review carefully before confirming.';

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '✅ Confirm & Sign', callback_data: 'order_sign' },
          { text: '✏️ Edit', callback_data: 'order_edit' }
        ],
        [
          { text: '❌ Cancel', callback_data: 'order_cancel' }
        ]
      ]
    }
  };
}
