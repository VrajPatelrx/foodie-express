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

socket.on('restaurants:update', async () => {
  state.restaurants = await API.get('/api/restaurants');
  if (state.activeRestaurantId) render();
});

socket.on('menu:update', async (data) => {
  if (data && String(data.restaurant_id) === String(state.activeRestaurantId)) {
    const existingMenuModal = document.getElementById('menuManagerModalOverlay');
    if (existingMenuModal) {
      renderMenuModal();
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
  const isOnline = Boolean(r.is_open);

  view.innerHTML = `
    <!-- Top Action Bar -->
    <div class="card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:48px; height:48px; border-radius:12px; background:var(--primary-soft); color:var(--primary); display:flex; align-items:center; justify-content:center;">
          ${typeof Icons !== 'undefined' ? Icons.kitchen(24) : ''}
        </div>
        <div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <h2 style="font-size:20px; margin:0;">${r.name}</h2>
            <span class="badge ${isOnline ? 'open' : 'closed'}">${isOnline ? 'Open for Orders' : 'Store Paused'}</span>
          </div>
          <div style="font-size:13px; color:var(--ink-secondary); margin-top:3px;">
            ${r.cuisine || 'Pure Veg Kitchen'} · Est. Prep & Delivery: <strong>${r.eta_minutes || 25} mins</strong>
          </div>
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button class="btn-secondary" id="kdsDutyToggleBtn" style="font-size:12.5px; padding:7px 12px; display:inline-flex; align-items:center; gap:6px; font-weight:700;">
          <span style="width:8px; height:8px; border-radius:50%; background:${isOnline ? 'var(--green)' : 'var(--red)'}; display:inline-block;"></span>
          ${isOnline ? 'Kitchen Online' : 'Kitchen Offline'}
        </button>
        <button class="btn-secondary" id="editProfileBtn" style="font-size:12.5px; padding:7px 12px; display:inline-flex; align-items:center; gap:6px; font-weight:600;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Edit Kitchen
        </button>
        <button class="btn-primary" id="manageMenuBtn" style="font-size:12.5px; padding:7px 14px; display:inline-flex; align-items:center; gap:6px; font-weight:700;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Menu & Products
        </button>
        <button class="btn-secondary" id="switchRestBtn" style="font-size:12.5px; padding:7px 12px;">Switch Kitchen</button>
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
    <div style="margin-top:28px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <button class="btn-secondary" id="toggleHistoryBtn" style="font-size:12.5px; padding:8px 16px; font-weight:700; display:inline-flex; align-items:center; gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:${state.showHistory ? 'rotate(180deg)' : 'none'}; transition:transform 0.2s;">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          ${state.showHistory ? 'Hide Completed Order History' : `View Completed Order History (${groups.history.length})`}
        </button>
      </div>

      ${state.showHistory && groups.history.length ? `
        <div style="margin-top:12px;">
          <div class="mobile-scroll-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            Swipe horizontally to view full order history
          </div>
          <div class="table-responsive">
            <table class="admin-table">
              <thead>
                <tr>
                  <th style="width:100px;">Order ID</th>
                  <th style="width:170px;">Customer</th>
                  <th>Items Ordered</th>
                  <th style="width:110px;">Total</th>
                  <th style="width:130px;">Status</th>
                  <th style="width:190px;">Date & Time</th>
                </tr>
              </thead>
              <tbody>
                ${groups.history.map(o => `
                  <tr>
                    <td><span class="mono" style="font-weight:800; color:var(--ink); font-size:13.5px;">#${o.id}</span></td>
                    <td>
                      <div style="font-weight:700; font-size:13.5px;">${o.customer_name}</div>
                      ${o.customer_phone ? `<div style="font-size:11px; color:var(--ink-secondary); margin-top:2px; display:flex; align-items:center; gap:4px;">${Icons.phone(12)} <span>${o.customer_phone}</span></div>` : ''}
                    </td>
                    <td>
                      <div style="display:flex; flex-wrap:wrap; gap:5px;">
                        ${o.items.map(i => `<span class="order-item-chip" style="font-size:11.5px; padding:3px 8px;">${i.qty}× ${i.name}</span>`).join('')}
                      </div>
                    </td>
                    <td><strong style="font-size:14px; color:var(--ink);">₹${o.total}</strong></td>
                    <td><span class="stamp st-${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
                    <td>
                      <div style="font-weight:700; font-size:12.5px; color:var(--ink);">${formatOrderDateTime(o.created_at)}</div>
                      <div style="color:var(--ink-muted); font-size:11px; margin-top:2px;">${timeAgo(o.created_at)}</div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('switchRestBtn').addEventListener('click', () => {
    localStorage.removeItem('fe_vendor_restaurant');
    state.activeRestaurantId = null;
    renderPicker();
  });

  document.getElementById('kdsDutyToggleBtn').addEventListener('click', async () => {
    try {
      const btn = document.getElementById('kdsDutyToggleBtn');
      btn.disabled = true;
      const nextState = r.is_open ? 0 : 1;
      await API.patch(`/api/restaurants/${r.id}`, { is_open: nextState });
      r.is_open = nextState;
      toast(nextState ? 'Kitchen is now OPEN for customer orders' : 'Kitchen is now PAUSED (Offline)', 'info');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('editProfileBtn').addEventListener('click', () => renderEditProfileModal(r));
  document.getElementById('manageMenuBtn').addEventListener('click', () => renderMenuModal());

  document.getElementById('toggleHistoryBtn').addEventListener('click', () => {
    state.showHistory = !state.showHistory;
    render();
  });

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

function renderOrderCard(order, allowAction = true) {
  const elapsed = elapsedMinutes(order.created_at);
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

// --- RESTAURANT PROFILE EDITING MODAL ---
function renderEditProfileModal(restaurant) {
  const existing = document.getElementById('editProfileModalOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'editProfileModalOverlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="color:var(--primary); display:inline-flex;">${typeof Icons !== 'undefined' ? Icons.kitchen(20) : ''}</span>
          <h3 style="margin:0; font-size:17px;">Edit Kitchen Profile</h3>
        </div>
        <button class="btn-secondary" id="closeEditProfileModal" style="padding:4px 8px; font-size:12px; border-radius:6px;">✕</button>
      </div>

      <form id="editProfileForm">
        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Restaurant / Kitchen Name</label>
          <input type="text" id="editRestName" required value="${restaurant.name || ''}" placeholder="e.g. Darbar Mugg Pulav" style="width:100%; height:40px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:14px;">
        </div>

        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Cuisine Specialty / Description</label>
          <input type="text" id="editRestCuisine" required value="${restaurant.cuisine || ''}" placeholder="e.g. Mugg Pulav, Biryani & Snacks" style="width:100%; height:40px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:14px;">
        </div>

        <div style="margin-bottom:16px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Avg. Delivery / Prep ETA (Minutes)</label>
          <input type="number" id="editRestEta" required min="10" max="120" value="${restaurant.eta_minutes || 25}" style="width:100%; height:40px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:14px;">
        </div>

        <div style="margin-bottom:20px; padding:12px; background:var(--surface-alt); border-radius:8px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-weight:700; font-size:13px;">Store Status</div>
            <div style="font-size:12px; color:var(--ink-secondary);">Open to receive new customer orders</div>
          </div>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; font-size:13px;">
            <input type="checkbox" id="editRestIsOpen" ${restaurant.is_open ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--primary);">
            <span>Open</span>
          </label>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button type="button" class="btn-secondary" id="cancelEditProfileBtn" style="padding:9px 16px; font-size:13px;">Cancel</button>
          <button type="submit" class="btn-primary" id="saveProfileBtn" style="padding:9px 20px; font-size:13px; font-weight:700;">Save Changes</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.querySelector('#closeEditProfileModal').addEventListener('click', closeModal);
  overlay.querySelector('#cancelEditProfileBtn').addEventListener('click', closeModal);

  overlay.querySelector('#editProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = overlay.querySelector('#saveProfileBtn');
    const name = overlay.querySelector('#editRestName').value.trim();
    const cuisine = overlay.querySelector('#editRestCuisine').value.trim();
    const eta_minutes = Number(overlay.querySelector('#editRestEta').value);
    const is_open = overlay.querySelector('#editRestIsOpen').checked ? 1 : 0;

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const res = await API.patch(`/api/restaurants/${restaurant.id}`, { name, cuisine, eta_minutes, is_open });
      toast('Restaurant profile updated successfully!', 'success');
      closeModal();
      // Update state and refresh
      state.restaurants = await API.get('/api/restaurants');
      render();
    } catch (err) {
      toast(err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}

// --- FULL MENU & PRODUCT MANAGEMENT MODAL ---
async function renderMenuModal() {
  const existing = document.getElementById('menuManagerModalOverlay');
  if (existing) existing.remove();

  const menu = await API.get(`/api/restaurants/${state.activeRestaurantId}/menu`);
  const overlay = document.createElement('div');
  overlay.id = 'menuManagerModalOverlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:620px; width:100%;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:12px; gap:10px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <h3 style="margin:0; font-size:18px;">Menu & Product Manager</h3>
            <span style="font-size:12px; color:var(--ink-secondary); background:var(--surface-alt); padding:2px 8px; border-radius:999px; font-weight:700;">${menu.length} Dishes</span>
          </div>
          <p style="margin:3px 0 0; font-size:12.5px; color:var(--ink-secondary);">Add new dishes, modify prices, update details, or toggle stock.</p>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn-primary" id="openAddDishBtn" style="padding:6px 14px; font-size:12.5px; font-weight:700; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add New Dish
          </button>
          <button class="btn-secondary" id="closeMenuManagerModal" style="padding:4px 8px; font-size:12px; border-radius:6px;">✕</button>
        </div>
      </div>

      <div style="max-height:420px; overflow-y:auto; padding-right:4px;" id="menuProductListContainer">
        ${menu.length ? menu.map(item => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 10px; border-bottom:1px solid var(--border); gap:12px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:180px;">
              <span style="display:inline-flex; flex-shrink:0;">${typeof Icons !== 'undefined' ? Icons.veg(15) : ''}</span>
              <div>
                <div style="font-weight:700; font-size:14px; color:var(--ink);">${item.name}</div>
                <div style="font-size:12px; color:var(--ink-secondary); display:flex; align-items:center; gap:6px; margin-top:2px;">
                  <strong style="color:var(--ink); font-size:13px;">₹${item.price}</strong>
                  <span>•</span>
                  <span style="background:var(--surface-alt); padding:1px 6px; border-radius:4px; font-size:11px;">${item.category || 'General'}</span>
                </div>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
              <!-- Quick Stock Toggle -->
              <button class="btn-secondary toggle-stock-btn" data-id="${item.id}" data-state="${item.is_available}" style="font-size:11.5px; font-weight:700; padding:5px 10px; border-radius:6px; ${item.is_available ? 'color:var(--green); border-color:var(--green);' : 'color:var(--red); border-color:var(--red);'}">
                ${item.is_available ? 'In Stock' : 'Sold Out'}
              </button>

              <!-- Edit Dish -->
              <button class="btn-secondary edit-dish-btn" data-id="${item.id}" style="font-size:11.5px; padding:5px 10px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Edit
              </button>

              <!-- Delete Dish -->
              <button class="btn-secondary delete-dish-btn" data-id="${item.id}" data-name="${item.name}" style="font-size:11.5px; padding:5px 10px; border-radius:6px; color:var(--red); border-color:var(--red); display:inline-flex; align-items:center; gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Delete
              </button>
            </div>
          </div>
        `).join('') : `
          <div style="text-align:center; padding:40px 10px; color:var(--ink-secondary); font-size:13.5px;">
            No dishes found on this menu.<br>Click <strong>"+ Add New Dish"</strong> above to add your first pure veg item!
          </div>
        `}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#closeMenuManagerModal').addEventListener('click', () => overlay.remove());

  // Wire Add Dish button
  overlay.querySelector('#openAddDishBtn').addEventListener('click', () => {
    renderDishFormModal(null, async () => {
      await renderMenuModal();
    });
  });

  // Wire Stock Toggle buttons
  overlay.querySelectorAll('.toggle-stock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        btn.disabled = true;
        const res = await API.patch(`/api/menu-items/${id}/toggle`);
        btn.dataset.state = res.is_available;
        btn.textContent = res.is_available ? 'In Stock' : 'Sold Out';
        btn.style.color = res.is_available ? 'var(--green)' : 'var(--red)';
        btn.style.borderColor = res.is_available ? 'var(--green)' : 'var(--red)';
        btn.disabled = false;
        toast(`Stock updated: ${res.is_available ? 'In Stock' : 'Sold Out'}`, 'info');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Wire Edit buttons
  overlay.querySelectorAll('.edit-dish-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = menu.find(m => String(m.id) === String(btn.dataset.id));
      if (item) {
        renderDishFormModal(item, async () => {
          await renderMenuModal();
        });
      }
    });
  });

  // Wire Delete buttons
  overlay.querySelectorAll('.delete-dish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      if (!confirm(`Are you sure you want to permanently delete "${name}" from the menu?`)) return;

      try {
        btn.disabled = true;
        await API.delete(`/api/menu-items/${id}`);
        toast(`Removed "${name}" from menu`, 'info');
        await renderMenuModal();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

// --- ADD / EDIT DISH FORM MODAL ---
function renderDishFormModal(existingItem = null, onSuccess = () => {}) {
  const isEdit = Boolean(existingItem);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '11000'; // Layer above menu manager modal
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-flex;">${typeof Icons !== 'undefined' ? Icons.veg(16) : ''}</span>
          <h3 style="margin:0; font-size:16px;">${isEdit ? 'Edit Dish Details' : 'Add New Pure Veg Dish'}</h3>
        </div>
        <button class="btn-secondary" id="closeDishFormModal" style="padding:4px 8px; font-size:12px; border-radius:6px;">✕</button>
      </div>

      <form id="dishForm">
        <div style="margin-bottom:12px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Dish Name</label>
          <input type="text" id="dishName" required value="${isEdit ? existingItem.name : ''}" placeholder="e.g. Special Mugg Pulav Bowl" style="width:100%; height:38px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:13.5px;">
        </div>

        <div style="margin-bottom:12px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Category</label>
          <input type="text" id="dishCategory" list="dishCategoryList" required value="${isEdit ? (existingItem.category || 'Meals') : 'Meals'}" placeholder="e.g. Pulav, Meals, Snacks" style="width:100%; height:38px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:13.5px;">
          <datalist id="dishCategoryList">
            <option value="Pulav & Biryani">
            <option value="Meals & Thali">
            <option value="Snacks">
            <option value="Fast Food">
            <option value="Starters">
            <option value="Combos">
            <option value="Beverages">
            <option value="Desserts">
          </datalist>
        </div>

        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:13px; font-weight:700; margin-bottom:4px;">Price (₹)</label>
          <input type="number" id="dishPrice" required min="1" step="1" value="${isEdit ? existingItem.price : ''}" placeholder="e.g. 140" style="width:100%; height:38px; padding:0 12px; border-radius:8px; border:1px solid var(--border); box-sizing:border-box; font-size:13.5px;">
        </div>

        <div style="margin-bottom:16px; padding:10px; background:var(--surface-alt); border-radius:8px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-weight:700; font-size:12.5px;">Availability</div>
            <div style="font-size:11.5px; color:var(--ink-secondary);">Available for immediate orders</div>
          </div>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; font-size:12.5px;">
            <input type="checkbox" id="dishAvailable" ${!isEdit || existingItem.is_available ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--primary);">
            <span>In Stock</span>
          </label>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button type="button" class="btn-secondary" id="cancelDishFormBtn" style="padding:8px 14px; font-size:12.5px;">Cancel</button>
          <button type="submit" class="btn-primary" id="saveDishSubmitBtn" style="padding:8px 18px; font-size:12.5px; font-weight:700;">${isEdit ? 'Save Changes' : 'Add Dish'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeForm = () => overlay.remove();
  overlay.querySelector('#closeDishFormModal').addEventListener('click', closeForm);
  overlay.querySelector('#cancelDishFormBtn').addEventListener('click', closeForm);

  overlay.querySelector('#dishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#saveDishSubmitBtn');
    const name = overlay.querySelector('#dishName').value.trim();
    const category = overlay.querySelector('#dishCategory').value.trim();
    const price = Number(overlay.querySelector('#dishPrice').value);
    const is_available = overlay.querySelector('#dishAvailable').checked ? 1 : 0;

    try {
      btn.disabled = true;
      btn.textContent = 'Saving...';

      if (isEdit) {
        await API.patch(`/api/menu-items/${existingItem.id}`, { name, category, price, is_available });
        toast(`Updated "${name}" successfully!`, 'success');
      } else {
        await API.post(`/api/restaurants/${state.activeRestaurantId}/menu`, { name, category, price, is_available });
        toast(`Added "${name}" to your menu!`, 'success');
      }

      closeForm();
      onSuccess();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Save Changes' : 'Add Dish';
    }
  });
}

init();
