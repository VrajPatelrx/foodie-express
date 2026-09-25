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
  activeTab: 'analytics', // analytics | restaurants | fleet | orders | coupons
  overview: null,
  analytics: null,
  orders: [],
  coupons: [],
  searchQuery: '',
  statusFilter: 'ALL',
  charts: {}
};

function renderAccessRestricted() {
  if (adminSignOutBtn) adminSignOutBtn.style.display = 'none';
  const userRole = currentUser ? currentUser.role : 'GUEST';
  const roleRedirects = {
    CUSTOMER: { label: 'Go to Customer Portal', url: 'customer.html' },
    VENDOR: { label: 'Go to Kitchen KDS', url: 'vendor.html' },
    RIDER: { label: 'Go to Rider Portal', url: 'rider.html' }
  };
  const target = roleRedirects[userRole];

  view.innerHTML = `
    <div style="max-width:460px; margin:60px auto; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:32px 24px; text-align:center; box-shadow:var(--shadow-sm);">
      <div style="width:56px; height:56px; border-radius:50%; background:rgba(239,68,68,0.12); color:#EF4444; display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h2 style="font-size:20px; font-weight:800; margin:0 0 8px; color:var(--ink); text-align:center;">Admin Access Restricted</h2>
      <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 20px; line-height:1.5; text-align:center;">
        ${currentUser ? `You are currently logged in with a <strong>${currentUser.role}</strong> account (${currentUser.email}). Operations Admin is restricted to Platform Administrators only.` : 'Platform revenue analytics, financial logs, and fleet dispatch controls are protected by security authentication.'}
      </p>
      <div style="display:flex; flex-direction:column; gap:10px; align-items:stretch;">
        ${target ? `
          <a href="${target.url}" class="btn-primary" style="width:100%; justify-content:center; text-align:center; padding:10px; font-size:13px; font-weight:700; text-decoration:none; box-sizing:border-box;">
            ${target.label}
          </a>
        ` : ''}
        <button id="quickAdminLoginBtn" class="${target ? 'btn-secondary' : 'btn-primary'}" style="width:100%; padding:10px; font-size:13px; font-weight:700; justify-content:center; text-align:center; box-sizing:border-box;">
          1-Click Log In as Platform Admin
        </button>
        <a href="login.html" class="btn-secondary" style="width:100%; justify-content:center; text-align:center; padding:10px; font-size:13px; text-decoration:none; box-sizing:border-box;">
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
    const [overview, analytics, orders, coupons] = await Promise.all([
      API.get('/api/admin/overview'),
      API.get('/api/admin/analytics'),
      API.get('/api/admin/orders'),
      API.get('/api/admin/coupons').catch(() => [])
    ]);
    state.overview = overview;
    state.analytics = analytics;
    state.orders = orders;
    state.coupons = Array.isArray(coupons) ? coupons : [];

    // Sync order badge counter
    const badge = document.getElementById('adminOrdersBadge');
    if (badge) {
      const activeCount = orders.filter(o => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)).length;
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }
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
    render(true);
  }
});

socket.on('riders:update', async () => {
  if (state.overview) {
    await loadAll();
    render(true);
  }
});

function destroyCharts() {
  Object.keys(state.charts).forEach(id => {
    if (state.charts[id]) {
      try { state.charts[id].destroy(); } catch (e) {}
      state.charts[id] = null;
    }
  });
}

function initNavigation() {
  document.querySelectorAll('#adminNav .customer-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('#adminNav .customer-nav-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === state.activeTab);
      });
      render();
    });
  });
}

function render(preserveInputs = false) {
  if (adminSignOutBtn) adminSignOutBtn.style.display = 'inline-flex';
  if (!state.overview || !state.analytics) return;

  destroyCharts();

  if (state.activeTab === 'analytics') {
    renderRevenueAnalytics();
  } else if (state.activeTab === 'restaurants') {
    renderRestaurantAnalytics();
  } else if (state.activeTab === 'fleet') {
    renderFleetLogistics();
  } else if (state.activeTab === 'coupons') {
    renderCouponsManager();
  } else {
    renderMasterOrderFeed(preserveInputs);
  }
}

// ----------------------------------------------------
// 1. REVENUE & FINANCIAL GROWTH TAB
// ----------------------------------------------------
function renderRevenueAnalytics() {
  const { overview, analytics } = state;
  const eco = overview.economics || {};
  const kpis = analytics.kpis || {};

  view.innerHTML = `
    <!-- Top Financial KPI Summary Grid -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Platform Financials & Unit Economics</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Real-time Gross Order Value (GOV), commission take-rate, and profitability.</p>
    </div>

    <div class="grid cols-4" style="margin-bottom:24px;">
      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="label">Gross Order Value (GOV)</div>
          <span class="kpi-trend-pill up">↑ Live</span>
        </div>
        <div class="num" style="color:var(--primary); font-size:26px;">₹${kpis.grossOrderValue || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Delivered order sales</div>
      </div>

      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="label">Platform Commission (18%)</div>
          <span class="kpi-trend-pill neutral">Take-Rate</span>
        </div>
        <div class="num" style="color:var(--purple); font-size:26px;">₹${eco.commission || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Direct revenue captured</div>
      </div>

      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="label">Kitchen Payouts (82%)</div>
          <span class="kpi-trend-pill neutral">Partners</span>
        </div>
        <div class="num" style="color:var(--blue); font-size:26px;">₹${eco.restaurantPayout || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Net payable to restaurants</div>
      </div>

      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="label">Platform Net Profit</div>
          <span class="kpi-trend-pill up">Net Margin</span>
        </div>
        <div class="num" style="color:var(--green); font-size:26px;">₹${eco.platformNetProfit || 0}</div>
        <div style="font-size:11px; color:var(--ink-secondary); margin-top:4px;">Commission + fees − rider costs</div>
      </div>
    </div>

    <!-- Secondary Operations Health KPIs -->
    <div class="grid cols-4" style="margin-bottom:24px;">
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--ink);">₹${kpis.averageOrderValue || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Avg Order Value (AOV)</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--green);">${kpis.fulfillmentRate || 100}%</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Fulfillment Success Rate</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--primary);">${kpis.activeOrders || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Active Cooking / In-Transit</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--purple);">${kpis.totalOrders || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Total Orders Lifetime</div>
      </div>
    </div>

    <!-- Dual Interactive Visual Charts -->
    <div class="analytics-grid-2">
      <!-- Chart 1: 7-Day Revenue & Volume Curve -->
      <div class="analytics-chart-card">
        <div class="chart-header">
          <div>
            <h4 class="chart-title">Revenue & Order Volume Trend</h4>
            <div class="chart-subtitle">Daily Gross Order Value (GOV) & completed delivery volume</div>
          </div>
          <span style="font-size:11px; font-weight:700; color:var(--ink-secondary); background:var(--surface-alt); padding:3px 8px; border-radius:999px;">Past 7 Days</span>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="revenueTrendCanvas"></canvas>
        </div>
      </div>

      <!-- Chart 2: Order Lifecycle Status Funnel -->
      <div class="analytics-chart-card">
        <div class="chart-header">
          <div>
            <h4 class="chart-title">Order Lifecycle Distribution</h4>
            <div class="chart-subtitle">Breakdown of orders across network states</div>
          </div>
          <span style="font-size:11px; font-weight:700; color:var(--ink-secondary); background:var(--surface-alt); padding:3px 8px; border-radius:999px;">All Time</span>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="orderStatusCanvas"></canvas>
        </div>
      </div>
    </div>

    <!-- Top Selling Dishes Bar Chart & Platform Logistics Summary -->
    <div class="analytics-grid-2">
      <div class="analytics-chart-card">
        <div class="chart-header">
          <div>
            <h4 class="chart-title">Top 6 Selling Dishes</h4>
            <div class="chart-subtitle">Dishes ordered most frequently across all kitchens</div>
          </div>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="topDishesCanvas"></canvas>
        </div>
      </div>

      <div class="analytics-chart-card">
        <div class="chart-header">
          <div>
            <h4 class="chart-title">Logistics & Rider Payout Pool</h4>
            <div class="chart-subtitle">Delivery fee collections vs partner disbursements</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; padding-bottom:8px; border-bottom:1px solid var(--border);">
            <span style="color:var(--ink-secondary);">Customer Delivery Fees Collected (₹25/order):</span>
            <strong style="color:var(--ink);">₹${eco.totalDeliveryFees || 0}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:13px; padding-bottom:8px; border-bottom:1px solid var(--border);">
            <span style="color:var(--ink-secondary);">Rider Partner Payouts (₹35/order):</span>
            <strong style="color:#EF4444;">₹${eco.riderPayoutTotal || 0}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:13px; padding-bottom:8px; border-bottom:1px solid var(--border);">
            <span style="color:var(--ink-secondary);">Delivery Net Subsidy by Platform:</span>
            <strong style="color:var(--purple);">₹${Math.max(0, (eco.riderPayoutTotal || 0) - (eco.totalDeliveryFees || 0))}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:800; padding-top:6px;">
            <span>Effective Net Platform Margin:</span>
            <strong style="color:var(--green);">₹${eco.platformNetProfit || 0}</strong>
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => initAnalyticsCharts(), 40);
}

function initAnalyticsCharts() {
  if (typeof Chart === 'undefined') return;

  const { analytics } = state;
  const series = analytics.dailySeries || [];

  // Chart 1: Revenue Trend
  const revCtx = document.getElementById('revenueTrendCanvas')?.getContext('2d');
  if (revCtx) {
    const labels = series.map(s => s.label);
    const revData = series.map(s => s.revenue);
    const orderData = series.map(s => s.orders);

    state.charts.revenueTrend = new Chart(revCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Revenue (₹)',
            data: revData,
            borderColor: '#FF5200',
            backgroundColor: 'rgba(255, 82, 0, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#FF5200',
            yAxisID: 'y'
          },
          {
            label: 'Orders (qty)',
            data: orderData,
            borderColor: '#2563EB',
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#2563EB',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            ticks: { callback: v => '₹' + v }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }

  // Chart 2: Order Status Doughnut
  const statusCtx = document.getElementById('orderStatusCanvas')?.getContext('2d');
  if (statusCtx) {
    const breakdown = analytics.statusBreakdown || {};
    const labels = ['Delivered', 'Active/Cooking', 'Out for Delivery', 'Cancelled'];
    const deliveredCount = breakdown.DELIVERED || 0;
    const activeCooking = (breakdown.PLACED || 0) + (breakdown.ACCEPTED || 0) + (breakdown.PREPARING || 0) + (breakdown.READY || 0);
    const inTransit = (breakdown.ASSIGNED || 0) + (breakdown.OUT_FOR_DELIVERY || 0);
    const cancelledCount = breakdown.CANCELLED || 0;

    state.charts.orderStatus = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: [deliveredCount, activeCooking, inTransit, cancelledCount],
          backgroundColor: ['#16A34A', '#F59E0B', '#2563EB', '#EF4444'],
          borderWidth: 2,
          borderColor: '#FFFFFF'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        cutout: '65%'
      }
    });
  }

  // Chart 3: Top Dishes Bar Chart
  const dishesCtx = document.getElementById('topDishesCanvas')?.getContext('2d');
  if (dishesCtx) {
    const dishes = analytics.topDishes || [];
    const dishLabels = dishes.map(d => d.name);
    const dishQty = dishes.map(d => d.total_qty);

    state.charts.topDishes = new Chart(dishesCtx, {
      type: 'bar',
      data: {
        labels: dishLabels,
        datasets: [{
          label: 'Units Sold',
          data: dishQty,
          backgroundColor: '#8B5CF6',
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { stepSize: 1 } }
        }
      }
    });
  }
}

// ----------------------------------------------------
// 2. RESTAURANTS & MENU PERFORMANCE TAB
// ----------------------------------------------------
function renderRestaurantAnalytics() {
  const { analytics, overview } = state;
  const rankings = analytics.restaurantRankings || [];
  const topDishes = analytics.topDishes || [];
  const totalRevenue = overview.revenue || 1;

  view.innerHTML = `
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Restaurant Kitchen Rankings & Dish Analytics</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">GMV contribution, customer ratings, and top-selling food items by kitchen.</p>
    </div>

    <!-- Restaurant Performance Table -->
    <div class="card" style="padding:20px; margin-bottom:24px;">
      <h4 style="font-size:15px; font-weight:800; margin:0 0 14px;">Partner Kitchen Leaderboard</h4>
      <div class="table-responsive">
        <table class="admin-table">
          <thead>
            <tr>
              <th style="width:60px; text-align:center;">Rank</th>
              <th>Restaurant Name</th>
              <th>Cuisine</th>
              <th style="text-align:center;">Rating</th>
              <th style="text-align:center;">Status</th>
              <th style="text-align:center;">Delivered / Total</th>
              <th style="text-align:right;">GMV Revenue</th>
              <th style="width:160px;">Share of Platform</th>
            </tr>
          </thead>
          <tbody>
            ${rankings.map((r, i) => {
              const sharePct = Math.round((r.total_revenue / totalRevenue) * 100);
              const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
              return `
                <tr>
                  <td style="text-align:center;">
                    <span class="leaderboard-rank ${rankClass}">${i + 1}</span>
                  </td>
                  <td>
                    <strong style="font-size:13.5px; color:var(--ink);">${r.name}</strong>
                  </td>
                  <td style="color:var(--ink-secondary); font-size:12.5px;">${r.cuisine || 'General'}</td>
                  <td style="text-align:center;">
                    <span class="rating-badge" style="display:inline-flex; align-items:center; gap:3px;">
                      ${Icons.star(12)} ${r.rating || 4.5}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge ${r.is_open ? 'open' : 'closed'}">
                      ${r.is_open ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <strong>${r.delivered_count}</strong> <span style="color:var(--ink-muted);">/ ${r.total_orders}</span>
                  </td>
                  <td style="text-align:right;">
                    <strong style="color:var(--primary); font-size:14px;">₹${r.total_revenue}</strong>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <div class="sim-progress-track" style="flex:1; margin:0; height:6px;">
                        <div class="sim-progress-fill" style="width:${sharePct}%; background:var(--primary);"></div>
                      </div>
                      <span style="font-size:11px; font-weight:700; width:30px;">${sharePct}%</span>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Top Dishes Table -->
    <div class="card" style="padding:20px;">
      <h4 style="font-size:15px; font-weight:800; margin:0 0 14px;">Top Performing Dishes by Volume</h4>
      <div class="table-responsive">
        <table class="admin-table">
          <thead>
            <tr>
              <th style="width:60px; text-align:center;">#</th>
              <th>Dish Name</th>
              <th style="text-align:center;">Dietary</th>
              <th style="text-align:center;">Orders Count</th>
              <th style="text-align:center;">Units Sold</th>
              <th style="text-align:right;">Total Sales Volume</th>
            </tr>
          </thead>
          <tbody>
            ${topDishes.length === 0 ? `
              <tr><td colspan="6" style="text-align:center; padding:30px; color:var(--ink-muted);">No dish sales recorded yet.</td></tr>
            ` : topDishes.map((d, i) => `
              <tr>
                <td style="text-align:center; font-weight:800; color:var(--ink-muted);">${i + 1}</td>
                <td>
                  <strong style="color:var(--ink);">${d.name}</strong>
                </td>
                <td style="text-align:center;">
                  <span style="display:inline-flex; align-items:center; gap:4px;">${Icons.veg(12)} Pure Veg</span>
                </td>
                <td style="text-align:center;">${d.order_count} trips</td>
                <td style="text-align:center;"><strong style="color:var(--purple);">${d.total_qty} units</strong></td>
                <td style="text-align:right;"><strong style="color:var(--green); font-size:14px;">₹${d.total_sales}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// 3. FLEET LOGISTICS TAB
// ----------------------------------------------------
function renderFleetLogistics() {
  const { overview, analytics } = state;
  const riders = overview.riders || [];
  const leaderboard = analytics.riderLeaderboard || riders;
  const eco = overview.economics || {};

  const availableCount = riders.filter(r => r.status === 'AVAILABLE').length;
  const busyCount = riders.filter(r => r.status === 'BUSY').length;
  const offlineCount = riders.filter(r => r.status === 'OFFLINE').length;

  view.innerHTML = `
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Delivery Fleet Logistics & Partner Performance</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Real-time rider capacity, trip earnings, and partner duty statuses.</p>
    </div>

    <!-- Fleet Status Counters -->
    <div class="grid cols-4" style="margin-bottom:24px;">
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--green);">${availableCount}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Available for Dispatch</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--primary);">${busyCount}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Currently on Trips</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--ink-muted);">${offlineCount}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Offline Partners</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--blue);">₹${eco.riderPayoutTotal || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Disbursed Earnings</div>
      </div>
    </div>

    <!-- Fleet Partner Table -->
    <div class="card" style="padding:20px;">
      <h4 style="font-size:15px; font-weight:800; margin:0 0 14px;">Delivery Partner Roster & Earnings</h4>
      <div class="table-responsive">
        <table class="admin-table">
          <thead>
            <tr>
              <th style="width:60px; text-align:center;">Rank</th>
              <th>Partner Name</th>
              <th>Vehicle</th>
              <th>Phone</th>
              <th style="text-align:center;">Rating</th>
              <th style="text-align:center;">Duty Status</th>
              <th style="text-align:center;">Trips Completed</th>
              <th style="text-align:right;">Shift Earnings</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((r, i) => {
              const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
              return `
                <tr>
                  <td style="text-align:center;">
                    <span class="leaderboard-rank ${rankClass}">${i + 1}</span>
                  </td>
                  <td>
                    <div style="font-weight:700; font-size:13.5px; color:var(--ink);">${r.name}</div>
                  </td>
                  <td style="color:var(--ink-secondary); font-size:12.5px;">${r.vehicle || 'Bike'}</td>
                  <td style="font-family:monospace; font-size:12px;">${r.phone || '9876543210'}</td>
                  <td style="text-align:center;">
                    <span class="rating-badge" style="display:inline-flex; align-items:center; gap:3px;">
                      ${Icons.star(12)} ${r.rating || 4.8}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge ${r.status === 'AVAILABLE' ? 'open' : r.status === 'BUSY' ? 'busy' : 'closed'}">
                      ${r.status}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <strong>${r.completed_trips || 0}</strong>
                  </td>
                  <td style="text-align:right;">
                    <strong style="color:var(--green); font-size:14px;">₹${r.earnings || 0}</strong>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// 4. LIVE MASTER ORDER FEED TAB
// ----------------------------------------------------
function renderMasterOrderFeed(preserveInputs = false) {
  const { overview, orders } = state;

  const filteredOrders = orders.filter(o => {
    const q = state.searchQuery.toLowerCase();
    const matchSearch = String(o.id).includes(q) || 
                        o.customer_name.toLowerCase().includes(q) || 
                        o.restaurant_name.toLowerCase().includes(q);
    const matchStatus = state.statusFilter === 'ALL' || o.status === state.statusFilter;
    return matchSearch && matchStatus;
  });

  view.innerHTML = `
    <!-- Live Master Orders Table -->
    <div class="card" style="padding:22px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:18px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin-bottom:4px;">Master Order Feed (${filteredOrders.length})</h3>
          <div style="font-size:12.5px; color:var(--ink-secondary);">Real-time dispatch stream with manual partner assignment override.</div>
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
              <th style="width:90px; text-align:center;">Details</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOrders.length === 0 ? `
              <tr>
                <td colspan="10" style="text-align:center; padding:40px 20px; color:var(--ink-muted);">
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
                  <td style="text-align:center;">
                    <button class="btn-secondary" data-inspect-btn="${o.id}" style="padding:4px 8px; font-size:11px; border-radius:999px;" title="View Order Breakdown">
                      Inspect
                    </button>
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
    if (preserveInputs) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
    searchEl.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      render(true);
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

  // Inspect order click handlers
  view.querySelectorAll('[data-inspect-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      openOrderInspectModal(btn.dataset.inspectBtn);
    });
  });
}

// ----------------------------------------------------
// 5. PROMO CODE / COUPON MANAGER TAB
// ----------------------------------------------------
function renderCouponsManager() {
  const { coupons, analytics } = state;
  const couponStats = analytics.couponStats || {};

  view.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; margin-bottom:18px;">
      <div>
        <h3 style="font-size:16px; margin-bottom:4px;">Promotions & Promo Code Campaign Suite</h3>
        <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Create, toggle, and manage customer discount vouchers across the platform.</p>
      </div>

      <button id="createCouponBtn" class="btn-primary" style="display:inline-flex; align-items:center; gap:6px; border-radius:999px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Create Promo Code
      </button>
    </div>

    <!-- Promo Summary Counters -->
    <div class="grid cols-3" style="margin-bottom:24px;">
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--primary);">${coupons.filter(c => c.is_active).length} / ${coupons.length}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Active Promo Codes</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--purple);">${couponStats.used_count || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Orders with Discounts Applied</div>
      </div>
      <div class="card" style="padding:14px; text-align:center;">
        <div style="font-size:24px; font-weight:800; color:var(--green);">₹${couponStats.total_discounts || 0}</div>
        <div style="font-size:12px; color:var(--ink-secondary); font-weight:700;">Total Discount Value Granted</div>
      </div>
    </div>

    <!-- Coupons Grid -->
    <div class="coupon-ticket-grid">
      ${coupons.map(c => `
        <div class="coupon-ticket-card" style="${c.is_active ? '' : 'opacity:0.6; filter:grayscale(0.5);'}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <span class="coupon-code-badge">${c.code}</span>
            <span class="badge ${c.is_active ? 'open' : 'closed'}">
              ${c.is_active ? 'ACTIVE' : 'DISABLED'}
            </span>
          </div>

          <div style="font-size:13.5px; font-weight:700; color:var(--ink); margin-bottom:4px;">
            ${c.discount_type === 'PERCENT' ? `${c.discount_value}% Off (Max ₹${c.max_discount})` : c.discount_type === 'FLAT' ? `Flat ₹${c.discount_value} Discount` : 'Free Delivery (₹25 Off)'}
          </div>
          <div style="font-size:12px; color:var(--ink-secondary); margin-bottom:12px; line-height:1.4;">
            ${c.description || 'Special seasonal offer'}
            ${c.min_order > 0 ? `<div style="margin-top:4px; font-weight:600; color:var(--ink);">Min. Order: ₹${c.min_order}</div>` : ''}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed var(--border); padding-top:10px; margin-top:8px;">
            <button class="btn-secondary" data-toggle-coupon="${c.id}" style="padding:4px 10px; font-size:11px; border-radius:999px;">
              ${c.is_active ? 'Disable' : 'Enable'}
            </button>
            <button class="btn-secondary" data-delete-coupon="${c.id}" style="padding:4px 10px; font-size:11px; color:#EF4444; border-color:#FCA5A5; border-radius:999px;">
              Delete
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('createCouponBtn')?.addEventListener('click', openCreateCouponModal);

  view.querySelectorAll('[data-toggle-coupon]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await API.patch(`/api/admin/coupons/${btn.dataset.toggleCoupon}/toggle`);
        toast('Coupon status updated.', 'info');
        await loadAll();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  view.querySelectorAll('[data-delete-coupon]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to permanently delete this coupon code?')) return;
      try {
        await API.delete(`/api/admin/coupons/${btn.dataset.deleteCoupon}`);
        toast('Coupon removed successfully.', 'info');
        await loadAll();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

// ----------------------------------------------------
// 6. MODALS: ORDER INSPECTOR & CREATE COUPON
// ----------------------------------------------------
function openOrderInspectModal(orderId) {
  const order = state.orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:540px; text-align:left;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div>
          <h3 style="font-size:18px; margin:0 0 2px;">Order #${order.id} Inspection</h3>
          <div style="font-size:12px; color:var(--ink-secondary);">Placed at: ${formatOrderDateTime(order.created_at)}</div>
        </div>
        <button class="btn-secondary" id="closeInspectBtn" style="padding:4px 8px; font-size:12px;">✕</button>
      </div>

      <div style="background:var(--surface-alt); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border); margin-bottom:14px; font-size:13px;">
        <div><strong>Customer:</strong> ${order.customer_name} (${order.customer_phone || 'N/A'})</div>
        <div style="margin-top:4px;"><strong>Address:</strong> ${order.customer_address}</div>
        <div style="margin-top:4px;"><strong>Kitchen:</strong> ${order.restaurant_name} (${order.restaurant_cuisine || ''})</div>
        <div style="margin-top:4px;"><strong>Delivery PIN:</strong> <span class="pin-badge" style="font-family:monospace; font-weight:800; padding:1px 6px;">${order.delivery_otp || order.delivery_pin || '1234'}</span></div>
      </div>

      <h4 style="font-size:14px; margin:0 0 8px;">Order Items (${(order.items || []).length})</h4>
      <div style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px; margin-bottom:14px; font-size:12.5px;">
        ${(order.items || []).map(it => `
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>${it.name} × ${it.qty}</span>
            <strong>₹${it.price * it.qty}</strong>
          </div>
        `).join('')}
        <div style="border-top:1px dashed var(--border); padding-top:6px; margin-top:6px; display:flex; justify-content:space-between; font-weight:800; font-size:13.5px;">
          <span>Total Paid (${order.payment_method || 'UPI'}):</span>
          <span style="color:var(--primary);">₹${order.total}</span>
        </div>
      </div>

      <h4 style="font-size:14px; margin:0 0 8px;">Audit History Timeline</h4>
      <div style="max-height:160px; overflow-y:auto; font-size:12px; border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 12px; margin-bottom:16px;">
        ${(order.log || []).map(l => `
          <div style="padding:4px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
            <div>
              <span class="stamp st-${l.status}" style="font-size:10px; padding:2px 6px;">${l.status}</span>
              <span style="color:var(--ink-secondary); margin-left:6px;">${l.note || ''}</span>
            </div>
            <span style="color:var(--ink-muted); font-size:11px;">${timeAgo(l.created_at)}</span>
          </div>
        `).join('')}
      </div>

      <button class="btn-secondary" id="closeInspectModalBottom" style="width:100%; justify-content:center;">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#closeInspectBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#closeInspectModalBottom').addEventListener('click', () => overlay.remove());
}

function openCreateCouponModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px; text-align:left;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="font-size:18px; margin:0;">Create New Promo Code</h3>
        <button class="btn-secondary" id="closeCouponModal" style="padding:4px 8px; font-size:12px;">✕</button>
      </div>

      <form id="newCouponForm">
        <div style="margin-bottom:12px;">
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Promo Code Name *</label>
          <input type="text" id="couponCodeInput" required placeholder="e.g. FESTIVE30" maxlength="15" 
            style="width:100%; text-transform:uppercase; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:14px; letter-spacing:1px;">
        </div>

        <div style="display:flex; gap:10px; margin-bottom:12px;">
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Discount Type</label>
            <select id="couponTypeSelect" style="width:100%; height:38px;">
              <option value="PERCENT">Percentage (%)</option>
              <option value="FLAT">Flat Rupee (₹)</option>
              <option value="DELIVERY">Free Delivery (₹25)</option>
            </select>
          </div>
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Discount Value *</label>
            <input type="number" id="couponValueInput" required placeholder="e.g. 30" min="1" max="1000" style="width:100%; height:38px;">
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:12px;">
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Max Discount Cap (₹)</label>
            <input type="number" id="couponMaxDiscount" placeholder="100" value="100" min="10" style="width:100%; height:38px;">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Min Order Value (₹)</label>
            <input type="number" id="couponMinOrder" placeholder="0" value="0" min="0" style="width:100%; height:38px;">
          </div>
        </div>

        <div style="margin-bottom:18px;">
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:4px;">Customer Description</label>
          <input type="text" id="couponDescInput" placeholder="e.g. 30% off on your celebration meal" style="width:100%;">
        </div>

        <div style="display:flex; gap:10px;">
          <button type="button" class="btn-secondary" id="cancelCouponModal" style="flex:1; justify-content:center;">Cancel</button>
          <button type="submit" class="btn-primary" style="flex:1.5; justify-content:center;">Save Promo Code</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#closeCouponModal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cancelCouponModal').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#newCouponForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = overlay.querySelector('#couponCodeInput').value.trim();
    const type = overlay.querySelector('#couponTypeSelect').value;
    const value = overlay.querySelector('#couponValueInput').value;
    const maxDisc = overlay.querySelector('#couponMaxDiscount').value;
    const minOrder = overlay.querySelector('#couponMinOrder').value;
    const desc = overlay.querySelector('#couponDescInput').value.trim();

    try {
      await API.post('/api/admin/coupons', {
        code,
        discount_type: type,
        discount_value: value,
        max_discount: maxDisc,
        min_order: minOrder,
        description: desc
      });
      toast(`Promo code "${code.toUpperCase()}" published!`, 'success');
      overlay.remove();
      await loadAll();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

(async () => {
  AppNavigation.setup({
    rootScreen: 'main',
    getCurrentScreen: () => 'main',
    exitUrl: '/login.html'
  });
  initNavigation();
  await loadAll();
  render();
})();
