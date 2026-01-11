/**
 * WebSocket Lifecycle Demo
 * Demonstrates full order lifecycle status streaming
 * 
 * This example shows how the WebSocket streams all status updates:
 * pending → routing → building → submitted → confirmed/failed
 * 
 * Usage:
 *   node examples/websocket-lifecycle-demo.js
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

// Connect to WebSocket and listen for ALL lifecycle status updates
async function connectWebSocket(orderId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/api/orders/execute?orderId=${orderId}`);

    const statusHistory = [];

    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      console.log(`📡 Listening for lifecycle updates for order: ${orderId}\n`);
      console.log('Expected lifecycle: pending → routing → building → submitted → confirmed/failed\n');
    });

    ws.on('message', (data) => {
      const update = JSON.parse(data.toString());
      statusHistory.push(update);
      
      console.log(`📊 Status Update #${statusHistory.length}:`);
      console.log(`   Status: ${update.status.toUpperCase()}`);
      console.log(`   Timestamp: ${new Date(update.timestamp).toLocaleString()}`);
      
      if (update.selectedDex) {
        console.log(`   Selected DEX: ${update.selectedDex}`);
      }
      
      if (update.price) {
        console.log(`   Price: ${update.price.toFixed(4)}`);
      }
      
      if (update.errorReason) {
        console.log(`   Error: ${update.errorReason}`);
      }
      
      console.log('');

      // Check if we've received all expected statuses
      const receivedStatuses = statusHistory.map(u => u.status);
      const expectedStatuses = ['pending', 'routing', 'building', 'submitted'];
      const hasAllIntermediate = expectedStatuses.every(s => receivedStatuses.includes(s));
      const isFinal = update.status === 'confirmed' || update.status === 'failed';

      if (isFinal) {
        console.log('🎯 Lifecycle Complete!');
        console.log(`\n📋 Full Status History:`);
        statusHistory.forEach((s, i) => {
          console.log(`   ${i + 1}. ${s.status}${s.selectedDex ? ` (${s.selectedDex})` : ''}${s.price ? ` @ ${s.price.toFixed(4)}` : ''}`);
        });
        
        if (update.status === 'confirmed') {
          console.log('\n🎉 Order confirmed successfully!');
        } else {
          console.log('\n❌ Order failed');
        }
        
        ws.close();
        resolve({ orderId, statusHistory, finalStatus: update.status });
      } else if (hasAllIntermediate && !isFinal) {
        console.log('⏳ Waiting for final status (confirmed/failed)...\n');
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
    console.log('='.repeat(60));
    console.log('LIFECYCLE STREAMING DEMO');
    console.log('='.repeat(60));
    console.log('');
    
    const result = await connectWebSocket(orderId);
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Order ID: ${result.orderId}`);
    console.log(`Final Status: ${result.finalStatus}`);
    console.log(`Total Updates Received: ${result.statusHistory.length}`);
    console.log(`Expected Updates: 5 (pending, routing, building, submitted, confirmed/failed)`);
    
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
