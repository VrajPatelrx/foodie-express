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
  appliedCoupon: null, // { code, discount, freeDelivery, description }
  paymentMethod: 'UPI',
  customerName: (currentUser && currentUser.name) || localStorage.getItem('fe_customer_name') || 'Aarav Patel',
  customerPhone: (currentUser && currentUser.phone) || localStorage.getItem('fe_customer_phone') || '9876543210',
  customerEmail: (currentUser && currentUser.email) || localStorage.getItem('fe_customer_email') || 'aarav@foodie.com',
  customerAddress: localStorage.getItem('fe_customer_address') || 'Flat 402, Sunshine Heights, Anand',
  destCoords: null, // { lat, lng } from GPS
  savedAddresses: [],
  trackingOrderId: null,
  currentOrder: null,
  mapInstance: null,
  riderMarker: null,
  routePolyline: null,
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

  // Tier 1: Fast cached / network position (~100ms on mobile cell/Wi-Fi)
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
    (err) => {
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
  updateFloatingCart();
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
      <button id="pwaInstallBtn" class="btn-secondary hide-mobile" onclick="PWA.install()" style="display:none; padding:5px 10px; font-size:11px; color:var(--primary); border-color:var(--primary); align-items:center; gap:5px;">
        ${Icons.phone(13)} Install App
      </button>
      <div class="header-user-pill" title="${currentUser.name}">
        <span class="user-avatar-micro" style="display:flex; align-items:center;">${Icons.customer(15)}</span>
        <span class="user-display-name">${currentUser.name.split(' ')[0]}</span>
      </div>
      <a class="btn-secondary hide-mobile" href="index.html" style="padding:5px 10px; font-size:12px; display:inline-flex; align-items:center; gap:5px;">⇄ Switch</a>
    `;
  } else {
    headerActions.innerHTML = `
      <button id="pwaInstallBtn" class="btn-secondary hide-mobile" onclick="PWA.install()" style="display:none; padding:5px 10px; font-size:11px; color:var(--primary); border-color:var(--primary); align-items:center; gap:5px;">
        ${Icons.phone(13)} Install App
      </button>
      <a class="btn-primary" href="login.html" style="padding:6px 14px; font-size:12px; white-space:nowrap; border-radius:8px;">Sign In</a>
      <a class="btn-secondary hide-mobile" href="index.html" style="padding:5px 10px; font-size:12px; display:inline-flex; align-items:center; gap:5px;">⇄ Switch</a>
    `;
  }

  if (window.PWA && PWA.deferredPrompt) {
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
// CART & PRICING CALCULATIONS
// ----------------------------------------------------
function cartCount() {
  return Object.values(state.cart).reduce((a, b) => a + b, 0);
}

function cartSubtotal() {
  let total = 0;
  for (const [id, qty] of Object.entries(state.cart)) {
    const item = state.menu.find(m => String(m.id) === String(id));
    if (item) total += item.price * qty;
  }
  return total;
}
const cartTotal = cartSubtotal;

function getDeliveryFee() {
  if (state.appliedCoupon && state.appliedCoupon.freeDelivery) return 0;
  return 25;
}

function getDiscountAmount() {
  if (!state.appliedCoupon) return 0;
  return state.appliedCoupon.discount || 0;
}

function getFinalPayable() {
  const sub = cartSubtotal();
  const fee = getDeliveryFee();
  const disc = getDiscountAmount();
  return Math.max(0, sub + fee - disc);
}

function updateFloatingCart() {
  const bar = document.getElementById('floatingCart');
  if (!bar) return;

  const count = cartCount();
  if (count > 0 && state.screen === 'menu') {
    bar.classList.add('visible');
    const countEl = document.getElementById('floatingCartCount');
    const priceEl = document.getElementById('floatingCartPrice');
    if (countEl) countEl.textContent = `${count} ${count === 1 ? 'ITEM' : 'ITEMS'}`;
    if (priceEl) priceEl.textContent = `₹${cartTotal()}`;
  } else {
    bar.classList.remove('visible');
  }
}

window.showCartModal = function() {
  if (cartCount() > 0) {
    openCheckoutModal();
  }
};

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

    // Deep-linking support (?screen=..., ?rest=..., ?order=...)
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
      title: "Service Temporarily Unavailable",
      desc: "Our servers are refreshing kitchen menus and driver dispatches. Please retry in a moment.",
      badge: "Connection Error",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Retry Connection",
      showSwitchRole: true
    });
  }
}

// Live Socket Updates
socket.on('order:update', (order) => {
  updateOrderBadges();

  if (['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
    if (String(order.id) === String(state.trackingOrderId)) {
      state.trackingOrderId = null;
      localStorage.removeItem('fe_last_order_id');
      const trackBtn = document.getElementById('trackActiveOrderBtn');
      if (trackBtn) trackBtn.remove();
      if (state.screen === 'browse') renderBrowse();
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
    <div style="margin-bottom:20px;">
      <h1 style="font-size:22px; font-weight:800; margin:0 0 6px; letter-spacing:-0.02em;">Order food in Anand</h1>
      <p style="color:var(--ink-secondary); font-size:13.5px; margin:0;">
        Explore top rated kitchens, quick snacks and meals delivered in minutes.
      </p>
    </div>

    <div class="filter-bar" style="margin-bottom:22px;">
      <div class="search-box">
        <span class="icon" style="display:flex; align-items:center;">${Icons.search(16)}</span>
        <input type="text" id="restSearch" placeholder="Search restaurants or cuisines (e.g. Gujarati, Thali, Snacks)..." value="${state.searchQuery}">
      </div>
      ${state.trackingOrderId ? `
        <button class="btn-primary" id="trackActiveOrderBtn" style="display:inline-flex; align-items:center; gap:6px;">
          ${Icons.location(14)} Live Order #${state.trackingOrderId} →
        </button>
      ` : ''}
    </div>

    <div class="grid cols-3">
      ${filtered.map(r => `
        <div class="rest-card" data-id="${r.id}" style="cursor:pointer;">
          <div class="banner" style="background:var(--surface-alt); display:flex; align-items:center; justify-content:center; height:120px; border-radius:var(--radius-sm); margin-bottom:12px;">
            <div style="width:52px; height:52px; border-radius:50%; background:var(--primary-soft); display:flex; align-items:center; justify-content:center; color:var(--primary);">
              ${Icons.kitchen(26, 'var(--primary)')}
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h3 style="margin:0; font-size:16px; font-weight:700;">${r.name}</h3>
            ${Icons.veg(13)}
          </div>
          <div class="cuisine" style="font-size:12.5px; color:var(--ink-secondary); margin-bottom:8px;">${r.cuisine}</div>
          <div class="meta-row" style="display:flex; align-items:center; gap:8px; font-size:12px;">
            <span class="rating" style="display:inline-flex; align-items:center; gap:3px; font-weight:700; background:var(--surface-alt); padding:2px 6px; border-radius:4px;">
              ${Icons.star(12)} ${r.rating}
            </span>
            <span style="color:var(--border-strong);">•</span>
            <span style="display:inline-flex; align-items:center; gap:4px; color:var(--ink-secondary);">
              ${Icons.clock(12)} ${r.eta_minutes ? r.eta_minutes + ' mins' : '25 mins'}
            </span>
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
    trackBtn.addEventListener('click', () => switchScreen('tracking'));
  }

  document.querySelectorAll('.rest-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.id);
      openRestaurantMenu(id);
    });
  });
}

// ----------------------------------------------------
// 2. RESTAURANT MENU SCREEN
// ----------------------------------------------------
async function openRestaurantMenu(restId) {
  const rest = state.restaurants.find(r => r.id === restId);
  if (!rest) return;
  if (state.screen !== 'menu') {
    screenHistory.push(state.screen);
  }
  state.activeRestaurant = rest;
  state.cart = {};
  state.appliedCoupon = null;
  state.selectedCategory = 'All';
  state.screen = 'menu';

  // Skeleton shimmer placeholder
  view.innerHTML = `
    <div style="margin-bottom:18px;">
      <div class="skeleton skeleton-title" style="height:32px; width:200px; margin-bottom:12px;"></div>
      <div class="skeleton" style="height:80px; width:100%; border-radius:var(--radius);"></div>
    </div>
    <div class="skeleton-grid">
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
    </div>
  `;

  try {
    const menu = await API.get(`/api/restaurants/${restId}/menu`);
    state.menu = menu;
    renderMenu();
    updateFloatingCart();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderMenu() {
  const rest = state.activeRestaurant;
  if (!rest) return;

  const categories = ['All', ...new Set(state.menu.map(m => m.category))];
  const filteredMenu = state.menu.filter(item => {
    return state.selectedCategory === 'All' || item.category === state.selectedCategory;
  });

  view.innerHTML = `
    <a href="#" class="back-link" id="backToRestaurants" style="display:inline-flex; align-items:center; gap:5px; margin-bottom:14px; font-weight:600;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      All Restaurants
    </a>

    <!-- Restaurant Hero Card -->
    <div class="card rest-hero-card" style="margin-bottom:18px; display:flex; gap:16px; align-items:center;">
      <div style="width:64px; height:64px; border-radius:var(--radius); background:var(--primary-soft); display:flex; align-items:center; justify-content:center; color:var(--primary); flex-shrink:0;">
        ${Icons.kitchen(28, 'var(--primary)')}
      </div>
      <div class="rest-hero-info" style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:3px; flex-wrap:wrap;">
          <h2 style="font-size:20px; margin:0; word-break:break-word;">${rest.name}</h2>
          ${Icons.veg(13)}
        </div>
        <div style="color:var(--ink-secondary); font-size:12.5px; margin-bottom:6px;">
          ${rest.cuisine} • Delivery in ${rest.eta_minutes ? rest.eta_minutes + ' mins' : '25-30 mins'}
        </div>
        <div style="display:flex; align-items:center; gap:8px; font-size:12px; flex-wrap:wrap;">
          <span class="rating" style="display:inline-flex; align-items:center; gap:3px; font-weight:700;">
            ${Icons.star(12)} ${rest.rating}
          </span>
          <span style="color:var(--border-strong);">•</span>
          <span style="color:var(--green); font-weight:700; display:inline-flex; align-items:center; gap:4px;">
            <span style="width:7px; height:7px; border-radius:50%; background:var(--green); display:inline-block;"></span> Accepting Orders
          </span>
        </div>
      </div>
    </div>

    <!-- Category Filter Bar -->
    <div class="filter-bar" style="margin-bottom:16px;">
      <div class="category-pills">
        ${categories.map(cat => `
          <button type="button" class="cat-pill ${state.selectedCategory === cat ? 'active' : ''}" data-cat="${cat}">${cat}</button>
        `).join('')}
      </div>
    </div>

    <!-- Dishes Grid -->
    <div class="grid cols-2" style="margin-bottom:80px;">
      ${filteredMenu.map(item => `
        <div class="menu-item-card">
          <div class="info">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              ${Icons.veg(12)}
              <span style="font-size:11px; color:var(--ink-muted); font-weight:600;">${item.category}</span>
            </div>
            <h4>${item.name}</h4>
            <p>${item.description || 'Prepared fresh with premium ingredients & authentic spices.'}</p>
            <div class="price">₹${item.price}</div>
          </div>
          <div class="action">
            ${!item.is_available ? `
              <span class="badge" style="background:var(--surface-alt); color:var(--ink-muted); font-size:11px;">Sold Out</span>
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
      updateFloatingCart();
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
      updateFloatingCart();
    });
  });

  updateFloatingCart();
}

// ----------------------------------------------------
// 3. CHECKOUT MODAL WITH PROMO COUPON & PAYMENT TABS
// ----------------------------------------------------
function openCheckoutModal() {
  document.body.classList.add('modal-open');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function renderModalContent() {
    const subtotal = cartSubtotal();
    const fee = getDeliveryFee();
    const discount = getDiscountAmount();
    const total = getFinalPayable();

    overlay.innerHTML = `
      <div class="modal-card" style="max-width:500px; position:relative; max-height:90vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="font-size:18px; margin:0; font-weight:800;">Order & Delivery Checkout</h3>
          <button class="btn-secondary" id="closeModalBtn" style="padding:4px 8px; font-size:12px; border:none; cursor:pointer;">
            ${Icons.close(16)}
          </button>
        </div>

        <!-- Contact details -->
        <div style="background:var(--primary-soft); padding:10px 12px; border-radius:var(--radius-sm); border:1px solid var(--primary-border); margin-bottom:14px;">
          <div style="font-size:11px; font-weight:700; color:var(--primary); text-transform:uppercase; margin-bottom:6px; letter-spacing:0.04em; display:flex; align-items:center; gap:4px;">
            ${Icons.check(12)} Auto-filled Contact Details
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:end;">
            <div>
              <label style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-secondary); margin-bottom:4px;">Full Name</label>
              <input type="text" id="cName" value="${state.customerName}" placeholder="Your Full Name" style="width:100%; height:38px; box-sizing:border-box; padding:0 10px; font-size:13px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff;">
            </div>
            <div>
              <label style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-secondary); margin-bottom:4px;">Phone Number</label>
              <input type="tel" id="cPhone" value="${state.customerPhone}" maxlength="10" placeholder="10-digit mobile" style="width:100%; height:38px; box-sizing:border-box; padding:0 10px; font-size:13px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff;">
            </div>
          </div>
        </div>

        <!-- Delivery Address -->
        <div style="margin-bottom:14px; position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="margin:0; font-size:13px;">Delivery Address</label>
            <button type="button" id="detectGpsBtn" class="btn-secondary" style="font-size:11px; padding:4px 10px; color:var(--primary); border-color:var(--primary); font-weight:700; display:inline-flex; align-items:center; gap:4px;">
              ${Icons.location(13)} Detect GPS
            </button>
          </div>

          ${state.savedAddresses.length ? `
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
              ${state.savedAddresses.map(a => `
                <button type="button" class="addr-pill ${a.address === state.customerAddress ? 'active' : ''}" data-addr="${encodeURIComponent(a.address)}" data-lat="${a.lat || ''}" data-lng="${a.lng || ''}" style="background:#fff; border:1px solid var(--border); border-radius:999px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                  ${Icons.location(12)} ${a.label}
                </button>
              `).join('')}
            </div>
          ` : ''}

          <div style="position:relative;">
            <textarea id="cAddr" rows="2" placeholder="Start typing address or locality in Anand...">${state.customerAddress}</textarea>
            <div id="geoSuggestBox" class="geo-suggest-box" style="display:none;"></div>
          </div>

          <div id="gpsStatusTag" style="font-size:11px; color:var(--green); font-weight:700; margin-top:4px; display:${state.destCoords ? 'block' : 'none'};">
            ✓ Accurate Coordinates Attached (${state.destCoords ? `${state.destCoords.lat.toFixed(4)}, ${state.destCoords.lng.toFixed(4)}` : ''})
          </div>
        </div>

        <!-- Promo Code & Coupon Engine -->
        <div style="margin-bottom:16px;">
          <label style="font-size:13px; display:flex; align-items:center; gap:5px;">
            ${Icons.discount(14)} Apply Promo Coupon
          </label>
          <div class="coupon-box" style="margin:6px 0 8px;">
            <input type="text" id="couponCodeInput" class="coupon-input" placeholder="Enter code (e.g. WELCOME50)" value="${state.appliedCoupon ? state.appliedCoupon.code : ''}" ${state.appliedCoupon ? 'disabled' : ''}>
            ${state.appliedCoupon ? `
              <button type="button" id="removeCouponBtn" class="coupon-btn" style="background:var(--red);">Remove</button>
            ` : `
              <button type="button" id="applyCouponBtn" class="coupon-btn">Apply</button>
            `}
          </div>

          ${state.appliedCoupon ? `
            <div class="applied-coupon-tag">
              ${Icons.check(13)} Coupon ${state.appliedCoupon.code} applied! Saved ₹${state.appliedCoupon.discount}
            </div>
          ` : `
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="coupon-chip" data-code="WELCOME50">WELCOME50 (50% OFF)</button>
              <button type="button" class="coupon-chip" data-code="FREEDEL">FREEDEL (Free Delivery)</button>
              <button type="button" class="coupon-chip" data-code="FLAT20">FLAT20 (₹20 OFF)</button>
            </div>
          `}
        </div>

        <!-- Payment Method Tabs -->
        <div style="margin-bottom:16px;">
          <label style="font-size:13px;">Payment Method</label>
          <div class="payment-tabs" style="border-radius:var(--radius-sm); overflow:hidden; border:1px solid var(--border);">
            <button type="button" class="payment-tab ${state.paymentMethod === 'UPI' ? 'active' : ''}" data-method="UPI">
              ${Icons.qr(15)} Instant UPI / QR
            </button>
            <button type="button" class="payment-tab ${state.paymentMethod === 'Card' ? 'active' : ''}" data-method="Card">
              ${Icons.card(15)} Card
            </button>
            <button type="button" class="payment-tab ${state.paymentMethod === 'COD' ? 'active' : ''}" data-method="COD">
              ${Icons.receipt(15)} Cash on Delivery
            </button>
          </div>

          <!-- Payment Tab Content -->
          <div style="margin-top:10px; background:var(--surface-alt); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border);">
            ${state.paymentMethod === 'UPI' ? `
              <div style="text-align:center;">
                <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius-sm); display:inline-flex; padding:12px; margin-bottom:8px;">
                  ${Icons.qr(72, 'var(--ink)')}
                </div>
                <div style="font-size:12px; font-weight:700; color:var(--ink);">Scan via Google Pay / PhonePe / Paytm</div>
                <div style="font-size:11px; color:var(--ink-secondary); margin-top:2px;">Instant authorization simulation on order placement.</div>
              </div>
            ` : state.paymentMethod === 'Card' ? `
              <div>
                <div style="margin-bottom:8px;">
                  <label style="font-size:10px; margin-bottom:2px;">Card Number</label>
                  <input type="text" placeholder="4111 2222 3333 4444" style="height:34px; padding:0 10px; font-size:12px;" value="4242 •••• •••• 4242">
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <div>
                    <label style="font-size:10px; margin-bottom:2px;">Expiry</label>
                    <input type="text" placeholder="MM/YY" style="height:34px; padding:0 10px; font-size:12px;" value="12/28">
                  </div>
                  <div>
                    <label style="font-size:10px; margin-bottom:2px;">CVV</label>
                    <input type="password" placeholder="•••" maxlength="3" style="height:34px; padding:0 10px; font-size:12px;" value="888">
                  </div>
                </div>
              </div>
            ` : `
              <div style="font-size:12.5px; color:var(--ink-secondary); text-align:center; padding:6px 0;">
                Pay exact amount <strong>₹${total}</strong> in cash or UPI QR at your doorstep upon arrival.
              </div>
            `}
          </div>
        </div>

        <!-- Bill Breakdown -->
        <div class="card" style="background:var(--surface-alt); padding:12px 14px; margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span>Item Subtotal</span><span>₹${subtotal}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span>Delivery Fee</span>
            <span>${fee === 0 ? '<span style="color:var(--green); font-weight:700;">FREE</span>' : '₹' + fee}</span>
          </div>
          ${discount > 0 ? `
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; color:var(--green); font-weight:700;">
              <span>Coupon Discount (${state.appliedCoupon.code})</span>
              <span>− ₹${discount}</span>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; font-weight:800; font-size:15px; border-top:1px dashed var(--border-strong); padding-top:6px; margin-top:4px;">
            <span>Total to Pay</span>
            <span style="color:var(--primary);">₹${total}</span>
          </div>
        </div>

        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" id="cancelCheckout" style="flex:1;">Cancel</button>
          <button class="btn-primary" id="confirmOrderBtn" style="flex:2; font-weight:800;">
            1-Click Place Order →
          </button>
        </div>
      </div>
    `;

    bindModalEvents();
  }

  function bindModalEvents() {
    const close = () => {
      overlay.remove();
      document.body.classList.remove('modal-open');
    };
    overlay.querySelector('#closeModalBtn').addEventListener('click', close);
    overlay.querySelector('#cancelCheckout').addEventListener('click', close);

    // Address pills
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

    // Forward Geocode Autocomplete
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
                <strong>${r.short_name}</strong>
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

    // Fast GPS Detect
    const gpsBtn = overlay.querySelector('#detectGpsBtn');
    gpsBtn.addEventListener('click', () => {
      gpsBtn.textContent = 'Locating...';
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
          gpsBtn.textContent = 'Detect GPS';
          gpsBtn.disabled = false;
          toast('Could not detect GPS. You can type your address directly.', 'info');
        }
      );
    });

    // Payment tab clicks
    overlay.querySelectorAll('.payment-tab').forEach(t => {
      t.addEventListener('click', () => {
        state.paymentMethod = t.dataset.method;
        renderModalContent();
      });
    });

    // Coupon chips
    overlay.querySelectorAll('.coupon-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const code = chip.dataset.code;
        await applyCouponCode(code);
      });
    });

    // Apply coupon button
    const applyBtn = overlay.querySelector('#applyCouponBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const input = overlay.querySelector('#couponCodeInput');
        const code = input.value.trim().toUpperCase();
        if (!code) {
          toast('Please enter a coupon code', 'error');
          return;
        }
        await applyCouponCode(code);
      });
    }

    // Remove coupon button
    const removeBtn = overlay.querySelector('#removeCouponBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        state.appliedCoupon = null;
        toast('Coupon removed', 'info');
        renderModalContent();
      });
    }

    // Confirm order button
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
          payment_method: state.paymentMethod,
          coupon_code: state.appliedCoupon ? state.appliedCoupon.code : null,
          discount_amount: getDiscountAmount()
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
        state.cart = {};
        state.appliedCoupon = null;

        overlay.remove();
        document.body.classList.remove('modal-open');
        updateOrderBadges();
        updateFloatingCart();
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

  async function applyCouponCode(code) {
    try {
      const res = await API.post('/api/coupons/apply', {
        code,
        subtotal: cartSubtotal()
      });
      state.appliedCoupon = res;
      toast(`Coupon ${res.code} applied! Saved ₹${res.discount}`, 'success');
      renderModalContent();
    } catch (e) {
      toast(e.message || 'Invalid coupon code', 'error');
    }
  }

  renderModalContent();
  document.body.appendChild(overlay);
}

// ----------------------------------------------------
// 4. MY ORDERS SCREEN (ACTIVE ORDERS + PAST ORDERS + RATINGS)
// ----------------------------------------------------
async function renderOrders() {
  view.innerHTML = `
    <div class="skeleton-grid">
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
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
        <h2 style="font-size:22px; font-weight:800; margin-bottom:4px;">My Orders</h2>
        <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
          Track live active deliveries and re-order previous meals in 1 click.
        </p>
      </div>

      <!-- ACTIVE ORDERS -->
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
                  <div style="width:48px; height:48px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); display:flex; align-items:center; justify-content:center; color:var(--primary); box-shadow:var(--shadow-sm);">
                    ${Icons.kitchen(24, 'var(--primary)')}
                  </div>
                  <div>
                    <h4 style="font-size:16px; margin:0 0 2px;">${o.restaurant_name}</h4>
                    <div style="font-size:12px; color:var(--ink-secondary);">Order #${o.id} • Placed ${timeAgo(o.created_at)}</div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <span class="badge" style="background:var(--primary); color:#fff; font-size:11px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
                    ${STATUS_LABEL[o.status] || o.status}
                  </span>
                  <div style="font-weight:800; font-size:15px; color:var(--ink); margin-top:4px;">₹${o.total}</div>
                </div>
              </div>

              <div style="margin-bottom:14px;">
                ${o.items.map(it => `
                  <span class="order-item-chip" style="display:inline-flex; align-items:center; gap:4px;">
                    ${Icons.veg(10)} ${it.name} × ${it.qty}
                  </span>
                `).join('')}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="font-size:12px; color:var(--ink-secondary); display:flex; align-items:center; gap:6px;">
                  ${o.rider_name ? `
                    <span style="display:flex; align-items:center; gap:4px;">${Icons.rider(15)} Rider: <strong>${o.rider_name}</strong></span>
                  ` : `
                    <span style="display:flex; align-items:center; gap:4px;">${Icons.kitchen(15)} Kitchen preparing food</span>
                  `}
                </div>
                <button class="btn-primary track-live-btn" data-id="${o.id}" style="padding:8px 16px; font-size:13px; display:inline-flex; align-items:center; gap:6px;">
                  ${Icons.location(14)} Track Live on Map →
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- PAST ORDERS -->
      <div>
        <h3 style="font-size:16px; margin-bottom:12px;">Past Orders (${pastOrders.length})</h3>
        ${pastOrders.length === 0 ? `
          <div class="card" style="text-align:center; padding:40px 20px;">
            <div style="margin-bottom:10px; color:var(--ink-muted);">${Icons.kitchen(40)}</div>
            <h4>No past orders yet</h4>
            <p style="color:var(--ink-secondary); font-size:13px; margin:4px 0 16px;">Explore local restaurants and order your favorite meal!</p>
            <button class="btn-primary" id="exploreNowBtn">Browse Restaurants →</button>
          </div>
        ` : `
          ${pastOrders.map(o => `
            <div class="order-history-card">
              <div class="order-history-header">
                <div style="display:flex; gap:12px; align-items:center;">
                  <div style="width:44px; height:44px; background:var(--surface-alt); border-radius:var(--radius-sm); display:flex; align-items:center; justify-content:center; color:var(--ink-secondary);">
                    ${Icons.kitchen(20)}
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
                  <span class="order-item-chip" style="display:inline-flex; align-items:center; gap:4px;">
                    ${Icons.veg(10)} ${it.name} × ${it.qty} (₹${it.price * it.qty})
                  </span>
                `).join('')}
              </div>

              <!-- Rating display or Rate button -->
              ${o.status === 'DELIVERED' ? `
                <div style="margin-bottom:12px; font-size:12px; display:flex; align-items:center; gap:6px;">
                  ${o.rating ? `
                    <span style="font-weight:700; color:var(--ink); display:inline-flex; align-items:center; gap:3px;">
                      ${Icons.star(13)} ${o.rating}/5 Rated
                    </span>
                    ${o.review_text ? `<span style="color:var(--ink-muted); font-style:italic;">"${o.review_text}"</span>` : ''}
                  ` : `
                    <button class="btn-secondary rate-order-btn" data-id="${o.id}" style="padding:4px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px; color:#F59E0B; border-color:#F59E0B;">
                      ${Icons.star(12)} Rate Meal
                    </button>
                  `}
                </div>
              ` : ''}

              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:10px;">
                <button class="btn-secondary view-receipt-btn" data-id="${o.id}" style="padding:5px 10px; font-size:12px; display:inline-flex; align-items:center; gap:4px;">
                  ${Icons.receipt(13)} View Receipt
                </button>
                <button class="btn-primary reorder-btn" data-id="${o.id}" style="padding:6px 14px; font-size:12px;">
                  1-Click Reorder
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

    document.querySelectorAll('.rate-order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = Number(btn.dataset.id);
        openRatingModal(orderId);
      });
    });

    const exploreBtn = document.getElementById('exploreNowBtn');
    if (exploreBtn) exploreBtn.addEventListener('click', () => switchScreen('browse'));

  } catch (err) {
    console.error('Failed to load orders:', err);
    renderErrorScreen(view, {
      title: "Could Not Fetch Orders",
      desc: "There was a momentary hiccup fetching your order history. Please try again.",
      badge: "Network Error",
      error: err,
      onRetry: () => renderOrders(),
      retryText: "Retry",
      showSwitchRole: false
    });
  }
}

// ----------------------------------------------------
// 5. INTERACTIVE ORDER RATING MODAL
// ----------------------------------------------------
function openRatingModal(orderId) {
  document.body.classList.add('modal-open');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let selectedRating = 5;

  overlay.innerHTML = `
    <div class="rating-modal-card">
      <h3 style="font-size:18px; margin:0 0 6px;">Rate Your Experience</h3>
      <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 16px;">How was the food and delivery for Order #${orderId}?</p>

      <div class="star-rating-row" id="starRatingRow">
        ${[1, 2, 3, 4, 5].map(n => `
          <button type="button" class="star-rating-btn ${n <= selectedRating ? 'active' : ''}" data-score="${n}">
            ${Icons.star(28)}
          </button>
        `).join('')}
      </div>

      <div style="margin-bottom:16px;">
        <textarea id="reviewTextInput" rows="2" placeholder="Write an optional review (e.g. food was fresh and delicious)..." style="font-size:13px;"></textarea>
      </div>

      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="cancelRatingBtn" style="flex:1;">Cancel</button>
        <button class="btn-primary" id="submitRatingBtn" style="flex:2;">Submit Review</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const starBtns = overlay.querySelectorAll('.star-rating-btn');
  starBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRating = Number(btn.dataset.score);
      starBtns.forEach(b => {
        const score = Number(b.dataset.score);
        b.classList.toggle('active', score <= selectedRating);
      });
    });
  });

  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
  };

  overlay.querySelector('#cancelRatingBtn').addEventListener('click', close);
  overlay.querySelector('#submitRatingBtn').addEventListener('click', async () => {
    const review = overlay.querySelector('#reviewTextInput').value.trim();
    try {
      await API.post(`/api/orders/${orderId}/rate`, {
        rating: selectedRating,
        review
      });
      toast('Thank you for rating your order!', 'success');
      close();
      renderOrders();
    } catch (e) {
      toast(e.message || 'Could not submit rating', 'error');
    }
  });
}

// 1-Click Re-order Action
async function reorderMeal(order) {
  toast(`Re-ordering from ${order.restaurant_name}...`, 'info');
  const rest = state.restaurants.find(r => r.id === order.restaurant_id) || {
    id: order.restaurant_id,
    name: order.restaurant_name,
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

    order.items.forEach(it => {
      state.cart[it.menu_item_id] = it.qty;
    });

    state.screen = 'menu';
    renderMenu();
    updateFloatingCart();
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
        <button class="btn-secondary" id="closeReceiptBtn" style="padding:4px 8px; font-size:12px; border:none; cursor:pointer;">
          ${Icons.close(16)}
        </button>
      </div>

      <div style="font-size:13px; color:var(--ink-secondary); margin-bottom:12px;">
        Restaurant: <strong>${order.restaurant_name}</strong><br>
        Date: ${new Date(order.created_at).toLocaleString()}<br>
        Payment: <strong>${order.payment_method}</strong>
      </div>

      <div class="card" style="background:var(--surface-alt); padding:12px; margin-bottom:14px;">
        ${order.items.map(it => `
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
            <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.veg(10)} ${it.name} × ${it.qty}</span>
            <span>₹${it.price * it.qty}</span>
          </div>
        `).join('')}
        <div style="display:flex; justify-content:space-between; font-size:13px; border-top:1px solid var(--border); padding-top:4px; margin-top:4px;">
          <span>Delivery Fee</span><span>₹${order.delivery_fee}</span>
        </div>
        ${order.discount_amount ? `
          <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--green); font-weight:700;">
            <span>Discount (${order.coupon_code || 'PROMO'})</span><span>− ₹${order.discount_amount}</span>
          </div>
        ` : ''}
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
// 6. SAVED ADDRESSES SCREEN
// ----------------------------------------------------
function renderAddresses() {
  view.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:22px; font-weight:800; margin-bottom:4px;">Saved Addresses</h2>
      <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
        Manage your delivery locations for 1-click checkout.
      </p>
    </div>

    <div class="grid cols-2" style="margin-bottom:20px;">
      ${state.savedAddresses.map(a => `
        <div class="card" style="position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; font-size:14px; display:inline-flex; align-items:center; gap:6px;">
              ${Icons.location(15)} ${a.label}
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
          <button type="button" id="newAddrGpsBtn" class="btn-secondary" style="font-size:11px; padding:3px 8px; color:var(--primary); border-color:var(--primary); display:inline-flex; align-items:center; gap:4px;">
            ${Icons.location(12)} Detect GPS
          </button>
        </div>
        <textarea id="newAddrText" rows="2" placeholder="House, Road, Area, Landmark in Anand"></textarea>
      </div>
      <button class="btn-primary" id="saveNewAddrBtn" style="width:100%;">Save Address</button>
    </div>
  `;

  let newCoords = null;
  const newGpsBtn = document.getElementById('newAddrGpsBtn');
  newGpsBtn.addEventListener('click', () => {
    newGpsBtn.textContent = 'Locating...';
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
        newGpsBtn.textContent = 'Detect GPS';
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
// 7. PROFILE & ACCOUNT SCREEN
// ----------------------------------------------------
function renderProfile() {
  view.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-size:22px; font-weight:800; margin-bottom:4px;">My Account</h2>
      <p style="color:var(--ink-secondary); font-size:14px; margin:0;">
        Profile preferences and role settings.
      </p>
    </div>

    <div class="card" style="max-width:540px; margin-bottom:20px;">
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px;">
        <div style="width:64px; height:64px; background:var(--primary-soft); border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--primary);">
          ${Icons.customer(32, 'var(--primary)')}
        </div>
        <div>
          <h3 style="font-size:18px; margin:0 0 3px;">${currentUser ? currentUser.name : state.customerName}</h3>
          <div style="color:var(--ink-secondary); font-size:13px;">${currentUser ? currentUser.email : state.customerEmail}</div>
          <div style="color:var(--primary); font-size:13px; font-weight:700; margin-top:2px;">+91 ${currentUser ? currentUser.phone : state.customerPhone}</div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border); padding-top:14px; display:flex; flex-direction:column; gap:10px;">
        <button class="btn-secondary" onclick="switchScreen('orders')" style="justify-content:space-between; padding:12px; display:flex; align-items:center;">
          <span style="display:flex; align-items:center; gap:8px;">${Icons.receipt(16)} View Past Orders</span>
          <span>→</span>
        </button>
        <button class="btn-secondary" onclick="switchScreen('addresses')" style="justify-content:space-between; padding:12px; display:flex; align-items:center;">
          <span style="display:flex; align-items:center; gap:8px;">${Icons.location(16)} Saved Addresses (${state.savedAddresses.length})</span>
          <span>→</span>
        </button>
        <a class="btn-secondary" href="index.html" style="justify-content:space-between; padding:12px; display:flex; align-items:center;">
          <span style="display:flex; align-items:center; gap:8px;">⇄ Switch Role (Kitchen / Rider / Admin)</span>
          <span>→</span>
        </a>
      </div>
    </div>

    <div style="max-width:540px;">
      ${currentUser ? `
        <button class="btn-secondary danger" id="profileLogoutBtn" style="width:100%; padding:12px; font-weight:700; color:var(--red); border-color:var(--red);">
          Sign Out of Account
        </button>
      ` : `
        <a class="btn-primary" href="login.html" style="width:100%; padding:12px; font-weight:800; text-align:center; display:block;">
          Sign In / Create Account
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
// 8. LIVE ORDER TRACKING SCREEN & OSRM ROAD MAP
// ----------------------------------------------------
async function loadTracking() {
  view.innerHTML = `
    <div class="card" style="text-align:center; padding:60px 20px;">
      <div style="margin-bottom:12px; color:var(--primary);">${Icons.clock(36, 'var(--primary)')}</div>
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
        <div style="margin-bottom:12px; color:var(--ink-muted);">${Icons.kitchen(36)}</div>
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
      <a href="#" class="back-link" id="orderMoreLink" style="margin:0; display:inline-flex; align-items:center; gap:4px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Browse Menu
      </a>
      <span class="badge ${isDelivered ? 'delivered' : isCancelled ? 'cancelled' : 'preparing'}" style="font-size:12px; padding:6px 12px; display:inline-flex; align-items:center; gap:5px;">
        ${STATUS_LABEL[order.status] || order.status}
      </span>
    </div>

    <!-- Live Map Container -->
    <div class="card map-container" style="margin-bottom:18px; padding:0; overflow:hidden; border:2px solid var(--border);">
      <div id="trackingMap" style="width:100%; height:270px; background:var(--surface-alt);"></div>
    </div>

    <!-- Active Delivery Status Card -->
    <div class="card" style="margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div>
          <h2 style="font-size:20px; margin-bottom:2px; font-weight:800;">Order #${order.id}</h2>
          <div style="color:var(--ink-secondary); font-size:13px;">From <strong>${order.restaurant_name}</strong></div>
        </div>
        ${(order.delivery_pin || order.delivery_otp) ? `
          <div style="text-align:right; flex-shrink:0;">
            <div style="font-size:10px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.5px;">Delivery PIN</div>
            <div class="pin-badge" style="font-family:monospace; font-size:16px; font-weight:800; letter-spacing:2px; background:var(--primary-soft); color:var(--primary); padding:4px 10px; border-radius:6px; border:1px solid var(--primary-border);">${order.delivery_pin || order.delivery_otp}</div>
            <div style="font-size:10px; color:var(--ink-muted); margin-top:2px;">Share with rider at doorstep</div>
          </div>
        ` : ''}
      </div>

      <!-- 5-Stage Stepper -->
      <div class="delivery-stepper">
        <div class="stepper-track-bg"></div>
        <div class="stepper-track-fill" style="width: ${progressWidth};"></div>
        <div class="stepper-nodes">
          <div class="stepper-node ${isStep1Done ? 'completed' : isStep1Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep1Done ? Icons.check(14) : '1'}</div>
            <div class="stepper-title">Placed</div>
          </div>
          <div class="stepper-node ${isStep2Done ? 'completed' : isStep2Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep2Done ? Icons.check(14) : Icons.kitchen(14)}</div>
            <div class="stepper-title">Cooking</div>
          </div>
          <div class="stepper-node ${isStep3Done ? 'completed' : isStep3Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep3Done ? Icons.check(14) : Icons.package(14)}</div>
            <div class="stepper-title">Ready</div>
          </div>
          <div class="stepper-node ${isStep4Done ? 'completed' : isStep4Active ? 'active' : ''}">
            <div class="stepper-icon">${isStep4Done ? Icons.check(14) : Icons.rider(14)}</div>
            <div class="stepper-title">On Way</div>
          </div>
          <div class="stepper-node ${isStep5Done ? 'completed' : ''}">
            <div class="stepper-icon">${isStep5Done ? Icons.check(14) : Icons.star(14)}</div>
            <div class="stepper-title">Delivered</div>
          </div>
        </div>
      </div>

      <!-- Rider Info or Kitchen Prep Note -->
      ${order.rider_name ? `
        <div style="display:flex; align-items:center; gap:12px; background:var(--surface-alt); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border);">
          <div style="width:44px; height:44px; border-radius:50%; background:var(--blue-soft); color:var(--blue); display:flex; align-items:center; justify-content:center;">
            ${Icons.rider(22, 'var(--blue)')}
          </div>
          <div style="flex:1;">
            <div style="font-weight:700; font-size:14px;">${order.rider_name} is delivering your food</div>
            <div style="font-size:12px; color:var(--ink-secondary);">${order.rider_vehicle || 'Motorcycle'} • 📞 ${order.rider_phone || '9876543210'}</div>
          </div>
          <a href="tel:${order.rider_phone || ''}" class="btn-secondary" style="padding:6px 12px; font-size:12px; color:var(--primary); border-color:var(--primary); font-weight:700;">Call</a>
        </div>
      ` : `
        <div style="background:var(--primary-soft); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--primary-border); font-size:13px; color:var(--ink); display:flex; align-items:center; gap:10px;">
          <span style="color:var(--primary);">${Icons.kitchen(20, 'var(--primary)')}</span>
          <div>
            <strong>Kitchen is preparing your order.</strong> A delivery partner will be automatically dispatched once items are boxed.
          </div>
        </div>
      `}
    </div>

    <!-- Items & Payment Receipt -->
    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px; margin-bottom:12px;">Order Summary</h3>
      ${order.items.map(it => `
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
          <span style="display:inline-flex; align-items:center; gap:5px;">${Icons.veg(11)} ${it.name} × ${it.qty}</span>
          <span style="font-weight:600;">₹${it.price * it.qty}</span>
        </div>
      `).join('')}
      <div style="border-top:1px solid var(--border); padding-top:8px; margin-top:8px; font-size:13px;">
        <div style="display:flex; justify-content:space-between; color:var(--ink-secondary); margin-bottom:4px;">
          <span>Delivery Fee</span><span>${order.delivery_fee === 0 ? '<span style="color:var(--green); font-weight:700;">FREE</span>' : '₹' + order.delivery_fee}</span>
        </div>
        ${order.discount_amount ? `
          <div style="display:flex; justify-content:space-between; color:var(--green); font-weight:700; margin-bottom:4px;">
            <span>Discount (${order.coupon_code || 'PROMO'})</span><span>− ₹${order.discount_amount}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:16px; border-top:1px dashed var(--border); margin-top:8px; padding-top:8px;">
          <span>Total Paid (${order.payment_method})</span>
          <span style="color:var(--primary);">₹${order.total}</span>
        </div>
      </div>
    </div>

    <!-- Timeline Audit -->
    <div class="card">
      <h3 style="font-size:15px; margin-bottom:14px;">Audit & Tracking Timeline</h3>
      ${(order.log || []).map(l => `
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

// ----------------------------------------------------
// 9. LEAFLET MAP WITH REAL-ROAD OSRM ROUTING
// ----------------------------------------------------
async function initTrackingMap(order) {
  const mapEl = document.getElementById('trackingMap');
  if (!mapEl || typeof L === 'undefined') return;

  const restLat = Number(order.restaurant_lat) || 22.5532;
  const restLng = Number(order.restaurant_lng) || 72.9485;
  const destLat = Number(order.dest_lat) || 22.5590;
  const destLng = Number(order.dest_lng) || 72.9570;

  if (state.mapInstance) {
    try { state.mapInstance.remove(); } catch (e) {}
  }

  state.mapInstance = L.map('trackingMap', { zoomControl: false }).setView([restLat, restLng], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(state.mapInstance);

  // Restaurant Marker
  const restIcon = L.divIcon({
    className: 'custom-map-pin restaurant',
    html: Icons.kitchen(16, '#FFF'),
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
  L.marker([restLat, restLng], { icon: restIcon }).addTo(state.mapInstance).bindPopup(`<strong>${order.restaurant_name}</strong>`);

  // Customer Destination Marker
  const destIcon = L.divIcon({
    className: 'custom-map-pin destination',
    html: Icons.location(16, '#FFF'),
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
  L.marker([destLat, destLng], { icon: destIcon }).addTo(state.mapInstance).bindPopup("Delivery Address");

  // Determine rider progress ratio
  let progressRatio = 0;
  if (['ASSIGNED', 'READY'].includes(order.status)) progressRatio = 0.05;
  else if (order.status === 'PICKED_UP') progressRatio = 0.35;
  else if (order.status === 'OUT_FOR_DELIVERY') progressRatio = 0.75;
  else if (order.status === 'DELIVERED') progressRatio = 1.0;

  // Real-road route fetching via OSRM with graceful fallback
  let routeCoords = [[restLat, restLng], [destLat, destLng]];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2800);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${restLng},${restLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) {
        // GeoJSON coords are [lng, lat], convert to Leaflet [lat, lng]
        routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      }
    }
  } catch (e) {
    // Offline or slow network: fallback to straight line
  }

  // Draw smooth polyline
  state.routePolyline = L.polyline(routeCoords, {
    color: '#FF5200',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round'
  }).addTo(state.mapInstance);

  // Position rider along the route
  const targetIndex = Math.min(routeCoords.length - 1, Math.floor(routeCoords.length * progressRatio));
  const riderPos = routeCoords[targetIndex] || [restLat, restLng];

  if (['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
    const riderIcon = L.divIcon({
      className: 'custom-map-pin rider',
      html: Icons.rider(18, '#FFF'),
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    state.riderMarker = L.marker(riderPos, { icon: riderIcon }).addTo(state.mapInstance);
  }

  // Fit bounds to show both restaurant and customer comfortably
  const bounds = L.latLngBounds(routeCoords);
  state.mapInstance.fitBounds(bounds, { padding: [35, 35] });
}

function celebrateDelivery() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }
}

init();
