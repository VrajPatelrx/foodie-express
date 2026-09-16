const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'foodie.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER', -- 'CUSTOMER', 'VENDOR', 'RIDER', 'ADMIN'
  restaurant_id INTEGER,
  rider_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT 'Home', -- 'Home', 'Work', 'College', 'Other'
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cuisine TEXT,
  emoji TEXT,
  rating REAL DEFAULT 4.0,
  eta_minutes INTEGER DEFAULT 30,
  is_open INTEGER DEFAULT 1,
  lat REAL DEFAULT 22.5539,
  lng REAL DEFAULT 72.9515
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  price REAL NOT NULL,
  veg INTEGER DEFAULT 1,
  is_available INTEGER DEFAULT 1,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
);

CREATE TABLE IF NOT EXISTS riders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'AVAILABLE', -- AVAILABLE, BUSY, OFFLINE
  vehicle TEXT DEFAULT 'Bike',
  phone TEXT DEFAULT '9876543210',
  rating REAL DEFAULT 4.8,
  earnings REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  customer_name TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  dest_lat REAL,
  dest_lng REAL,
  restaurant_id INTEGER NOT NULL,
  rider_id INTEGER,
  status TEXT DEFAULT 'PLACED',
  subtotal REAL NOT NULL,
  delivery_fee REAL DEFAULT 25,
  total REAL NOT NULL,
  payment_method TEXT DEFAULT 'UPI',
  delivery_otp TEXT DEFAULT '1234',
  cancel_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  qty INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

CREATE TABLE IF NOT EXISTS order_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
`);

// Safe migrations for existing SQLite databases
function addColumnIfNotExists(table, columnDef) {
  const colName = columnDef.trim().split(/\s+/)[0];
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    }
  } catch (err) {
    console.warn(`Migration notice for ${table}.${colName}:`, err.message);
  }
}

addColumnIfNotExists('restaurants', 'lat REAL DEFAULT 22.5539');
addColumnIfNotExists('restaurants', 'lng REAL DEFAULT 72.9515');
addColumnIfNotExists('menu_items', 'is_available INTEGER DEFAULT 1');
addColumnIfNotExists('riders', 'phone TEXT DEFAULT "9876543210"');
addColumnIfNotExists('riders', 'rating REAL DEFAULT 4.8');
addColumnIfNotExists('riders', 'earnings REAL DEFAULT 0');
addColumnIfNotExists('orders', 'user_id INTEGER');
addColumnIfNotExists('orders', 'customer_email TEXT');
addColumnIfNotExists('orders', 'dest_lat REAL');
addColumnIfNotExists('orders', 'dest_lng REAL');
addColumnIfNotExists('orders', 'delivery_otp TEXT DEFAULT "1234"');
addColumnIfNotExists('orders', 'cancel_reason TEXT');
addColumnIfNotExists('orders', 'coupon_code TEXT');
addColumnIfNotExists('orders', 'discount_amount REAL DEFAULT 0');
addColumnIfNotExists('orders', 'rating INTEGER');
addColumnIfNotExists('orders', 'review_text TEXT');

// Backfill distinct coordinates for map visualization
try {
  db.exec(`
    UPDATE restaurants SET lat = 22.5532, lng = 72.9485 WHERE id = 1;
    UPDATE restaurants SET lat = 22.5585, lng = 72.9560 WHERE id = 2;
    UPDATE restaurants SET lat = 22.5480, lng = 72.9520 WHERE id = 3;
    UPDATE restaurants SET lat = 22.5560, lng = 72.9430 WHERE id = 4;
  `);
} catch (e) {}

// Sync and backfill any riders or vendors registered without linked profile records
try {
  const unlinkedRiders = db.prepare("SELECT id, name, phone FROM users WHERE role = 'RIDER' AND (rider_id IS NULL OR rider_id NOT IN (SELECT id FROM riders))").all();
  for (const u of unlinkedRiders) {
    const res = db.prepare("INSERT INTO riders (name, status, vehicle, phone, rating, earnings) VALUES (?, 'AVAILABLE', 'Bike', ?, 4.8, 0)")
      .run(u.name, u.phone || '9876543210');
    db.prepare("UPDATE users SET rider_id = ? WHERE id = ?").run(res.lastInsertRowid, u.id);
  }

  const unlinkedVendors = db.prepare("SELECT id, name FROM users WHERE role = 'VENDOR' AND (restaurant_id IS NULL OR restaurant_id NOT IN (SELECT id FROM restaurants))").all();
  for (const u of unlinkedVendors) {
    const res = db.prepare("INSERT INTO restaurants (name, cuisine, rating, eta_minutes, is_open, lat, lng) VALUES (?, 'Pure Veg Kitchen & Snacks', 4.5, 25, 1, 22.5540, 72.9500)")
      .run(u.name);
    db.prepare("UPDATE users SET restaurant_id = ? WHERE id = ?").run(res.lastInsertRowid, u.id);
  }
} catch (e) {
  console.warn('Profile sync warning:', e.message);
}

module.exports = db;
