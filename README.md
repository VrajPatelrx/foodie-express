# Foodie Express — Real-Time Food Delivery Platform

<p align="center">
  <img src="client/icons/icon.svg" width="80" height="80" alt="Foodie Express Logo" />
</p>

<p align="center">
  <strong>A full-stack, real-time food delivery web application with 4 synchronized live dashboards: Customer, Restaurant Kitchen (KDS), Rider Partner, and Admin Console.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socketdotio&logoColor=white" alt="Socket.io" />
  <img src="https://img.shields.io/badge/Database-SQLite_WAL-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

## Overview

**Foodie Express** is an on-demand food delivery platform built with Node.js, Express, Socket.io, and SQLite. It provides a real-time event-driven experience where customer orders instantly trigger notifications in restaurant kitchens, dispatch available delivery riders, and update the central operations admin dashboard without page reloads.

---

## Key Features

- **4-in-1 Live Simulator (`showcase.html`)**: View Customer, Kitchen, Rider, and Admin screens side-by-side with an automated order lifecycle simulation.
- **Customer Portal (`customer.html`)**: Menu browsing, cart management, GPS location detection, saved address book, payment options (UPI, Card, COD), and live order tracking with an interactive Leaflet map.
- **Kitchen Display System (`vendor.html`)**: 3-column Kanban board (*New Orders*, *Preparing*, *Ready*) with real-time SLA timers, sound alerts, and menu item stock toggles.
- **Rider Partner App (`rider.html`)**: Online/Offline duty toggle, dispatch requests, turn-by-turn order progression, trip earnings, and 4-digit customer delivery OTP verification.
- **Operations & Finance Admin (`admin.html`)**: Gross Order Value (GOV) metrics, platform commission tracking, net earnings, active rider monitoring, and manual dispatch assignments.

---

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+), Leaflet.js, Web Audio API
- **Backend**: Node.js, Express.js
- **Real-Time Communication**: Socket.io (WebSockets)
- **Database**: SQLite (`better-sqlite3` with WAL mode)
- **Mobile Tunneling**: ngrok (for remote device testing)

---

## How to Run the Project

### 1. Prerequisites
Ensure [Node.js](https://nodejs.org/) (version 18 or higher) is installed on your system.

---

### 2. Install Dependencies
```bash
npm install
```

---

### 3. Start the Application

#### Option A: Windows (1-Click)
> Double-click **`start.bat`** in the project folder.

#### Option B: Terminal (Windows / macOS / Linux)
```bash
npm start
```

---

### 4. Open in Your Browser
Once the server is running, open:
**[http://localhost:3000](http://localhost:3000)**

> **Demo Mode**: Open **[http://localhost:3000/showcase.html](http://localhost:3000/showcase.html)** to test all 4 roles simultaneously on one screen.

---

### 5. Environment Configuration (.env)
Foodie Express automatically loads settings from your private `.env` file:
```bash
# Copy template to .env (already created for you)
cp .env.example .env
```
Key configuration parameters:
- `PORT`: Web server port (default `3000`)
- `JWT_SECRET`: Secret key used for cryptographic session signature verification
- `PASSWORD_SALT`: Custom salt used for secure credential hashing
- `NGROK_DOMAIN` / `TUNNEL_URL`: Optional private ngrok permanent domain for mobile testing (kept 100% private and excluded from git)

---

### Optional: Mobile Testing (HTTPS Tunnel)
To test the application on a mobile device with GPS location:

1. Keep the server running (`npm start`).
2. Double-click **`tunnel.bat`** (or run `npm run tunnel`).
3. Open the generated HTTPS URL on your mobile phone browser or scan the QR code from the landing page.

---

### Reset / Reseed Database
To clear mock orders and restore default seed data:
```bash
npm run reset-db
```

---

## Demo Accounts & Portals

Use the **1-Click Demo Login** buttons on the login page or log in with these default credentials:

| Portal | URL | Demo Email | Password | Role Description |
|---|---|---|---|---|
| **4-in-1 Simulator** | `/showcase.html` | *None (Auto)* | *None* | Runs all roles side-by-side |
| **Customer** | `/customer.html` | `customer@foodie.com` | `foodie123` | Place and track orders |
| **Kitchen (KDS)** | `/vendor.html` | `vendor@foodie.com` | `foodie123` | Manage orders and menu stock |
| **Delivery Rider** | `/rider.html` | `rider@foodie.com` | `foodie123` | Accept trips and verify OTP |
| **Operations Admin** | `/admin.html` | `admin@foodie.com` | `foodie123` | Platform revenue and dispatch |

---

## License

This project is licensed under the [MIT License](LICENSE).
