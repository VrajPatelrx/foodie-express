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
      title: "Kitchen Terminal Offline",
      desc: "Unable to sync with live kitchen tickets. Please check your network while we attempt reconnection.",
      badge: "KDS Paused",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Reconnect Kitchen",
      showSwitchRole: true
    });
  }
}

socket.on('order:update', async (order) => {
  if (String(order.restaurant_id) === String(state.activeRestaurantId)) {
    const prevOrder = state.orders.find(o => o.id === order.id);
    const isNew = !prevOrder;

    await loadOrders();
    render();

    if (order.status === 'PLACED' || isNew) {
      AudioFx.play('chime');
      toast(`New incoming order #${order.id} from ${order.customer_name}`, 'info');
    } else {
      AudioFx.play('alert');
    }
  }
});

async function loadOrders() {
  state.orders = await API.get(`/api/vendor/${state.activeRestaurantId}/orders`);
}

function renderPicker() {
  document.getElementById('activeRestaurantTag').textContent = 'Select Kitchen';
  view.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2>Select Restaurant Kitchen</h2>
      <p style="color:var(--ink-secondary); font-size:14px;">Choose the restaurant kitchen terminal to manage incoming tickets:</p>
    </div>
    <div class="grid cols-4">
      ${state.restaurants.map(r => `
        <div class="rest-card" data-id="${r.id}">
          <div class="banner" style="display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg, var(--primary-soft), var(--surface-alt));">
            ${typeof Icons !== 'undefined' ? Icons.kitchen(28, 'var(--primary)') : ''}
          </div>
          <h3>${r.name}</h3>
          <div class="cuisine">${r.cuisine}</div>
          <div class="meta-row">
            <span>Rating ${r.rating || 4.5}</span>
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
    else if (['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.status)) groups.history.push(o);
  }
  return groups;
}

function render() {
  const r = state.restaurants.find(x => String(x.id) === String(state.activeRestaurantId));
  if (!r) { renderPicker(); return; }

  document.getElementById('activeRestaurantTag').textContent = r.name;

  const groups = groupOrders();

  view.innerHTML = `
    <!-- Top Action Bar -->
    <div class="card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:48px; height:48px; border-radius:12px; background:var(--primary-soft); color:var(--primary); display:flex; align-items:center; justify-content:center;">
          ${typeof Icons !== 'undefined' ? Icons.kitchen(24) : ''}
        </div>
        <div>
          <h2 style="font-size:20px; margin:0 0 2px;">${r.name}</h2>
          <div style="font-size:13px; color:var(--ink-secondary);">Kitchen Display Terminal (KDS) · ${r.cuisine}</div>
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button class="btn-secondary" id="manageMenuBtn">Item Stock Control</button>
        <button class="btn-secondary" id="switchRestBtn">Switch Kitchen</button>
      </div>
    </div>

    <!-- 3-Column Kitchen Display Kanban -->
    <div class="kds-board">
      <!-- 1. Incoming Orders -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>Incoming Orders</span>
            <span class="kds-badge" style="color:var(--amber);">${groups.incoming.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">Action Required</span>
        </div>
        ${groups.incoming.length ? groups.incoming.map(o => renderOrderCard(o)).join('') : `
          <div style="text-align:center; padding:50px 10px; color:var(--ink-muted); font-size:13px;">
            No incoming orders.<br>New customer tickets will chime here.
          </div>
        `}
      </div>

      <!-- 2. Kitchen Prep -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>Cooking Queue</span>
            <span class="kds-badge" style="color:var(--blue);">${groups.cooking.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">In Preparation</span>
        </div>
        ${groups.cooking.length ? groups.cooking.map(o => renderOrderCard(o)).join('') : `
          <div style="text-align:center; padding:50px 10px; color:var(--ink-muted); font-size:13px;">
            Kitchen queue is clear.<br>Dishes being prepared appear here.
          </div>
        `}
      </div>

      <!-- 3. Dispatch & Hand-off -->
      <div class="kds-col">
        <div class="kds-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>Ready & Dispatched</span>
            <span class="kds-badge" style="color:var(--green);">${groups.ready.length}</span>
          </div>
          <span style="font-size:11px; color:var(--ink-muted);">Partner Hand-off</span>
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
      <button class="btn-secondary" id="toggleHistoryBtn" style="font-size:12px; padding:6px 14px;">
        ${state.showHistory ? 'Hide Past Orders' : `View Past Orders (${groups.history.length})`}
      </button>

      ${state.showHistory && groups.history.length ? `
        <div class="card" style="margin-top:12px; overflow-x:auto;">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${groups.history.map(o => `
                <tr>
                  <td><strong>#${o.id}</strong></td>
                  <td>${o.customer_name}</td>
                  <td>${o.items.map(i => `${i.qty}×${i.name}`).join(', ')}</td>
                  <td>₹${o.total}</td>
                  <td><span class="stamp st-${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
                  <td style="color:var(--ink-muted); font-size:12px;">${timeAgo(o.created_at)}</td>
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

  view.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        await API.patch(`/api/orders/${btn.dataset.id}/status`, { status: btn.dataset.action });
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

function renderOrderCard(order, allowAction = true) {
  const elapsed = Math.floor((Date.now() - new Date(order.created_at.replace(' ', 'T') + 'Z').getTime()) / 60000);
  let slaClass = 'normal';
  if (elapsed >= 18) slaClass = 'delayed';
  else if (elapsed >= 10) slaClass = 'warning';

  let actionHtml = '';
  if (allowAction) {
    if (order.status === 'PLACED') {
      actionHtml = `
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn-primary" data-action="ACCEPTED" data-id="${order.id}" style="flex:1; padding:8px 12px; font-size:12px;">
            Accept Order
          </button>
          <button class="btn-secondary" data-action="REJECTED" data-id="${order.id}" style="color:var(--red); border-color:var(--red); padding:8px 10px; font-size:12px;">
            Decline
          </button>
        </div>
      `;
    } else if (order.status === 'ACCEPTED') {
      actionHtml = `
        <div style="margin-top:12px;">
          <button class="btn-primary" data-action="PREPARING" data-id="${order.id}" style="width:100%; padding:9px 12px; font-size:13px; background:var(--blue);">
            Start Cooking
          </button>
        </div>
      `;
    } else if (order.status === 'PREPARING') {
      actionHtml = `
        <div style="margin-top:12px;">
          <button class="btn-primary" data-action="READY" data-id="${order.id}" style="width:100%; padding:9px 12px; font-size:13px; background:var(--green);">
            Mark Ready for Pickup
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
        <span class="sla-pill ${slaClass}">${elapsed}m ago</span>
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
          Assigned Partner: <strong>${order.rider_name}</strong>
        </div>
      ` : ''}

      ${actionHtml}
    </div>
  `;
}

async function renderStockModal() {
  const menu = await API.get(`/api/restaurants/${state.activeRestaurantId}/menu`);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:540px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h3 style="margin:0;">Menu Item Stock Control</h3>
          <p style="margin:4px 0 0; font-size:13px; color:var(--ink-secondary);">Toggle items In-Stock or Sold-Out in real time.</p>
        </div>
        <button class="btn-secondary" id="closeStockModal" style="padding:4px 8px; font-size:12px;">✕</button>
      </div>

      <div style="max-height:380px; overflow-y:auto; padding-right:4px;">
        ${menu.map(item => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border);">
            <div>
              <div style="font-weight:700; font-size:14px;">${item.name}</div>
              <div style="font-size:12px; color:var(--ink-secondary);">₹${item.price} · ${item.category}</div>
            </div>
            <button class="btn-secondary toggle-stock-btn" data-id="${item.id}" data-state="${item.is_available}" style="font-size:12px; font-weight:700; padding:6px 12px; ${item.is_available ? 'color:var(--green); border-color:var(--green);' : 'color:var(--red); border-color:var(--red);'}">
              ${item.is_available ? 'In Stock' : 'Sold Out'}
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#closeStockModal').addEventListener('click', () => overlay.remove());

  overlay.querySelectorAll('.toggle-stock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        const res = await API.patch(`/api/menu-items/${id}/toggle`);
        btn.dataset.state = res.is_available;
        btn.textContent = res.is_available ? 'In Stock' : 'Sold Out';
        btn.style.color = res.is_available ? 'var(--green)' : 'var(--red)';
        btn.style.borderColor = res.is_available ? 'var(--green)' : 'var(--red)';
        toast(`Updated stock for ${res.name}`, 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

init();
