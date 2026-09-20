const db = require('./db');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SALT = process.env.PASSWORD_SALT || 'foodie_salt';

function hashPassword(password, salt = DEFAULT_SALT) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function verifyPassword(inputPassword, storedHash) {
  if (!inputPassword || !storedHash) return false;
  if (hashPassword(inputPassword, DEFAULT_SALT) === storedHash) return true;
  if (DEFAULT_SALT !== 'foodie_salt' && hashPassword(inputPassword, 'foodie_salt') === storedHash) {
    return true;
  }
  return false;
}

// 1. Seed Restaurants and Riders if not already present
const count = db.prepare('SELECT COUNT(*) as c FROM restaurants').get().c;
if (count === 0) {
  console.log('Seeding restaurants & riders...');

  const insertRestaurant = db.prepare(
    'INSERT INTO restaurants (name, cuisine, emoji, rating, eta_minutes, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertItem = db.prepare(
    'INSERT INTO menu_items (restaurant_id, name, category, price, veg) VALUES (?, ?, ?, ?, ?)'
  );
  const insertRider = db.prepare(
    'INSERT INTO riders (name, vehicle, phone) VALUES (?, ?, ?)'
  );

  const restaurants = [
    {
      name: 'Anand Tiffin House', cuisine: 'Gujarati Thali', emoji: '🍛', rating: 4.5, eta: 28, lat: 22.5532, lng: 72.9485,
      items: [
        ['Gujarati Thali', 'Meals', 180, 1],
        ['Khaman Dhokla', 'Snacks', 60, 1],
        ['Fafda Jalebi', 'Snacks', 90, 1],
        ['Kadhi Khichdi', 'Meals', 120, 1],
      ]
    },
    {
      name: 'Vallabh Pizza Corner', cuisine: 'Pizza & Italian', emoji: '🍕', rating: 4.2, eta: 35, lat: 22.5585, lng: 72.9560,
      items: [
        ['Margherita Pizza', 'Pizza', 220, 1],
        ['Farmhouse Pizza', 'Pizza', 280, 1],
        ['Garlic Bread', 'Sides', 110, 1],
        ['Pasta Alfredo', 'Pasta', 190, 1],
      ]
    },
    {
      name: 'Spice Route Pure Veg Biryani', cuisine: 'Pure Veg Biryani & Mughlai', emoji: '🍚', rating: 4.6, eta: 35, lat: 22.5480, lng: 72.9520,
      items: [
        ['Paneer Dum Biryani', 'Biryani', 210, 1],
        ['Veg Hyderabadi Biryani', 'Biryani', 170, 1],
        ['Hara Bhara Veg Kebab', 'Starters', 160, 1],
        ['Paneer Tikka Masala', 'Curries', 220, 1],
        ['Raita & Salad', 'Sides', 45, 1],
      ]
    },
    {
      name: 'Fresh Mart Grocery', cuisine: 'Grocery & Essentials', emoji: '🛒', rating: 4.3, eta: 20, lat: 22.5560, lng: 72.9430,
      items: [
        ['Milk 1L', 'Dairy', 62, 1],
        ['Bread Loaf', 'Bakery', 45, 1],
        ['Basmati Rice 1kg', 'Staples', 120, 1],
        ['Onion 1kg', 'Vegetables', 35, 1],
        ['Fresh Malai Paneer 200g', 'Dairy', 85, 1],
      ]
    },
  ];

  for (const r of restaurants) {
    const info = insertRestaurant.run(r.name, r.cuisine, r.emoji, r.rating, r.eta, r.lat, r.lng);
    for (const [name, category, price, veg] of r.items) {
      insertItem.run(info.lastInsertRowid, name, category, price, veg);
    }
  }

  const riders = [
    ['Ramesh Patel', 'Bike', '9876543210'],
    ['Suresh Rana', 'Bike', '9876543211'],
    ['Bhavesh Solanki', 'Scooter', '9876543212'],
    ['Kiran Desai', 'Bike', '9876543213'],
  ];
  for (const [name, vehicle, phone] of riders) {
    insertRider.run(name, vehicle, phone);
  }

  console.log('Seed restaurants & riders complete.');
}

// 2. Seed Default User Accounts & Saved Addresses
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  console.log('Seeding user accounts & saved addresses...');

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, restaurant_id, rider_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const pwdHash = hashPassword('foodie123');

  // Customer Account
  const custInfo = insertUser.run(
    'Aarav Patel', 'customer@foodie.com', '9876543210', pwdHash, 'CUSTOMER', null, null
  );

  // Vendor Account (linked to Restaurant #1: Anand Tiffin House)
  insertUser.run(
    'Anand Tiffin Kitchen', 'vendor@foodie.com', '9876543211', pwdHash, 'VENDOR', 1, null
  );

  // Rider Account (linked to Rider #1: Ramesh Patel)
  insertUser.run(
    'Ramesh Patel', 'rider@foodie.com', '9876543212', pwdHash, 'RIDER', null, 1
  );

  // Admin Account
  insertUser.run(
    'Platform Admin', 'admin@foodie.com', '9876543213', pwdHash, 'ADMIN', null, null
  );

  // Seed Saved Addresses for Demo Customer
  const insertAddr = db.prepare(`
    INSERT INTO customer_addresses (user_id, label, address, lat, lng, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertAddr.run(
    custInfo.lastInsertRowid, 'Home', 'Flat 402, Sunshine Heights, Near Town Hall, Anand', 22.5590, 72.9570, 1
  );
  insertAddr.run(
    custInfo.lastInsertRowid, 'College / Work', 'Room 12, Engineering Block B, BVM Engineering College, Vallabh Vidyanagar', 22.5510, 72.9250, 0
  );

  console.log('Seed user accounts complete.');
}

module.exports = { hashPassword, verifyPassword };
