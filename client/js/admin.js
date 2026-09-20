const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('fe_user'));
} catch (e) {}

const adminSignOutBtn = document.getElementById('adminSignOutBtn');
if (adminSignOutBtn) {
  adminSignOutBtn.addEventListener('click', () => {
    localStorage.removeItem('fe_user');
    localStorage.removeItem('fe_token');
    window.location.href = 'login.html';
  });
}

let state = {
  overview: null,
  orders: [],
  searchQuery: '',
  statusFilter: 'ALL',
};

function renderAccessRestricted() {
  view.innerHTML = `
    <div style="max-width:460px; margin:60px auto; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:32px 24px; text-align:center; box-shadow:var(--shadow-sm);">
      <div style="width:56px; height:56px; border-radius:50%; background:rgba(239,68,68,0.12); color:#EF4444; display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h2 style="font-size:20px; font-weight:800; margin:0 0 8px; color:var(--ink);">Admin Access Restricted</h2>
      <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 20px; line-height:1.5;">
        Platform revenue analytics, financial logs, and fleet dispatch controls are protected by security authentication.
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button id="quickAdminLoginBtn" class="btn-primary" style="width:100%; padding:10px; font-size:13px; font-weight:700;">
          1-Click Log In as Platform Admin
        </button>
        <a href="login.html" class="btn-secondary" style="width:100%; text-align:center; padding:10px; font-size:13px; text-decoration:none;">
          Go to Standard Login Page
        </a>
      </div>
    </div>
  `;

  document.getElementById('quickAdminLoginBtn')?.addEventListener('click', async () => {
    try {
      const res = await API.post('/api/auth/login', { demoRole: 'ADMIN' });
      localStorage.setItem('fe_token', res.token);
      localStorage.setItem('fe_user', JSON.stringify(res.user));
      currentUser = res.user;
      toast('Authenticated as Platform Admin', 'success');
      await loadAll();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadAll() {
  if (!localStorage.getItem('fe_token') || (currentUser && currentUser.role !== 'ADMIN')) {
    renderAccessRestricted();
    return;
  }

  try {
    const [overview, orders] = await Promise.all([
      API.get('/api/admin/overview'),
      API.get('/api/admin/orders'),
    ]);
    state.overview = overview;
    state.orders = orders;
  } catch (err) {
    if (err.message && (err.message.includes('401') || err.message.includes('sign in') || err.message.includes('Access denied') || err.message.includes('Forbidden'))) {
      renderAccessRestricted();
      return;
    }
    console.error('Failed to load admin data:', err);
    renderErrorScreen(view, {
      title: "Admin Analytics Standby",
      desc: "Unable to connect to the central analytics database. Please check your connection while we reconnect.",
      badge: "Admin Offline",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Reconnect Platform",
      showSwitchRole: true
    });
    throw err;
  }
}

socket.on('order:update', async () => {
  if (state.overview) {
    await loadAll();
    render();
  }
});

socket.on('riders:update', async () => {
  if (state.overview) {
    await loadAll();
    render();
  }
});

function render() {
  const { overview, orders } = state;
  const eco = overview.economics || {};

  const filteredOrders = orders.filter(o => {
    const q = state.searchQuery.toLowerCase();
    const matchSearch = String(o.id).includes(q) || 
                        o.customer_name.toLowerCase().includes(q) || 
                        o.restaurant_name.toLowerCase().includes(q);
    const matchStatus = state.statusFilter === 'ALL' || o.status === state.statusFilter;
    return matchSearch && matchStatus;
  });

  view.innerHTML = `
    <!-- Financial Unit Economics -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Platform Financials & Unit Economics</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Real-time Gross Order Value (GOV), commission take-rate, and payouts.</p>
    </div>

    <div class="grid cols-4" style="margin-bottom:24px;">
      <div class="stat-card">
        <div class="label">Gross Order Value (GOV)</div>
        <div class="num" style="color:var(--primary);">₹${overview.revenue}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Delivered order sales</div>
      </div>
      <div class="stat-card">
        <div class="label">Platform Commission (18%)</div>
        <div class="num" style="color:var(--purple);">₹${eco.commission || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Direct take-rate revenue</div>
      </div>
      <div class="stat-card">
        <div class="label">Restaurant Payouts (82%)</div>
        <div class="num" style="color:var(--blue);">₹${eco.restaurantPayout || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Net payable to kitchens</div>
      </div>
      <div class="stat-card">
        <div class="label">Platform Net Profit</div>
        <div class="num" style="color:var(--green);">₹${eco.platformNetProfit || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Commission + fees - rider costs</div>
      </div>
    </div>

    <!-- Operations Volume Metrics -->
    <div class="grid cols-4" style="margin-bottom:24px;">
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800;">${overview.totalOrders}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Total Orders Logged</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--primary);">${overview.activeOrders}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Active in Network</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--green);">${overview.delivered}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Successfully Delivered</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--blue);">
          ${overview.riders.filter(r => r.status === 'AVAILABLE').length} / ${overview.riders.length}
        </div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Riders Available</div>
      </div>
    </div>

    <!-- Rider Fleet Status -->
    <div style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:16px;">Delivery Fleet Logistics</h3>
        <span style="font-size:12px; color:var(--ink-secondary);">${overview.riders.length} Registered Partners</span>
      </div>
      <div class="grid cols-4">
        ${overview.riders.map(r => `
          <div class="card" style="padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="display:flex; align-items:center; color:var(--primary);">${Icons.rider(22)}</span>
              <span class="badge ${r.status === 'AVAILABLE' ? 'open' : r.status === 'BUSY' ? 'busy' : 'closed'}">
                ${r.status}
              </span>
            </div>
            <div style="font-weight:700; font-size:14px; margin-top:8px;">${r.name}</div>
            <div style="font-size:12px; color:var(--ink-secondary); margin-top:4px; display:flex; align-items:center; gap:8px;">
              <span>${r.vehicle || 'Bike'}</span>
              <span>•</span>
              <span style="display:inline-flex; align-items:center; gap:3px;">${Icons.star(12)} ${r.rating || 4.8}</span>
              <span>•</span>
              <span style="font-weight:700; color:var(--ink);">₹${r.earnings || 0}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Live Master Orders Table -->
    <div class="card" style="padding:22px; margin-top:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:18px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin-bottom:4px;">Master Order Feed (${filteredOrders.length})</h3>
          <div style="font-size:12.5px; color:var(--ink-secondary);">Real-time synchronized live dispatch stream with manual partner assignment override.</div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <div style="position:relative; width:260px;">
            <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); display:flex; align-items:center; color:var(--ink-muted);">
              ${Icons.search(15)}
            </span>
            <input type="text" id="orderTableSearch" placeholder="Search order, customer, store..." 
              value="${state.searchQuery}" style="width:100%; height:38px; padding-left:36px; padding-right:12px; font-size:13px; border-radius:var(--radius-sm); border:1px solid var(--border);">
          </div>
          
          <select id="orderStatusFilter" style="width:170px; height:38px; padding:0 12px; font-size:13px; border-radius:var(--radius-sm); border:1px solid var(--border); background:#fff; font-weight:600;">
            <option value="ALL" ${state.statusFilter === 'ALL' ? 'selected' : ''}>All Statuses (${orders.length})</option>
            <option value="PLACED" ${state.statusFilter === 'PLACED' ? 'selected' : ''}>Placed</option>
            <option value="ACCEPTED" ${state.statusFilter === 'ACCEPTED' ? 'selected' : ''}>Accepted</option>
            <option value="PREPARING" ${state.statusFilter === 'PREPARING' ? 'selected' : ''}>Preparing</option>
            <option value="READY" ${state.statusFilter === 'READY' ? 'selected' : ''}>Ready for Pickup</option>
            <option value="ASSIGNED" ${state.statusFilter === 'ASSIGNED' ? 'selected' : ''}>Assigned</option>
            <option value="OUT_FOR_DELIVERY" ${state.statusFilter === 'OUT_FOR_DELIVERY' ? 'selected' : ''}>Out for Delivery</option>
            <option value="DELIVERED" ${state.statusFilter === 'DELIVERED' ? 'selected' : ''}>Delivered</option>
            <option value="CANCELLED" ${state.statusFilter === 'CANCELLED' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
      </div>

      <div class="mobile-scroll-hint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        Swipe horizontally to view full feed columns
      </div>

      <div class="table-responsive">
        <table class="admin-table master-feed-table">
          <thead>
            <tr>
              <th style="width:75px; text-align:center;">#</th>
              <th style="width:200px;">Customer</th>
              <th style="width:190px;">Kitchen / Store</th>
              <th style="width:140px; text-align:center;">Status</th>
              <th style="width:160px;">Assigned Rider</th>
              <th style="width:110px; text-align:right;">Total</th>
              <th style="width:120px; text-align:center;">Delivery PIN</th>
              <th style="width:170px;">Date & Time</th>
              <th style="width:210px; text-align:center;">Manual Dispatch</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOrders.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:40px 20px; color:var(--ink-muted);">
                  No orders match your filter criteria.
                </td>
              </tr>
            ` : filteredOrders.map(o => {
              const canManualAssign = ['READY', 'PLACED', 'ACCEPTED'].includes(o.status);
              return `
                <tr>
                  <td style="text-align:center;">
                    <span class="mono" style="font-weight:800; font-size:13.5px; color:var(--ink);">#${o.id}</span>
                  </td>
                  <td>
                    <div style="font-weight:700; font-size:13.5px; color:var(--ink);">${o.customer_name}</div>
                    <div style="font-size:11.5px; color:var(--ink-secondary); max-width:210px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;" title="${o.customer_address}">
                      ${o.customer_address}
                    </div>
                  </td>
                  <td>
                    <div style="font-weight:700; font-size:13px; color:var(--ink); display:flex; align-items:center; gap:6px;">
                      <span style="color:var(--primary); display:flex; align-items:center;">${Icons.kitchen(15)}</span>
                      <span>${o.restaurant_name}</span>
                    </div>
                    <div style="font-size:11px; color:var(--ink-secondary); margin-top:2px; margin-left:21px;">${o.restaurant_cuisine || ''}</div>
                  </td>
                  <td style="text-align:center;">
                    <span class="stamp st-${o.status}" style="font-size:10.5px; padding:3px 8px;">
                      ${STATUS_LABEL[o.status] || o.status}
                    </span>
                  </td>
                  <td>
                    ${o.rider_name ? `
                      <div style="font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px;">
                        <span style="color:var(--blue); display:flex; align-items:center;">${Icons.rider(15)}</span>
                        <span>${o.rider_name}</span>
                      </div>
                      ${o.rider_phone ? `<div style="font-size:11px; color:var(--ink-secondary); margin-left:21px; margin-top:2px; display:flex; align-items:center; gap:4px;">${Icons.phone(12)} <span>${o.rider_phone}</span></div>` : ''}
                    ` : `
                      <span style="color:var(--ink-muted); font-size:12px; font-style:italic;">Unassigned</span>
                    `}
                  </td>
                  <td style="text-align:right;">
                    <strong style="font-size:14px; color:var(--ink);">₹${o.total}</strong>
                    <div style="font-size:10.5px; color:var(--ink-muted);">${o.payment_method || 'UPI'}</div>
                  </td>
                  <td style="text-align:center;">
                    <span class="pin-badge" style="font-family:'JetBrains Mono',monospace; font-weight:800; background:var(--primary-soft); color:var(--primary); padding:3px 9px; border-radius:6px; border:1px solid var(--primary-border); font-size:12.5px; letter-spacing:1px;">
                      ${o.delivery_otp || o.delivery_pin || '—'}
                    </span>
                  </td>
                  <td>
                    <div style="font-weight:700; font-size:12.5px; color:var(--ink);">${formatOrderDateTime(o.created_at)}</div>
                    <div style="color:var(--ink-muted); font-size:11px; margin-top:2px;">${timeAgo(o.created_at)}</div>
                  </td>
                  <td style="text-align:center;">
                    ${canManualAssign ? `
                      <div style="display:inline-flex; gap:6px; align-items:center; justify-content:center;">
                        <select data-assign-select="${o.id}" style="padding:5px 8px; font-size:11.5px; width:135px; height:32px; border-radius:var(--radius-sm); border:1px solid var(--border); background:#fff;">
                          <option value="">Select Partner...</option>
                          ${overview.riders.map(r => `<option value="${r.id}" ${r.status === 'BUSY' ? 'disabled' : ''}>${r.name} (${r.status})</option>`).join('')}
                        </select>
                        <button class="btn-primary" data-assign-btn="${o.id}" style="padding:5px 12px; font-size:11.5px; height:32px; border-radius:var(--radius-sm); font-weight:700; white-space:nowrap;">
                          Assign
                        </button>
                      </div>
                    ` : `
                      <span style="font-size:11.5px; color:var(--ink-muted); background:var(--surface-alt); padding:3px 10px; border-radius:999px;">Locked</span>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Search input handler with focus and cursor preservation
  const searchEl = document.getElementById('orderTableSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      render();
      const input = document.getElementById('orderTableSearch');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  // Filter dropdown handler
  const filterEl = document.getElementById('orderStatusFilter');
  if (filterEl) {
    filterEl.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      render();
    });
  }

  // Manual Dispatch click handlers
  view.querySelectorAll('[data-assign-btn]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.assignBtn;
      const select = view.querySelector(`[data-assign-select="${orderId}"]`);
      const riderId = select ? select.value : null;

      if (!riderId) {
        toast('Please select a rider from the dropdown', 'error');
        return;
      }

      try {
        btn.disabled = true;
        await API.assignRider(orderId, riderId);
        toast(`Order #${orderId} assigned successfully!`, 'success');
        await loadAll();
        render();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

(async () => {
  AppNavigation.setup({
    rootScreen: 'main',
    getCurrentScreen: () => 'main',
    exitUrl: '/login.html'
  });
  await loadAll();
  render();
})();
