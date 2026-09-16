const API = {
  base: '',
  async _handleResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    let bodyData = null;
    if (contentType.includes('application/json')) {
      try {
        bodyData = await res.json();
      } catch (e) {
        bodyData = null;
      }
    }
    if (!res.ok) {
      if (bodyData && bodyData.error) {
        throw new Error(bodyData.error);
      }
      if (res.status === 502 || res.status === 503) {
        throw new Error('Our kitchen server is taking a breather (502 Gateway). Reconnecting momentarily...');
      }
      if (res.status === 504) {
        throw new Error('Server request timed out. Please check back in a moment.');
      }
      if (res.status === 404) {
        throw new Error('Requested resource was not found (404).');
      }
      throw new Error(`Server returned error (${res.status})`);
    }
    if (bodyData !== null) return bodyData;
    try {
      return await res.json();
    } catch (e) {
      return await res.text();
    }
  },
  async get(url) {
    const res = await fetch(url);
    return this._handleResponse(res);
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this._handleResponse(res);
  },
  async patch(url, body) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this._handleResponse(res);
  },

  // Specialized helpers
  verifyOtp(orderId, otp) {
    return this.post(`/api/orders/${orderId}/verify-otp`, { otp });
  },
  cancelOrder(orderId, reason) {
    return this.post(`/api/orders/${orderId}/cancel`, { reason });
  },
  toggleItemStock(itemId) {
    return this.patch(`/api/menu-items/${itemId}/toggle`, {});
  },
  setRiderStatus(riderId, status) {
    return this.patch(`/api/riders/${riderId}/status`, { status });
  },
  assignRider(orderId, riderId) {
    return this.post(`/api/admin/orders/${orderId}/assign`, { rider_id: riderId });
  },
};

const STATUS_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const STATUS_LABEL = {
  PLACED: 'Order Placed',
  ACCEPTED: 'Accepted by Restaurant',
  PREPARING: 'Preparing Food',
  READY: 'Ready for Pickup',
  ASSIGNED: 'Rider Assigned',
  PICKED_UP: 'Food Picked Up',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  REJECTED: 'Order Rejected',
  CANCELLED: 'Order Cancelled',
};

const STATUS_ICONS = {
  PLACED: '📝',
  ACCEPTED: '👨‍🍳',
  PREPARING: '🍳',
  READY: '📦',
  ASSIGNED: '🛵',
  PICKED_UP: '🥡',
  OUT_FOR_DELIVERY: '🚀',
  DELIVERED: '🎉',
  REJECTED: '❌',
  CANCELLED: '🛑',
};

// Web Audio API Synthesizer (zero MP3 files required, pure browser synthesis)
const AudioFx = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  },
  play(type = 'chime') {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'chime') {
        // Two-tone bell for new incoming order / status ping (E5 -> G5)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.setValueAtTime(783.99, now + 0.12);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === 'alert') {
        // Energetic ping for rider assignment (A5)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'success') {
        // Arpeggio celebratory chime (C5 -> E5 -> G5 -> C6)
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          o.connect(g);
          g.connect(this.ctx.destination);
          const t = now + idx * 0.08;
          g.gain.setValueAtTime(0.2, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o.start(t);
          o.stop(t + 0.35);
        });
      } else if (type === 'error') {
        // Minor low buzz for rejection / bad OTP
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(160, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // Audio playback fails silently if blocked by autoplay policy
    }
  },
};

// Auto-init audio context on first user click anywhere
window.addEventListener('click', () => AudioFx.init(), { once: true });
window.addEventListener('keydown', () => AudioFx.init(), { once: true });

// Confetti burst for delivery celebration
function celebrateDelivery() {
  AudioFx.play('success');
  // If canvas-confetti library is loaded
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
    return;
  }

  // Fallback CSS particle celebration
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
  const colors = ['#FF5200', '#16A34A', '#2563EB', '#F59E0B', '#EC4899'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const size = Math.random() * 8 + 6;
    const dur = Math.random() * 1.5 + 1.2;
    p.style.cssText = `position:absolute;top:-10px;left:${left}%;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};animation:fallDown ${dur}s ease-out forwards;`;
    container.appendChild(p);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 2500);
}

function progressTrack(status) {
  const idx = STATUS_FLOW.indexOf(status);
  const isTerminalBad = status === 'REJECTED' || status === 'CANCELLED';
  return STATUS_FLOW.map((s, i) => {
    let cls = 'seg';
    if (isTerminalBad) return cls;
    if (i < idx) cls += ' done';
    else if (i === idx) cls += ' current';
    return cls;
  }).join('|').split('|').map(c => `<div class="${c}"></div>`).join('');
}

function toast(msg, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : '🔔'}</span> ${msg}`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// Swiggy-Style Foodie Express Kitchen Error & Offline Screen
function renderErrorScreen(container, options = {}) {
  const {
    title = "The Kitchen is Taking a Quick Breather!",
    desc = "Our servers need a moment to cool down the pans and refresh the menu. Don't worry, our chefs and delivery fleet are on standby!",
    badge = "Kitchen Standby",
    error = null,
    onRetry = () => location.reload(),
    retryText = "Reconnect Kitchen",
    showSwitchRole = true,
  } = options;

  let cleanHint = 'Server connection momentarily paused';
  if (error) {
    const msg = typeof error === 'string' ? error : (error.message || '');
    if (msg.includes('Unexpected token') || msg.includes('502') || msg.includes('503')) {
      cleanHint = 'Server rebooting or unreachable (502 Gateway)';
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      cleanHint = 'Offline • Waiting for network or server connection';
    } else if (msg.length > 0 && msg.length < 80) {
      cleanHint = msg;
    }
  }

  const html = `
    <div class="empty-state-card">
      <div class="empty-state-visual">
        <div class="state-glow"></div>
        <svg viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="80" cy="80" r="70" fill="url(#clocheGlow)" fill-opacity="0.3"/>
          <path class="steam-line s1" d="M68 45 C65 35, 73 28, 68 18" stroke="#FF5200" stroke-width="3" stroke-linecap="round" fill="none"/>
          <path class="steam-line s2" d="M80 40 C77 30, 85 24, 80 14" stroke="#FF7A00" stroke-width="3.5" stroke-linecap="round" fill="none"/>
          <path class="steam-line s3" d="M92 45 C95 35, 87 28, 92 18" stroke="#FF5200" stroke-width="3" stroke-linecap="round" fill="none"/>
          <circle cx="80" cy="54" r="8" fill="#FF5200"/>
          <circle cx="80" cy="54" r="4" fill="#FFE5D6"/>
          <path d="M30 110 C30 72 52 58 80 58 C108 58 130 72 130 110 Z" fill="url(#domeGrad)"/>
          <path d="M42 104 C44 78 60 68 80 66 C70 68 52 78 48 104 Z" fill="#FFFFFF" fill-opacity="0.5"/>
          <circle cx="70" cy="88" r="3" fill="#1E293B"/>
          <circle cx="90" cy="88" r="3" fill="#1E293B"/>
          <path d="M74 96 Q80 102 86 96" stroke="#1E293B" stroke-width="2.5" stroke-linecap="round" fill="none"/>
          <ellipse cx="64" cy="94" rx="4" ry="2.5" fill="#FF8A8A" opacity="0.6"/>
          <ellipse cx="96" cy="94" rx="4" ry="2.5" fill="#FF8A8A" opacity="0.6"/>
          <rect x="26" y="108" width="108" height="8" rx="4" fill="#CBD5E1"/>
          <ellipse cx="80" cy="118" rx="64" ry="10" fill="#E2E8F0"/>
          <ellipse cx="80" cy="116" rx="58" ry="8" fill="#F8FAFC"/>
          <path d="M84 48 C84 44 87 42 90 42 C93 42 95 44 97 43 C99 41 103 43 103 46 C105 47 106 50 104 53 L86 53 Z" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.2"/>
          <defs>
            <radialGradient id="clocheGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(80 80) rotate(90) scale(70)">
              <stop stop-color="#FF5200" stop-opacity="0.25"/>
              <stop offset="1" stop-color="#FF5200" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="domeGrad" x1="80" y1="58" x2="80" y2="110" gradientUnits="userSpaceOnUse">
              <stop stop-color="#F8FAFC"/>
              <stop offset="0.5" stop-color="#E2E8F0"/>
              <stop offset="1" stop-color="#CBD5E1"/>
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div class="empty-state-badge">
        <span class="badge-dot"></span> ${badge}
      </div>

      <h2 class="empty-state-title">${title}</h2>
      <p class="empty-state-desc">${desc}</p>

      <div class="empty-state-hint">
        <span>📡</span> <span>${cleanHint}</span>
      </div>

      <div class="empty-state-actions">
        <button type="button" class="empty-state-retry-btn" id="feRetryBtn">
          <span class="retry-icon">🔄</span> <span class="retry-label">${retryText}</span>
        </button>
        ${showSwitchRole ? `
          <a href="/login.html" class="empty-state-secondary-btn">
            <span>⇄</span> Switch Role
          </a>
        ` : ''}
      </div>

      <div class="empty-state-countdown" id="feCountdown">
        Auto-checking connection in <strong id="feSecs">12</strong>s...
      </div>
    </div>
  `;

  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  if (!container) return;
  container.innerHTML = html;

  const retryBtn = container.querySelector('#feRetryBtn');
  let countdownTimer = null;
  let secsLeft = 12;

  const doRetry = async () => {
    clearInterval(countdownTimer);
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.style.opacity = '0.75';
      const label = retryBtn.querySelector('.retry-label');
      if (label) label.textContent = 'Checking Connection...';
    }
    try {
      if (onRetry) {
        await onRetry();
      } else {
        location.reload();
      }
    } catch (e) {
      if (retryBtn) {
        retryBtn.disabled = false;
        retryBtn.style.opacity = '1';
        const label = retryBtn.querySelector('.retry-label');
        if (label) label.textContent = retryText;
      }
    }
  };

  if (retryBtn) {
    retryBtn.addEventListener('click', doRetry);
  }

  const secsEl = container.querySelector('#feSecs');
  countdownTimer = setInterval(() => {
    secsLeft--;
    if (secsEl) secsEl.textContent = secsLeft;
    if (secsLeft <= 0) {
      clearInterval(countdownTimer);
      doRetry();
    }
  }, 1000);
}

function timeAgo(iso) {
  if (!iso) return 'just now';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function elapsedMinutes(iso) {
  if (!iso) return 0;
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

// --- PROGRESSIVE WEB APP (PWA) SUPPORT ---
const PWA = {
  deferredPrompt: null,
  init() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => console.log('⚡ PWA Service Worker registered:', reg.scope))
          .catch(err => console.warn('PWA SW failed:', err));
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const btn = document.getElementById('pwaInstallBtn');
      if (btn) btn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      toast('Foodie Express installed to your device!', 'success');
      const btn = document.getElementById('pwaInstallBtn');
      if (btn) btn.style.display = 'none';
    });
  },
  async install() {
    if (!this.deferredPrompt) {
      toast('To install: tap your browser menu (⋮ / Share) and select "Add to Home Screen"', 'info');
      return;
    }
    this.deferredPrompt.prompt();
    const choice = await this.deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      toast('Installing Foodie Express...', 'success');
    }
    this.deferredPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'none';
  }
};

PWA.init();

// --- LIVE SERVER CONNECTION INDICATOR ---
const LiveConnection = {
  el: null,
  status: 'connecting',
  init(customSocket) {
    if (this.el) return;
    
    // Floating top indicator badge
    this.el = document.createElement('div');
    this.el.id = 'liveConnectionBadge';
    this.el.className = 'live-conn-badge connecting';
    this.el.innerHTML = `
      <span class="live-dot"></span>
      <span class="live-text">Syncing...</span>
    `;
    this.el.title = 'Live Server Connection Status (Click to ping)';
    document.body.appendChild(this.el);

    const s = customSocket || (typeof socket !== 'undefined' ? socket : (typeof io === 'function' ? io() : null));

    if (s && typeof s.on === 'function') {
      if (s.connected) {
        this.setStatus('connected', 'Live');
      }
      s.on('connect', () => this.setStatus('connected', 'Live'));
      s.on('disconnect', () => this.setStatus('reconnecting', 'Connecting...'));
      s.on('connect_error', () => this.setStatus('offline', 'Offline'));
      s.on('reconnect', () => this.setStatus('connected', 'Live'));
    } else {
      // HTTP polling ping fallback
      this.checkHttpPing();
      setInterval(() => this.checkHttpPing(), 15000);
    }

    this.el.addEventListener('click', () => this.checkHttpPing(true));
  },
  async checkHttpPing(showToast = false) {
    const t0 = Date.now();
    try {
      await fetch('/api/network-info', { cache: 'no-store' });
      const ms = Date.now() - t0;
      this.setStatus('connected', `Live (${ms}ms)`);
      if (showToast) toast(`🟢 Server Online (${ms}ms ping)`, 'success');
    } catch (e) {
      this.setStatus('offline', 'Offline');
      if (showToast) toast('🔴 Server Offline / Unreachable', 'error');
    }
  },
  setStatus(state, label) {
    this.status = state;
    this.lastLabel = label;
    if (!this.el) return;
    this.el.className = `live-conn-badge ${state}`;
    const textEl = this.el.querySelector('.live-text');
    if (textEl) {
      if (window.innerWidth <= 640 && label.startsWith('Live (')) {
        const m = label.match(/Live \((.*?)\)/);
        textEl.textContent = m ? m[1] : label;
      } else {
        textEl.textContent = label;
      }
    }
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => LiveConnection.init());
} else {
  LiveConnection.init();
}

// ==========================================================
// CENTRALIZED APP BACK NAVIGATION & EXIT HANDLER
// ==========================================================
const AppNavigation = {
  lastBackPress: 0,
  toastEl: null,
  toastTimer: null,
  rootScreen: 'browse',
  getCurrentScreen: () => 'browse',
  onNavigateBack: null,
  exitUrl: '/login.html',
  isInitialized: false,

  showExitToast(text = 'Tap back again to exit') {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.id = 'exitToast';
      this.toastEl.className = 'exit-toast';
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.innerHTML = `<span class="exit-icon">‹</span> ${text}`;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.classList.remove('show');
    }, 2000);
  },

  setup(options = {}) {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.rootScreen = options.rootScreen || 'browse';
    this.getCurrentScreen = options.getCurrentScreen || (() => this.rootScreen);
    this.onNavigateBack = options.onNavigateBack || null;
    this.exitUrl = options.exitUrl || '/login.html';

    // Seed state so browser has a baseline entry
    try {
      history.replaceState({ appRoot: true, screen: this.rootScreen }, '');
      history.pushState({ appGuard: true, screen: this.rootScreen }, '');
    } catch (e) {}

    window.addEventListener('popstate', (e) => {
      // 1. If any modal is open, back closes the modal first!
      const openModal = document.querySelector('.modal-overlay');
      if (openModal) {
        const closeBtn = openModal.querySelector('#closeModalBtn, #closeReceiptBtn, #dismissReceiptBtn, #cancelCheckout');
        if (closeBtn) {
          closeBtn.click();
        } else {
          openModal.remove();
          document.body.classList.remove('modal-open');
        }
        try {
          history.pushState({ appGuard: true, screen: this.getCurrentScreen() }, '');
        } catch (err) {}
        return;
      }

      // 2. If on a sub-screen, go back 1 by 1!
      const currentScreen = this.getCurrentScreen();
      if (currentScreen !== this.rootScreen) {
        if (this.onNavigateBack) {
          this.onNavigateBack(currentScreen);
        }
        try {
          history.pushState({ appGuard: true, screen: this.getCurrentScreen() }, '');
        } catch (err) {}
        return;
      }

      // 3. We are on the root / main page: "Tap back again to exit"
      const now = Date.now();
      if (now - this.lastBackPress < 2000) {
        if (this.toastEl) this.toastEl.classList.remove('show');
        window.location.href = this.exitUrl;
      } else {
        this.lastBackPress = now;
        this.showExitToast('Tap back again to exit');
        try {
          history.pushState({ appGuard: true, screen: this.rootScreen }, '');
        } catch (err) {}
      }
    });
  }
};

