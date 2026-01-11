const WebSocket = require('ws');

const SERVER_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test 1: Create a new order and watch all statuses stream in real-time
async function testNewOrderFlow() {
  log('\n=== TEST 1: New Order Flow (Real-time Status Updates) ===', 'cyan');
  
  try {
    // Step 1: Create an order
    log('\n📝 Creating new order...', 'blue');
    const createResponse = await fetch(`${SERVER_URL}/api/orders/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenIn: 'USDC',
        tokenOut: 'SOL',
        amount: 1000,
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create order: ${createResponse.statusText}`);
    }

    const createData = await createResponse.json();
    const orderId = createData.orderId;
    log(`✅ Order created: ${orderId}`, 'green');

    // Small delay to ensure order is in the queue before connecting
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 2: Connect to WebSocket and capture all status updates
    log(`\n🔌 Connecting to WebSocket for order ${orderId}...`, 'blue');
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}/api/orders/execute?orderId=${orderId}`);
      const receivedStatuses = [];
      const expectedStatuses = ['pending', 'routing', 'building', 'submitted'];
      let timeout;

      ws.on('open', () => {
        log('✅ WebSocket connected', 'green');
        log('⏳ Waiting for status updates...\n', 'yellow');
        
        // Set timeout for test completion (10 seconds should be enough)
        timeout = setTimeout(() => {
          ws.close();
          analyzeResults(orderId, receivedStatuses, expectedStatuses, resolve, reject);
        }, 15000);
      });

      ws.on('message', (data) => {
        try {
          const update = JSON.parse(data.toString());
          receivedStatuses.push(update);
          
          log(`📨 Status update received: ${update.status}`, 'green');
          log(`   - selectedDex: ${update.selectedDex ?? 'undefined'}`, 'reset');
          log(`   - price: ${update.price ?? 'undefined'}`, 'reset');
          log(`   - timestamp: ${update.timestamp}\n`, 'reset');

          // Check if we received a final status
          if (update.status === 'confirmed' || update.status === 'failed') {
            log(`✅ Final status received: ${update.status}`, 'green');
            if (update.status === 'failed') {
              log(`   - errorReason: ${update.errorReason}`, 'yellow');
            }
            clearTimeout(timeout);
            setTimeout(() => {
              ws.close();
              expectedStatuses.push(update.status);
              analyzeResults(orderId, receivedStatuses, expectedStatuses, resolve, reject);
            }, 500);
          }
        } catch (error) {
          log(`❌ Error parsing message: ${error.message}`, 'red');
        }
      });

      ws.on('error', (error) => {
        log(`❌ WebSocket error: ${error.message}`, 'red');
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('close', () => {
        log('\n🔌 WebSocket connection closed', 'blue');
      });
    });
  } catch (error) {
    log(`❌ Test failed: ${error.message}`, 'red');
    throw error;
  }
}

// Test 2: Connect to an existing completed order and verify replay
async function testOrderReplay(existingOrderId) {
  log('\n=== TEST 2: Order Replay (Completed Order) ===', 'cyan');
  log(`📋 Testing with existing order: ${existingOrderId}`, 'blue');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/api/orders/execute?orderId=${existingOrderId}`);
    const receivedStatuses = [];
    const expectedStatuses = ['pending', 'routing', 'building', 'submitted'];
    let timeout;

    ws.on('open', () => {
      log('✅ WebSocket connected', 'green');
      log('⏳ Waiting for status replay...\n', 'yellow');
      
      // Set timeout for test completion
      timeout = setTimeout(() => {
        ws.close();
        analyzeResults(existingOrderId, receivedStatuses, expectedStatuses, resolve, reject, true);
      }, 2000);
    });

    ws.on('message', (data) => {
      try {
        const update = JSON.parse(data.toString());
        receivedStatuses.push(update);
        
        log(`📨 Status replayed: ${update.status}`, 'green');
        log(`   - selectedDex: ${update.selectedDex ?? 'undefined'}`, 'reset');
        log(`   - price: ${update.price ?? 'undefined'}`, 'reset');
        log(`   - timestamp: ${update.timestamp}\n`, 'reset');

        // Check if we received a final status (for completed orders)
        if (update.status === 'confirmed' || update.status === 'failed') {
          log(`✅ Final status replayed: ${update.status}`, 'green');
          expectedStatuses.push(update.status);
          clearTimeout(timeout);
          setTimeout(() => {
            ws.close();
            analyzeResults(existingOrderId, receivedStatuses, expectedStatuses, resolve, reject, true);
          }, 300);
        }
      } catch (error) {
        log(`❌ Error parsing message: ${error.message}`, 'red');
      }
    });

    ws.on('error', (error) => {
      log(`❌ WebSocket error: ${error.message}`, 'red');
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      log('\n🔌 WebSocket connection closed', 'blue');
    });
  });
}

function analyzeResults(orderId, receivedStatuses, expectedStatuses, resolve, reject, isReplay = false) {
  log('\n=== TEST RESULTS ===', 'cyan');
  log(`Order ID: ${orderId}`, 'blue');
  log(`Received ${receivedStatuses.length} status updates`, 'blue');
  
  const receivedStatusNames = receivedStatuses.map(s => s.status);
  log(`\nReceived statuses: [${receivedStatusNames.join(' → ')}]`, 'yellow');
  log(`Expected statuses: [${expectedStatuses.join(' → ')}]`, 'yellow');

  // Validate all required fields are present
  let allFieldsValid = true;
  receivedStatuses.forEach((status, index) => {
    const requiredFields = ['orderId', 'status', 'timestamp'];
    const missingFields = requiredFields.filter(field => !(field in status));
    
    if (missingFields.length > 0) {
      log(`❌ Status ${status.status} missing fields: ${missingFields.join(', ')}`, 'red');
      allFieldsValid = false;
    }

    // Validate conditional fields
    if (['building', 'submitted', 'confirmed', 'failed'].includes(status.status)) {
      if (status.selectedDex === undefined) {
        log(`⚠️  Warning: Status ${status.status} should have selectedDex`, 'yellow');
      }
      if (status.price === undefined) {
        log(`⚠️  Warning: Status ${status.status} should have price`, 'yellow');
      }
    }

    if (status.status === 'failed' && !status.errorReason) {
      log(`⚠️  Warning: Failed status should have errorReason`, 'yellow');
    }
  });

  // Check if we got all expected statuses
  const allStatusesReceived = expectedStatuses.every(status => 
    receivedStatusNames.includes(status)
  );

  // Check if statuses are in correct order
  let correctOrder = true;
  let lastIndex = -1;
  for (const expectedStatus of expectedStatuses) {
    const currentIndex = receivedStatusNames.indexOf(expectedStatus);
    if (currentIndex === -1) {
      correctOrder = false;
      break;
    }
    if (currentIndex < lastIndex) {
      correctOrder = false;
      break;
    }
    lastIndex = currentIndex;
  }

  if (allStatusesReceived && correctOrder && allFieldsValid) {
    log('\n✅ TEST PASSED!', 'green');
    log(`   ✓ All ${expectedStatuses.length} statuses received`, 'green');
    log(`   ✓ Statuses in correct order`, 'green');
    log(`   ✓ All required fields present`, 'green');
    resolve({ orderId, receivedStatuses, passed: true });
  } else {
    log('\n❌ TEST FAILED!', 'red');
    if (!allStatusesReceived) {
      const missing = expectedStatuses.filter(s => !receivedStatusNames.includes(s));
      log(`   ✗ Missing statuses: ${missing.join(', ')}`, 'red');
    }
    if (!correctOrder) {
      log(`   ✗ Statuses not in correct order`, 'red');
    }
    if (!allFieldsValid) {
      log(`   ✗ Some statuses missing required fields`, 'red');
    }
    reject(new Error('Test failed'));
  }
}

// Main test runner
async function runTests() {
  log('\n🚀 Starting WebSocket Status Streaming Tests\n', 'cyan');
  log('='.repeat(60), 'cyan');

  try {
    // Check if server is running
    log('\n🔍 Checking if server is running...', 'blue');
    try {
      const healthResponse = await fetch(`${SERVER_URL}/health`);
      if (!healthResponse.ok) {
        throw new Error('Server health check failed');
      }
      const health = await healthResponse.json();
      log('✅ Server is running', 'green');
      log(`   Database: ${health.services.database}`, 'reset');
      log(`   Redis: ${health.services.redis}`, 'reset');
    } catch (error) {
      log('❌ Server is not running or not accessible', 'red');
      log('   Please start the server first: npm run dev', 'yellow');
      process.exit(1);
    }

    // Test 1: New order flow
    await testNewOrderFlow();
    
    // Test 2: Order replay (use the order ID from Test 1 if available, or use existing one)
    // You can pass an existing order ID here, or we'll skip this test
    const existingOrderId = process.argv[2];
    if (existingOrderId) {
      await testOrderReplay(existingOrderId);
    } else {
      log('\n⚠️  Skipping replay test - no existing order ID provided', 'yellow');
      log('   To test replay, run: node test-websocket.js <orderId>', 'yellow');
    }

    log('\n' + '='.repeat(60), 'cyan');
    log('\n✅ All tests completed!', 'green');
    process.exit(0);
  } catch (error) {
    log(`\n❌ Test suite failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Check if fetch is available (Node 18+), otherwise use node-fetch
if (typeof fetch === 'undefined') {
  log('⚠️  Node.js 18+ required for fetch API', 'yellow');
  log('   Installing node-fetch...', 'yellow');
  process.exit(1);
}

// Run tests
runTests();
