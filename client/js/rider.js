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

        <!-- Live Route & GPS Simulation Box -->
        <div class="rider-map-box">
          <div id="riderTripMap_${o.id}" class="rider-trip-map"></div>
          <div class="rider-sim-bar">
            <div style="display:flex; align-items:center; gap:8px;">
              <button id="simRideToggleBtn" class="btn-primary" style="padding:6px 14px; font-size:12px; display:inline-flex; align-items:center; gap:6px; border-radius:999px;">
                <span id="simRideIcon">▶</span>
                <span id="simRideLabel">Simulate Ride</span>
              </button>
              <button id="simRideResetBtn" class="btn-secondary" style="padding:6px 10px; font-size:12px; border-radius:999px;" title="Reset position to Kitchen">
                ↺ Reset
              </button>
              <div style="display:inline-flex; border:1px solid var(--border); border-radius:999px; overflow:hidden;">
                <button class="sim-speed-btn active" data-speed="1" style="padding:4px 9px; font-size:11px; border:none; background:var(--primary); color:#fff; cursor:pointer; font-weight:700;">1x</button>
                <button class="sim-speed-btn" data-speed="2" style="padding:4px 9px; font-size:11px; border:none; background:transparent; cursor:pointer; font-weight:700;">2x</button>
                <button class="sim-speed-btn" data-speed="4" style="padding:4px 9px; font-size:11px; border:none; background:transparent; cursor:pointer; font-weight:700;">4x</button>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button id="realGpsBtn" class="btn-secondary" style="padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:5px; border-radius:999px;" title="Stream real phone GPS">
                ${typeof Icons !== 'undefined' ? Icons.navigation(12) : ''}
                <span id="realGpsLabel">Use Real GPS</span>
              </button>
              <span id="simProgressBadge" style="font-size:11.5px; font-weight:700; color:var(--ink-secondary);">0% en route</span>
            </div>
            <div class="sim-progress-track">
              <div id="simProgressFill" class="sim-progress-fill" style="width:0%;"></div>
            </div>
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

  if (state.orders.length) {
    const activeOrder = state.orders[0];
    if (['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(activeOrder.status)) {
      setTimeout(() => initRiderTripMap(activeOrder), 60);
    }
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

// ----------------------------------------------------
// LIVE TRIP ROUTE & GPS SIMULATION ENGINE
// ----------------------------------------------------
let riderMapInstance = null;
let riderMarkerInstance = null;
let riderRouteCoords = [];
let simInterval = null;
let simIndex = 0;
let simSpeedMultiplier = 1;
let realGpsWatchId = null;

function calculateHeading(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

async function initRiderTripMap(order) {
  const mapEl = document.getElementById(`riderTripMap_${order.id}`);
  if (!mapEl || typeof L === 'undefined') return;

  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }

  if (riderMapInstance) {
    try { riderMapInstance.remove(); } catch (e) {}
  }

  const restLat = Number(order.restaurant_lat) || 22.5532;
  const restLng = Number(order.restaurant_lng) || 72.9485;
  const destLat = Number(order.dest_lat) || 22.5590;
  const destLng = Number(order.dest_lng) || 72.9570;

  riderMapInstance = L.map(mapEl.id, { zoomControl: false }).setView([restLat, restLng], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(riderMapInstance);

  // Restaurant Marker
  const restIcon = L.divIcon({
    className: 'custom-map-pin restaurant',
    html: typeof Icons !== 'undefined' ? Icons.kitchen(16, '#FFF') : '🍴',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  L.marker([restLat, restLng], { icon: restIcon }).addTo(riderMapInstance).bindPopup(`<strong>${order.restaurant_name}</strong>`);

  // Customer Destination Marker
  const destIcon = L.divIcon({
    className: 'custom-map-pin destination',
    html: typeof Icons !== 'undefined' ? Icons.location(16, '#FFF') : '📍',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  L.marker([destLat, destLng], { icon: destIcon }).addTo(riderMapInstance).bindPopup(`<strong>${order.customer_name}</strong>`);

  // Real-road route fetching via OSRM
  riderRouteCoords = [[restLat, restLng], [destLat, destLng]];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2800);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${restLng},${restLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) {
        riderRouteCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      }
    }
  } catch (e) {
    const steps = 24;
    riderRouteCoords = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      riderRouteCoords.push([
        restLat + (destLat - restLat) * t,
        restLng + (destLng - restLng) * t
      ]);
    }
  }

  // Draw polyline
  L.polyline(riderRouteCoords, {
    color: '#2563EB',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round'
  }).addTo(riderMapInstance);

  // Position rider marker
  const initialPos = riderRouteCoords[simIndex] || [restLat, restLng];
  const riderIcon = L.divIcon({
    className: 'custom-map-pin rider',
    html: `
      <div class="rider-beacon-pulse"></div>
      <div class="rider-heading-dir" style="transform: rotate(0deg);">
        ${typeof Icons !== 'undefined' ? Icons.rider(18, '#FFF') : '🛵'}
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  riderMarkerInstance = L.marker(initialPos, { icon: riderIcon }).addTo(riderMapInstance);

  riderMapInstance.fitBounds(L.latLngBounds(riderRouteCoords), { padding: [30, 30] });

  // Connect Simulation UI Controls
  const toggleBtn = document.getElementById('simRideToggleBtn');
  const resetBtn = document.getElementById('simRideResetBtn');
  const progressFill = document.getElementById('simProgressFill');
  const progressBadge = document.getElementById('simProgressBadge');
  const iconSpan = document.getElementById('simRideIcon');
  const labelSpan = document.getElementById('simRideLabel');

  function updateSimDisplay() {
    const total = Math.max(1, riderRouteCoords.length - 1);
    const progress = Math.min(1, simIndex / total);
    const pct = Math.round(progress * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressBadge) progressBadge.textContent = `${pct}% en route`;
  }

  function broadcastPosition(pos, heading, progress) {
    const data = {
      order_id: order.id,
      rider_id: state.activeRiderId,
      lat: pos[0],
      lng: pos[1],
      heading: Math.round(heading),
      progress,
      speed: 26 * simSpeedMultiplier
    };
    socket.emit('rider:location', data);
    API.post(`/api/orders/${order.id}/location`, data).catch(() => {});
  }

  function stepSimulation() {
    if (simIndex < riderRouteCoords.length - 1) {
      simIndex++;
      const currentPos = riderRouteCoords[simIndex];
      const prevPos = riderRouteCoords[simIndex - 1] || currentPos;
      const heading = calculateHeading(prevPos[0], prevPos[1], currentPos[0], currentPos[1]);
      const progress = simIndex / (riderRouteCoords.length - 1);

      riderMarkerInstance.setLatLng(currentPos);
      const headingEl = riderMarkerInstance.getElement()?.querySelector('.rider-heading-dir');
      if (headingEl) headingEl.style.transform = `rotate(${heading}deg)`;

      updateSimDisplay();
      broadcastPosition(currentPos, heading, progress);

      if (simIndex >= riderRouteCoords.length - 1) {
        clearInterval(simInterval);
        simInterval = null;
        if (iconSpan) iconSpan.textContent = '✓';
        if (labelSpan) labelSpan.textContent = 'Arrived at Doorstep';
        AudioFx.play('chime');
        toast('Doorstep arrived! You can now verify the customer PIN.', 'success');
      }
    }
  }

  if (toggleBtn) {
    toggleBtn.onclick = () => {
      if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
        if (iconSpan) iconSpan.textContent = '▶';
        if (labelSpan) labelSpan.textContent = 'Resume Ride';
      } else {
        if (simIndex >= riderRouteCoords.length - 1) {
          simIndex = 0;
        }
        if (iconSpan) iconSpan.textContent = '⏸';
        if (labelSpan) labelSpan.textContent = 'Pause Ride';
        simInterval = setInterval(stepSimulation, Math.max(250, Math.round(1300 / simSpeedMultiplier)));
      }
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
      }
      simIndex = 0;
      riderMarkerInstance.setLatLng(riderRouteCoords[0]);
      updateSimDisplay();
      if (iconSpan) iconSpan.textContent = '▶';
      if (labelSpan) labelSpan.textContent = 'Simulate Ride';
      broadcastPosition(riderRouteCoords[0], 0, 0);
      toast('Ride position reset to kitchen.', 'info');
    };
  }

  document.querySelectorAll('.sim-speed-btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.sim-speed-btn').forEach(x => {
        x.style.background = 'transparent';
        x.style.color = 'var(--ink)';
      });
      b.style.background = 'var(--primary)';
      b.style.color = '#fff';
      simSpeedMultiplier = Number(b.dataset.speed) || 1;
      if (simInterval) {
        clearInterval(simInterval);
        simInterval = setInterval(stepSimulation, Math.max(250, Math.round(1300 / simSpeedMultiplier)));
      }
    };
  });

  // Real GPS Toggle
  const realGpsBtn = document.getElementById('realGpsBtn');
  if (realGpsBtn) {
    realGpsBtn.onclick = () => {
      if (realGpsWatchId) {
        navigator.geolocation.clearWatch(realGpsWatchId);
        realGpsWatchId = null;
        realGpsBtn.classList.remove('btn-primary');
        realGpsBtn.classList.add('btn-secondary');
        document.getElementById('realGpsLabel').textContent = 'Use Real GPS';
        toast('Real GPS broadcasting paused.', 'info');
      } else {
        if (!navigator.geolocation) {
          toast('Geolocation not supported on this device.', 'error');
          return;
        }
        realGpsBtn.classList.remove('btn-secondary');
        realGpsBtn.classList.add('btn-primary');
        document.getElementById('realGpsLabel').textContent = 'GPS Active ●';
        toast('Broadcasting live sensor GPS coordinates...', 'success');

        realGpsWatchId = navigator.geolocation.watchPosition((pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const heading = pos.coords.heading || 0;
          riderMarkerInstance.setLatLng([lat, lng]);
          riderMapInstance.setView([lat, lng]);
          broadcastPosition([lat, lng], heading, 0.5);
        }, (err) => {
          toast(`GPS Error: ${err.message}`, 'error');
        }, { enableHighAccuracy: true });
      }
    };
  }

  updateSimDisplay();
}

init();
