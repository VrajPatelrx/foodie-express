const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('fe_user'));
} catch (e) {}

let state = {
  restaurants: [],
  activeRestaurantId: (currentUser && currentUser.restaurant_id) || localStorage.getItem('fe_vendor_restaurant') || null,
  orders: [],
  menu: [],
  showHistory: false,
};

async function init() {
  const headerActions = document.querySelector('.header-actions');
  if (headerActions && currentUser) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-secondary';
    logoutBtn.style.cssText = 'padding:6px 12px; font-size:12px;';
    logoutBtn.textContent = 'Sign Out';
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('fe_user');
      localStorage.removeItem('fe_token');
      localStorage.removeItem('fe_vendor_restaurant');
      window.location.href = 'login.html';
    });
    headerActions.prepend(logoutBtn);
  }

  // Setup Back Navigation & Exit Guard
  AppNavigation.setup({
    rootScreen: 'main',
    getCurrentScreen: () => 'main',
    exitUrl: '/login.html'
  });

  try {
    state.restaurants = await API.get('/api/restaurants');
    if (!state.activeRestaurantId) {
      renderPicker();
    } else {
      await loadOrders();
      render();
    }
  } catch (err) {
    console.error('Failed to init vendor app:', err);
    renderErrorScreen(view, {
      title: "Vendor Kitchen Offline",
      desc: "Unable to connect to the restaurant live order dispatch system. Check back in a moment as the system reconnects.",
      badge: "Kitchen Standby",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Reconnect Kitchen",
      showSwitchRole: true
    });
  }
}

socket.on('order:update', async (order) => {
  if (String(order.restaurant_id) === String(state.activeRestaurantId)) {
    const isNew = !state.orders.some(o => o.id === order.id);
    await loadOrders();
    render();

    if (order.status === 'PLACED' || isNew) {
      AudioFx.play('chime');
      toast(`🔔 New incoming order #${order.id} from ${order.customer_name}!`, 'info');
    } else {
      toast(`Order #${order.id} updated → ${STATUS_LABEL[order.status] || order.status}`);
    }
  }
});

async function loadOrders() {
  if (!state.activeRestaurantId) return;
  state.orders = await API.get(`/api/vendor/${state.activeRestaurantId}/orders`);
}

function renderPicker() {
  document.getElementById('activeRestaurantTag').textContent = 'Select Kitchen';
  view.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2>Kitchen Display System (KDS)</h2>
      <p style="color:var(--ink-secondary); font-size:14px;">Select the restaurant kitchen you want to manage:</p>
    </div>
    <div class="grid cols-3">
      ${state.restaurants.map(r => `
        <div class="rest-card" data-id="${r.id}">
          <div class="banner">${r.emoji}</div>
          <h3>${r.name}</h3>
          <div class="cuisine">${r.cuisine}</div>
          <div class="meta-row">
            <span class="rating-badge">★ ${r.rating}</span>
            <span class="badge ${r.is_open ? 'open' : 'closed'}">${r.is_open ? 'Active' : 'Closed'}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  view.querySelectorAll('.rest-card').forEach(el => {
    el.addEventListener('click', async () => {
      state.activeRestaurantId = el.dataset.id;
      localStorage.setItem('fe_vendor_restaurant', state.activeRestaurantId);
      await loadOrders();
      render();
    });
  });
}

function groupOrders() {
  const groups = { incoming: [], cooking: [], ready: [], history: [] };
  for (const o of state.orders) {
    if (o.status === 'PLACED') groups.incoming.push(o);
    else if (['ACCEPTED', 'PREPARING'].includes(o.status)) groups.cooking.push(o);
    else if (['READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status)) groups.ready.push(o);
    else groups.history.push(o);
  }
  return groups;
}

function render() {
  const r = state.restaurants.find(x => String(x.id) === String(state.activeRestaurantId));
  if (!r) { renderPicker(); return; }

  document.getElementById('activeRestaurantTag').textContent = `${r.emoji} ${r.name}`;

  const groups = groupOrders();

  view.innerHTML = `
    <!-- Top Action Bar -->
    <div class="card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="font-size:32px;">${r.emoji}</div>
        <div>
          <h2 style="font-size:20px;">${r.name}</h2>
          <div style="font-size:13px; color:var(--ink-secondary);">Kitchen Display System (KDS) · ${r.cuisine}</div>
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button class="btn-secondary" id="manageMenuBtn">📋 Manage Item Stock</button>
        <button class="btn-secondary" id="switchRestBtn">⇄ Switch Restaurant</button>
      </div>
    </div>

    <!-- 3-Column Kitchen Display Kanban -->
    <div class="kds-board">
      <!-- 1. Incoming Orders -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>🔔 Incoming Orders</span>
            <span class="kds-badge" style="color:var(--amber);">${groups.incoming.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">Action Required</span>
        </div>
        ${groups.incoming.length ? groups.incoming.map(o => renderOrderCard(o)).join('') : `
          <div style="text-align:center; padding:50px 10px; color:var(--ink-muted); font-size:13px;">
            No incoming orders.<br>New customer orders will chime here!
          </div>
        `}
      </div>

      <!-- 2. Kitchen Prep -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>🍳 Kitchen Prep</span>
            <span class="kds-badge" style="color:var(--blue);">${groups.cooking.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">Cooking</span>
        </div>
        ${groups.cooking.length ? groups.cooking.map(o => renderOrderCard(o)).join('') : `
          <div style="text-align:center; padding:50px 10px; color:var(--ink-muted); font-size:13px;">
            Kitchen is clear.<br>Orders being cooked appear here.
          </div>
        `}
      </div>

      <!-- 3. Dispatch & Hand-off -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>🛵 Ready & Dispatched</span>
            <span class="kds-badge" style="color:var(--green);">${groups.ready.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">Rider Logistics</span>
        </div>
        ${groups.ready.length ? groups.ready.map(o => renderOrderCard(o, false)).join('') : `
          <div style="text-align:center; padding:50px 10px; color:var(--ink-muted); font-size:13px;">
            No orders awaiting pickup or in transit.
          </div>
        `}
      </div>
    </div>

    <!-- Collapsible History -->
    <div style="margin-top:24px;">
      <button class="btn-secondary" id="toggleHistoryBtn" style="width:100%; justify-content:center;">
        ${state.showHistory ? '▲ Hide Completed Order History' : `▼ View Completed & Past Orders (${groups.history.length})`}
      </button>

      ${state.showHistory ? `
        <div class="card" style="margin-top:14px;">
          <table class="data">
            <thead>
              <tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th></tr>
            </thead>
            <tbody>
              ${groups.history.map(o => `
                <tr>
                  <td style="font-weight:700;">#${o.id}</td>
                  <td>${o.customer_name}</td>
                  <td>${o.items.map(i => `${i.qty}×${i.name}`).join(', ')}</td>
                  <td style="font-weight:700;">₹${o.total}</td>
                  <td><span class="stamp st-${o.status}" style="font-size:10px; padding:3px 8px;">${STATUS_LABEL[o.status]}</span></td>
                  <td style="color:var(--ink-muted);">${timeAgo(o.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('switchRestBtn').addEventListener('click', () => {
    localStorage.removeItem('fe_vendor_restaurant');
    state.activeRestaurantId = null;
    renderPicker();
  });

  document.getElementById('manageMenuBtn').addEventListener('click', renderStockModal);

  document.getElementById('toggleHistoryBtn').addEventListener('click', () => {
    state.showHistory = !state.showHistory;
    render();
  });

  // Attach status transition handlers
  view.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      const nextStatus = btn.dataset.action;
      try {
        btn.disabled = true;
        await API.patch(`/api/orders/${orderId}/status`, { status: nextStatus });
        AudioFx.play('alert');
        await loadOrders();
        render();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function renderOrderCard(order, showAction = true) {
  const elapsed = elapsedMinutes(order.created_at);
  let slaClass = 'normal';
  if (elapsed >= 18) slaClass = 'delayed';
  else if (elapsed >= 10) slaClass = 'warning';

  let actionHtml = '';
  if (showAction) {
    if (order.status === 'PLACED') {
      actionHtml = `
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn-primary" data-action="ACCEPTED" data-id="${order.id}" style="flex:1; padding:8px 12px; font-size:12px;">
            ✔ Accept Order
          </button>
          <button class="btn-secondary" data-action="REJECTED" data-id="${order.id}" style="color:var(--red); border-color:var(--red); padding:8px 10px; font-size:12px;">
            ✕
          </button>
        </div>
      `;
    } else if (order.status === 'ACCEPTED') {
      actionHtml = `
        <div style="margin-top:12px;">
          <button class="btn-primary" data-action="PREPARING" data-id="${order.id}" style="width:100%; padding:9px 12px; font-size:13px; background:var(--blue);">
            🍳 Start Preparing
          </button>
        </div>
      `;
    } else if (order.status === 'PREPARING') {
      actionHtml = `
        <div style="margin-top:12px;">
          <button class="btn-primary" data-action="READY" data-id="${order.id}" style="width:100%; padding:9px 12px; font-size:13px; background:var(--green);">
            📦 Mark Ready for Pickup
          </button>
        </div>
      `;
    }
  }

  return `
    <div class="kds-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div>
          <div style="font-weight:800; font-size:15px;">Order #${order.id}</div>
          <div style="font-size:12px; color:var(--ink-secondary);">${order.customer_name} · ${order.customer_phone || ''}</div>
        </div>
        <span class="sla-pill ${slaClass}">⏱ ${elapsed}m ago</span>
      </div>

      <div style="background:var(--surface-alt); border-radius:var(--radius-sm); padding:10px; margin:8px 0; font-size:13px;">
        ${order.items.map(it => `
          <div style="display:flex; justify-content:space-between; padding:2px 0;">
            <span style="font-weight:700;">${it.qty} × ${it.name}</span>
            <span style="color:var(--ink-secondary);">₹${it.price * it.qty}</span>
          </div>
        `).join('')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <span style="font-weight:700; color:var(--ink);">Total: ₹${order.total} (${order.payment_method})</span>
        <span class="stamp st-${order.status}" style="font-size:9px; padding:2px 6px;">${STATUS_LABEL[order.status]}</span>
      </div>

      ${order.rider_name ? `
        <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); font-size:12px; color:var(--ink-secondary);">
          🛵 Assigned Rider: <strong>${order.rider_name}</strong>
        </div>
      ` : ''}

      ${actionHtml}
    </div>
  `;
}

async function renderStockModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:540px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="font-size:18px;">📋 Menu Stock & Availability</h3>
        <button id="closeStockModal" style="background:none; border:none; font-size:20px; cursor:pointer;">✕</button>
      </div>
      <p style="font-size:13px; color:var(--ink-secondary); margin-bottom:16px;">
        Toggle items out of stock when ingredients run out. Changes update the customer app immediately.
      </p>

      <div id="stockList" style="max-height:360px; overflow-y:auto; padding-right:6px;">
        <div style="text-align:center; padding:20px;">Loading menu items...</div>
      </div>

      <div style="margin-top:16px; text-align:right;">
        <button class="btn-secondary" id="doneStockModal">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#closeStockModal').addEventListener('click', close);
  overlay.querySelector('#doneStockModal').addEventListener('click', close);

  try {
    const items = await API.get(`/api/restaurants/${state.activeRestaurantId}/menu`);
    const listEl = overlay.querySelector('#stockList');
    listEl.innerHTML = items.map(it => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="veg-dot ${it.veg ? '' : 'nonveg'}"></span>
          <div>
            <div style="font-weight:700; font-size:14px;">${it.name}</div>
            <div style="font-size:12px; color:var(--ink-secondary);">₹${it.price} · ${it.category || 'General'}</div>
          </div>
        </div>
        <button class="${it.is_available ? 'btn-secondary' : 'btn-primary'}" data-stock-id="${it.id}" style="padding:6px 14px; font-size:12px; ${it.is_available ? '' : 'background:var(--red);'}">
          ${it.is_available ? 'In Stock (Available)' : 'Sold Out (Off)'}
        </button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-stock-id]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.stockId;
        b.disabled = true;
        try {
          const res = await API.toggleItemStock(id);
          b.textContent = res.is_available ? 'In Stock (Available)' : 'Sold Out (Off)';
          b.className = res.is_available ? 'btn-secondary' : 'btn-primary';
          if (!res.is_available) b.style.background = 'var(--red)';
          else b.style.background = '';
          toast(`Updated stock status for item #${id}`, 'info');
        } catch (e) {
          toast(e.message, 'error');
        }
        b.disabled = false;
      });
    });
  } catch (err) {
    overlay.querySelector('#stockList').innerHTML = `<div style="color:var(--red); text-align:center;">Failed to load items: ${err.message}</div>`;
  }
}

init();
