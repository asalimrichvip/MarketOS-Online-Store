'use strict';

// Keep this empty for same-origin hosting. For GitHub Pages, set ?api=https://YOUR-API-HOST
// on the storefront URL, or set window.MARKETOS_API_BASE before this script is loaded.
const API_BASE = String(window.MARKETOS_API_BASE || new URLSearchParams(location.search).get('api') || '').trim().replace(/\/+$/, '');
const $ = id => document.getElementById(id);
const state = {
  store:null,
  products:[],
  cart:new Map(),
  filter:'ALL',
  query:'',
  loading:false,
  submitting:false,
  attempt:null,
  toastTimer:null
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function money(minor) {
  const currency = state.store?.currency || 'EGP';
  try {
    return new Intl.NumberFormat('ar-EG',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(minor || 0) / 100);
  } catch (_) {
    return `${currency} ${(Number(minor || 0) / 100).toFixed(2)}`;
  }
}

function roundQty(value) { return Math.round(Number(value) * 1000) / 1000; }
function qtyText(value) { return Number.isInteger(Number(value)) ? String(Number(value)) : String(roundQty(value)); }

function unitLabel(unit) {
  const raw = String(unit || '').trim();
  const normalized = raw.toLocaleLowerCase('en');
  const labels = {
    piece:'قطعة',pieces:'قطعة',pc:'قطعة',pcs:'قطعة',unit:'وحدة',units:'وحدة',
    kg:'كجم',kilogram:'كجم',kilograms:'كجم',g:'جرام',gram:'جرام',grams:'جرام',
    l:'لتر',litre:'لتر',litres:'لتر',liter:'لتر',liters:'لتر',ml:'مللي',
    pack:'عبوة',packs:'عبوة',box:'علبة',boxes:'علبة',bottle:'زجاجة',bottles:'زجاجة',
    bag:'كيس',bags:'كيس',dozen:'دستة'
  };
  return labels[normalized] || raw || 'قطعة';
}

function isAppsScriptApi() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:$|\?)/i.test(API_BASE);
}

function appsScriptJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!isAppsScriptApi()) {
      reject(new Error('حط رابط Google Apps Script المنشور في إعداد api.'));
      return;
    }
    const callback = '__mos_jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      try { delete window[callback]; } catch (_) { window[callback] = undefined; }
    };
    window[callback] = data => { cleanup(); resolve(data); };
    const url = new URL(API_BASE);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', callback);
    url.searchParams.set('_', String(Date.now()));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value ?? '')));
    const timer = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة الاتصال بخادم Google. جرّب تحديث الصفحة.')); }, 18000);
    script.async = true;
    script.onerror = () => { cleanup(); reject(new Error('تعذر الاتصال بخادم Google Apps Script. راجع رابط النشر وصلاحية الوصول.')); };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function waitMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function submitAppsScriptOrder(payload) {
  if (!isAppsScriptApi()) throw new Error('رابط Google Apps Script غير مضبوط.');
  const token = String(payload.trackingToken || payload.idempotencyKey || '');
  if (!token) throw new Error('رمز الطلب مفقود. حدّث الصفحة وحاول مرة أخرى.');
  let frame = null;
  let form = null;
  try {
    const frameName = 'mos_order_post_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    frame = document.createElement('iframe');
    frame.name = frameName;
    frame.title = 'إرسال الطلب';
    frame.hidden = true;
    document.body.appendChild(frame);

    form = document.createElement('form');
    form.method = 'POST';
    form.action = API_BASE;
    form.target = frameName;
    form.acceptCharset = 'UTF-8';
    form.hidden = true;
    const fields = {action:'submitOrder', payload:JSON.stringify(payload)};
    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await waitMs(attempt === 0 ? 900 : 800);
      const result = await appsScriptJsonp('orderResult', {token});
      if (result?.ok && result.order) return result;
      if (result?.ok === false && !result.pending && result.error) throw new Error(result.error);
    }
    throw new Error('مش قادرين نأكد تسجيل الطلب حتى الآن. حدّث حالة الاتصال قبل ما تعيد المحاولة؛ نفس رمز الطلب بيمنع تكرار الخصم.');
  } finally {
    if (form) form.remove();
    if (frame) setTimeout(() => frame.remove(), 1000);
  }
}

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (isAppsScriptApi()) {
    if (path === '/api/storefront/catalog' && method === 'GET') return appsScriptJsonp('catalog');
    if (path === '/api/storefront/orders' && method === 'POST') {
      let payload = {};
      try { payload = JSON.parse(options.body || '{}'); } catch (_) { throw new Error('بيانات الطلب غير صحيحة.'); }
      return submitAppsScriptOrder(payload);
    }
    throw new Error('العملية المطلوبة غير مدعومة في واجهة Google Apps Script.');
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      cache:'no-store',
      credentials:'omit',
      headers:{'Content-Type':'application/json', ...(options.headers || {})}
    });
  } catch (_) {
    throw new Error('مش قادرين نوصل لخادم الطلبات. اتأكد إن رابط الـ API مضبوط.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (response.status === 404 || !Object.keys(data).length) {
      throw new Error('واجهة المتجر مش متوصلة بخادم الطلبات لسه. راجع إعداد رابط الـ API.');
    }
    throw new Error(data.error || `حصل خطأ في الطلب (${response.status}).`);
  }
  return data;
}

function productIcon(name) {
  const text = String(name || '').toLowerCase();
  if (/milk|لبن|زبادي|جبن|cheese|yogurt/.test(text)) return '🥛';
  if (/water|مياه|ماء/.test(text)) return '💧';
  if (/rice|رز|أرز|sugar|سكر|flour|دقيق|pasta|مكرونة/.test(text)) return '🌾';
  if (/oil|زيت|vinegar|خل/.test(text)) return '🫙';
  if (/bread|عيش|خبز|toast|توست/.test(text)) return '🥖';
  if (/juice|عصير|drink|مشروب/.test(text)) return '🧃';
  if (/tea|شاي|coffee|قهوة|نسكافيه/.test(text)) return '☕';
  if (/apple|تفاح/.test(text)) return '🍎';
  if (/orange|برتقال|lemon|ليمون/.test(text)) return '🍊';
  if (/meat|لحمة|لحم|chicken|فراخ|دجاج|fish|سمك/.test(text)) return '🍗';
  if (/chip|شيبسي|snack|سناك|بسكويت|biscuit/.test(text)) return '🍪';
  if (/soap|صابون|detergent|منظف|clean/.test(text)) return '🧼';
  if (/egg|بيض/.test(text)) return '🥚';
  return '🛒';
}

function stockLabel(product) {
  if (!product.track_inventory) return {text:'متوفر', className:'stock-available'};
  if (product.stock_status === 'OUT_OF_STOCK') return {text:'نفد مؤقتًا', className:'stock-out'};
  if (product.stock_status === 'LOW_STOCK') return {text:'الكمية قربت تخلص', className:'stock-low'};
  return {text:'متوفر', className:'stock-available'};
}

function setMessage(message = '', isError = false) {
  const element = $('storeMessage');
  element.textContent = message;
  element.classList.toggle('error', Boolean(isError));
}

function toast(message, isError = false) {
  const element = $('storeToast');
  element.textContent = message;
  element.classList.toggle('error', Boolean(isError));
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 3800);
}

function priceLine(product, qty) {
  const subtotal = Math.round(Number(product.price_minor) * Number(qty));
  const tax = Math.round(subtotal * Number(product.tax_rate_bp || 0) / 10000);
  return {subtotal,tax,total:subtotal + tax};
}

function visibleProducts() {
  const query = state.query.trim().toLocaleLowerCase('ar');
  return state.products.filter(product => {
    const matchesQuery = !query || String(product.name).toLocaleLowerCase('ar').includes(query);
    const matchesStock = state.filter === 'ALL' || product.stock_status === state.filter || (state.filter === 'IN_STOCK' && !product.track_inventory);
    return matchesQuery && matchesStock;
  });
}

function renderProducts() {
  const grid = $('productGrid');
  const products = visibleProducts();
  if (!products.length) {
    grid.innerHTML = '<div class="empty-results">مفيش منتجات مطابقة للبحث أو الفلتر ده.</div>';
    return;
  }
  const storeClosed = state.store && !state.store.isOpen;
  grid.innerHTML = products.map(product => {
    const status = stockLabel(product);
    const outOfStock = product.track_inventory && product.stock_status === 'OUT_OF_STOCK';
    const count = state.cart.get(product.id)?.qty || 0;
    const unitPrice = money(product.price_with_tax_minor);
    return `<article class="product-card ${outOfStock ? 'out-of-stock' : ''}">
      ${count ? `<span class="product-in-cart">${escapeHtml(qtyText(count))}</span>` : ''}
      <span class="product-stock ${status.className}">${status.text}</span>
      <div class="product-visual" aria-hidden="true">${productIcon(product.name)}</div>
      <h3 class="product-title">${escapeHtml(product.name)}</h3>
      <span class="product-unit">${escapeHtml(unitLabel(product.unit))}</span>
      <div class="product-bottom"><div class="product-price">${unitPrice}<small>شامل الضريبة</small></div>
      <button class="add-button" type="button" data-add-product="${escapeHtml(product.id)}" aria-label="إضافة ${escapeHtml(product.name)} للسلة" ${outOfStock || storeClosed ? 'disabled' : ''}>+</button></div>
    </article>`;
  }).join('');
}

function cartTotals() {
  let subtotal = 0;
  let tax = 0;
  for (const item of state.cart.values()) {
    const line = priceLine(item.product, item.qty);
    subtotal += line.subtotal;
    tax += line.tax;
  }
  const delivery = Number(state.store?.deliveryFeeMinor || 0);
  return {subtotal,tax,delivery,total:subtotal + tax + delivery};
}

function renderCart() {
  const cartElement = $('cartItems');
  const items = [...state.cart.values()];
  const count = items.reduce((sum, item) => sum + Number(item.qty), 0);
  $('cartCount').textContent = `${qtyText(count)} ${count === 1 ? 'صنف' : 'وحدة'}`;
  if (!items.length) {
    cartElement.innerHTML = '<div class="empty-cart"><span>🛍️</span><strong>السلة لسه فاضية</strong><small>ضيف المنتجات اللي محتاجها وهتظهر هنا.</small></div>';
  } else {
    cartElement.innerHTML = items.map(item => {
      const line = priceLine(item.product,item.qty);
      return `<div class="cart-item"><div class="cart-item-main"><div class="cart-item-name">${escapeHtml(item.product.name)}</div><div class="cart-item-price">${money(item.product.price_with_tax_minor)} للوحدة</div><button class="remove-item" type="button" data-remove-product="${escapeHtml(item.product.id)}">حذف</button></div>
        <div class="cart-item-side"><strong class="cart-line-total">${money(line.total)}</strong><div class="quantity-control"><button type="button" data-qty-minus="${escapeHtml(item.product.id)}" aria-label="تقليل الكمية">−</button><span>${escapeHtml(qtyText(item.qty))}</span><button type="button" data-qty-plus="${escapeHtml(item.product.id)}" aria-label="زيادة الكمية" ${item.qty >= 1000 ? 'disabled' : ''}>+</button></div></div></div>`;
    }).join('');
  }
  const totals = cartTotals();
  $('cartSubtotal').textContent = money(totals.subtotal);
  $('cartTax').textContent = money(totals.tax);
  $('cartDelivery').textContent = money(totals.delivery);
  $('cartTotal').textContent = money(totals.total);
  $('submitTotal').textContent = money(totals.total);
  $('mobileCartTotal').textContent = money(totals.total);
  $('mobileCartCount').textContent = qtyText(count);
  $('mobileCartJump').classList.toggle('hidden',!items.length);
  $('placeOrderButton').disabled = !items.length || state.submitting || !state.store?.isOpen || !state.store?.ordersEnabled;
  $('placeOrderButton').querySelector('span').textContent = state.submitting ? 'بنسجل طلبك…' : !state.store?.isOpen ? 'الطلبات مقفولة حاليًا' : state.store && !state.store.ordersEnabled ? 'الطلبات هتتاح قريبًا' : 'تأكيد الطلب';
}

function addToCart(productId, change = 1) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  if (!state.store?.isOpen) return toast('الطلبات مقفولة حاليًا.', true);
  if (product.track_inventory && product.stock_status === 'OUT_OF_STOCK') return toast('الصنف نفد حاليًا.', true);
  const existing = state.cart.get(productId);
  const nextQty = roundQty((existing?.qty || 0) + change);
  if (nextQty <= 0) state.cart.delete(productId);
  else if (nextQty <= 1000) state.cart.set(productId,{product,qty:nextQty});
  else return toast('الكمية أكبر من المسموح في الطلب الواحد.', true);
  state.attempt = null;
  renderProducts();
  renderCart();
}

function setStockFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('[data-stock-filter]').forEach(button => button.classList.toggle('active',button.dataset.stockFilter === filter));
  renderProducts();
}

function updateStoreHeader() {
  const store = state.store;
  if (!store) return;
  $('storeName').textContent = store.name || 'متجر البقالة';
  $('storeTagline').textContent = store.tagline || 'اختار احتياجاتك، راجع السلة، وإحنا نوصلهالك.';
  const status = $('storeStatus');
  const acceptingOrders = Boolean(store.isOpen && store.ordersEnabled);
  status.classList.toggle('closed',!acceptingOrders);
  status.innerHTML = `<i></i>${acceptingOrders ? 'بنستقبل الطلبات' : !store.isOpen ? 'الطلبات مقفولة مؤقتًا' : 'المتجر تحت التجهيز'}`;
  if (store.phone) {
    const phoneLink = $('storePhoneLink');
    phoneLink.href = `tel:${String(store.phone).replace(/[^\d+]/g,'')}`;
    phoneLink.textContent = store.phone;
    phoneLink.classList.remove('hidden');
  }
  if (!store.isOpen) setMessage('المتجر قافل استقبال الطلبات مؤقتًا. تقدر تتصفح المنتجات وترجع تجرب بعدين.');
  else if (!store.ordersEnabled) setMessage('المنتجات متاحة للتصفح والاختبار، واستقبال الطلبات هيتفتح بعد اكتمال التجهيز.');
  else setMessage('');
}

async function loadCatalog({quiet = false} = {}) {
  if (state.loading) return;
  state.loading = true;
  $('refreshStore').disabled = true;
  if (!quiet && !state.products.length) $('productGrid').innerHTML = '<div class="loading-card">بنجهزلك المنتجات…</div>';
  try {
    const data = await request('/api/storefront/catalog');
    state.store = data.store;
    state.products = Array.isArray(data.products) ? data.products : [];
    // Drop no-longer-active and newly sold-out products from the basket. The server
    // still revalidates all stock and price values at order placement.
    for (const [id,item] of state.cart) {
      const latest = state.products.find(product => product.id === id);
      if (!latest || (latest.track_inventory && latest.stock_status === 'OUT_OF_STOCK')) state.cart.delete(id);
      else state.cart.set(id,{...item,product:latest});
    }
    updateStoreHeader();
    renderProducts();
    renderCart();
  } catch (error) {
    setMessage(error.message,true);
    if (!state.products.length) $('productGrid').innerHTML = `<div class="empty-results">${escapeHtml(error.message)}<br><br><button id="retryCatalog" class="filter-chip active" type="button">حاول تاني</button></div>`;
    $('retryCatalog')?.addEventListener('click',() => loadCatalog());
  } finally {
    state.loading = false;
    $('refreshStore').disabled = false;
  }
}

async function submitOrder(event) {
  event.preventDefault();
  if (state.submitting) return;
  if (!state.store?.isOpen) return toast('الطلبات مقفولة حاليًا.',true);
  if (!state.store?.ordersEnabled) return toast('استقبال الطلبات غير مفعل أثناء اختبار المتجر.',true);
  if (!state.cart.size) return toast('ضيف منتج واحد على الأقل للسلة.',true);
  const phone = $('customerPhone').value.trim();
  if (phone.replace(/\D/g,'').length < 8) return toast('راجع رقم الموبايل واكتبه بشكل صحيح.',true);
  const payload = {
    customerName:$('customerName').value.trim(),
    customerPhone:phone,
    deliveryAddress:$('deliveryAddress').value.trim(),
    customerNotes:$('customerNotes').value.trim(),
    paymentMethod:'CASH_ON_DELIVERY',
    items:[...state.cart.values()].map(item => ({productId:item.product.id,qty:item.qty}))
  };
  const signature = JSON.stringify(payload);
  if (!state.attempt || state.attempt.signature !== signature) {
    const newKey = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.attempt = {signature,key:newKey};
  }
  state.submitting = true;
  renderCart();
  $('storeToast').classList.remove('show');
  try {
    const data = await request('/api/storefront/orders',{
      method:'POST',
      body:JSON.stringify({...payload,idempotencyKey:state.attempt.key,trackingToken:state.attempt.key})
    });
    const order = data.order;
    const orderTotal = Number(order.total_minor || 0);
    state.cart.clear();
    state.attempt = null;
    $('checkoutForm').reset();
    $('successOrderNo').textContent = order.order_no;
    $('successOrderTotal').textContent = money(orderTotal);
    $('successTrackingToken').textContent = order.tracking_token || state.attempt?.key || '';
    $('trackPlacedOrder').onclick = () => {
      const target = new URL('./track-order.html',location.href);
      target.searchParams.set('order',order.order_no);
      target.searchParams.set('token',order.tracking_token || state.attempt?.key || '');
      if (API_BASE) target.searchParams.set('api',API_BASE);
      location.href = target.href;
    };
    $('orderSuccess').classList.remove('hidden');
    renderCart();
    await loadCatalog({quiet:true});
  } catch (error) {
    toast(error.message,true);
    if (error.message.includes('الكمية المتاحة') || error.message.includes('مبقاش متاح')) await loadCatalog({quiet:true});
  } finally {
    state.submitting = false;
    renderCart();
  }
}

document.querySelectorAll('[data-stock-filter]').forEach(button => button.addEventListener('click',() => setStockFilter(button.dataset.stockFilter)));
$('productSearch').addEventListener('input',event => { state.query = event.target.value; renderProducts(); });
$('refreshStore').addEventListener('click',() => loadCatalog());
$('productGrid').addEventListener('click',event => {
  const button = event.target.closest('[data-add-product]');
  if (button && !button.disabled) addToCart(button.dataset.addProduct,1);
});
$('cartItems').addEventListener('click',event => {
  const remove = event.target.closest('[data-remove-product]');
  if (remove) return addToCart(remove.dataset.removeProduct,-(state.cart.get(remove.dataset.removeProduct)?.qty || 0));
  const minus = event.target.closest('[data-qty-minus]');
  if (minus) return addToCart(minus.dataset.qtyMinus,-1);
  const plus = event.target.closest('[data-qty-plus]');
  if (plus && !plus.disabled) return addToCart(plus.dataset.qtyPlus,1);
});
$('checkoutForm').addEventListener('submit',submitOrder);
$('continueShopping').addEventListener('click',() => {
  $('orderSuccess').classList.add('hidden');
  $('products').scrollIntoView({behavior:'smooth',block:'start'});
});
if ('IntersectionObserver' in window) {
  const cartVisibilityObserver = new IntersectionObserver(entries => {
    $('mobileCartJump').classList.toggle('at-cart',Boolean(entries[0]?.isIntersecting));
  },{threshold:0.08});
  cartVisibilityObserver.observe($('checkout'));
}
document.addEventListener('visibilitychange',() => { if (!document.hidden) loadCatalog({quiet:true}); });
const storefrontApiOverride = new URLSearchParams(location.search).get('api');
if (storefrontApiOverride) {
  document.querySelectorAll('a[href="./track-order.html"]').forEach(link => {
    const target = new URL(link.href);
    target.searchParams.set('api', storefrontApiOverride);
    link.href = target.href;
  });
}
loadCatalog();
