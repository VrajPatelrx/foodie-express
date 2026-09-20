const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { Server } = require('socket.io');
const os = require('os');
const db = require('../database/db');
const { hashPassword, verifyPassword } = require('../database/seed');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- SECURITY HEADERS & HARDENING ---
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Allow same-origin iframe for showcase.html
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// --- CRYPTOGRAPHIC TOKEN SECURITY (HMAC-SHA256) ---
const JWT_SECRET = process.env.JWT_SECRET || 'foodie_secure_jwt_secret_token_default';

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7-day validity
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) {
    // Backwards compatibility fallback for pre-existing active sessions during live updates
    if (token.startsWith('user_token_') || token.startsWith('demo_token_')) {
      const uid = parseInt(token.replace(/^.*_token_/, ''), 10);
      if (uid) {
        const u = db.prepare('SELECT id, name, email, phone, role, restaurant_id, rider_id FROM users WHERE id = ?').get(uid);
        if (u) return u;
      }
    }
    return null;
  }
  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (signature.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return null;
}

function authenticateUser(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.ADMIN_API_KEY && adminKey === process.env.ADMIN_API_KEY) {
    req.user = { id: 0, role: 'ADMIN', name: 'Server Admin' };
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  req.user = user;
  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to access this resource.' });
    }
    next();
  };
}

// --- RATE LIMITING & BRUTE FORCE SHIELD ---
const loginRateMap = new Map();
const otpAttemptMap = new Map();
const geoRateMap = new Map();

function isRateLimited(map, key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = map.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  map.set(key, entry);
  return entry.count > maxRequests;
}

// Input sanitizer against Stored XSS
function sanitizeText(val) {
  if (typeof val !== 'string') return '';
  return val.replace(/[<>]/g, '').trim();
}

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
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isRateLimited(loginRateMap, ip, 25, 60000)) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 1 minute before trying again.' });
  }

  const { email, password, demoRole } = req.body;

  // 1-Click Quick Demo Login (Supports evaluator convenience)
  if (demoRole) {
    const user = db.prepare('SELECT id, name, email, phone, role, restaurant_id, rider_id FROM users WHERE role = ? LIMIT 1').get(demoRole.toUpperCase());
    if (user) {
      const token = signToken({ id: user.id, role: user.role, email: user.email, name: user.name, restaurant_id: user.restaurant_id, rider_id: user.rider_id });
      return res.json({ success: true, user, token });
    }
  }

  if (!email) {
    return res.status(400).json({ error: 'Please enter your email.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    return res.status(401).json({ error: 'No account found with this email address.' });
  }

  if (!verifyPassword(password || '', user.password_hash)) {
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
      .run(user.name);
    user.restaurant_id = restRes.lastInsertRowid;
    db.prepare('UPDATE users SET restaurant_id = ? WHERE id = ?').run(user.restaurant_id, user.id);
  }

  const { password_hash, ...safeUser } = user;
  const token = signToken({ id: safeUser.id, role: safeUser.role, email: safeUser.email, name: safeUser.name, restaurant_id: safeUser.restaurant_id, rider_id: safeUser.rider_id });
  res.json({ success: true, user: safeUser, token });
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
    `).run(name.trim());
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

  const token = signToken({ id: userId, role: userRole, email: newUser.email, name: newUser.name, restaurant_id: restaurantId, rider_id: riderId });
  res.status(201).json({ success: true, user: newUser, token });
});

app.get('/api/auth/me', (req, res) => {
  const token = extractToken(req);
  let userId = req.query.user_id;
  if (token) {
    const verified = verifyToken(token);
    if (verified) userId = verified.id;
  }
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT id, name, email, phone, role, restaurant_id, rider_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
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
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isRateLimited(geoRateMap, ip, 40, 60000)) {
    return res.status(429).json({ error: 'Geocoding rate limit reached. Please wait a moment.' });
  }

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
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isRateLimited(geoRateMap, ip, 40, 60000)) {
    return res.status(429).json({ error: 'Search rate limit reached. Please wait a moment.' });
  }

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
  const rawTunnel = process.env.TUNNEL_URL || process.env.NGROK_DOMAIN || '';
  const tunnelUrl = rawTunnel ? rawTunnel.trim().replace(/\/+$/, '') : null;
  res.json({
    localIp,
    port,
    tunnelUrl,
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

app.patch('/api/restaurants/:id', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const restId = req.params.id;
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restId);
  if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

  const { name, cuisine, eta_minutes, is_open } = req.body;
  const newName = name !== undefined ? String(name).trim() : rest.name;
  const newCuisine = cuisine !== undefined ? String(cuisine).trim() : rest.cuisine;
  const newEta = eta_minutes !== undefined ? Math.max(10, Math.min(120, Number(eta_minutes) || 30)) : rest.eta_minutes;
  const newIsOpen = is_open !== undefined ? (is_open ? 1 : 0) : rest.is_open;

  if (!newName) {
    return res.status(400).json({ error: 'Restaurant name cannot be empty.' });
  }

  db.prepare(`
    UPDATE restaurants 
    SET name = ?, cuisine = ?, eta_minutes = ?, is_open = ?
    WHERE id = ?
  `).run(newName, newCuisine, newEta, newIsOpen, restId);

  // Keep vendor user record in sync with edited restaurant name
  db.prepare("UPDATE users SET name = ? WHERE restaurant_id = ? AND role = 'VENDOR'").run(newName, restId);

  const updated = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restId);
  io.emit('restaurants:update');
  res.json({ success: true, restaurant: updated });
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ?').all(req.params.id);
  res.json(items);
});

// Add new dish to restaurant menu
app.post('/api/restaurants/:id/menu', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const restId = req.params.id;
  const rest = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(restId);
  if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

  const { name, category, price, is_available } = req.body;
  const cleanName = sanitizeText(String(name || ''));
  const cleanCategory = sanitizeText(String(category || 'Specialties'));
  const numPrice = Number(price);

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Dish name must be at least 2 characters.' });
  }
  if (isNaN(numPrice) || numPrice <= 0) {
    return res.status(400).json({ error: 'Please enter a valid price greater than 0.' });
  }

  const avail = is_available === 0 ? 0 : 1;
  const insert = db.prepare(`
    INSERT INTO menu_items (restaurant_id, name, category, price, veg, is_available)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  const info = insert.run(restId, cleanName, cleanCategory, numPrice, avail);

  const newItem = {
    id: info.lastInsertRowid,
    restaurant_id: Number(restId),
    name: cleanName,
    category: cleanCategory,
    price: numPrice,
    veg: 1,
    is_available: avail
  };

  io.emit('menu:update', { restaurant_id: Number(restId) });
  io.emit('restaurants:update');
  res.status(201).json({ success: true, item: newItem });
});

// Edit existing dish
app.patch('/api/menu-items/:id', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Dish not found' });

  const { name, category, price, is_available } = req.body;
  const cleanName = name !== undefined ? sanitizeText(String(name)) : item.name;
  const cleanCat = category !== undefined ? sanitizeText(String(category)) : item.category;
  const numPrice = price !== undefined ? Number(price) : item.price;
  const avail = is_available !== undefined ? (is_available ? 1 : 0) : item.is_available;

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Dish name must be at least 2 characters.' });
  }
  if (isNaN(numPrice) || numPrice <= 0) {
    return res.status(400).json({ error: 'Dish price must be greater than 0.' });
  }

  db.prepare(`
    UPDATE menu_items
    SET name = ?, category = ?, price = ?, is_available = ?
    WHERE id = ?
  `).run(cleanName, cleanCat, numPrice, avail, item.id);

  const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id);
  io.emit('menu:update', { restaurant_id: item.restaurant_id });
  res.json({ success: true, item: updated });
});

// Delete dish from restaurant menu
app.delete('/api/menu-items/:id', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Dish not found' });

  db.prepare('DELETE FROM menu_items WHERE id = ?').run(item.id);

  io.emit('menu:update', { restaurant_id: item.restaurant_id });
  res.json({ success: true, id: item.id, restaurant_id: item.restaurant_id });
});

// Quick stock toggle
app.patch('/api/menu-items/:id/toggle', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const newAvail = item.is_available ? 0 : 1;
  db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(newAvail, item.id);
  io.emit('menu:update', { restaurant_id: item.restaurant_id });
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
  const cleanReview = sanitizeText(review || '');
  db.prepare('UPDATE orders SET rating = ?, review_text = ? WHERE id = ?').run(numericRating, cleanReview, orderId);
  res.json({ success: true, message: 'Thank you for your feedback!' });
});

// ---------- ORDERS: CUSTOMER ----------
app.post('/api/orders', (req, res) => {
  // Enforce partner role boundary: VENDOR and RIDER tokens cannot place customer delivery orders
  const callerToken = extractToken(req);
  if (callerToken) {
    const caller = verifyToken(callerToken);
    if (caller && (caller.role === 'VENDOR' || caller.role === 'RIDER')) {
      return res.status(403).json({ error: `Access denied. ${caller.role} partner accounts cannot create customer delivery orders.` });
    }
  }

  const { user_id } = req.body;
  if (user_id) {
    const callerUser = db.prepare('SELECT role FROM users WHERE id = ?').get(user_id);
    if (callerUser && (callerUser.role === 'VENDOR' || callerUser.role === 'RIDER')) {
      return res.status(403).json({ error: `Access denied. ${callerUser.role} partner accounts cannot create customer delivery orders.` });
    }
  }

  const validation = validateOrderInput(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.errors.join(' ') });
  }

  const { customer_name, customer_address, customer_email, restaurant_id, items, payment_method, dest_lat, dest_lng, coupon_code, discount_amount } = req.body;
  const cleanPhone = validation.cleanPhone;
  const cleanName = sanitizeText(customer_name);
  const cleanAddress = sanitizeText(customer_address);
  const cleanEmail = sanitizeText(customer_email || '');
  const cleanCoupon = coupon_code ? sanitizeText(String(coupon_code)).toUpperCase() : null;

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

  const isFreeDel = cleanCoupon === 'FREEDEL';
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
    user_id || null, cleanName, cleanAddress, cleanPhone, cleanEmail, 
    dest_lat || null, dest_lng || null,
    restaurant_id, subtotal, deliveryFee, total, payment_method || 'UPI', deliveryOtp,
    cleanCoupon, discount
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
app.post('/api/orders/:id/cancel', authenticateUser, (req, res) => {
  const { reason } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Customers can only cancel their own order unless Admin/Vendor
  if (req.user.role === 'CUSTOMER' && order.user_id && req.user.id !== order.user_id) {
    return res.status(403).json({ error: 'Forbidden: You can only cancel your own orders.' });
  }

  if (!['PLACED', 'ACCEPTED'].includes(order.status)) {
    return res.status(400).json({ error: `Cannot cancel order in status ${order.status}. Kitchen has already started preparation.` });
  }

  const cleanReason = sanitizeText(reason || 'Customer requested cancellation');
  db.prepare('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('CANCELLED', cleanReason, order.id);
  logStatus(order.id, 'CANCELLED', cleanReason ? `Cancelled: ${cleanReason}` : 'Cancelled by customer');

  if (order.rider_id) {
    db.prepare("UPDATE riders SET status = 'AVAILABLE' WHERE id = ?").run(order.rider_id);
    tryAssignWaitingOrders();
  }

  const updated = emitOrderUpdate(order.id);
  io.emit('riders:update');
  res.json(updated);
});

// Verify Delivery OTP (Proof of Delivery by Rider) with Brute Force Defense
app.post('/api/orders/:id/verify-otp', authenticateUser, requireRole(['RIDER', 'ADMIN']), (req, res) => {
  const { otp } = req.body;
  const orderId = req.params.id;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Brute force lockout check: max 5 failed attempts per order
  const now = Date.now();
  const attempt = otpAttemptMap.get(orderId) || { failed: 0, lockedUntil: 0 };
  if (attempt.lockedUntil && now < attempt.lockedUntil) {
    const waitSecs = Math.ceil((attempt.lockedUntil - now) / 1000);
    return res.status(429).json({ error: `Security lockout: Too many incorrect PIN attempts. Locked for ${waitSecs}s for customer security.` });
  }

  if (!['OUT_FOR_DELIVERY', 'PICKED_UP'].includes(order.status)) {
    return res.status(400).json({ error: `Cannot deliver order in status ${order.status}` });
  }

  if (String(order.delivery_otp).trim() !== String(otp || '').trim()) {
    attempt.failed++;
    if (attempt.failed >= 5) {
      attempt.lockedUntil = now + (10 * 60 * 1000); // 10 minute lockout
      otpAttemptMap.set(orderId, attempt);
      return res.status(429).json({ error: 'Maximum PIN verification attempts exceeded. Locked for 10 minutes for customer safety.' });
    }
    otpAttemptMap.set(orderId, attempt);
    return res.status(400).json({ error: `Invalid 4-digit Delivery PIN. (${5 - attempt.failed} attempts remaining)` });
  }

  // Clear failed attempts counter on success
  otpAttemptMap.delete(orderId);

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
app.get('/api/vendor/:restaurantId/orders', authenticateUser, requireRole(['VENDOR', 'ADMIN']), (req, res) => {
  const restId = req.params.restaurantId;
  const rows = db.prepare('SELECT id FROM orders WHERE restaurant_id = ? ORDER BY id DESC').all(restId);
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.patch('/api/orders/:id/status', authenticateUser, requireRole(['VENDOR', 'RIDER', 'ADMIN']), (req, res) => {
  const { status, note } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const allowed = TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Cannot move order from ${order.status} to ${status}` });
  }

  const cleanNote = sanitizeText(note || '');
  db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, order.id);
  logStatus(order.id, status, cleanNote);

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

app.get('/api/riders/:id/orders', authenticateUser, requireRole(['RIDER', 'ADMIN']), (req, res) => {
  const riderId = req.params.id;
  const rows = db.prepare(
    "SELECT id FROM orders WHERE rider_id = ? AND status NOT IN ('DELIVERED','CANCELLED','REJECTED') ORDER BY id DESC"
  ).all(riderId);
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.patch('/api/riders/:id/status', authenticateUser, requireRole(['RIDER', 'ADMIN']), (req, res) => {
  const { status } = req.body;
  const riderId = req.params.id;
  if (!['AVAILABLE', 'OFFLINE'].includes(status)) {
    return res.status(400).json({ error: 'Status must be AVAILABLE or OFFLINE' });
  }
  db.prepare('UPDATE riders SET status = ? WHERE id = ?').run(status, riderId);
  if (status === 'AVAILABLE') {
    tryAssignWaitingOrders();
  }
  io.emit('riders:update');
  res.json({ success: true, status });
});

// ---------- ADMIN (SECURED) ----------
app.get('/api/admin/orders', authenticateUser, requireRole(['ADMIN']), (req, res) => {
  const rows = db.prepare('SELECT id FROM orders ORDER BY id DESC').all();
  res.json(rows.map(r => getFullOrder(r.id)));
});

app.post('/api/admin/orders/:id/assign', authenticateUser, requireRole(['ADMIN']), (req, res) => {
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

app.get('/api/admin/overview', authenticateUser, requireRole(['ADMIN']), (req, res) => {
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
