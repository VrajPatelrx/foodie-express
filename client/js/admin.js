const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

let state = {
  overview: null,
  orders: [],
  searchQuery: '',
  statusFilter: 'ALL',
};

async function loadAll() {
  try {
    const [overview, orders] = await Promise.all([
      API.get('/api/admin/overview'),
      API.get('/api/admin/orders'),
    ]);
    state.overview = overview;
    state.orders = orders;
  } catch (err) {
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
  await loadAll();
  render();
});

socket.on('riders:update', async () => {
  await loadAll();
  render();
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
              <span style="font-size:24px;">🛵</span>
              <span class="badge ${r.status === 'AVAILABLE' ? 'open' : r.status === 'BUSY' ? 'busy' : 'closed'}">
                ${r.status}
              </span>
            </div>
            <div style="font-weight:700; font-size:14px; margin-top:8px;">${r.name}</div>
            <div style="font-size:12px; color:var(--ink-secondary); margin-top:2px;">
              ${r.vehicle || 'Bike'} · ★ ${r.rating || 4.8} · 💰 ₹${r.earnings || 0}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Live Master Orders Table -->
    <div class="card" style="padding:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <div>
          <h3 style="font-size:16px;">Master Order Feed (${filteredOrders.length})</h3>
          <div style="font-size:12px; color:var(--ink-secondary);">Real-time synchronized across network with manual dispatch override.</div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input type="text" id="orderTableSearch" placeholder="Search order, customer, restaurant..." 
            value="${state.searchQuery}" style="width:240px; padding:6px 12px; font-size:13px;">
          
          <select id="orderStatusFilter" style="width:160px; padding:6px 10px; font-size:13px;">
            <option value="ALL" ${state.statusFilter === 'ALL' ? 'selected' : ''}>All Statuses</option>
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

      <div class="table-responsive">
        <table class="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Customer</th>
              <th>Restaurant</th>
              <th>Status</th>
              <th>Assigned Rider</th>
              <th>Total</th>
              <th>Delivery PIN</th>
              <th>Date & Time</th>
              <th>Manual Dispatch</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOrders.map(o => {
              const canManualAssign = ['READY', 'PLACED', 'ACCEPTED'].includes(o.status);
              return `
                <tr>
                  <td style="font-weight:700;">#${o.id}</td>
                  <td>
                    <div style="font-weight:600;">${o.customer_name}</div>
                    <div style="font-size:11px; color:var(--ink-secondary);">${o.customer_address}</div>
                  </td>
                  <td>${o.restaurant_emoji} ${o.restaurant_name}</td>
                  <td>
                    <span class="stamp st-${o.status}" style="font-size:10px; padding:3px 8px;">
                      ${STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td>${o.rider_name || '<span style="color:var(--ink-muted);">Unassigned</span>'}</td>
                  <td style="font-weight:700;">₹${o.total}</td>
                  <td style="font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--primary);">${o.delivery_otp || '—'}</td>
                  <td>
                    <div style="font-weight:700; font-size:12px;">${formatOrderDateTime(o.created_at)}</div>
                    <div style="color:var(--ink-muted); font-size:11px;">${timeAgo(o.created_at)}</div>
                  </td>
                  <td>
                    ${canManualAssign ? `
                      <div style="display:flex; gap:6px; align-items:center;">
                        <select data-assign-select="${o.id}" style="padding:4px 8px; font-size:11px; width:130px;">
                          <option value="">Select Rider...</option>
                          ${overview.riders.map(r => `<option value="${r.id}" ${r.status === 'BUSY' ? 'disabled' : ''}>${r.name} (${r.status})</option>`).join('')}
                        </select>
                        <button class="btn-primary" data-assign-btn="${o.id}" style="padding:4px 10px; font-size:11px;">
                          Assign
                        </button>
                      </div>
                    ` : `
                      <span style="font-size:11px; color:var(--ink-muted);">Locked</span>
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

  // Search input handler
  const searchEl = document.getElementById('orderTableSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      render();
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
