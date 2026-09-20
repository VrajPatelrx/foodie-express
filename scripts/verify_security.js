const http = require('http');

async function runTests() {
  console.log('--- STARTING FOODIE EXPRESS SECURITY VERIFICATION ---\n');

  // Check if server is already running (e.g. dev server), otherwise start it
  const isAlreadyRunning = await new Promise(resolve => {
    const ping = http.get({ hostname: '127.0.0.1', port: process.env.PORT || 3000, path: '/api/network-info' }, () => {
      resolve(true);
    });
    ping.on('error', () => resolve(false));
    ping.setTimeout(500, () => {
      ping.destroy();
      resolve(false);
    });
  });

  if (!isAlreadyRunning) {
    require('../server/server.js');
    await new Promise(r => setTimeout(r, 1000));
  }

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: process.env.PORT || 3000,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let data;
          try { data = JSON.parse(raw); } catch (e) { data = raw; }
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      });
      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Security Headers
    console.log('1. Testing HTTP Security Headers:');
    const rootRes = await request('/');
    assert(rootRes.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options is nosniff');
    assert(rootRes.headers['x-frame-options'] === 'SAMEORIGIN', 'X-Frame-Options is SAMEORIGIN');
    assert(!rootRes.headers['x-powered-by'], 'X-Powered-By is disabled');

    // 2. Dynamic Tunnel URL
    console.log('\n2. Testing Dynamic Tunnel URL via /api/network-info:');
    const netRes = await request('/api/network-info');
    assert(netRes.status === 200, 'Network info returns 200');
    assert(Boolean(netRes.body.tunnelUrl), 'Network info includes tunnelUrl from .env');
    assert(netRes.body.tunnelUrl.startsWith('https://'), 'Tunnel URL is valid HTTPS');

    // 3. Admin Authorization Protection
    console.log('\n3. Testing Role-Based Access Control (Admin Routes):');
    const anonAdmin = await request('/api/admin/overview');
    assert(anonAdmin.status === 401, 'Anonymous request to /api/admin/overview rejected with 401');

    const fakeTokenAdmin = await request('/api/admin/overview', {
      headers: { 'Authorization': 'Bearer fake_tampered_token.123.456' }
    });
    assert(fakeTokenAdmin.status === 401, 'Tampered token to /api/admin/overview rejected with 401');

    // 4. Authentication & Signed Token Issuance
    console.log('\n4. Testing Authentication & Signed Tokens:');
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { demoRole: 'ADMIN' }
    });
    assert(adminLogin.status === 200, 'Admin demo login succeeds');
    assert(Boolean(adminLogin.body.token), 'Login returns token');
    const adminToken = adminLogin.body.token;
    assert(adminToken.split('.').length === 3, 'Token is a 3-part cryptographic signature');

    const custLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { demoRole: 'CUSTOMER' }
    });
    const custToken = custLogin.body.token;

    // 5. Customer Accessing Admin Routes
    console.log('\n5. Testing Privilege Separation (Customer forbidden from Admin):');
    const custAdminReq = await request('/api/admin/overview', {
      headers: { 'Authorization': `Bearer ${custToken}` }
    });
    assert(custAdminReq.status === 403, 'Customer token to /api/admin/overview rejected with 403 Forbidden');

    // 6. Admin Accessing Admin Routes
    console.log('\n6. Testing Authorized Admin Access:');
    const validAdminReq = await request('/api/admin/overview', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(validAdminReq.status === 200, 'Admin token successfully accesses /api/admin/overview');
    assert(validAdminReq.body.economics !== undefined, 'Admin receives economic data');

    // 6b. Testing Role Isolation & Multi-Profile Access
    console.log('\n6b. Testing Role Isolation & Multi-Profile Access:');
    const vendorLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { demoRole: 'VENDOR' }
    });
    assert(vendorLogin.status === 200, 'Vendor login succeeds');
    const vendorToken = vendorLogin.body.token;

    const riderLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { demoRole: 'RIDER' }
    });
    assert(riderLogin.status === 200, 'Rider login succeeds');
    const riderToken = riderLogin.body.token;

    // Vendor trying to place customer order -> 403
    const vendorOrderReq = await request('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vendorToken}` },
      body: {
        customer_name: 'Vendor Order Attempt',
        customer_address: '123 Test Street, Anand',
        customer_phone: '9876543210',
        restaurant_id: 1,
        items: [{ menu_item_id: 1, qty: 1 }],
        payment_method: 'UPI'
      }
    });
    assert(vendorOrderReq.status === 403, 'Vendor token forbidden from placing customer orders (403)');

    // Rider trying to place customer order -> 403
    const riderOrderReq = await request('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${riderToken}` },
      body: {
        customer_name: 'Rider Order Attempt',
        customer_address: '123 Test Street, Anand',
        customer_phone: '9876543210',
        restaurant_id: 1,
        items: [{ menu_item_id: 1, qty: 1 }],
        payment_method: 'UPI'
      }
    });
    assert(riderOrderReq.status === 403, 'Rider token forbidden from placing customer orders (403)');

    // Vendor can access Kitchen 1 AND Kitchen 2 (all kitchens accessible to authorized vendor)
    const vRest1 = await request('/api/vendor/1/orders', { headers: { 'Authorization': `Bearer ${vendorToken}` } });
    const vRest2 = await request('/api/vendor/2/orders', { headers: { 'Authorization': `Bearer ${vendorToken}` } });
    assert(vRest1.status === 200 && vRest2.status === 200, 'Vendor token can access all kitchen boards (1 and 2)');

    // Rider can access Rider 1 AND Rider 2 (all riders accessible to authorized rider)
    const rRider1 = await request('/api/riders/1/orders', { headers: { 'Authorization': `Bearer ${riderToken}` } });
    const rRider2 = await request('/api/riders/2/orders', { headers: { 'Authorization': `Bearer ${riderToken}` } });
    assert(rRider1.status === 200 && rRider2.status === 200, 'Rider token can access all rider order queues (1 and 2)');

    // 7. OTP Brute-Force Lockout Defense
    console.log('\n7. Testing OTP Brute-Force Defense:');
    // Create mock order
    const orderRes = await request('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        customer_name: 'Security Test',
        customer_address: '123 Security Test Lane, Anand',
        customer_phone: '9876543210',
        restaurant_id: 1,
        items: [{ menu_item_id: 1, qty: 1 }],
        payment_method: 'UPI'
      }
    });
    assert(orderRes.status === 201, 'Order created successfully');
    const testOrderId = orderRes.body.id;

    // Transition order to OUT_FOR_DELIVERY so OTP verification is accepted
    await request(`/api/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'ACCEPTED' }
    });
    await request(`/api/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'PREPARING' }
    });
    await request(`/api/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'READY' }
    });
    await request(`/api/admin/orders/${testOrderId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { rider_id: 1 }
    });
    await request(`/api/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'PICKED_UP' }
    });
    await request(`/api/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'OUT_FOR_DELIVERY' }
    });

    // Try wrong OTP 5 times
    let lastOtpRes = null;
    for (let i = 0; i < 5; i++) {
      lastOtpRes = await request(`/api/orders/${testOrderId}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: { otp: '0000' }
      });
    }
    assert(lastOtpRes.status === 429, '5th failed OTP attempt triggers 429 Security Lockout');

    console.log(`\n--- TEST RESULTS: ${passed} PASSED, ${failed} FAILED ---`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
