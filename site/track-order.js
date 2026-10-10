'use strict';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const API_BASE = String(window.MARKETOS_API_BASE || params.get('api') || '').trim().replace(/\/+$/, '');
const state = {lastQuery:null,lastOrder:null,loading:false,timer:null};

function isAppsScriptApi() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:$|\?)/i.test(API_BASE);
}

function appsScriptJsonp(action, values = {}) {
  return new Promise((resolve, reject) => {
    if (!isAppsScriptApi()) return reject(new Error('رابط Google Apps Script غير مضبوط.'));
    const callback = '__mos_track_' + Date.now() + '_' + Math.random().toString(36).slice(2);
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
    Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, String(value ?? '')));
    const timer = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة الاتصال بخادم Google.')); }, 18000);
    script.async = true;
    script.onerror = () => { cleanup(); reject(new Error('تعذر الاتصال بخادم Google Apps Script. راجع رابط النشر.')); };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

const STATUS_FLOW = [
  {status:'NEW',title:'استلمنا طلبك',description:'طلبك اتسجل، وفريق المتجر هيراجعه ويأكد التفاصيل.',icon:'✓'},
  {status:'CONFIRMED',title:'تم تأكيد الطلب',description:'المتجر راجع طلبك وبدأ يجهز الخطوة اللي بعد كده.',icon:'✓'},
  {status:'PREPARING',title:'طلبك قيد التجهيز',description:'بنجهز أصناف طلبك علشان يبقى جاهز للتوصيل.',icon:'▦'},
  {status:'OUT_FOR_DELIVERY',title:'خرج للتوصيل 🚚',description:'طلبك خرج مع المندوب وفي الطريق ليك.',icon:'➜'},
  {status:'DELIVERED',title:'تم توصيل الطلب',description:'تم تسجيل إن الطلب وصل. بالهنا والشفا!',icon:'✓'}
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function money(minor) {
  return new Intl.NumberFormat('ar-EG',{style:'currency',currency:'EGP',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(minor || 0)/100);
}

function dateText(raw) {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ar-EG',{timeZone:'Africa/Cairo',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function setMessage(message='',isError=false) {
  $('trackMessage').textContent = message;
  $('trackMessage').classList.toggle('error',Boolean(isError));
}

function statusText(status) {
  return ({NEW:'طلب جديد',CONFIRMED:'تم التأكيد',PREPARING:'قيد التجهيز',OUT_FOR_DELIVERY:'خرج للتوصيل',DELIVERED:'تم التوصيل',CANCELLED:'ملغي'})[status] || 'حالة الطلب';
}

function currentStatus(order) {
  if (order.status === 'CANCELLED') return {title:'تم إلغاء الطلب',description:'الطلب اتلغى من فريق المتجر. لو محتاج توضيح، اتواصل مع المتجر.',icon:'×',index:-1};
  const index = STATUS_FLOW.findIndex(item=>item.status===order.status);
  const current = STATUS_FLOW[Math.max(0,index)];
  return {...current,index:Math.max(0,index)};
}

function renderTimeline(order) {
  const target = $('statusTimeline');
  if(order.status==='CANCELLED') {
    target.innerHTML = `<div class="timeline-cancelled"><span>×</span><div><strong>الطلب ملغي</strong><p>مش هيتم توصيل الطلب، والمخزون رجع للكمية المتاحة.</p></div></div>`;
    return;
  }
  const index = currentStatus(order).index;
  target.innerHTML = STATUS_FLOW.map((item,i)=>{
    const cls = i<index?'done':i===index?'current':'pending';
    const label = i<index?'تمت':i===index?'الحالة الحالية':'في انتظار الخطوة السابقة';
    return `<div class="timeline-step ${cls}"><div class="timeline-marker">${i<index?'✓':i+1}</div><div class="timeline-copy"><strong>${item.title}</strong><small>${i===index?item.description:label}</small></div>${i===index?'<span class="timeline-current-tag">دلوقتي</span>':''}</div>`;
  }).join('');
}

function renderOrder(order) {
  state.lastOrder=order;
  const current=currentStatus(order);
  $('trackingResult').classList.remove('hidden');
  $('trackedOrderNumber').textContent=order.orderNo;
  $('trackedStatusBadge').textContent=statusText(order.status);
  $('trackedStatusBadge').className=`tracked-status ${order.status==='CANCELLED'?'cancelled':order.status==='DELIVERED'?'delivered':order.status==='OUT_FOR_DELIVERY'?'out-delivery':''}`;
  $('deliveryStatusIcon').textContent=current.icon;
  $('deliveryStatusTitle').textContent=current.title;
  $('deliveryStatusDescription').textContent=current.description;
  $('trackedSubtotal').textContent=money(order.subtotalMinor);
  $('trackedTax').textContent=money(order.taxMinor);
  $('trackedDelivery').textContent=money(order.deliveryFeeMinor);
  $('trackedTotal').textContent=money(order.totalMinor);
  $('trackingUpdatedAt').textContent=`آخر تحديث: ${dateText(order.updatedAt || order.createdAt)}`;
  renderTimeline(order);
}

async function lookupOrder({silent=false}={}) {
  if(state.loading)return;
  const orderNo=$('orderNumber').value.trim().toUpperCase();
  const token=$('trackingToken').value.trim();
  if(!orderNo || token.length<20){setMessage('اكتب رقم الطلب ورمز المتابعة بشكل صحيح.',true);return;}
  state.lastQuery={orderNo,token};
  state.loading=true;$('trackButton').disabled=true;$('refreshTracking').disabled=true;
  if(!silent)setMessage('بندور على طلبك…');
  try{
    let result;
    if(isAppsScriptApi()) {
      result=await appsScriptJsonp('track',{orderNo,token});
    } else {
      const response=await fetch(`${API_BASE}/api/storefront/order-status`,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',body:JSON.stringify({orderNo,token})});
      result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'مش قادرين نجيب حالة الطلب دلوقتي.');
    }
    if(!result.ok)throw new Error(result.error||'مش قادرين نجيب حالة الطلب دلوقتي.');
    renderOrder(result.order);setMessage('تم تحديث حالة الطلب من بيانات المتجر.');
  }catch(error){
    if(!silent){$('trackingResult').classList.add('hidden');setMessage(error.message||'حصل خطأ أثناء البحث.',true);}
  }finally{state.loading=false;$('trackButton').disabled=false;$('refreshTracking').disabled=false;}
}

$('trackForm').addEventListener('submit',event=>{event.preventDefault();lookupOrder();});
$('refreshTracking').addEventListener('click',()=>lookupOrder());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.lastQuery&&state.lastOrder&& !state.loading)lookupOrder({silent:true});});
window.addEventListener('pageshow',()=>{if(state.lastQuery&&state.lastOrder&&!state.loading)lookupOrder({silent:true});});
state.timer=setInterval(()=>{if(!document.hidden&&state.lastQuery&&state.lastOrder&&!state.loading)lookupOrder({silent:true});},45000);

if(params.get('api')) {
  document.querySelectorAll('a[href="./storefront.html"]').forEach(link => {
    const target = new URL(link.href);
    target.searchParams.set('api', params.get('api'));
    link.href = target.href;
  });
}
if(params.get('order'))$('orderNumber').value=params.get('order').trim().toUpperCase();
if(params.get('token'))$('trackingToken').value=params.get('token');
if(isAppsScriptApi()) {
  appsScriptJsonp('catalog').then(data=>{if(data?.store?.name)$('trackStoreName').textContent=data.store.name;}).catch(()=>{});
} else {
  fetch(`${API_BASE}/api/storefront/catalog`,{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{if(data?.store?.name)$('trackStoreName').textContent=data.store.name;}).catch(()=>{});
}
if($('orderNumber').value && $('trackingToken').value) lookupOrder();
