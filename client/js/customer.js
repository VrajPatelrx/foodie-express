const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

// Read logged-in user
let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('fe_user'));
} catch (e) {}

let state = {
  screen: 'browse', // browse | menu | tracking | orders | addresses | profile
  restaurants: [],
  menu: [],
  activeRestaurant: null,
  cart: {}, // menu_item_id -> qty
  searchQuery: '',
  selectedCategory: 'All',
  vegOnly: false,
  customerName: (currentUser && currentUser.name) || localStorage.getItem('fe_customer_name') || 'Aarav Patel',
  customerPhone: (currentUser && currentUser.phone) || localStorage.getItem('fe_customer_phone') || '9876543210',
  customerEmail: (currentUser && currentUser.email) || localStorage.getItem('fe_customer_email') || 'aarav@foodie.com',
  customerAddress: localStorage.getItem('fe_customer_address') || 'Flat 402, Sunshine Heights, Anand',
  destCoords: null, // { lat, lng } from GPS
  savedAddresses: [],
  trackingOrderId: null, // Only populated when an order is genuinely active
  currentOrder: null,
  mapInstance: null,
  riderMarker: null,
  allOrders: [],
};

// ----------------------------------------------------
// FAST 2-TIER MOBILE GPS RESOLUTION
// ----------------------------------------------------
function detectFastGps(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError(new Error('Geolocation is not supported by your browser'));
    return;
  }

  // Tier 1: Fast cached / network position (returns in ~100ms on mobile cell/Wi-Fi)
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      // If permission was explicitly denied by user, do not retry
      if (err.code === 1) {
        onError(err);
        return;
      }
      // Tier 2: Try precision GPS with longer timeout
      navigator.geolocation.getCurrentPosition(
        (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
        (err2) => onError(err2),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    },
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
  );
}

// ----------------------------------------------------
// NAVIGATION SYNC & BACK STACK
// ----------------------------------------------------
const screenHistory = [];

function switchScreen(screen, trackHistory = true) {
  if (trackHistory && screen !== state.screen) {
    screenHistory.push(state.screen);
  }
  state.screen = screen;
  
  // Sync Desktop Tabs
  document.querySelectorAll('#desktopNav .customer-nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.nav === screen);
  });

  // Sync Mobile Bottom Nav
  document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === screen);
  });

  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initNavigation() {
  document.querySelectorAll('#desktopNav .customer-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchScreen(tab.dataset.nav));
  });
  document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.nav));
  });

  // Setup Back Navigation & Exit Guard
  AppNavigation.setup({
    rootScreen: 'browse',
    getCurrentScreen: () => state.screen,
    onNavigateBack: (current) => {
      if (current === 'menu') {
        switchScreen('browse', false);
      } else if (screenHistory.length > 0) {
        const prev = screenHistory.pop();
        switchScreen(prev, false);
      } else {
        switchScreen('browse', false);
      }
    },
    exitUrl: '/login.html'
  });
}

function updateHeaderUser() {
  const headerActions = document.getElementById('headerActions');
  if (!headerActions) return;

  if (currentUser) {
    headerActions.innerHTML = `
      <button id="pwaInstallBtn" class="btn-secondary hide-mobile" onclick="PWA.install()" style="display:none; padding:5px 10px; font-size:11px; color:var(--primary); border-color:var(--primary);">
        📱 App
      </button>
      <div class="header-user-pill" title="${currentUser.name}">
        <span class="user-avatar-micro">👤</span>
        <span class="user-display-name">${currentUser.name.split(' ')[0]}</span>
      </div>
      <a class="btn-secondary hide-mobile" href="index.html" style="padding:5px 10px; font-size:12px;">⇄ Switch</a>
    `;
  } else {
    headerActions.innerHTML = `
      <button id="pwaInstallBtn" class="btn-secondary hide-mobile" onclick="PWA.install()" style="display:none; padding:5px 10px; font-size:11px; color:var(--primary); border-color:var(--primary);">
        📱 App
      </button>
      <a class="btn-primary" href="login.html" style="padding:5px 12px; font-size:12px; white-space:nowrap; border-radius:8px;">Sign In</a>
      <a class="btn-secondary hide-mobile" href="index.html" style="padding:5px 10px; font-size:12px;">⇄ Switch</a>
    `;
  }

  if (PWA && PWA.deferredPrompt) {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'inline-flex';
  }
}

async function updateOrderBadges() {
  try {
    const uid = currentUser ? currentUser.id : 1;
    const orders = await API.get(`/api/orders?user_id=${uid}&phone=${encodeURIComponent(state.customerPhone)}`);
    state.allOrders = orders;
    
    const activeOrders = orders.filter(o => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
    const activeCount = activeOrders.length;

    const deskBadge = document.getElementById('desktopOrderBadge');
    const mobBadge = document.getElementById('mobileOrderBadge');

    if (activeCount > 0) {
      state.trackingOrderId = activeOrders[0].id;
      localStorage.setItem('fe_last_order_id', activeOrders[0].id);
      if (deskBadge) { deskBadge.textContent = activeCount; deskBadge.style.display = 'inline-block'; }
      if (mobBadge) { mobBadge.textContent = activeCount; mobBadge.style.display = 'block'; }
    } else {
      state.trackingOrderId = null;
      localStorage.removeItem('fe_last_order_id');
      if (deskBadge) deskBadge.style.display = 'none';
      if (mobBadge) mobBadge.style.display = 'none';
      const trackBtn = document.getElementById('trackActiveOrderBtn');
      if (trackBtn) trackBtn.remove();
    }
  } catch (e) {
    console.warn('Could not update order badge:', e);
  }
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
async function init() {
  updateHeaderUser();
  initNavigation();

  try {
    const [restaurants, addresses] = await Promise.all([
      API.get('/api/restaurants'),
      API.get(`/api/customer/addresses?user_id=${currentUser ? currentUser.id : 1}`).catch(() => [])
    ]);
    state.restaurants = restaurants;
    state.savedAddresses = addresses;

    if (addresses.length && !localStorage.getItem('fe_customer_address')) {
      const def = addresses.find(a => a.is_default) || addresses[0];
      state.customerAddress = def.address;
      if (def.lat && def.lng) state.destCoords = { lat: def.lat, lng: def.lng };
    }

    await updateOrderBadges();

    // Support deep-linking via query parameters (?screen=browse|orders|addresses|profile, ?rest=1, ?order=15)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('rest')) {
      await openRestaurantMenu(Number(urlParams.get('rest')));
      return;
    } else if (urlParams.get('order')) {
      state.trackingOrderId = Number(urlParams.get('order'));
      switchScreen('tracking');
      return;
    } else if (urlParams.get('screen')) {
      switchScreen(urlParams.get('screen'));
      return;
    }

    render();
  } catch (err) {
    console.error('Failed to init customer app:', err);
    renderErrorScreen(view, {
      title: "The Kitchen is Taking a Quick Breather!",
      desc: "Our servers need a moment to cool down the pans and refresh the menu. Don't worry, our chefs and delivery fleet are on standby!",
      badge: "Kitchen Standby",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Reconnect Kitchen",
      showSwitchRole: true
    });
  }
}

// Live Socket Order Updates
socket.on('order:update', (order) => {
  updateOrderBadges();

  if (['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
    if (String(order.id) === String(state.trackingOrderId)) {
      state.trackingOrderId = null;
      localStorage.removeItem('fe_last_order_id');
      const trackBtn = document.getElementById('trackActiveOrderBtn');
      if (trackBtn) trackBtn.remove();
      if (state.screen === 'browse') {
        renderBrowse();
      }
    }
  }

  if (state.screen === 'tracking' && String(order.id) === String(state.currentOrder ? state.currentOrder.id : state.trackingOrderId)) {
    const prevStatus = state.currentOrder ? state.currentOrder.status : null;
    state.currentOrder = order;

    if (order.status !== prevStatus) {
      if (order.status === 'DELIVERED') {
        celebrateDelivery();
      } else if (['ASSIGNED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
        AudioFx.play('alert');
      } else {
        AudioFx.play('chime');
      }
      toast(`Order #${order.id}: ${STATUS_LABEL[order.status] || order.status}`);
    }
    renderTracking(order);
  } else if (state.screen === 'orders') {
    renderOrders();
  }
});

function cartCount() {
  return Object.values(state.cart).reduce((a, b) => a + b, 0);
}

function cartTotal() {
  let total = 0;
  for (const [id, qty] of Object.entries(state.cart)) {
    const item = state.menu.find(m => String(m.id) === String(id));
    if (item) total += item.price * qty;
  }
  return total;
}

// ----------------------------------------------------
// MASTER ROUTER
// ----------------------------------------------------
function render() {
  if (state.screen === 'browse') renderBrowse();
  else if (state.screen === 'menu') renderMenu();
  else if (state.screen === 'tracking') loadTracking();
  else if (state.screen === 'orders') renderOrders();
  else if (state.screen === 'addresses') renderAddresses();
  else if (state.screen === 'profile') renderProfile();
}

// ----------------------------------------------------
// 1. BROWSE SCREEN
// ----------------------------------------------------
function renderBrowse() {
  const filtered = state.restaurants.filter(r => {
    const q = state.searchQuery.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q);
  });

  view.innerHTML = `
    <!-- Pure Veg Platform Trust Banner -->
    <div class="pure-veg-banner">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:24px;">🥗</span>
        <div>
          <div style="font-weight:800; font-size:14px; color:#15803d;">100% Pure Vegetarian Express</div>
          <div style="font-size:12px; color:#166534; opacity:0.9;">Delivering Anand's best pure veg restaurants, thalis & snacks in minutes</div>
        </div>
      </div>
      <span class="pure-veg-tag" style="background:#fff; border-color:#86efac;">🌿 100% PURE VEG</span>
    </div>

    <div class="filter-bar">
      <div class="search-box">
        <span class="icon">🔍</span>
        <input type="text" id="restSearch" placeholder="Search pure veg restaurants or cuisines (e.g. Thali, Pizza, Biryani)..." value="${state.searchQuery}">
      </div>
      ${state.trackingOrderId ? `
        <button class="btn-primary" id="trackActiveOrderBtn">📍 Track Active Order #${state.trackingOrderId}</button>
      ` : ''}
    </div>

    <div class="grid cols-3">
      ${filtered.map(r => `
        <div class="rest-card" data-id="${r.id}">
          <div class="banner">${r.emoji}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h3 style="margin:0;">${r.name}</h3>
            <span class="pure-veg-tag" style="font-size:9.5px; padding:1px 5px;"><span class="veg-dot" style="width:11px; height:11px;"></span> VEG</span>
          </div>
          <div class="cuisine">${r.cuisine}</div>
          <div class="meta-row" style="display:flex; align-items:center; gap:6px;">
            <span class="rating">⭐ ${r.rating}</span>
            <span class="dot">•</span>
            <span>⚡ ${r.eta_minutes ? r.eta_minutes + ' mins' : '25 mins'}</span>
            <span style="margin-left:auto; font-weight:700; color:var(--ink-secondary);">Min ₹99</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('restSearch').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderBrowse();
    const input = document.getElementById('restSearch');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  const trackBtn = document.getElementById('trackActiveOrderBtn');
  if (trackBtn) {
    trackBtn.addEventListener('click', () => {
      switchScreen('tracking');
    });
  }

  document.querySelectorAll('.rest-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.id);
      openRestaurantMenu(id);
    });
  });
}

// ----------------------------------------------------
// 2. RESTAURANT MENU SCREEN (100% PURE VEG)
// ----------------------------------------------------
async function openRestaurantMenu(restId) {
  const rest = state.restaurants.find(r => r.id === restId);
  if (!rest) return;
  if (state.screen !== 'menu') {
    screenHistory.push(state.screen);
  }
  state.activeRestaurant = rest;
  state.cart = {};
  state.selectedCategory = 'All';
  state.vegOnly = true;
  state.screen = 'menu';

  view.innerHTML = `
    <div class="card" style="text-align:center; padding:50px 20px;">
      <div style="font-size:36px; margin-bottom:8px;">⏳</div>
      <h3>Loading Pure Veg Menu from ${rest.name}...</h3>
    </div>
  `;

  try {
    const menu = await API.get(`/api/restaurants/${restId}/menu`);
    state.menu = menu;
    renderMenu();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderMenu() {
  const rest = state.activeRestaurant;
  const categories = ['All', ...new Set(state.menu.map(m => m.category))];

  const filteredMenu = state.menu.filter(item => {
    const matchCat = state.selectedCategory === 'All' || item.category === state.selectedCategory;
    return matchCat;
  });

  view.innerHTML = `
    <a href="#" class="back-link" id="backToRestaurants">← Back to Restaurants</a>

    <div class="card rest-hero-card" style="margin-bottom:18px; display:flex; gap:14px; align-items:center;">
      <div class="rest-hero-icon" style="font-size:38px; background:var(--primary-soft); width:64px; height:64px; border-radius:var(--radius); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        ${rest.emoji}
      </div>
      <div class="rest-hero-info" style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px; flex-wrap:wrap;">
          <h2 style="font-size:20px; margin:0; word-break:break-word;">${rest.name}</h2>
          <span class="pure-veg-tag" style="font-size:9.5px; padding:1px 6px;"><span class="veg-dot" style="width:11px; height:11px;"></span> 100% PURE VEG</span>
        </div>
        <div style="color:var(--ink-secondary); font-size:12.5px; margin-bottom:4px;">
          ${rest.cuisine} • ⚡ ${rest.eta_minutes ? rest.eta_minutes + ' mins' : '25-30 mins'} delivery
        </div>
        <div style="display:flex; align-items:center; gap:6px; font-size:12px; flex-wrap:wrap;">
          <span class="rating">⭐ ${rest.rating}</span>
          <span style="color:var(--ink-muted);">•</span>
          <span style="color:var(--green); font-weight:700;">⚡ Accepting Orders</span>
        </div>
      </div>
    </div>

    <!-- Category Filter Bar (Smooth Horizontal Scrolling Pills) -->
    <div class="filter-bar">
      <div class="category-pills">
        ${categories.map(cat => `
          <button type="button" class="cat-pill ${state.selectedCategory === cat ? 'active' : ''}" data-cat="${cat}">${cat}</button>
        `).join('')}
      </div>
      <div class="pure-veg-tag hide-mobile" style="margin-left:auto; padding:5px 10px;">
        🌿 100% Pure Veg Kitchen
      </div>
    </div>

    <!-- Menu Items Grid -->
    <div class="grid cols-2">
      ${filteredMenu.map(item => `
        <div class="menu-item-card">
          <div class="info">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span class="pure-veg-tag"><span class="veg-dot"></span> PURE VEG</span>
              <span style="font-size:11px; color:var(--ink-muted); font-weight:600;">${item.category}</span>
            </div>
            <h4>${item.name}</h4>
            <p>${item.description || 'Authentic pure vegetarian delicacy prepared fresh with premium spices & ingredients.'}</p>
            <div class="price">₹${item.price}</div>
          </div>
          <div class="action">
            ${!item.is_available ? `
              <span class="badge" style="background:var(--red-soft); color:var(--red); font-size:11px;">Sold Out</span>
            ` : state.cart[item.id] ? `
              <div class="qty-control">
                <button class="qty-btn" data-action="dec" data-id="${item.id}">−</button>
                <span class="qty">${state.cart[item.id]}</span>
                <button class="qty-btn" data-action="inc" data-id="${item.id}">+</button>
              </div>
            ` : `
              <button class="btn-secondary add-btn" data-id="${item.id}" style="padding:7px 18px; border-color:var(--primary); color:var(--primary); font-weight:700; border-radius:var(--radius-sm);">
                + Add
              </button>
            `}
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Floating Sticky Cart Bar -->
    ${cartCount() > 0 ? `
      <div class="cart-bar">
        <div>
          <div style="font-weight:800; font-size:15px;">${cartCount()} Pure Veg Item${cartCount() > 1 ? 's' : ''} added</div>
          <div style="font-size:12.5px; opacity:0.9;">Total: ₹${cartTotal()} (Free Delivery)</div>
        </div>
        <button class="btn-primary" id="checkoutBtn" style="background:#fff; color:var(--ink); font-weight:800; padding:10px 20px; border-radius:999px;">
          Proceed to Checkout →
        </button>
      </div>
    ` : ''}
  `;

  document.getElementById('backToRestaurants').addEventListener('click', (e) => {
    e.preventDefault();
    switchScreen('browse');
  });

  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.selectedCategory = pill.dataset.cat;
      renderMenu();
    });
  });

  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      state.cart[id] = 1;
      AudioFx.play('click');
      renderMenu();
    });
  });

  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const act = btn.dataset.action;
      if (act === 'inc') {
        state.cart[id] = (state.cart[id] || 0) + 1;
      } else if (act === 'dec') {
        state.cart[id] = (state.cart[id] || 0) - 1;
        if (state.cart[id] <= 0) delete state.cart[id];
      }
      AudioFx.play('click');
      renderMenu();
    });
  });

  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', openCheckoutModal);
  }
}

// ----------------------------------------------------
// 3. CHECKOUT MODAL WITH FAST GPS & FORWARD SEARCH
// ----------------------------------------------------
function openCheckoutModal() {
  document.body.classList.add('modal-open');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px; position:relative;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="font-size:18px; margin:0;">Delivery & Contact Details</h3>
        <button class="btn-secondary" id="closeModalBtn" style="padding:4px 8px; font-size:12px;">✕</button>
      </div>

      <div style="background:var(--primary-soft); padding:10px 12px; border-radius:var(--radius-sm); border:1px solid var(--primary-border); margin-bottom:14px;">
        <div style="font-size:11px; font-weight:700; color:var(--primary); text-transform:uppercase; margin-bottom:6px; letter-spacing:0.04em;">
          ✓ Auto-filled from your profile
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:end;">
          <div style="display:flex; flex-direction:column; justify-content:flex-end;">
            <label style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-secondary); margin-bottom:4px; white-space:nowrap;">Full Name</label>
            <input type="text" id="cName" value="${state.customerName}" placeholder="Your Full Name" style="width:100%; height:38px; box-sizing:border-box; padding:0 10px; font-size:13px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff;">
          </div>
          <div style="display:flex; flex-direction:column; justify-content:flex-end;">
            <label style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-secondary); margin-bottom:4px; white-space:nowrap;">Phone Number</label>
            <input type="tel" id="cPhone" value="${state.customerPhone}" maxlength="10" placeholder="10-digit mobile" style="width:100%; height:38px; box-sizing:border-box; padding:0 10px; font-size:13px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff;">
          </div>
        </div>
      </div>

      <!-- Delivery Address Selection -->
      <div style="margin-bottom:14px; position:relative;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="margin:0; font-size:13px;">Delivery Address</label>
          
          <!-- GPS Detect Button -->
          <button type="button" id="detectGpsBtn" class="btn-secondary" style="font-size:11px; padding:4px 10px; color:var(--primary); border-color:var(--primary); font-weight:700;">
            📍 Detect GPS Location
          </button>
        </div>

        <!-- Saved Address Pills -->
        ${state.savedAddresses.length ? `
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
            ${state.savedAddresses.map(a => `
              <button type="button" class="addr-pill ${a.address === state.customerAddress ? 'active' : ''}" data-addr="${encodeURIComponent(a.address)}" data-lat="${a.lat || ''}" data-lng="${a.lng || ''}" style="background:#fff; border:1px solid var(--border); border-radius:999px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:600;">
                ${a.label === 'Home' ? '🏠' : a.label.includes('Work') ? '🏢' : '📍'} ${a.label}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <div style="position:relative;">
          <textarea id="cAddr" rows="2" placeholder="Start typing address or locality (e.g. Station Road, Anand)...">${state.customerAddress}</textarea>
          <div id="geoSuggestBox" class="geo-suggest-box" style="display:none;"></div>
        </div>

        <div id="gpsStatusTag" style="font-size:11px; color:var(--green); font-weight:700; margin-top:4px; display:${state.destCoords ? 'block' : 'none'};">
          ✓ Accurate Coordinates Attached (${state.destCoords ? `${state.destCoords.lat.toFixed(4)}, ${state.destCoords.lng.toFixed(4)}` : ''})
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="font-size:13px;">Payment Method</label>
        <div class="pill-select" id="payMethodPick">
          <button data-method="UPI" class="active">⚡ Instant UPI</button>
          <button data-method="Card">💳 Card</button>
          <button data-method="COD">💵 Cash on Delivery</button>
        </div>
      </div>

      <div class="card" style="background:var(--surface-alt); padding:12px 14px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">
          <span>Item Total</span><span>₹${cartTotal()}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
          <span>Delivery Partner Fee</span><span>₹25</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:15px; border-top:1px dashed var(--border-strong); padding-top:6px;">
          <span>To Pay</span><span style="color:var(--primary);">₹${cartTotal() + 25}</span>
        </div>
      </div>

      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="cancelCheckout" style="flex:1;">Cancel</button>
        <button class="btn-primary" id="confirmOrderBtn" style="flex:2;">1-Click Place Order →</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Address pill click handler
  overlay.querySelectorAll('.addr-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      overlay.querySelectorAll('.addr-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const addr = decodeURIComponent(pill.dataset.addr);
      overlay.querySelector('#cAddr').value = addr;
      state.customerAddress = addr;
      const lat = pill.dataset.lat;
      const lng = pill.dataset.lng;
      if (lat && lng) {
        state.destCoords = { lat: Number(lat), lng: Number(lng) };
        const tag = overlay.querySelector('#gpsStatusTag');
        tag.style.display = 'block';
        tag.textContent = `✓ Coordinates Attached (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})`;
      }
    });
  });

  // Forward Geocode Autocomplete as user types
  const addrInput = overlay.querySelector('#cAddr');
  const suggestBox = overlay.querySelector('#geoSuggestBox');
  let searchTimer = null;

  addrInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(searchTimer);
    if (val.length < 3) {
      suggestBox.style.display = 'none';
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await API.get(`/api/geo/search?q=${encodeURIComponent(val)}`);
        if (res.results && res.results.length > 0) {
          suggestBox.innerHTML = res.results.map(r => `
            <div class="geo-suggest-item" data-lat="${r.lat}" data-lng="${r.lng}" data-name="${encodeURIComponent(r.display_name)}">
              <strong>📍 ${r.short_name}</strong>
              <div style="font-size:10px; color:var(--ink-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.display_name}</div>
            </div>
          `).join('');
          suggestBox.style.display = 'block';

          suggestBox.querySelectorAll('.geo-suggest-item').forEach(item => {
            item.addEventListener('click', () => {
              const name = decodeURIComponent(item.dataset.name);
              const lat = Number(item.dataset.lat);
              const lng = Number(item.dataset.lng);
              addrInput.value = name;
              state.customerAddress = name;
              state.destCoords = { lat, lng };
              suggestBox.style.display = 'none';

              const tag = overlay.querySelector('#gpsStatusTag');
              tag.style.display = 'block';
              tag.textContent = `✓ Pin Placed at Address (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            });
          });
        } else {
          suggestBox.style.display = 'none';
        }
      } catch (err) {
        suggestBox.style.display = 'none';
      }
    }, 350);
  });

  // Fast GPS Detect Handler
  const gpsBtn = overlay.querySelector('#detectGpsBtn');
  gpsBtn.addEventListener('click', () => {
    gpsBtn.textContent = '⏳ Locating...';
    gpsBtn.disabled = true;

    detectFastGps(
      async (lat, lng) => {
        state.destCoords = { lat, lng };
        try {
          const geoRes = await API.get(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
          overlay.querySelector('#cAddr').value = geoRes.address;
          state.customerAddress = geoRes.address;
          const tag = overlay.querySelector('#gpsStatusTag');
          tag.style.display = 'block';
          tag.textContent = `✓ GPS Location Attached (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          toast('Current location detected via GPS!', 'success');
        } catch (e) {
          const fallback = `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          overlay.querySelector('#cAddr').value = fallback;
          state.customerAddress = fallback;
          const tag = overlay.querySelector('#gpsStatusTag');
          tag.style.display = 'block';
          tag.textContent = `✓ GPS Location Attached (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        } finally {
          gpsBtn.textContent = '✓ GPS Found';
          gpsBtn.disabled = false;
        }
      },
      (err) => {
        console.warn('GPS detection error:', err);
        gpsBtn.textContent = '📍 Detect GPS';
        gpsBtn.disabled = false;

        if (err.code === 1) {
          toast('📍 Location permission needed. Please allow location access or type your address.', 'error');
        } else {
          toast('GPS signal weak. You can type your address below and we will pin it on the map.', 'info');
        }
      }
    );
  });

  let paymentMethod = 'UPI';
  overlay.querySelectorAll('#payMethodPick button').forEach(b => {
    b.addEventListener('click', () => {
      overlay.querySelectorAll('#payMethodPick button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      paymentMethod = b.dataset.method;
    });
  });

  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
  };
  overlay.querySelector('#closeModalBtn').addEventListener('click', close);
  overlay.querySelector('#cancelCheckout').addEventListener('click', close);

  // Submit Order with automatic address coordinate resolution
  overlay.querySelector('#confirmOrderBtn').addEventListener('click', async () => {
    const name = overlay.querySelector('#cName').value.trim();
    const addr = overlay.querySelector('#cAddr').value.trim();
    const phone = overlay.querySelector('#cPhone').value.trim();

    if (!name || name.length < 2) {
      toast('Please enter your full name', 'error');
      return;
    }

    const cleanPhone = phone.replace(/[\s+-]/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      toast('Please enter a valid 10-digit mobile number', 'error');
      return;
    }

    if (!addr || addr.length < 5) {
      toast('Please provide a delivery address', 'error');
      return;
    }

    const confirmBtn = overlay.querySelector('#confirmOrderBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Placing Order...';

    // If coordinates not set yet, attempt quick forward-geocode of typed address
    if (!state.destCoords) {
      try {
        const geoSearch = await API.get(`/api/geo/search?q=${encodeURIComponent(addr)}`);
        if (geoSearch.results && geoSearch.results.length > 0) {
          state.destCoords = { lat: geoSearch.results[0].lat, lng: geoSearch.results[0].lng };
        }
      } catch (e) {}
    }

    const items = Object.entries(state.cart).map(([menu_item_id, qty]) => ({
      menu_item_id: Number(menu_item_id),
      qty
    }));

    try {
      const order = await API.post('/api/orders', {
        user_id: currentUser ? currentUser.id : 1,
        customer_name: name,
        customer_address: addr,
        customer_phone: cleanPhone,
        customer_email: state.customerEmail,
        dest_lat: state.destCoords ? state.destCoords.lat : 22.5590,
        dest_lng: state.destCoords ? state.destCoords.lng : 72.9570,
        restaurant_id: state.activeRestaurant.id,
        items,
        payment_method: paymentMethod,
      });

      localStorage.setItem('fe_customer_name', name);
      localStorage.setItem('fe_customer_address', addr);
      localStorage.setItem('fe_customer_phone', cleanPhone);
      localStorage.setItem('fe_last_order_id', order.id);

      state.customerName = name;
      state.customerAddress = addr;
      state.customerPhone = cleanPhone;
      state.trackingOrderId = order.id;
      state.currentOrder = order;

      overlay.remove();
      document.body.classList.remove('modal-open');
      updateOrderBadges();
      switchScreen('tracking');
      AudioFx.play('chime');
      toast('Order placed successfully! Live delivery tracking below.', 'success');
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '1-Click Place Order →';
      toast(err.message, 'error');
    }
  });
}

// ----------------------------------------------------
// 4. MY ORDERS SCREEN (ACTIVE ORDERS + PAST ORDERS)
// ----------------------------------------------------
async function renderOrders() {
  view.innerHTML = `
    <div class="card" style="text-align:center; padding:50px 20px;">
      <div style="font-size:36px; margin-bottom:8px;">⏳</div>
      <h3>Loading your orders...</h3>
    </div>
  `;

  try {
    const uid = currentUser ? currentUser.id : 1;
    const orders = await API.get(`/api/orders?user_id=${uid}&phone=${encodeURIComponent(state.customerPhone)}`);
    state.allOrders = orders;

    const activeOrders = orders.filter(o => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
    const pastOrders = orders.filter(o => ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));

    view.innerHTML = `
      <div style="margin-bottom:20px;">
        <h2 style="font-size:22px; margin-bottom:4px;">My Orders 📜</h2>
        <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
          Track live active deliveries and re-order previous meals in 1 click.
        </p>
      </div>

      <!-- ACTIVE ORDERS SECTION -->
      ${activeOrders.length > 0 ? `
        <div style="margin-bottom:28px;">
          <h3 style="font-size:16px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 3px rgba(22,163,74,0.2);"></span>
            Live Active Orders (${activeOrders.length})
          </h3>
          ${activeOrders.map(o => `
            <div class="order-history-card" style="border:2px solid var(--primary); background:linear-gradient(180deg, #FFF9F5, #FFFFFF);">
              <div class="order-history-header">
                <div style="display:flex; gap:12px; align-items:center;">
                  <div style="font-size:36px; width:52px; height:52px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow-sm);">
                    ${o.restaurant_emoji || '🍔'}
                  </div>
                  <div>
                    <h4 style="font-size:17px; margin:0 0 2px;">${o.restaurant_name}</h4>
                    <div style="font-size:12px; color:var(--ink-secondary);">Order #${o.id} • Placed ${timeAgo(o.created_at)}</div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <span class="badge" style="background:var(--primary); color:#fff; font-size:11px; font-weight:800;">
                    ${STATUS_ICONS[o.status] || '🚀'} ${STATUS_LABEL[o.status] || o.status}
                  </span>
                  <div style="font-weight:800; font-size:15px; color:var(--ink); margin-top:4px;">₹${o.total}</div>
                </div>
              </div>

              <!-- Items chips -->
              <div style="margin-bottom:14px;">
                ${o.items.map(it => `
                  <span class="order-item-chip">${it.name} × ${it.qty}</span>
                `).join('')}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="font-size:12px; color:var(--ink-secondary);">
                  ${o.rider_name ? `🛵 Rider: <strong>${o.rider_name}</strong>` : '👨‍🍳 Kitchen preparing food'}
                </div>
                <button class="btn-primary track-live-btn" data-id="${o.id}" style="padding:8px 16px; font-size:13px;">
                  📍 Track Live on Map →
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- PAST ORDERS SECTION -->
      <div>
        <h3 style="font-size:16px; margin-bottom:12px;">Past Orders (${pastOrders.length})</h3>
        ${pastOrders.length === 0 ? `
          <div class="card" style="text-align:center; padding:40px 20px;">
            <div style="font-size:40px; margin-bottom:8px;">🍽️</div>
            <h4>No past orders yet</h4>
            <p style="color:var(--ink-secondary); font-size:13px; margin:4px 0 16px;">Explore local restaurants and order your favorite meal!</p>
            <button class="btn-primary" id="exploreNowBtn">Browse Restaurants →</button>
          </div>
        ` : `
          ${pastOrders.map(o => `
            <div class="order-history-card">
              <div class="order-history-header">
                <div style="display:flex; gap:12px; align-items:center;">
                  <div style="font-size:32px; width:48px; height:48px; background:var(--surface-alt); border-radius:var(--radius-sm); display:flex; align-items:center; justify-content:center;">
                    ${o.restaurant_emoji || '🍔'}
                  </div>
                  <div>
                    <h4 style="font-size:16px; margin:0 0 2px;">${o.restaurant_name}</h4>
                    <div style="font-size:12px; color:var(--ink-secondary);">Order #${o.id} • ${timeAgo(o.created_at)}</div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <span class="badge ${o.status === 'DELIVERED' ? 'delivered' : 'cancelled'}" style="font-size:11px;">
                    ${o.status === 'DELIVERED' ? '✓ Delivered' : '✕ Cancelled'}
                  </span>
                  <div style="font-weight:800; font-size:14px; margin-top:3px;">₹${o.total}</div>
                </div>
              </div>

              <div style="margin-bottom:12px;">
                ${o.items.map(it => `
                  <span class="order-item-chip">${it.name} × ${it.qty} (₹${it.price * it.qty})</span>
                `).join('')}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:10px;">
                <button class="btn-secondary view-receipt-btn" data-id="${o.id}" style="padding:5px 10px; font-size:12px;">
                  📜 View Receipt
                </button>
                <button class="btn-primary reorder-btn" data-id="${o.id}" style="padding:6px 14px; font-size:12px;">
                  🔁 1-Click Reorder
                </button>
              </div>
            </div>
          `).join('')}
        `}
      </div>
    `;

    document.querySelectorAll('.track-live-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.trackingOrderId = Number(btn.dataset.id);
        switchScreen('tracking');
      });
    });

    document.querySelectorAll('.reorder-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = Number(btn.dataset.id);
        const order = state.allOrders.find(o => o.id === orderId);
        if (order) reorderMeal(order);
      });
    });

    document.querySelectorAll('.view-receipt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = Number(btn.dataset.id);
        const order = state.allOrders.find(o => o.id === orderId);
        if (order) openReceiptModal(order);
      });
    });

    const exploreBtn = document.getElementById('exploreNowBtn');
    if (exploreBtn) exploreBtn.addEventListener('click', () => switchScreen('browse'));

  } catch (err) {
    console.error('Failed to load orders:', err);
    renderErrorScreen(view, {
      title: "Couldn't Fetch Your Orders",
      desc: "We had a momentary hiccup fetching your order history. Your previous orders are completely safe in our kitchen records!",
      badge: "Orders Offline",
      error: err,
      onRetry: () => renderOrders(),
      retryText: "Try Fetching Again",
      showSwitchRole: false
    });
  }
}

// 1-Click Re-order Action
async function reorderMeal(order) {
  toast(`Re-ordering from ${order.restaurant_name}...`, 'info');
  const rest = state.restaurants.find(r => r.id === order.restaurant_id) || {
    id: order.restaurant_id,
    name: order.restaurant_name,
    emoji: order.restaurant_emoji || '🍔',
    cuisine: order.restaurant_cuisine || 'Delicious Meals',
    rating: '4.8',
    delivery_time: '25-30 mins',
    min_order: 100
  };

  state.activeRestaurant = rest;
  state.cart = {};

  try {
    const menu = await API.get(`/api/restaurants/${order.restaurant_id}/menu`);
    state.menu = menu;

    // Put items in cart
    order.items.forEach(it => {
      state.cart[it.menu_item_id] = it.qty;
    });

    state.screen = 'menu';
    renderMenu();
    openCheckoutModal();
    toast('Cart populated! Review and place your order.', 'success');
  } catch (e) {
    toast('Could not re-order: ' + e.message, 'error');
  }
}

// View Receipt Modal
function openReceiptModal(order) {
  document.body.classList.add('modal-open');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:18px; margin:0;">Order #${order.id} Receipt</h3>
        <button class="btn-secondary" id="closeReceiptBtn" style="padding:4px 8px; font-size:12px;">✕</button>
      </div>

      <div style="font-size:13px; color:var(--ink-secondary); margin-bottom:12px;">
        Restaurant: <strong>${order.restaurant_name}</strong><br>
        Date: ${new Date(order.created_at).toLocaleString()}<br>
        Payment: <strong>${order.payment_method}</strong>
      </div>

      <div class="card" style="background:var(--surface-alt); padding:12px; margin-bottom:14px;">
        ${order.items.map(it => `
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span>${it.name} × ${it.qty}</span>
            <span>₹${it.price * it.qty}</span>
          </div>
        `).join('')}
        <div style="display:flex; justify-content:space-between; font-size:13px; border-top:1px solid var(--border); padding-top:4px; margin-top:4px;">
          <span>Delivery Fee</span><span>₹${order.delivery_fee}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:15px; border-top:1px dashed var(--border-strong); padding-top:6px; margin-top:4px;">
          <span>Total Paid</span><span style="color:var(--primary);">₹${order.total}</span>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <h4 style="font-size:13px; margin-bottom:8px;">Tracking Log</h4>
        <div style="font-size:12px; max-height:120px; overflow-y:auto;">
          ${(order.log || []).map(l => `
            <div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid var(--border);">
              <span>${STATUS_LABEL[l.status] || l.status}</span>
              <span style="color:var(--ink-muted);">${timeAgo(l.created_at)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <button class="btn-secondary" id="dismissReceiptBtn" style="width:100%;">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
  };
  overlay.querySelector('#closeReceiptBtn').addEventListener('click', close);
  overlay.querySelector('#dismissReceiptBtn').addEventListener('click', close);
}

// ----------------------------------------------------
// 5. SAVED ADDRESSES SCREEN
// ----------------------------------------------------
function renderAddresses() {
  view.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:22px; margin-bottom:4px;">Saved Addresses 📍</h2>
      <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
        Manage your delivery locations for 1-click checkout.
      </p>
    </div>

    <div class="grid cols-2" style="margin-bottom:20px;">
      ${state.savedAddresses.map(a => `
        <div class="card" style="position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; font-size:14px;">
              ${a.label === 'Home' ? '🏠' : a.label.includes('Work') ? '🏢' : '📍'} ${a.label}
            </div>
            ${a.is_default ? `<span class="badge" style="background:var(--primary-soft); color:var(--primary);">Default</span>` : ''}
          </div>
          <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 10px;">${a.address}</p>
          <div style="font-size:11px; color:var(--green); font-weight:600;">
            ${a.lat && a.lng ? `✓ GPS Pin: ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` : '• Standard Address'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card" style="max-width:500px;">
      <h3 style="font-size:16px; margin-bottom:12px;">+ Add New Address</h3>
      <div style="margin-bottom:10px;">
        <label style="font-size:12px;">Label</label>
        <input type="text" id="newAddrLabel" placeholder="Home / Office / Friend's Place" style="padding:8px 12px; font-size:13px;">
      </div>
      <div style="margin-bottom:10px; position:relative;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label style="font-size:12px; margin:0;">Complete Address</label>
          <button type="button" id="newAddrGpsBtn" class="btn-secondary" style="font-size:11px; padding:3px 8px; color:var(--primary); border-color:var(--primary);">
            📍 Detect GPS
          </button>
        </div>
        <textarea id="newAddrText" rows="2" placeholder="House, Road, Area, Landmark"></textarea>
      </div>
      <button class="btn-primary" id="saveNewAddrBtn" style="width:100%;">Save Address</button>
    </div>
  `;

  let newCoords = null;
  const newGpsBtn = document.getElementById('newAddrGpsBtn');
  newGpsBtn.addEventListener('click', () => {
    newGpsBtn.textContent = '⏳ Locating...';
    detectFastGps(
      async (lat, lng) => {
        newCoords = { lat, lng };
        try {
          const res = await API.get(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
          document.getElementById('newAddrText').value = res.address;
          toast('GPS location captured!', 'success');
        } catch (e) {
          document.getElementById('newAddrText').value = `GPS Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        } finally {
          newGpsBtn.textContent = '✓ GPS Found';
        }
      },
      (err) => {
        newGpsBtn.textContent = '📍 Detect GPS';
        toast('Could not detect GPS: ' + err.message, 'info');
      }
    );
  });

  document.getElementById('saveNewAddrBtn').addEventListener('click', async () => {
    const label = document.getElementById('newAddrLabel').value.trim() || 'Saved Place';
    const address = document.getElementById('newAddrText').value.trim();
    if (!address) { toast('Please enter an address', 'error'); return; }

    try {
      const uid = currentUser ? currentUser.id : 1;
      const res = await API.post('/api/customer/addresses', {
        user_id: uid,
        label,
        address,
        lat: newCoords ? newCoords.lat : null,
        lng: newCoords ? newCoords.lng : null,
      });
      state.savedAddresses.push(res);
      toast('Address saved successfully!', 'success');
      renderAddresses();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

// ----------------------------------------------------
// 6. PROFILE & ACCOUNT SCREEN
// ----------------------------------------------------
function renderProfile() {
  view.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:22px; margin-bottom:4px;">My Account 👤</h2>
      <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
        Profile preferences and role settings.
      </p>
    </div>

    <div class="card" style="max-width:540px; margin-bottom:20px;">
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px;">
        <div style="font-size:36px; width:64px; height:64px; background:var(--primary-soft); border-radius:50%; display:flex; align-items:center; justify-content:center;">
          👤
        </div>
        <div>
          <h3 style="font-size:18px; margin:0 0 3px;">${currentUser ? currentUser.name : state.customerName}</h3>
          <div style="color:var(--ink-secondary); font-size:13px;">${currentUser ? currentUser.email : state.customerEmail}</div>
          <div style="color:var(--primary); font-size:13px; font-weight:700;">📞 +91 ${currentUser ? currentUser.phone : state.customerPhone}</div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border); padding-top:14px; display:flex; flex-direction:column; gap:10px;">
        <button class="btn-secondary" onclick="switchScreen('orders')" style="justify-content:space-between; padding:12px;">
          <span>📜 View Past Orders</span><span>→</span>
        </button>
        <button class="btn-secondary" onclick="switchScreen('addresses')" style="justify-content:space-between; padding:12px;">
          <span>📍 Saved Addresses (${state.savedAddresses.length})</span><span>→</span>
        </button>
        <a class="btn-secondary" href="index.html" style="justify-content:space-between; padding:12px;">
          <span>⇄ Switch Role (Kitchen / Rider / Admin)</span><span>→</span>
        </a>
      </div>
    </div>

    <div style="max-width:540px;">
      ${currentUser ? `
        <button class="btn-secondary danger" id="profileLogoutBtn" style="width:100%; padding:12px; font-weight:700; color:var(--red); border-color:var(--red);">
          Sign Out of Account
        </button>
      ` : `
        <a class="btn-primary" href="login.html" style="width:100%; padding:12px; font-weight:800; text-align:center;">
          🔐 Sign In / Create Account
        </a>
      `}
    </div>
  `;

  const logoutBtn = document.getElementById('profileLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('fe_user');
      localStorage.removeItem('fe_token');
      currentUser = null;
      toast('Signed out successfully', 'info');
      setTimeout(() => location.reload(), 400);
    });
  }
}

// ----------------------------------------------------
// 7. TRACKING SCREEN
// ----------------------------------------------------
async function loadTracking() {
  view.innerHTML = `
    <div class="card" style="text-align:center; padding:60px 20px;">
      <div style="font-size:40px; margin-bottom:12px;">⏳</div>
      <h3>Connecting to Live Order Tracker...</h3>
    </div>
  `;
  try {
    const order = await API.get(`/api/orders/${state.trackingOrderId}`);
    state.currentOrder = order;
    renderTracking(order);
  } catch (err) {
    view.innerHTML = `
      <div class="card" style="text-align:center; padding:60px 20px;">
        <div style="font-size:40px; margin-bottom:12px;">🍽️</div>
        <h3>No active order found</h3>
        <p style="color:var(--ink-secondary); font-size:14px; margin:8px 0 16px;">Browse restaurants to place your next meal.</p>
        <button class="btn-primary" id="startOrder">Browse Menu →</button>
      </div>
    `;
    const b = document.getElementById('startOrder');
    if (b) b.addEventListener('click', () => switchScreen('browse'));
  }
}

function renderTracking(order) {
  const isDelivered = order.status === 'DELIVERED';
  const isCancelled = order.status === 'CANCELLED';

  const isStep1Done = ['ACCEPTED','PREPARING','READY','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(order.status);
  const isStep1Active = order.status === 'PLACED';

  const isStep2Done = ['READY','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(order.status);
  const isStep2Active = ['ACCEPTED','PREPARING'].includes(order.status);

  const isStep3Done = ['PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(order.status);
  const isStep3Active = ['READY','ASSIGNED'].includes(order.status);

  const isStep4Done = order.status === 'DELIVERED';
  const isStep4Active = ['PICKED_UP','OUT_FOR_DELIVERY'].includes(order.status);

  const isStep5Done = order.status === 'DELIVERED';

  let progressWidth = '8%';
  if (isStep5Done) progressWidth = '100%';
  else if (isStep4Active) progressWidth = '75%';
  else if (isStep3Active || isStep3Done) progressWidth = '50%';
  else if (isStep2Active || isStep2Done) progressWidth = '25%';

  view.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
      <a href="#" class="back-link" id="orderMoreLink" style="margin:0;">← Browse Menu</a>
      <span class="badge ${isDelivered ? 'delivered' : isCancelled ? 'cancelled' : 'preparing'}" style="font-size:12px; padding:6px 12px;">
        ${STATUS_ICONS[order.status] || ''} ${STATUS_LABEL[order.status] || order.status}
      </span>
    </div>

    <!-- Live Map Container -->
    <div class="card map-container" style="margin-bottom:18px; padding:0; overflow:hidden; border:2px solid var(--border);">
      <div id="trackingMap" style="width:100%; height:260px; background:var(--surface-alt);"></div>
    </div>

    <!-- Active Delivery Status Card -->
    <div class="card" style="margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div>
          <h2 style="font-size:20px; margin-bottom:2px;">Order #${order.id}</h2>
          <div style="color:var(--ink-secondary); font-size:13px;">From <strong>${order.restaurant_name}</strong></div>
        </div>
        ${(order.delivery_pin || order.delivery_otp) ? `
          <div style="text-align:right; flex-shrink:0;">
            <div style="font-size:10px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.5px;">Delivery PIN</div>
            <div class="pin-badge">${order.delivery_pin || order.delivery_otp}</div>
            <div style="font-size:10px; color:var(--ink-muted); margin-top:2px;">Share with rider at delivery</div>
          </div>
        ` : ''}
      </div>

      <!-- Industry-Standard 5-Stage Stepper -->
      <div class="delivery-stepper">
        <div class="stepper-track-bg"></div>
        <div class="stepper-track-fill" style="width: ${progressWidth};"></div>
        <div class="stepper-nodes">
          <div class="stepper-node ${isStep1Done ? 'completed' : isStep1Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep1Done ? '✓' : '📋'}</div>
            <div class="stepper-title">Placed</div>
          </div>
          <div class="stepper-node ${isStep2Done ? 'completed' : isStep2Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep2Done ? '✓' : '👨‍🍳'}</div>
            <div class="stepper-title">Cooking</div>
          </div>
          <div class="stepper-node ${isStep3Done ? 'completed' : isStep3Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep3Done ? '✓' : '📦'}</div>
            <div class="stepper-title">Ready</div>
          </div>
          <div class="stepper-node ${isStep4Done ? 'completed' : isStep4Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep4Done ? '✓' : '🛵'}</div>
            <div class="stepper-title">On Way</div>
          </div>
          <div class="stepper-node ${isStep5Done ? 'completed' : ''}">
            <div class="stepper-icon">${isStep5Done ? '🎉' : '🏠'}</div>
            <div class="stepper-title">Delivered</div>
          </div>
        </div>
      </div>

      <!-- Rider Info or Kitchen Prep Note -->
      ${order.rider_name ? `
        <div style="display:flex; align-items:center; gap:12px; background:var(--surface-alt); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border);">
          <div style="font-size:32px;">🛵</div>
          <div style="flex:1;">
            <div style="font-weight:700; font-size:14px;">${order.rider_name} is delivering your food</div>
            <div style="font-size:12px; color:var(--ink-secondary);">${order.rider_vehicle || 'Motorcycle'} • 📞 ${order.rider_phone || '9876543210'}</div>
          </div>
          <a href="tel:${order.rider_phone || ''}" class="btn-secondary" style="padding:6px 12px; font-size:12px; color:var(--primary); border-color:var(--primary); font-weight:700;">Call</a>
        </div>
      ` : `
        <div style="background:var(--primary-soft); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--primary-border); font-size:13px; color:var(--ink);">
          👨‍🍳 <strong>Kitchen is preparing your order.</strong> A delivery partner will be automatically dispatched as soon as the food is boxed!
        </div>
      `}
    </div>

    <!-- Items & Payment Receipt -->
    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px; margin-bottom:12px;">Order Summary</h3>
      ${order.items.map(it => `
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
          <span>${it.name} × ${it.qty}</span>
          <span style="font-weight:600;">₹${it.price * it.qty}</span>
        </div>
      `).join('')}
      <div style="border-top:1px solid var(--border); padding-top:8px; margin-top:8px; font-size:13px;">
        <div style="display:flex; justify-content:space-between; color:var(--ink-secondary); margin-bottom:4px;">
          <span>Delivery Fee</span><span>₹${order.delivery_fee}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:16px; border-top:1px dashed var(--border); margin-top:8px; padding-top:8px;">
          <span>Total Paid (${order.payment_method})</span>
          <span style="color:var(--primary);">₹${order.total}</span>
        </div>
      </div>
    </div>

    <!-- Live Event Timeline -->
    <div class="card">
      <h3 style="font-size:15px; margin-bottom:14px;">Audit & Tracking Timeline</h3>
      ${order.log.map(l => `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:8px 0; border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:700; font-size:13px;">${STATUS_LABEL[l.status] || l.status}</div>
            <div style="font-size:12px; color:var(--ink-secondary);">${l.note || ''}</div>
          </div>
          <span style="font-size:12px; color:var(--ink-muted);">${timeAgo(l.created_at)}</span>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('orderMoreLink').addEventListener('click', (e) => {
    e.preventDefault();
    switchScreen('browse');
  });

  initTrackingMap(order);
}

function initTrackingMap(order) {
  const mapEl = document.getElementById('trackingMap');
  if (!mapEl || typeof L === 'undefined') return;

  const restLat = order.restaurant_lat || 22.5532;
  const restLng = order.restaurant_lng || 72.9485;
  const destLat = order.dest_lat || 22.5590;
  const destLng = order.dest_lng || 72.9570;

  let riderProgress = 0;
  if (order.status === 'PICKED_UP') riderProgress = 0.25;
  else if (order.status === 'OUT_FOR_DELIVERY') riderProgress = 0.70;
  else if (order.status === 'DELIVERED') riderProgress = 1.0;

  const riderLat = restLat + (destLat - restLat) * riderProgress;
  const riderLng = restLng + (destLng - restLng) * riderProgress;

  if (state.mapInstance) {
    try { state.mapInstance.remove(); } catch (e) {}
  }

  state.mapInstance = L.map('trackingMap', { zoomControl: false }).setView([riderLat, riderLng], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(state.mapInstance);

  const restIcon = L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="font-size:24px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🏪</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  L.marker([restLat, restLng], { icon: restIcon }).addTo(state.mapInstance).bindPopup(order.restaurant_name);

  const homeIcon = L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="font-size:24px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🏠</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  L.marker([destLat, destLng], { icon: homeIcon }).addTo(state.mapInstance).bindPopup("Delivery Address");

  L.polyline([[restLat, restLng], [destLat, destLng]], {
    color: '#FF5200',
    weight: 3,
    dashArray: '6, 8'
  }).addTo(state.mapInstance);

  if (['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
    const bikeIcon = L.divIcon({
      className: 'custom-bike-pin',
      html: `<div style="font-size:28px; filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4)); animation:pulseBar 1.2s infinite;">🛵</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    state.riderMarker = L.marker([riderLat, riderLng], { icon: bikeIcon }).addTo(state.mapInstance);
  }
}

function celebrateDelivery() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }
}

init();
