const socket = typeof io === 'function' ? io() : { on: () => {}, emit: () => {} };
const view = document.getElementById('view');

let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('fe_user'));
} catch (e) {}

let state = {
  riders: [],
  activeRiderId: (currentUser && currentUser.rider_id) || localStorage.getItem('fe_rider_id') || null,
  orders: [],
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
          <div class="banner">🛵</div>
          <h3>${r.name}</h3>
          <div class="cuisine">${r.vehicle || 'Bike'} · 📞 ${r.phone || '9876543210'}</div>
          <div class="meta-row">
            <span class="rating-badge">★ ${r.rating || 4.8}</span>
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
      await loadOrders();
      render();
    });
  });
}

function render() {
  const rider = state.riders.find(r => String(r.id) === String(state.activeRiderId));
  if (!rider) { renderPicker(); return; }

  document.getElementById('activeRiderTag').textContent = `🛵 ${rider.name}`;

  const isOnline = rider.status !== 'OFFLINE';

  view.innerHTML = `
    <!-- Top Status & Earnings Bar -->
    <div class="card" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="font-size:32px;">🛵</div>
        <div>
          <h2 style="font-size:20px;">${rider.name}</h2>
          <div style="font-size:13px; color:var(--ink-secondary);">
            ${rider.vehicle || 'Bike'} · ★ ${rider.rating || 4.8} · 💰 Earnings: <strong>₹${rider.earnings || 0}</strong>
          </div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <!-- Online/Offline Duty Toggle -->
        <div class="duty-switch">
          <span>${isOnline ? '🟢 Online' : '⚪ Offline'}</span>
          <div class="switch-toggle ${isOnline ? 'on' : ''}" id="dutyToggleBtn"></div>
        </div>

        <button class="btn-secondary" id="switchRiderBtn">⇄ Switch Rider</button>
      </div>
    </div>

    <!-- Active Runs Section -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:16px; margin-bottom:4px;">Assigned Delivery Trips</h3>
      <p style="color:var(--ink-secondary); font-size:13px; margin:0;">Follow pickup and dropoff steps below.</p>
    </div>

    ${state.orders.length ? state.orders.map(o => `
      <div class="ticket">
        <div class="ticket-head">
          <div>
            <div class="ticket-id">Trip #${o.id} · ${o.restaurant_emoji} ${o.restaurant_name}</div>
            <div class="ticket-sub">Pickup from restaurant → Deliver to: <strong>${o.customer_name}</strong></div>
          </div>
          <div class="stamp st-${o.status}">${STATUS_LABEL[o.status] || o.status}</div>
        </div>

        <div class="card" style="background:var(--surface-alt); padding:14px; margin-bottom:14px;">
          <div style="font-size:13px; margin-bottom:6px;">
            📍 <strong>Pickup:</strong> ${o.restaurant_name}
          </div>
          <div style="font-size:13px; margin-bottom:8px;">
            🏠 <strong>Drop-off:</strong> ${o.customer_address} (📞 ${o.customer_phone || 'N/A'})
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:14px; font-weight:800; border-top:1px dashed var(--border); padding-top:8px;">
            <span>💵 Collect Amount:</span>
            <span style="color:var(--primary);">₹${o.total} (${o.payment_method})</span>
          </div>
        </div>

        <!-- Action Step Progression -->
        <div>
          ${o.status === 'ASSIGNED' ? `
            <button class="btn-primary" data-action="PICKED_UP" data-id="${o.id}" style="width:100%;">
              📦 Confirm Pickup from Kitchen
            </button>
          ` : o.status === 'PICKED_UP' ? `
            <button class="btn-primary" data-action="OUT_FOR_DELIVERY" data-id="${o.id}" style="width:100%; background:var(--blue);">
              🚀 Start Journey to Customer
            </button>
          ` : o.status === 'OUT_FOR_DELIVERY' ? `
            <button class="btn-primary" id="openOtpModalBtn" data-id="${o.id}" style="width:100%; background:var(--green);">
              🔒 Enter Customer 4-Digit PIN & Mark Delivered
            </button>
          ` : ''}
        </div>
      </div>
    `).join('') : `
      <div class="card" style="text-align:center; padding:60px 20px;">
        <div style="font-size:42px; margin-bottom:12px;">😴</div>
        <h3>No deliveries assigned right now</h3>
        <p style="color:var(--ink-secondary); font-size:14px; max-width:400px; margin:8px auto 0;">
          ${isOnline ? 'You are marked Online! As soon as a kitchen marks food Ready, the system will dispatch it to you automatically.' : 'You are currently Offline. Toggle duty switch above to start receiving orders.'}
        </p>
      </div>
    `}
  `;

  document.getElementById('switchRiderBtn').addEventListener('click', () => {
    localStorage.removeItem('fe_rider_id');
    state.activeRiderId = null;
    renderPicker();
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
      <div style="font-size:36px; margin-bottom:8px;">🔒</div>
      <h3 style="font-size:18px;">Customer Delivery PIN</h3>
      <p style="font-size:13px; color:var(--ink-secondary); margin:6px 0 18px;">
        Please ask customer for their 4-digit code shown on their tracking screen to complete handover.
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
      toast('Delivery verified successfully! +₹35 added to earnings.', 'success');
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
