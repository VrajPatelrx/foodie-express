const statusPill = document.getElementById('simStatusPill');
const simBtn = document.getElementById('runSimBtn');

function setStatus(text, bg = '#334155', color = '#E2E8F0') {
  if (!statusPill) return;
  statusPill.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color};"></span> ${text}`;
  statusPill.style.background = bg;
  statusPill.style.color = color;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAutoSimulation() {
  simBtn.disabled = true;
  simBtn.style.opacity = '0.5';

  try {
    // 1. Fetch restaurants to place order from
    const restaurants = await API.get('/api/restaurants');
    const rest = restaurants[0] || { id: 1 };
    const menu = await API.get(`/api/restaurants/${rest.id}/menu`);
    const item1 = menu[0] || { id: 1, name: 'Item 1' };

    setStatus('Step 1/6: Customer placing order...', '#2563EB', '#fff');
    AudioFx.play('chime');

    const customerNames = ['Aarav Patel', 'Priya Sharma', 'Rohit Verma', 'Ananya Mehta'];
    const randomName = customerNames[Math.floor(Math.random() * customerNames.length)];

    const order = await API.post('/api/orders', {
      customer_name: randomName,
      customer_address: 'Flat 402, Sunshine Heights, Anand',
      customer_phone: '9876543210',
      restaurant_id: rest.id,
      items: [{ menu_item_id: item1.id, qty: 2 }],
      payment_method: 'UPI',
    });

    toast(`Order #${order.id} placed by ${randomName}`, 'info');
    await sleep(2800);

    // 2. Kitchen accepts order
    setStatus('Step 2/6: Kitchen accepted order', '#7C3AED', '#fff');
    await API.patch(`/api/orders/${order.id}/status`, { status: 'ACCEPTED', note: 'Kitchen accepted order' });
    AudioFx.play('alert');
    await sleep(2800);

    // 3. Kitchen starts preparing food
    setStatus('Step 3/6: Kitchen preparing dishes...', '#D97706', '#fff');
    await API.patch(`/api/orders/${order.id}/status`, { status: 'PREPARING', note: 'Kitchen preparing dishes' });
    AudioFx.play('alert');
    await sleep(3000);

    // 4. Kitchen marks ready (triggers auto rider dispatch!)
    setStatus('Step 4/6: Order ready · Auto-assigning partner...', '#FF5200', '#fff');
    await API.patch(`/api/orders/${order.id}/status`, { status: 'READY', note: 'Food packed in kitchen' });
    AudioFx.play('alert');
    await sleep(3000);

    // 5. Rider picks up food
    setStatus('Step 5/6: Rider picked up order · En route', '#2563EB', '#fff');
    await API.patch(`/api/orders/${order.id}/status`, { status: 'PICKED_UP', note: 'Rider received parcel' });
    AudioFx.play('alert');
    await sleep(2500);

    // 6. Rider out for delivery
    setStatus('Step 6/6: Delivery partner approaching destination', '#4338CA', '#fff');
    await API.patch(`/api/orders/${order.id}/status`, { status: 'OUT_FOR_DELIVERY', note: 'Rider approaching customer location' });
    AudioFx.play('alert');
    await sleep(3500);

    // 7. Verify Delivery PIN and complete
    setStatus('Final Step: Verifying Customer PIN...', '#16A34A', '#fff');
    const currentOrder = await API.get(`/api/orders/${order.id}`);
    await API.verifyOtp(order.id, currentOrder.delivery_otp);

    setStatus('Order successfully delivered and verified', '#16A34A', '#fff');
    celebrateDelivery();
    toast(`Order #${order.id} successfully delivered!`, 'success');

  } catch (err) {
    console.error('Simulation error:', err);
    setStatus(`Simulation Error: ${err.message}`, '#DC2626', '#fff');
    toast(err.message, 'error');
  } finally {
    simBtn.disabled = false;
    simBtn.style.opacity = '1';
  }
}

if (simBtn) {
  simBtn.addEventListener('click', runAutoSimulation);
}
