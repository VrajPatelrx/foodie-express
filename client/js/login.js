const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

const regRoleSelect = document.getElementById('regRole');
const regNameLabel = document.getElementById('regNameLabel');
const regNameInput = document.getElementById('regName');

function updateRoleUi() {
  if (!regRoleSelect || !regNameLabel || !regNameInput) return;
  const role = regRoleSelect.value;
  if (role === 'VENDOR') {
    regNameLabel.textContent = 'Restaurant Name';
    regNameInput.placeholder = 'e.g. Darbar Mugg Pulav';
  } else if (role === 'RIDER') {
    regNameLabel.textContent = 'Rider Full Name';
    regNameInput.placeholder = 'e.g. Vraj Patel';
  } else {
    regNameLabel.textContent = 'Full Name';
    regNameInput.placeholder = 'e.g. Vraj Patel';
  }
}

if (regRoleSelect) {
  regRoleSelect.addEventListener('change', updateRoleUi);
}

function switchTab(tab) {
  if (tab === 'login') {
    tabLogin.style.borderBottomColor = 'var(--primary)';
    tabLogin.style.fontWeight = '800';
    tabLogin.style.color = 'var(--ink)';

    tabRegister.style.borderBottomColor = 'transparent';
    tabRegister.style.fontWeight = '600';
    tabRegister.style.color = 'var(--ink-secondary)';

    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
  } else {
    tabRegister.style.borderBottomColor = 'var(--primary)';
    tabRegister.style.fontWeight = '800';
    tabRegister.style.color = 'var(--ink)';

    tabLogin.style.borderBottomColor = 'transparent';
    tabLogin.style.fontWeight = '600';
    tabLogin.style.color = 'var(--ink-secondary)';

    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    updateRoleUi();
  }
}

tabLogin.addEventListener('click', () => switchTab('login'));
tabRegister.addEventListener('click', () => switchTab('register'));
updateRoleUi();

function handleSuccessfulAuth(user, token) {
  localStorage.setItem('fe_user', JSON.stringify(user));
  localStorage.setItem('fe_token', token || '');

  if (user.role === 'CUSTOMER') {
    localStorage.setItem('fe_customer_name', user.name);
    localStorage.setItem('fe_customer_phone', user.phone);
    localStorage.setItem('fe_customer_email', user.email);
    window.location.href = 'customer.html';
  } else if (user.role === 'VENDOR') {
    if (user.restaurant_id) {
      localStorage.setItem('fe_vendor_restaurant', user.restaurant_id);
    }
    window.location.href = 'vendor.html';
  } else if (user.role === 'RIDER') {
    if (user.rider_id) {
      localStorage.setItem('fe_rider_id', user.rider_id);
    }
    window.location.href = 'rider.html';
  } else if (user.role === 'ADMIN') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'index.html';
  }
}

// 1-Click Quick Demo Login buttons
document.querySelectorAll('.demo-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const role = btn.dataset.role;
    try {
      btn.disabled = true;
      const res = await API.post('/api/auth/login', { demoRole: role });
      toast(`Logged in as demo ${role.toLowerCase()}: ${res.user.name}`, 'success');
      setTimeout(() => handleSuccessfulAuth(res.user, res.token), 400);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
});

// Standard Login Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await API.post('/api/auth/login', { email, password });
    toast(`Welcome back, ${res.user.name}!`, 'success');
    handleSuccessfulAuth(res.user, res.token);
  } catch (err) {
    toast(err.message, 'error');
  }
});

// Standard Registration Submit
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const role = document.getElementById('regRole').value;

  try {
    const res = await API.post('/api/auth/register', { name, phone, email, password, role });
    toast(`Account created successfully! Welcome, ${res.user.name}`, 'success');
    handleSuccessfulAuth(res.user, res.token);
  } catch (err) {
    toast(err.message, 'error');
  }
});
