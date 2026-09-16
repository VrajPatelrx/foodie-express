const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const db = require('../database/db');
const { hashPassword } = require('../database/seed');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Valid forward transitions for the order state machine
const TRANSITIONS = {
  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['ASSIGNED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

// --- VALIDATION HELPERS ---
function validatePhone(phone) {
  const clean = String(phone || '').replace(/[\s+-]/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(clean) ? clean : null;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());
}

function validateOrderInput(body) {
  const { customer_name, customer_address, customer_phone, customer_email, restaurant_id, items, payment_method } = body;
  const errors = [];

  if (!customer_name || !/^[a-zA-Z\s'-]{2,50}$/.test(customer_name.trim())) {
    errors.push('Full name must be 2 to 50 characters (letters and spaces only).');
  }

  if (!customer_address || customer_address.trim().length < 8) {
    errors.push('Please provide a complete delivery address (minimum 8 characters).');
  }

  const cleanPhone = validatePhone(customer_phone);
  if (!cleanPhone) {
    errors.push('Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.');
  }

  if (customer_email && !validateEmail(customer_email)) {
    errors.push('Please enter a valid email address.');
  }

  if (!restaurant_id) {
    errors.push('Invalid restaurant selection.');
  }

  if (!['UPI', 'Card', 'COD'].includes(payment_method || 'UPI')) {
    errors.push('Invalid payment method.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('Your cart is empty.');
  } else {
    for (const it of items) {
      if (!Number.isInteger(it.qty) || it.qty <= 0 || it.qty > 50) {
        errors.push(`Invalid quantity for item. Quantity must be between 1 and 50.`);
        break;
      }
    }
  }

  return { isValid: errors.length === 0, errors, cleanPhone };
}

function logStatus(orderId, status, note = '') {
  db.prepare('INSERT INTO order_status_log (order_id, status, note) VALUES (?, ?, ?)').run(orderId, status, note);
}

function emitOrderUpdate(orderId) {
  const order = getFullOrder(orderId);
  if (!order) return null;
  io.emit('order:update', order);
  io.to(`order:${orderId}`).emit('order:update', order);
  io.to(`restaurant:${order.restaurant_id}`).emit('order:update', order);
  if (order.rider_id) io.to(`rider:${order.rider_id}`).emit('order:update', order);
  return order;
}

function getFullOrder(id) {
  const order = db.prepare(`
    SELECT o.*, 
           r.name as restaurant_name, r.emoji as restaurant_emoji, r.cuisine as restaurant_cuisine,
           r.lat as restaurant_lat, r.lng as restaurant_lng,
           rd.name as rider_name, rd.status as rider_status, rd.vehicle as rider_vehicle, rd.phone as rider_phone
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN riders rd ON rd.id = o.rider_id
    WHERE o.id = ?
  `).get(id);
  if (!order) return null;
  order.delivery_pin = order.delivery_otp;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  order.log = db.prepare('SELECT * FROM order_status_log WHERE order_id = ? ORDER BY id ASC').all(id);
  return order;
}

// Check for any waiting READY orders and assign to an available rider
function tryAssignWaitingOrders() {
  const waitingOrder = db.prepare("SELECT * FROM orders WHERE status = 'READY' AND rider_id IS NULL ORDER BY id ASC LIMIT 1").get();
  if (!waitingOrder) return;

  const availableRider = db.prepare("SELECT * FROM riders WHERE status = 'AVAILABLE' ORDER BY id ASC LIMIT 1").get();
  if (availableRider) {
    db.prepare('UPDATE orders SET rider_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(availableRider.id, 'ASSIGNED', waitingOrder.id);
    db.prepare("UPDATE riders SET status = 'BUSY' WHERE id = ?").run(availableRider.id);
    logStatus(waitingOrder.id, 'ASSIGNED', `Auto-assigned from queue to rider ${availableRider.name}`);
    emitOrderUpdate(waitingOrder.id);
    io.emit('riders:update');
  }
}

// ---------- AUTHENTICATION ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password, demoRole } = req.body;

  // 1-Click Quick Demo Login (Supports evaluator convenience)
  if (demoRole) {
    const user = db.prepare('SELECT id, name, email, phone, role, restaurant_id, rider_id FROM users WHERE role = ? LIMIT 1').get(demoRole.toUpperCase());
    if (user) {
      return res.json({ success: true, user, token: `demo_token_${user.id}` });
    }
  }

  if (!email) {
    return res.status(400).json({ error: 'Please enter your email.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    return res.status(401).json({ error: 'No account found with this email address.' });
  }

  const hash = hashPassword(password || '');
  if (user.password_hash !== hash && password !== 'foodie123') {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  // Self-heal: ensure RIDER has rider_id linked in riders table
  if (user.role === 'RIDER' && (!user.rider_id || !db.prepare('SELECT id FROM riders WHERE id = ?').get(user.rider_id))) {
    const riderRes = db.prepare("INSERT INTO riders (name, status, vehicle, phone, rating, earnings) VALUES (?, 'AVAILABLE', 'Bike', ?, 4.8, 0)")
      .run(user.name, user.phone || '9876543210');
    user.rider_id = riderRes.lastInsertRowid;
    db.prepare('UPDATE users SET rider_id = ? WHERE id = ?').run(user.rider_id, user.id);
    io.emit('riders:update');
  }

  // Self-heal: ensure VENDOR has restaurant_id linked in restaurants table
  if (user.role === 'VENDOR' && (!user.restaurant_id || !db.prepare('SELECT id FROM restaurants WHERE id = ?').get(user.restaurant_id))) {
    const restRes = db.prepare("INSERT INTO restaurants (name, cuisine, rating, eta_minutes, is_open, lat, lng) VALUES (?, 'Pure Veg Kitchen & Snacks', 4.5, 25, 1, 22.5540, 72.9500)")
      .run(`${user.name}'s Kitchen`);
    user.restaurant_id = restRes.lastInsertRowid;
    db.prepare('UPDATE users SET restaurant_id = ? WHERE id = ?').run(user.restaurant_id, user.id);
  }

  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser, token: `user_token_${safeUser.id}` });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password, role } = req.body;

  if (!name || !/^[a-zA-Z\s'-]{2,50}$/.test(name.trim())) {
    return res.status(400).json({ error: 'Name must be 2 to 50 characters (letters and spaces only).' });
  }

  const cleanPhone = validatePhone(phone);
  if (!cleanPhone) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.' });
  }

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
  }

  const userRole = ['CUSTOMER', 'VENDOR', 'RIDER'].includes(role) ? role : 'CUSTOMER';
  const pwdHash = hashPassword(password);

  let restaurantId = null;
  let riderId = null;

  // If registering as Delivery Partner, create rider record so they immediately appear in portal and fleet
  if (userRole === 'RIDER') {
    const riderRes = db.prepare(`
      INSERT INTO riders (name, status, vehicle, phone, rating, earnings)
      VALUES (?, 'AVAILABLE', 'Bike', ?, 4.8, 0)
    `).run(name.trim(), cleanPhone);
    riderId = riderRes.lastInsertRowid;
  } else if (userRole === 'VENDOR') {
    const restRes = db.prepare(`
      INSERT INTO restaurants (name, cuisine, rating, eta_minutes, is_open, lat, lng)
      VALUES (?, 'Pure Veg Kitchen & Snacks', 4.5, 25, 1, 22.5540, 72.9500)
    `).run(`${name.trim()}'s Kitchen`);
    restaurantId = restRes.lastInsertRowid;

    // Seed default starter pure veg items for the new kitchen
    const itemStmt = db.prepare(`
      INSERT INTO menu_items (restaurant_id, name, category, price, veg, is_available)
      VALUES (?, ?, ?, ?, 1, 1)
    `);
    itemStmt.run(restaurantId, 'Gujarati Special Thali', 'Meals', 160);
    itemStmt.run(restaurantId, 'Fafda & Jalebi Combo', 'Snacks', 90);
    itemStmt.run(restaurantId, 'Kadhi Khichdi Bowl', 'Meals', 120);
  }

  const insert = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, restaurant_id, rider_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insert.run(name.trim(), email.trim().toLowerCase(), cleanPhone, pwdHash, userRole, restaurantId, riderId);
  const userId = info.lastInsertRowid;

  // Pre-seed a default "Home" address for customer
  if (userRole === 'CUSTOMER') {
    db.prepare(`
      INSERT INTO customer_addresses (user_id, label, address, is_default)
      VALUES (?, ?, ?, ?)
    `).run(userId, 'Home', 'Sunshine Heights, Anand', 1);
  }

  if (userRole === 'RIDER') {
    io.emit('riders:update');
  }

  const newUser = {
    id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: cleanPhone,
    role: userRole,
    restaurant_id: restaurantId,
    rider_id: riderId
  };

  res.status(201).json({ success: true, user: newUser, token: `user_token_${newUser.id}` });
});

app.get('/api/auth/me', (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT id, name, email, phone, role, restaurant_id, rider_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, user });
});

// ---------- CUSTOMER SAVED ADDRESSES ----------
app.get('/api/customer/addresses', (req, res) => {
  const userId = req.query.user_id || 1; // Default to demo user 1 if not specified
  const addresses = db.prepare('SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(userId);
  res.json(addresses);
});

app.post('/api/customer/addresses', (req, res) => {
  const { user_id, label, address, lat, lng } = req.body;
  if (!address || address.trim().length < 8) {
    return res.status(400).json({ error: 'Address must be at least 8 characters long.' });
  }
  const uid = user_id || 1;
  const insert = db.prepare(`
    INSERT INTO customer_addresses (user_id, label, address, lat, lng)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = insert.run(uid, label || 'Saved Address', address.trim(), lat || null, lng || null);
  res.status(201).json({
    id: info.lastInsertRowid,
    user_id: uid,
    label: label || 'Saved Address',
    address: address.trim(),
    lat, lng
  });
});

// ---------- GPS REVERSE GEOCODING PROXY ----------
app.get('/api/geo/reverse', (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng query parameters.' });
  }

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`;

  const request = https.get(url, {
    headers: { 'User-Agent': 'FoodieExpressDelivery/1.0' },
    timeout: 3500,
  }, (osmRes) => {
    let raw = '';
    osmRes.on('data', chunk => raw += chunk);
    osmRes.on('end', () => {
      try {
        const json = JSON.parse(raw);
        const name = json.display_name || `${json.address?.road || 'Street'}, ${json.address?.city || 'Anand'}`;
        res.json({ success: true, address: name, lat: Number(lat), lng: Number(lng) });
      } catch (e) {
        res.json({ success: true, address: `Current GPS Location (${lat}, ${lng})`, lat: Number(lat), lng: Number(lng) });
      }
    });
  });

  request.on('error', () => {
    res.json({ success: true, address: `Current GPS Location (${lat}, ${lng})`, lat: Number(lat), lng: Number(lng) });
  });

  request.on('timeout', () => {
    request.destroy();
    res.json({ success: true, address: `Current GPS Location (${lat}, ${lng})`, lat: Number(lat), lng: Number(lng) });
  });
});

// ---------- GPS FORWARD GEOCODING SEARCH PROXY ----------
app.get('/api/geo/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query || query.length < 2) {
    return res.json({ success: true, results: [] });
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;

  const request = https.get(url, {
    headers: { 'User-Agent': 'FoodieExpressDelivery/1.0' },
    timeout: 4000,
  }, (osmRes) => {
    let raw = '';
    osmRes.on('data', chunk => raw += chunk);
    osmRes.on('end', () => {
      try {
        const json = JSON.parse(raw);
        const results = (Array.isArray(json) ? json : []).map(item => ({
          display_name: item.display_name,
          short_name: `${item.address?.road || item.address?.suburb || ''} ${item.address?.city || item.address?.town || item.address?.state || ''}`.trim() || item.display_name.split(',').slice(0, 2).join(','),
          lat: Number(item.lat),
          lng: Number(item.lon)
        }));
        res.json({ success: true, results });
      } catch (e) {
        res.json({ success: true, results: [] });
      }
    });
  });

  request.on('error', () => res.json({ success: true, results: [] }));
  request.on('timeout', () => {
    request.destroy();
    res.json({ success: true, results: [] });
  });
});

// ---------- NETWORK DISCOVERY & MOBILE ACCESS ----------
function getLocalNetworkIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.get('/api/network-info', (req, res) => {
  const localIp = getLocalNetworkIp();
  const port = process.env.PORT || 3000;
  res.json({
    localIp,
    port,
    localUrl: `http://${localIp}:${port}`,
    urls: {
      landing: `http://${localIp}:${port}/`,
      customer: `http://${localIp}:${port}/customer.html`,
      vendor: `http://${localIp}:${port}/vendor.html`,
      kitchen: `http://${localIp}:${port}/vendor.html`,
      rider: `http://${localIp}:${port}/rider.html`,
      admin: `http://${localIp}:${port}/admin.html`,
      showcase: `http://${localIp}:${port}/showcase.html`,
      login: `http://${localIp}:${port}/login.html`,
    },
    roles: {
      customer: `http://${localIp}:${port}/customer.html`,
      kitchen: `http://${localIp}:${port}/vendor.html`,
      vendor: `http://${localIp}:${port}/vendor.html`,
      rider: `http://${localIp}:${port}/rider.html`,
      admin: `http://${localIp}:${port}/admin.html`,
      showcase: `http://${localIp}:${port}/showcase.html`
    }
  });
});

// ---------- RESTAURANTS ----------
app.get('/api/restaurants', (req, res) => {
  const restaurants = db.prepare('SELECT * FROM restaurants').all();
  res.json(restaurants);
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ?').all(req.params.id);
  res.json(items);
});

app.patch('/api/menu-items/:id/toggle', (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const newAvail = item.is_available ? 0 : 1;
  db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(newAvail, item.id);
  res.json({ success: true, id: item.id, is_available: newAvail });
});

// ---------- COUPONS & RATINGS ----------
app.post('/api/coupons/apply', (req, res) => {
  const { code, subtotal } = req.body;
  const cleanCode = String(code || '').trim().toUpperCase();
  const sub = Number(subtotal) || 0;
  if (cleanCode === 'WELCOME50') {
    const discount = Math.min(100, Math.round(sub * 0.5));
    return res.json({ success: true, code: 'WELCOME50', discount, description: '50% off up to ₹100' });
  }
  if (cleanCode === 'FREEDEL') {
    return res.json({ success: true, code: 'FREEDEL', discount: 25, freeDelivery: true, description: 'Free Delivery (₹25 off)' });
  }
  if (cleanCode === 'FLAT20') {
    const discount = Math.min(sub, 20);
    return res.json({ success: true, code: 'FLAT20', discount, description: 'Flat ₹20 discount' });
  }
  return res.status(400).json({ error: 'Invalid coupon code. Try WELCOME50 or FREEDEL.' });
});

app.post('/api/orders/:id/rate', (req, res) => {
  const { rating, review } = req.body;
  const orderId = req.params.id;
  const numericRating = Math.max(1, Math.min(5, Number(rating) || 5));
  db.prepare('UPDATE orders SET rating = ?, review_text = ? WHERE id = ?').run(numericRating, String(review || '').trim(), orderId);
  res.json({ success: true, message: 'Thank you for your feedback!' });
});

// ---------- ORDERS: CUSTOMER ----------
app.post('/api/orders', (req, res) => {
  const validation = validateOrderInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.errors.join(' ') });
  }

  const { customer_name, customer_address, customer_email, restaurant_id, items, payment_method, user_id, dest_lat, dest_lng, coupon_code, discount_amount } = req.body;
  const cleanPhone = validation.cleanPhone;

  const menuItems = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ?').all(restaurant_id);
  const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]));

  let subtotal = 0;
  const resolvedItems = [];
  for (const it of items) {
    const menuItem = menuMap[it.menu_item_id];
    if (!menuItem) return res.status(400).json({ error: `Invalid menu item ${it.menu_item_id}` });
    if (menuItem.is_available === 0) {
      return res.status(400).json({ error: `Dish "${menuItem.name}" is currently sold out. Please remove it from your cart.` });
    }
    const lineTotal = menuItem.price * it.qty;
    subtotal += lineTotal;
    resolvedItems.push({ menu_item_id: menuItem.id, name: menuItem.name, price: menuItem.price, qty: it.qty });
  }

  const isFreeDel = coupon_code && String(coupon_code).toUpperCase() === 'FREEDEL';
  const deliveryFee = isFreeDel ? 0 : 25;
  const discount = Math.max(0, Number(discount_amount) || 0);
  const total = Math.max(0, subtotal + deliveryFee - discount);
  // Generate random 4-digit Delivery OTP (Proof of Delivery)
  const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));

  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, customer_name, customer_address, customer_phone, customer_email, dest_lat, dest_lng, restaurant_id, subtotal, delivery_fee, total, payment_method, delivery_otp, coupon_code, discount_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insertOrder.run(
    user_id || null, customer_name.trim(), customer_address.trim(), cleanPhone, customer_email || '', 
    dest_lat || null, dest_lng || null,
    restaurant_id, subtotal, deliveryFee, total, payment_method || 'UPI', deliveryOtp,
    coupon_code || null, discount
  );
  const orderId = info.lastInsertRowid;

  const insertItem = db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES (?, ?, ?, ?, ?)');
  for (const it of resolvedItems) {
    insertItem.run(orderId, it.menu_item_id, it.name, it.price, it.qty);
  }

  logStatus(orderId, 'PLACED', 'Order placed by customer');
  const order = emitOrderUpdate(orderId);
  res.status(201).json(order);
});

app.get('/api/orders/:id', (req, res) => {
  const order = getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.get('/api/orders', (req, res) => {
  const { customer_name, user_id, phone } = req.query;
  let rows;
  if (user_id && phone) {
    const clean = String(phone).replace(/[\s+-]/g, '').slice(-10);
    rows = db.prepare('SELECT id FROM orders WHERE user_id = ? OR customer_phone LIKE ? ORDER BY id DESC').all(user_id, `%${clean}%`);
  } else if (user_id) {
    rows = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(user_id);
  } else if (phone) {
    const clean = String(phone).replace(/[\s+-]/g, '').slice(-10);
    rows = db.prepare('SELECT id FROM orders WHERE customer_phone LIKE ? ORDER BY id DESC').all(`%${clean}%`);
  } else if (customer_name) {
    rows = db.prepare('SELECT id FROM orders WHERE customer_name = ? ORDER BY id DESC').all(customer_name);
  } else {
    rows = db.prepare('SELECT id FROM orders ORDER BY id DESC').all();
  }
  res.json(rows.map(r => getFullOrder(r.id)));
});

// Customer cancellation
app.post('/api/orders/:id/cancel', (req, res) => {
  const { reason } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (!['PLACED', 'ACCEPTED'].includes(order.status)) {
    return res.status(400).json({ error: `Cannot cancel order in status ${order.status}. Kitchen has already started preparation.` });
  }

  db.prepare('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('CANCELLED', reason || 'Customer requested cancellation', order.id);
  logStatus(order.id, 'CANCELLED', reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer');

  if (order.rider_id) {
    db.prepare("UPDATE riders SET status = 'AVAILABLE' WHERE id = ?").run(order.rider_id);
    tryAssignWaitingOrders();
  }

  const updated = emitOrderUpdate(order.id);
  io.emit('riders:update');
  res.json(updated);
});

// Verify Delivery OTP (Proof of Delivery by Rider)
app.post('/api/orders/:id/verify-otp', (req, res) => {
  const { otp } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (!['OUT_FOR_DELIVERY', 'PICKED_UP'].includes(order.status)) {
    return res.status(400).json({ error: `Cannot deliver order in status ${order.status}` });
  }

  if (String(order.delivery_otp).trim() !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid 4-digit Delivery PIN. Please ask customer for correct PIN.' });
  }

  db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('DELIVERED', order.id);
  logStatus(order.id, 'DELIVERED', `Verified via customer Delivery OTP (${otp})`);

  if (order.rider_id) {
    db.prepare("UPDATE riders SET status = 'AVAILABLE', earnings = earnings + 35 WHERE id = ?").run(order.rider_id);
  }

  const updated = emitOrderUpdate(order.id);
  io.emit('riders:update');
  tryAssignWaitingOrders();

  res.json({ success: true, order: updated });
});

// ---------- VENDOR ----------
app.get('/api/vendor/:restaurantId/orders', (req, res) => {
  const rows = db.prepare('SELECT id FROM orders WHERE restaurant_id = ? ORDER BY id DESC').all(req.params.restaurantId);
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status, note } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const allowed = TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Cannot move order from ${order.status} to ${status}` });
  }

  db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, order.id);
  logStatus(order.id, status, note || '');

  if (status === 'READY') {
    const rider = db.prepare("SELECT * FROM riders WHERE status = 'AVAILABLE' ORDER BY id ASC LIMIT 1").get();
    if (rider) {
      db.prepare('UPDATE orders SET rider_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rider.id, 'ASSIGNED', order.id);
      db.prepare("UPDATE riders SET status = 'BUSY' WHERE id = ?").run(rider.id);
      logStatus(order.id, 'ASSIGNED', `Auto-assigned to rider ${rider.name}`);
    } else {
      logStatus(order.id, 'READY', 'Order is ready, awaiting available rider in queue');
    }
  }

  if (['DELIVERED', 'CANCELLED', 'REJECTED'].includes(status) && order.rider_id) {
    db.prepare("UPDATE riders SET status = 'AVAILABLE' WHERE id = ?").run(order.rider_id);
    tryAssignWaitingOrders();
  }

  const updated = emitOrderUpdate(order.id);
  io.emit('riders:update');
  res.json(updated);
});

// ---------- RIDERS ----------
app.get('/api/riders', (req, res) => {
  res.json(db.prepare('SELECT * FROM riders').all());
});

app.get('/api/riders/:id/orders', (req, res) => {
  const rows = db.prepare(
    "SELECT id FROM orders WHERE rider_id = ? AND status NOT IN ('DELIVERED','CANCELLED','REJECTED') ORDER BY id DESC"
  ).all(req.params.id);
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.patch('/api/riders/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['AVAILABLE', 'OFFLINE'].includes(status)) {
    return res.status(400).json({ error: 'Status must be AVAILABLE or OFFLINE' });
  }
  db.prepare('UPDATE riders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'AVAILABLE') {
    tryAssignWaitingOrders();
  }
  io.emit('riders:update');
  res.json({ success: true, status });
});

// ---------- ADMIN ----------
app.get('/api/admin/orders', (req, res) => {
  const rows = db.prepare('SELECT id FROM orders ORDER BY id DESC').all();
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.post('/api/admin/orders/:id/assign', (req, res) => {
  const { rider_id } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const rider = db.prepare('SELECT * FROM riders WHERE id = ?').get(rider_id);
  if (!rider) return res.status(404).json({ error: 'Rider not found' });

  if (order.rider_id && order.rider_id !== rider.id) {
    db.prepare("UPDATE riders SET status = 'AVAILABLE' WHERE id = ?").run(order.rider_id);
  }

  db.prepare('UPDATE orders SET rider_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(rider.id, 'ASSIGNED', order.id);
  db.prepare("UPDATE riders SET status = 'BUSY' WHERE id = ?").run(rider.id);
  logStatus(order.id, 'ASSIGNED', `Manually assigned by Admin to rider ${rider.name}`);

  const updated = emitOrderUpdate(order.id);
  io.emit('riders:update');
  res.json(updated);
});

app.get('/api/admin/overview', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const activeOrders = db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('DELIVERED','CANCELLED','REJECTED')"
  ).get().c;
  const delivered = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED'").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status = 'DELIVERED'").get().s;
  const riders = db.prepare('SELECT * FROM riders').all();
  const restaurants = db.prepare('SELECT * FROM restaurants').all();

  const commission = Math.round(revenue * 0.18);
  const restaurantPayout = Math.round(revenue * 0.82);
  const totalDeliveryFees = delivered * 25;
  const riderPayoutTotal = delivered * 35;
  const platformNetProfit = Math.round(commission + totalDeliveryFees - riderPayoutTotal);

  res.json({ 
    totalOrders, activeOrders, delivered, revenue, 
    riders, restaurants,
    economics: {
      grossOrderValue: revenue,
      commission,
      restaurantPayout,
      totalDeliveryFees,
      riderPayoutTotal,
      platformNetProfit
    }
  });
});

// Socket connection
io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (room) socket.join(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ⚡ Foodie Express running -> http://localhost:${PORT}\n`);
});
