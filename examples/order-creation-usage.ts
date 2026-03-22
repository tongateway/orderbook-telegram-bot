/**
 * Order Creation Service Usage Examples
 *
 * This file demonstrates how to use the order creation service
 * to create, close, and match orders on the TON blockchain
 */

import {
  createNewOrder,
  closeOrder,
  matchOrders,
  validateOrderRequest,
  OrderCreationRequest,
} from '../src/services/orderCreationService';
import {
  buildTonOrderMessage,
  buildJettonOrderMessage,
  buildCloseOrderMessage,
  calculatePriceRate,
  calculateSlippage,
} from '../src/services/tonOrderService';

// ============================================================================
// Example 1: Create a Limit Order (TON → USDT)
// ============================================================================

async function exampleCreateTonLimitOrder() {
  const request: OrderCreationRequest = {
    telegramId: 123456789,
    userAddress: 'EQD...',
    fromCoinId: 1, // TON
    toCoinId: 2, // USDT
    amount: 10, // 10 TON
    price: 3.5, // 1 TON = 3.5 USDT
    slippagePercent: 2, // 2% slippage
    orderType: 'LIMIT',
  };

  // Validate request
  const validation = validateOrderRequest(request);
  if (!validation.valid) {
    console.error('Invalid request:', validation.error);
    return;
  }

  // Create order
  const result = await createNewOrder(request);

  if (result.success) {
    console.log('Order created successfully!');
    console.log('Transaction hash:', result.transactionHash);
    console.log('Order address:', result.orderAddress);
  } else {
    console.error('Failed to create order:', result.error);
  }
}

// ============================================================================
// Example 2: Create a Market Order (USDT → TON)
// ============================================================================

async function exampleCreateJettonMarketOrder() {
  const request: OrderCreationRequest = {
    telegramId: 123456789,
    userAddress: 'EQD...',
    fromCoinId: 2, // USDT
    toCoinId: 1, // TON
    amount: 100, // 100 USDT
    // No price for market order - uses current market price
    slippagePercent: 5, // 5% slippage for market order
    orderType: 'MARKET',
  };

  const result = await createNewOrder(request);

  if (result.success) {
    console.log('Market order created!');
    console.log(result.message);
  } else {
    console.error('Failed:', result.error);
  }
}

// ============================================================================
// Example 3: Close an Existing Order
// ============================================================================

async function exampleCloseOrder() {
  const telegramId = 123456789;
  const orderAddress = 'EQC...'; // Order contract address

  const result = await closeOrder(telegramId, orderAddress);

  if (result.success) {
    console.log('Order closed successfully!');
    console.log('Transaction hash:', result.transactionHash);
  } else {
    console.error('Failed to close order:', result.error);
  }
}

// ============================================================================
// Example 4: Match Two Orders
// ============================================================================

async function exampleMatchOrders() {
  const telegramId = 123456789;
  const myOrderId = 'order-123'; // From Open4Dev API
  const anotherOrderId = 'order-456'; // From Open4Dev API
  const matchAmount = 5; // Match 5 tokens

  const result = await matchOrders(telegramId, myOrderId, anotherOrderId, matchAmount);

  if (result.success) {
    console.log('Orders matched successfully!');
    console.log('Transaction hash:', result.transactionHash);
  } else {
    console.error('Failed to match orders:', result.error);
  }
}

// ============================================================================
// Example 5: Build Order Messages Manually (Low-level API)
// ============================================================================

function exampleBuildMessagesManually() {
  // Example 5a: Build TON order message
  const tonOrderMessage = buildTonOrderMessage({
    userAddress: 'EQD...',
    vaultAddress: 'EQC...',
    amount: '10', // 10 TON
    priceRate: calculatePriceRate(3.5).toString(), // 1 TON = 3.5 USDT
    slippage: calculateSlippage(2).toString(), // 2%
    toJettonMinter: 'EQB...', // USDT minter address
  });

  console.log('TON Order Message:');
  console.log('To:', tonOrderMessage.to);
  console.log('Value:', tonOrderMessage.value, 'nanoTON');
  console.log('Payload:', tonOrderMessage.payload);

  // Example 5b: Build Jetton order message
  const jettonOrderMessage = buildJettonOrderMessage({
    userAddress: 'EQD...',
    vaultAddress: 'EQC...',
    amount: '100', // 100 USDT
    priceRate: calculatePriceRate(0.285).toString(), // 1 USDT = 0.285 TON
    slippage: calculateSlippage(2).toString(),
    toJettonMinter: null, // Receiving TON
    fromJettonWallet: 'EQA...', // User's USDT wallet
    forwardTonAmount: '0.1',
  });

  console.log('Jetton Order Message:');
  console.log('To:', jettonOrderMessage.to);
  console.log('Value:', jettonOrderMessage.value, 'nanoTON');
  console.log('Payload:', jettonOrderMessage.payload);

  // Example 5c: Build close order message
  const closeMessage = buildCloseOrderMessage('EQC...');

  console.log('Close Order Message:');
  console.log('To:', closeMessage.to);
  console.log('Value:', closeMessage.value, 'nanoTON');
  console.log('Payload:', closeMessage.payload);
}

// ============================================================================
// Example 6: Calculate Price Rate and Slippage
// ============================================================================

function exampleCalculateParameters() {
  // Calculate price rate
  // If 1 TON = 3.5 USDT, then priceRate = 3.5 * 10^18
  const priceRate1 = calculatePriceRate(3.5);
  console.log('Price rate for 1 TON = 3.5 USDT:', priceRate1.toString());

  // If 1 USDT = 0.285 TON, then priceRate = 0.285 * 10^18
  const priceRate2 = calculatePriceRate(0.285);
  console.log('Price rate for 1 USDT = 0.285 TON:', priceRate2.toString());

  // Calculate slippage
  const slippage2Percent = calculateSlippage(2);
  console.log('2% slippage:', slippage2Percent.toString());

  const slippage5Percent = calculateSlippage(5);
  console.log('5% slippage:', slippage5Percent.toString());
}

// ============================================================================
// Run Examples
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('Order Creation Service Examples');
  console.log('========================================\n');

  // Uncomment the example you want to run:

  // await exampleCreateTonLimitOrder();
  // await exampleCreateJettonMarketOrder();
  // await exampleCloseOrder();
  // await exampleMatchOrders();
  // exampleBuildMessagesManually();
  exampleCalculateParameters();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  exampleCreateTonLimitOrder,
  exampleCreateJettonMarketOrder,
  exampleCloseOrder,
  exampleMatchOrders,
  exampleBuildMessagesManually,
  exampleCalculateParameters,
};
