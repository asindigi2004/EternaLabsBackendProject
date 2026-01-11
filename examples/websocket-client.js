/**
 * Example WebSocket Client for Order Execution Engine
 * 
 * Usage:
 *   node examples/websocket-client.js
 * 
 * Make sure the server is running on http://localhost:3000
 */

const WebSocket = require('ws');

// First, create an order via HTTP
async function createOrder() {
  const response = await fetch('http://localhost:3000/api/orders/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.orderId;
}

// Connect to WebSocket and listen for status updates
async function connectWebSocket(orderId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/api/orders/execute?orderId=${orderId}`);

    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      console.log(`📡 Listening for updates for order: ${orderId}\n`);
    });

    ws.on('message', (data) => {
      const update = JSON.parse(data.toString());
      
      console.log(`📊 Status Update: ${update.status.toUpperCase()}`);
      console.log(`   Timestamp: ${new Date(update.timestamp).toLocaleString()}`);
      
      if (update.selectedDex) {
        console.log(`   DEX: ${update.selectedDex}`);
      }
      
      if (update.price) {
        console.log(`   Price: ${update.price.toFixed(4)}`);
      }
      
      if (update.errorReason) {
        console.log(`   Error: ${update.errorReason}`);
      }
      
      console.log('');

      // Close connection when order is finalized
      if (update.status === 'confirmed') {
        console.log('🎉 Order confirmed successfully!');
        ws.close();
        resolve(update);
      } else if (update.status === 'failed') {
        console.log('❌ Order failed');
        ws.close();
        reject(new Error(update.errorReason || 'Order failed'));
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      reject(error);
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
    });
  });
}

// Main execution
async function main() {
  try {
    console.log('🚀 Creating order...\n');
    const orderId = await createOrder();
    console.log(`📝 Order created: ${orderId}\n`);
    
    await connectWebSocket(orderId);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { createOrder, connectWebSocket };
