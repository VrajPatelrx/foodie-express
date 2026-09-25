/**
 * Foodie Express - Modern Vector SVG Iconography System
 * Clean, lightweight, professional SVG icons replacing raw emojis.
 */
const Icons = {
  // Brand Logo Mark
  logo(size = 28) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-svg brand-logo-svg">
      <rect width="40" height="40" rx="10" fill="url(#logoGrad_${size})"/>
      <path d="M12 12H28C29.6 12 30.5 13.8 29.3 15L25 19.5C24.4 20 23.6 20.5 22.8 20.5H18V22.5H23C24.4 22.5 25.2 24 24.2 25L22 27.2C21.4 27.8 20.6 28.2 19.7 28.2H18V30C18 31.1 17.1 32 16 32H14C12.9 32 12 31.1 12 30V12Z" fill="#FFFFFF"/>
      <path d="M24 20.5H29C30.5 20.5 31.3 22.2 30.3 23.2L26.5 27C25.8 27.7 24.8 28.2 23.8 28.2H19.5L22.5 22.8C23.1 21.6 23.7 20.5 24 20.5Z" fill="#FFE8DF" opacity="0.9"/>
      <defs>
        <linearGradient id="logoGrad_${size}" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stop-color="#FF5A1F"/>
          <stop offset="1" stop-color="#E03200"/>
        </linearGradient>
      </defs>
    </svg>`;
  },

  // Subtle Indian Standard Vegetarian Dot-in-Square (FSSAI)
  veg(size = 14) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-svg icon-veg" title="Vegetarian">
      <rect x="1" y="1" width="14" height="14" rx="3" stroke="#16A34A" stroke-width="1.6" fill="#FFFFFF"/>
      <circle cx="8" cy="8" r="4" fill="#16A34A"/>
    </svg>`;
  },

  // Customer / User
  customer(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>`;
  },

  // Kitchen / Storefront
  kitchen(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>`;
  },

  // Rider / Motorcycle Delivery
  rider(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <circle cx="5.5" cy="17.5" r="3.5"/>
      <circle cx="18.5" cy="17.5" r="3.5"/>
      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 5.5l1.5-4.5h3.5l2 4"/>
      <path d="M9 17.5l2-6.5h3.5l1.5 6.5"/>
    </svg>`;
  },

  // GPS Navigation Pointer
  navigation(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <polygon points="3 11 22 2 13 21 11 13 3 11"/>
    </svg>`;
  },

  // Operations / Admin Analytics
  admin(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>`;
  },

  // Showcase Simulator
  showcase(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
    </svg>`;
  },

  // Shopping Bag / Cart
  cart(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>`;
  },

  // Map Location Pin
  location(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>`;
  },

  // Clock / ETA
  clock(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`;
  },

  // Search
  search(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`;
  },

  // Check / Verified
  check(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  },

  // Chevron Right
  chevronRight(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <polyline points="9 18 15 12 9 6"/>
    </svg>`;
  },

  // Star (Rating)
  star(size = 14, color = '#F59E0B') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1" class="icon-svg">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
  },

  // Lock / Security
  lock(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>`;
  },

  // Phone / Mobile
  phone(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>`;
  },

  // UPI QR Code
  qr(size = 20, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
      <line x1="17" y1="7" x2="17.01" y2="7"/>
      <line x1="7" y1="17" x2="7.01" y2="17"/>
      <line x1="17" y1="17" x2="17.01" y2="17"/>
    </svg>`;
  },

  // Credit / Debit Card
  card(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>`;
  },

  // Percent / Coupon
  discount(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <line x1="19" y1="5" x2="5" y2="19"/>
      <circle cx="6.5" cy="6.5" r="2.5"/>
      <circle cx="17.5" cy="17.5" r="2.5"/>
    </svg>`;
  },

  // Close / Cross
  close(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
  },

  // Play button for simulator
  play(size = 16, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1" class="icon-svg">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>`;
  },

  // Receipt / Bill
  receipt(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`;
  },

  // Package / Delivery Box
  package(size = 18, color = 'currentColor') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>`;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Icons;
}
