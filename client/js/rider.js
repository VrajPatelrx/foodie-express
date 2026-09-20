const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('fe_user'));
} catch (e) {}

let state = {
  riders: [],
  activeRiderId: localStorage.getItem('fe_rider_id') || (currentUser && currentUser.rider_id) || null,
  orders: [],
};

function renderAccessRestricted() {
  const userRole = currentUser ? currentUser.role : 'GUEST';
  const roleRedirects = {
    CUSTOMER: { label: 'Go to Customer Portal', url: 'customer.html' },
    VENDOR: { label: 'Go to Kitchen KDS', url: 'vendor.html' },
    ADMIN: { label: 'Go to Operations Admin', url: 'admin.html' }
  };
  const target = roleRedirects[userRole];

  view.innerHTML = `
    <div style="max-width:460px; margin:60px auto; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:32px 24px; text-align:center; box-shadow:var(--shadow-sm);">
      <div style="width:56px; height:56px; border-radius:50%; background:rgba(239,68,68,0.12); color:#EF4444; display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h2 style="font-size:20px; font-weight:800; margin:0 0 8px; color:var(--ink); text-align:center;">Rider Portal Restricted</h2>
      <p style="font-size:13px; color:var(--ink-secondary); margin:0 0 20px; line-height:1.5; text-align:center;">
        ${currentUser ? `You are currently logged in with a <strong>${currentUser.role}</strong> account (${currentUser.email}). This portal is restricted to Delivery Partners (Riders) only.` : 'Live delivery runs, earnings tracking, and OTP verification require authentication as a Delivery Partner (Rider).'}
      </p>
      <div style="display:flex; flex-direction:column; gap:10px; align-items:stretch;">
        ${target ? `
          <a href="${target.url}" class="btn-primary" style="width:100%; justify-content:center; text-align:center; padding:10px; font-size:13px; font-weight:700; text-decoration:none; box-sizing:border-box;">
            ${target.label}
          </a>
        ` : ''}
        <button id="quickRiderLoginBtn" class="${target ? 'btn-secondary' : 'btn-primary'}" style="width:100%; padding:10px; font-size:13px; font-weight:700; justify-content:center; text-align:center; box-sizing:border-box;">
          1-Click Log In as Delivery Rider
        </button>
        <a href="login.html" class="btn-secondary" style="width:100%; justify-content:center; text-align:center; padding:10px; font-size:13px; text-decoration:none; box-sizing:border-box;">
          Sign In with Another Account
        </a>
      </div>
    </div>
  `;

  document.getElementById('quickRiderLoginBtn')?.addEventListener('click', async () => {
    try {
      const res = await API.post('/api/auth/login', { demoRole: 'RIDER' });
      localStorage.setItem('fe_token', res.token);
      localStorage.setItem('fe_user', JSON.stringify(res.user));
      currentUser = res.user;
      toast('Authenticated as Delivery Rider', 'success');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function init() {
  const token = localStorage.getItem('fe_token');
  if (!token || !currentUser || (currentUser.role !== 'RIDER' && currentUser.role !== 'ADMIN')) {
    renderAccessRestricted();
    return;
  }
  const headerActions = document.querySelector('.header-actions');
  if (headerActions && currentUser) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-secondary';
    logoutBtn.style.cssText = 'padding:6px 12px; font-size:12px;';
    logoutBtn.textContent = 'Sign Out';
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('fe_user');
      localStorage.removeItem('fe_token');
      localStorage.removeItem('fe_rider_id');
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
    state.riders = await API.get('/api/riders');
    if (!state.activeRiderId) {
      renderPicker();
    } else {
      await loadOrders();
      render();
    }
  } catch (err) {
    console.error('Failed to init rider app:', err);
    renderErrorScreen(view, {
      title: "Fleet Dispatch Standby",
      desc: "Unable to connect to live delivery partner tracking. Please check your connection while we reconnect.",
      badge: "Rider Portal Paused",
      error: err,
      onRetry: () => location.reload(),
      retryText: "Reconnect Fleet",
      showSwitchRole: true
    });
  }
}

socket.on('order:update', async (order) => {
  if (String(order.rider_id) === String(state.activeRiderId)) {
    await loadOrders();
    render();
    AudioFx.play('alert');
    toast(`Order #${order.id} update: ${STATUS_LABEL[order.status] || order.status}`);
  }
});

socket.on('riders:update', async () => {
  state.riders = await API.get('/api/riders');
  if (state.activeRiderId) {
    await loadOrders();
    render();
  }
});

async function loadOrders() {
  state.orders = await API.get(`/api/riders/${state.activeRiderId}/orders`);
}

function renderPicker() {
  document.getElementById('activeRiderTag').textContent = 'Select Rider';
  view.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2>Delivery Partner Portal</h2>
      <p style="color:var(--ink-secondary); font-size:14px;">Select your rider profile to start deliveries:</p>
    </div>
    <div class="grid cols-4">
      ${state.riders.map(r => `
        <div class="rest-card" data-id="${r.id}">
          <div class="banner" style="display:flex; align-items:center; justify-content:center;">
            ${typeof Icons !== 'undefined' ? Icons.rider(28, 'var(--primary)') : 'Partner'}
          </div>
          <h3>${r.name}</h3>
          <div class="cuisine">${r.vehicle || 'Bike'} · ${r.phone || '9876543210'}</div>
          <div class="meta-row">
            <span class="rating-badge">${typeof Icons !== 'undefined' ? Icons.star(12) : ''} ${r.rating || 4.8}</span>
            <span class="badge ${r.status === 'AVAILABLE' ? 'open' : r.status === 'BUSY' ? 'busy' : 'closed'}">
              ${r.status}
            </span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  view.querySelectorAll('.rest-card').forEach(el => {
    el.addEventListener('click', async () => {
      state.activeRiderId = el.dataset.id;
      localStorage.setItem('fe_rider_id', state.activeRiderId);
      if (currentUser) {
        currentUser.rider_id = Number(state.activeRiderId);
        localStorage.setItem('fe_user', JSON.stringify(currentUser));
      }
      await loadOrders();
      render();
    });
  });
}

function render() {
  const rider = state.riders.find(r => String(r.id) === String(state.activeRiderId));
  if (!rider) { renderPicker(); return; }

  document.getElementById('activeRiderTag').textContent = rider.name;

  const isOnline = rider.status !== 'OFFLINE';

  view.innerHTML = `
    <!-- Top Status & Earnings Bar -->
    <div class="card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:48px; height:48px; border-radius:12px; background:var(--primary-soft); color:var(--primary); display:flex; align-items:center; justify-content:center;">
          ${typeof Icons !== 'undefined' ? Icons.rider(26) : ''}
        </div>
        <div>
          <h2 style="font-size:20px; margin:0 0 2px;">${rider.name}</h2>
          <div style="font-size:13px; color:var(--ink-secondary);">
            ${rider.vehicle || 'Bike'} · ${typeof Icons !== 'undefined' ? Icons.star(12) : '★'} ${rider.rating || 4.8} · Shift Earnings: <strong>₹${rider.earnings || 0}</strong>
          </div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <!-- Online/Offline Duty Toggle -->
        <div class="duty-switch" style="display:flex; align-items:center; gap:8px;">
          <span style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px;">
            <span style="width:8px; height:8px; border-radius:50%; background:${isOnline ? 'var(--green)' : 'var(--ink-muted)'}; display:inline-block;"></span>
            ${isOnline ? 'Active on Duty' : 'Offline'}
          </span>
          <div class="switch-toggle ${isOnline ? 'on' : ''}" id="dutyToggleBtn"></div>
        </div>

        <select id="quickRiderSelect" class="btn-secondary" style="font-size:12.5px; padding:6px 10px; cursor:pointer; font-weight:600;">
          ${state.riders.map(x => `<option value="${x.id}" ${String(x.id) === String(rider.id) ? 'selected' : ''}>🛵 ${x.name} (${x.vehicle || 'Bike'})</option>`).join('')}
        </select>
        <button class="btn-secondary" id="switchRiderBtn">All Riders</button>
      </div>
    </div>

    <!-- Active Runs Section -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Assigned Deliveries</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Complete pickup and doorstep delivery handoffs:</p>
    </div>

    ${state.orders.length ? state.orders.map(o => `
      <div class="ticket">
        <div class="ticket-head">
          <div>
            <div class="ticket-id">Trip #${o.id} · ${o.restaurant_name}</div>
            <div class="ticket-sub">Deliver to: <strong>${o.customer_name}</strong></div>
          </div>
          <div class="stamp st-${o.status}">${STATUS_LABEL[o.status] || o.status}</div>
        </div>

        <div class="card" style="background:var(--surface-alt); padding:14px; margin-bottom:14px;">
          <div style="font-size:13px; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            <span style="color:var(--primary);">${typeof Icons !== 'undefined' ? Icons.kitchen(14) : ''}</span>
            <strong>Pickup:</strong> ${o.restaurant_name}
          </div>
          <div style="font-size:13px; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="color:var(--green);">${typeof Icons !== 'undefined' ? Icons.location(14) : ''}</span>
            <strong>Drop-off:</strong> ${o.customer_address} (${o.customer_phone || 'N/A'})
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:14px; font-weight:800; border-top:1px dashed var(--border); padding-top:8px;">
            <span>Order Value:</span>
            <span style="color:var(--primary);">₹${o.total} (${o.payment_method})</span>
          </div>
        </div>

        <!-- Action Step Progression -->
        <div>
          ${o.status === 'ASSIGNED' ? `
            <button class="btn-primary" data-action="PICKED_UP" data-id="${o.id}" style="width:100%;">
              Confirm Pickup from Kitchen
            </button>
          ` : o.status === 'PICKED_UP' ? `
            <button class="btn-primary" data-action="OUT_FOR_DELIVERY" data-id="${o.id}" style="width:100%; background:var(--blue);">
              Start Journey to Customer
            </button>
          ` : o.status === 'OUT_FOR_DELIVERY' ? `
            <button class="btn-primary" id="openOtpModalBtn" data-id="${o.id}" style="width:100%; background:var(--green); display:inline-flex; align-items:center; justify-content:center; gap:6px;">
              ${typeof Icons !== 'undefined' ? Icons.check(16) : ''} Verify Customer PIN & Complete Delivery
            </button>
          ` : ''}
        </div>
      </div>
    `).join('') : `
      <div class="card" style="text-align:center; padding:60px 20px;">
        <div style="width:52px; height:52px; border-radius:14px; background:var(--surface-alt); margin:0 auto 14px; display:flex; align-items:center; justify-content:center; color:var(--ink-muted);">
          ${typeof Icons !== 'undefined' ? Icons.rider(26) : ''}
        </div>
        <h3 style="font-size:17px; margin-bottom:4px;">No active delivery assignments</h3>
        <p style="color:var(--ink-secondary); font-size:14px; max-width:400px; margin:4px auto 0;">
          ${isOnline ? 'You are marked Online. Once a kitchen marks an order Ready, it will be automatically dispatched to you.' : 'You are currently Offline. Turn on your duty switch above to start receiving trips.'}
        </p>
      </div>
    `}
  `;

  document.getElementById('switchRiderBtn').addEventListener('click', () => {
    localStorage.removeItem('fe_rider_id');
    state.activeRiderId = null;
    renderPicker();
  });

  document.getElementById('quickRiderSelect')?.addEventListener('change', async (e) => {
    state.activeRiderId = e.target.value;
    localStorage.setItem('fe_rider_id', state.activeRiderId);
    if (currentUser) {
      currentUser.rider_id = Number(state.activeRiderId);
      localStorage.setItem('fe_user', JSON.stringify(currentUser));
    }
    await loadOrders();
    render();
  });

  document.getElementById('dutyToggleBtn').addEventListener('click', async () => {
    const nextStatus = isOnline ? 'OFFLINE' : 'AVAILABLE';
    try {
      await API.setRiderStatus(state.activeRiderId, nextStatus);
      rider.status = nextStatus;
      toast(`Duty status updated to ${nextStatus}`, 'info');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
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

  const otpBtn = document.getElementById('openOtpModalBtn');
  if (otpBtn) {
    otpBtn.addEventListener('click', () => renderVerifyOtpModal(otpBtn.dataset.id));
  }
}

function renderVerifyOtpModal(orderId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:400px; text-align:center;">
      <div style="width:52px; height:52px; border-radius:14px; background:var(--green-soft); color:var(--green); margin:0 auto 14px; display:flex; align-items:center; justify-content:center;">
        ${typeof Icons !== 'undefined' ? Icons.lock(24) : ''}
      </div>
      <h3 style="font-size:18px; margin-bottom:4px;">Customer Delivery PIN</h3>
      <p style="font-size:13px; color:var(--ink-secondary); margin:6px 0 18px;">
        Please ask customer for the 4-digit verification PIN displayed on their tracking screen.
      </p>

      <div style="margin-bottom:18px;">
        <input id="otpInput" type="text" maxlength="4" placeholder="••••" 
          style="font-family:'JetBrains Mono',monospace; font-size:32px; letter-spacing:0.25em; text-align:center; padding:12px; font-weight:800;">
      </div>

      <div style="display:flex; gap:10px;">
        <button class="btn-secondary" id="cancelOtpBtn" style="flex:1;">Cancel</button>
        <button class="btn-primary" id="submitOtpBtn" style="flex:2; background:var(--green);">
          Verify & Deliver
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const otpInput = overlay.querySelector('#otpInput');
  otpInput.focus();

  overlay.querySelector('#cancelOtpBtn').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#submitOtpBtn').addEventListener('click', async () => {
    const code = otpInput.value.trim();
    if (code.length !== 4) {
      toast('Please enter the 4-digit PIN', 'error');
      AudioFx.play('error');
      return;
    }

    try {
      await API.verifyOtp(orderId, code);
      overlay.remove();
      AudioFx.play('success');
      toast('Delivery verified successfully! Payout credited.', 'success');
      await loadOrders();
      state.riders = await API.get('/api/riders');
      render();
    } catch (err) {
      AudioFx.play('error');
      toast(err.message, 'error');
    }
  });
}

init();
