/**
 * MarketOS Online Store API
 * Bound/standalone Apps Script backend for the demo spreadsheet.
 *
 * Public reads use JSONP because the storefront is hosted on GitHub Pages.
 * Public writes use a regular form POST (no CORS response is read). The UI
 * then polls for the result using the per-order random tracking token.
 *
 * Never return customer names, phone numbers, addresses, notes, or line
 * items from a JSONP endpoint. The tracking token is a bearer capability.
 */
const MARKETOS_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1OMxARM53wATkx2iCbJyBCRSLRVheGW1d',
  SHEETS: {
    PRODUCTS: 'Products',
    INVENTORY: 'Inventory',
    ORDERS: 'Orders',
    ORDER_ITEMS: 'OrderItems',
    BRANCHES: 'Branches',
    SETTINGS: 'Settings'
  },
  MAX_ITEMS_PER_ORDER: 40,
  MAX_QTY_PER_LINE: 1000,
  RATE_LIMIT_WINDOW_SECONDS: 600,
  RATE_LIMIT_MAX_ORDERS_PER_PHONE: 8
});

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || 'health');
  const callback = String(params.callback || '');
  try {
    let result;
    if (action === 'catalog') {
      result = getPublicCatalog_();
    } else if (action === 'orderResult') {
      result = getOrderResult_(String(params.token || ''));
    } else if (action === 'track') {
      result = getPublicOrderStatus_(String(params.orderNo || ''), String(params.token || ''));
    } else if (action === 'health') {
      result = { ok: true, service: 'MarketOS Google Apps Script API', status: 'online' };
    } else {
      result = { ok: false, error: 'الطلب غير معروف.' };
    }
    return jsonOutput_(result, callback);
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: safeErrorMessage_(error)
    }, callback);
  }
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || '');
  let payload = {};
  let token = '';
  try {
    if (action !== 'submitOrder') throw new Error('نوع العملية غير مسموح.');
    if (!params.payload) throw new Error('بيانات الطلب غير مكتملة.');
    payload = JSON.parse(String(params.payload));
    token = String(payload.idempotencyKey || payload.trackingToken || '');
    const order = createPublicOrder_(payload);
    if (token) PropertiesService.getScriptProperties().deleteProperty('mos_error_' + token);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, order: order }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    const message = safeErrorMessage_(error);
    if (token && /^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      PropertiesService.getScriptProperties().setProperty(
        'mos_error_' + token,
        JSON.stringify({ ok: false, error: message, savedAt: Date.now() })
      );
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setupMarketOS() {
  const ss = spreadsheet_();
  Object.keys(MARKETOS_CONFIG.SHEETS).forEach(function (key) {
    const name = MARKETOS_CONFIG.SHEETS[key];
    if (!ss.getSheetByName(name)) throw new Error('التبويب المطلوب غير موجود: ' + name);
  });
  ensureColumn_(ss.getSheetByName(MARKETOS_CONFIG.SHEETS.ORDERS), 'tracking_token');
  ensureColumn_(ss.getSheetByName(MARKETOS_CONFIG.SHEETS.ORDERS), 'payload_hash');
  return 'MarketOS: تم التحقق من التبويبات وإعداد أعمدة تتبّع الطلب.';
}

function getPublicCatalog_() {
  const ss = spreadsheet_();
  const settings = readSettings_(ss);
  const branchId = String(settings.storefront_branch_id || 'MAIN');
  const productsSheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.PRODUCTS);
  const inventorySheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.INVENTORY);
  const productsTable = readTable_(productsSheet);
  const inventoryTable = readTable_(inventorySheet);
  const inventoryIndex = {};

  inventoryTable.rows.forEach(function (row) {
    const sku = text_(row.branch_id) + '|' + text_(row.sku);
    if (text_(row.branch_id) === branchId) inventoryIndex[sku] = row;
  });

  const products = productsTable.rows
    .filter(function (row) { return isTrue_(row.active) && text_(row.sku); })
    .map(function (row) {
      const sku = text_(row.sku);
      const tracked = isTrue_(row.track_inventory);
      const stockRow = inventoryIndex[branchId + '|' + sku];
      const available = stockRow ? number_(stockRow.quantity_on_hand) : 0;
      const reorderLevel = stockRow ? number_(stockRow.reorder_level) : number_(settings.default_reorder_level || 5);
      const priceMinor = Math.max(0, Math.round(number_(row.price_egp) * 100));
      const taxRateBp = Math.max(0, Math.round(number_(row.tax_rate_percent) * 100));
      const taxMinor = Math.round(priceMinor * taxRateBp / 10000);
      return {
        id: sku,
        sku: sku,
        name: text_(row.name_ar) || text_(row.name_en) || sku,
        name_en: text_(row.name_en),
        category: text_(row.category),
        unit: text_(row.unit) || 'قطعة',
        price_minor: priceMinor,
        tax_rate_bp: taxRateBp,
        price_with_tax_minor: priceMinor + taxMinor,
        track_inventory: tracked,
        stock_status: !tracked ? 'IN_STOCK' : available <= 0 ? 'OUT_OF_STOCK' : available <= reorderLevel ? 'LOW_STOCK' : 'IN_STOCK',
        image_url: safeImageUrl_(row.image_url),
        description: text_(row.description_ar)
      };
    });

  const storeOpen = settings.store_open === undefined || settings.store_open === ''
    ? true : isTrue_(settings.store_open);
  return {
    ok: true,
    store: {
      name: text_(settings.store_name_ar) || 'متجر البقالة',
      tagline: text_(settings.store_tagline_ar) || 'اختار احتياجاتك، وإحنا نوصلهالك',
      currency: text_(settings.currency) || 'EGP',
      phone: text_(settings.support_phone),
      deliveryFeeMinor: Math.max(0, Math.round(number_(settings.delivery_fee_egp) * 100)),
      isOpen: storeOpen,
      ordersEnabled: isTrue_(settings.orders_enabled),
      branchId: branchId
    },
    products: products
  };
}

function createPublicOrder_(payload) {
  const clean = normalizeOrderPayload_(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('فيه طلب آخر بيتسجل حاليًا. جرّب مرة أخرى بعد لحظات.');
  let changedStock = [];
  let appendedRows = [];
  try {
    const ss = spreadsheet_();
    const settings = readSettings_(ss);
    if (!isTrue_(settings.orders_enabled)) {
      throw new Error('استقبال الطلبات مقفول حاليًا لحين إكمال اختبار المتجر.');
    }
    const ordersSheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.ORDERS);
    const itemsSheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.ORDER_ITEMS);
    const productsSheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.PRODUCTS);
    const inventorySheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.INVENTORY);
    ensureColumn_(ordersSheet, 'tracking_token');
    ensureColumn_(ordersSheet, 'payload_hash');

    const hash = payloadHash_(clean);
    const orders = readTable_(ordersSheet);
    const previous = orders.rows.find(function (row) {
      return text_(row.idempotency_key) === clean.idempotencyKey;
    });
    if (previous) {
      if (text_(previous.payload_hash) && text_(previous.payload_hash) !== hash) {
        throw new Error('مفتاح الطلب مستخدم بالفعل مع بيانات مختلفة. حدّث الصفحة ثم حاول مرة أخرى.');
      }
      return publicOrderSummary_(previous);
    }

    enforcePhoneRateLimit_(orders.rows, clean.customerPhone);

    const productTable = readTable_(productsSheet);
    const productIndex = {};
    productTable.rows.forEach(function (row) { productIndex[text_(row.sku)] = row; });

    const branchId = text_(settings.storefront_branch_id) || 'MAIN';
    const inventoryTable = readTable_(inventorySheet);
    const inventoryIndex = {};
    inventoryTable.rows.forEach(function (row, index) {
      if (text_(row.branch_id) === branchId) {
        inventoryIndex[text_(row.sku)] = { row: index + 2, data: row };
      }
    });

    const preparedItems = [];
    let subtotalMinor = 0;
    let taxMinor = 0;
    clean.items.forEach(function (item) {
      const product = productIndex[item.productId];
      if (!product || !isTrue_(product.active)) throw new Error('أحد المنتجات لم يعد متاحًا. حدّث قائمة المنتجات وحاول مرة أخرى.');
      const unitPriceMinor = Math.max(0, Math.round(number_(product.price_egp) * 100));
      const taxRateBp = Math.max(0, Math.round(number_(product.tax_rate_percent) * 100));
      const lineSubtotalMinor = Math.round(unitPriceMinor * item.qty);
      const lineTaxMinor = Math.round(lineSubtotalMinor * taxRateBp / 10000);
      const tracked = isTrue_(product.track_inventory);
      const stockEntry = inventoryIndex[item.productId];
      let stockBefore = null;
      if (tracked) {
        if (!stockEntry) throw new Error('المخزون غير مسجل للصنف ' + text_(product.name_ar) + '.');
        stockBefore = number_(stockEntry.data.quantity_on_hand);
        if (stockBefore < item.qty) {
          throw new Error('الكمية المتاحة من ' + text_(product.name_ar) + ' لم تعد كافية. حدّث السلة وحاول مرة أخرى.');
        }
      }
      preparedItems.push({
        sku: item.productId,
        product: product,
        qty: item.qty,
        unitPriceMinor: unitPriceMinor,
        taxRatePercent: taxRateBp / 100,
        lineSubtotalMinor: lineSubtotalMinor,
        lineTaxMinor: lineTaxMinor,
        lineTotalMinor: lineSubtotalMinor + lineTaxMinor,
        stockEntry: tracked ? stockEntry : null,
        stockBefore: stockBefore
      });
      subtotalMinor += lineSubtotalMinor;
      taxMinor += lineTaxMinor;
    });

    const deliveryMinor = Math.max(0, Math.round(number_(settings.delivery_fee_egp) * 100));
    const totalMinor = subtotalMinor + taxMinor + deliveryMinor;
    const orderNumber = newOrderNumber_(orders.rows);
    const now = new Date();
    const orderId = 'ORD-' + Utilities.getUuid().replace(/-/g, '').substring(0, 20).toUpperCase();
    const orderRecord = {
      order_id: orderId,
      order_number: orderNumber,
      created_at: now,
      updated_at: now,
      customer_name: clean.customerName,
      customer_phone: clean.customerPhone,
      delivery_address: clean.deliveryAddress,
      customer_notes: clean.customerNotes,
      branch_id: branchId,
      subtotal_egp: subtotalMinor / 100,
      tax_egp: taxMinor / 100,
      delivery_fee_egp: deliveryMinor / 100,
      total_egp: totalMinor / 100,
      payment_method: 'CASH_ON_DELIVERY',
      payment_status: 'UNPAID',
      status: 'NEW',
      idempotency_key: clean.idempotencyKey,
      source: 'WEB',
      tracking_token: clean.trackingToken,
      payload_hash: hash
    };

    // Write stock first while holding the script lock; retain exact previous
    // values so a later write failure can roll back this order.
    preparedItems.forEach(function (item) {
      if (!item.stockEntry) return;
      const newQty = item.stockBefore - item.qty;
      inventorySheet.getRange(item.stockEntry.row, inventoryTable.headers.indexOf('quantity_on_hand') + 1).setValue(newQty);
      inventorySheet.getRange(item.stockEntry.row, inventoryTable.headers.indexOf('updated_at') + 1).setValue(now);
      changedStock.push({ row: item.stockEntry.row, oldQty: item.stockBefore, oldUpdatedAt: item.stockEntry.data.updated_at });
    });

    appendObjectRow_(ordersSheet, orderRecord);
    appendedRows.push({ sheet: ordersSheet, row: ordersSheet.getLastRow(), width: ordersSheet.getLastColumn() });
    preparedItems.forEach(function (item) {
      const record = {
        order_item_id: 'ITM-' + Utilities.getUuid().replace(/-/g, '').substring(0, 18).toUpperCase(),
        order_id: orderId,
        sku: item.sku,
        product_name_ar_snapshot: text_(item.product.name_ar) || text_(item.product.name_en) || item.sku,
        unit_snapshot: text_(item.product.unit) || 'قطعة',
        quantity: item.qty,
        unit_price_egp: item.unitPriceMinor / 100,
        tax_rate_percent: item.taxRatePercent,
        line_subtotal_egp: item.lineSubtotalMinor / 100,
        line_tax_egp: item.lineTaxMinor / 100,
        line_total_egp: item.lineTotalMinor / 100
      };
      appendObjectRow_(itemsSheet, record);
      appendedRows.push({ sheet: itemsSheet, row: itemsSheet.getLastRow(), width: itemsSheet.getLastColumn() });
    });
    SpreadsheetApp.flush();
    return {
      order_no: orderNumber,
      total_minor: totalMinor,
      subtotal_minor: subtotalMinor,
      tax_minor: taxMinor,
      delivery_fee_minor: deliveryMinor,
      status: 'NEW',
      tracking_token: clean.trackingToken
    };
  } catch (error) {
    appendedRows.reverse().forEach(function (entry) {
      try { entry.sheet.getRange(entry.row, 1, 1, entry.width).clearContent(); } catch (_) {}
    });
    changedStock.reverse().forEach(function (entry) {
      try {
        const inventorySheet = spreadsheet_().getSheetByName(MARKETOS_CONFIG.SHEETS.INVENTORY);
        const headers = readHeaders_(inventorySheet);
        inventorySheet.getRange(entry.row, headers.indexOf('quantity_on_hand') + 1).setValue(entry.oldQty);
        const updatedAtIndex = headers.indexOf('updated_at');
        if (updatedAtIndex >= 0) inventorySheet.getRange(entry.row, updatedAtIndex + 1).setValue(entry.oldUpdatedAt);
      } catch (_) {}
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getOrderResult_(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, error: 'رمز التحقق غير صحيح.' };
  const props = PropertiesService.getScriptProperties();
  const errorJson = props.getProperty('mos_error_' + token);
  if (errorJson) {
    props.deleteProperty('mos_error_' + token);
    try { return JSON.parse(errorJson); } catch (_) {}
  }
  const ss = spreadsheet_();
  const sheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.ORDERS);
  ensureColumn_(sheet, 'tracking_token');
  ensureColumn_(sheet, 'payload_hash');
  const table = readTable_(sheet);
  const row = table.rows.find(function (item) {
    return text_(item.tracking_token) === token;
  });
  if (!row) return { ok: false, pending: true, error: '' };
  return { ok: true, order: publicOrderSummary_(row) };
}

function getPublicOrderStatus_(orderNo, token) {
  if (!orderNo || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return { ok: false, error: 'رقم الطلب أو رمز المتابعة غير صحيح.' };
  }
  const ss = spreadsheet_();
  const sheet = requireSheet_(ss, MARKETOS_CONFIG.SHEETS.ORDERS);
  ensureColumn_(sheet, 'tracking_token');
  ensureColumn_(sheet, 'payload_hash');
  const table = readTable_(sheet);
  const row = table.rows.find(function (item) {
    return text_(item.order_number) === orderNo && text_(item.tracking_token) === token;
  });
  if (!row) return { ok: false, error: 'مش قادرين نلاقي الطلب بالبيانات دي.' };
  return {
    ok: true,
    order: {
      orderNo: text_(row.order_number),
      status: validStatus_(row.status),
      subtotalMinor: Math.round(number_(row.subtotal_egp) * 100),
      taxMinor: Math.round(number_(row.tax_egp) * 100),
      deliveryFeeMinor: Math.round(number_(row.delivery_fee_egp) * 100),
      totalMinor: Math.round(number_(row.total_egp) * 100),
      createdAt: isoDate_(row.created_at),
      updatedAt: isoDate_(row.updated_at)
    }
  };
}

function normalizeOrderPayload_(input) {
  const payload = input || {};
  const idempotencyKey = String(payload.idempotencyKey || '');
  const trackingToken = String(payload.trackingToken || idempotencyKey);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(idempotencyKey) || !/^[A-Za-z0-9_-]{20,100}$/.test(trackingToken)) {
    throw new Error('مفتاح الطلب غير صحيح. حدّث الصفحة وحاول مرة أخرى.');
  }
  const customerName = limitedText_(payload.customerName, 100);
  const customerPhone = limitedText_(payload.customerPhone, 30);
  const deliveryAddress = limitedText_(payload.deliveryAddress, 400);
  const customerNotes = limitedText_(payload.customerNotes, 500);
  if (customerName.length < 2) throw new Error('اكتب اسم العميل بشكل صحيح.');
  if (customerPhone.replace(/\D/g, '').length < 8) throw new Error('اكتب رقم موبايل صحيح.');
  if (deliveryAddress.length < 8) throw new Error('اكتب عنوان التوصيل بالتفصيل.');
  if (String(payload.website || '').trim()) throw new Error('تعذر التحقق من الطلب.');
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > MARKETOS_CONFIG.MAX_ITEMS_PER_ORDER) {
    throw new Error('عدد أصناف الطلب غير مسموح.');
  }
  const items = payload.items.map(function (item) {
    const productId = limitedText_(item && item.productId, 80);
    const qty = Number(item && item.qty);
    if (!productId || !Number.isFinite(qty) || qty <= 0 || qty > MARKETOS_CONFIG.MAX_QTY_PER_LINE || Math.round(qty * 1000) !== qty * 1000) {
      throw new Error('راجع كميات المنتجات في السلة.');
    }
    return { productId: productId, qty: qty };
  });
  const seen = {};
  items.forEach(function (item) {
    if (seen[item.productId]) throw new Error('الصنف مكرر داخل الطلب. حدّث السلة وحاول مرة أخرى.');
    seen[item.productId] = true;
  });
  return {
    idempotencyKey: idempotencyKey,
    trackingToken: trackingToken,
    customerName: customerName,
    customerPhone: customerPhone,
    deliveryAddress: deliveryAddress,
    customerNotes: customerNotes,
    items: items
  };
}

function enforcePhoneRateLimit_(orders, phone) {
  const digits = String(phone).replace(/\D/g, '');
  const now = Date.now();
  const count = orders.filter(function (row) {
    if (String(row.customer_phone || '').replace(/\D/g, '') !== digits) return false;
    const created = new Date(row.created_at).getTime();
    return Number.isFinite(created) && now - created >= 0 && now - created < MARKETOS_CONFIG.RATE_LIMIT_WINDOW_SECONDS * 1000;
  }).length;
  if (count >= MARKETOS_CONFIG.RATE_LIMIT_MAX_ORDERS_PER_PHONE) {
    throw new Error('تم تسجيل طلبات كثيرة من نفس الرقم خلال فترة قصيرة. حاول لاحقًا.');
  }
}

function publicOrderSummary_(row) {
  return {
    order_no: text_(row.order_number),
    total_minor: Math.round(number_(row.total_egp) * 100),
    subtotal_minor: Math.round(number_(row.subtotal_egp) * 100),
    tax_minor: Math.round(number_(row.tax_egp) * 100),
    delivery_fee_minor: Math.round(number_(row.delivery_fee_egp) * 100),
    status: validStatus_(row.status),
    tracking_token: text_(row.tracking_token)
  };
}

function newOrderNumber_(existingRows) {
  const datePart = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Africa/Cairo', 'yyyyMMdd');
  let candidate;
  let attempts = 0;
  do {
    candidate = 'WEB-' + datePart + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 7).toUpperCase();
    attempts += 1;
    if (attempts > 5) throw new Error('تعذر إنشاء رقم طلب فريد. حاول مرة أخرى.');
  } while (existingRows.some(function (row) { return text_(row.order_number) === candidate; }));
  return candidate;
}

function payloadHash_(payload) {
  const canonical = JSON.stringify({
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    deliveryAddress: payload.deliveryAddress,
    customerNotes: payload.customerNotes,
    items: payload.items
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function jsonOutput_(value, callback) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  if (callback) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(callback)) {
      return ContentService.createTextOutput('/* invalid callback */').setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function spreadsheet_() {
  return SpreadsheetApp.openById(MARKETOS_CONFIG.SPREADSHEET_ID);
}

function readSettings_(ss) {
  const table = readTable_(requireSheet_(ss, MARKETOS_CONFIG.SHEETS.SETTINGS));
  const settings = {};
  table.rows.forEach(function (row) {
    const key = text_(row.setting_key);
    if (key) settings[key] = row.setting_value;
  });
  return settings;
}

function readTable_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (!lastRow || !lastColumn) return { headers: [], rows: [] };
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function (item) { return String(item || '').trim(); });
  const rows = values.slice(1).map(function (line) {
    const item = {};
    headers.forEach(function (header, index) { if (header) item[header] = line[index]; });
    return item;
  }).filter(function (item) {
    return Object.keys(item).some(function (key) { return item[key] !== '' && item[key] !== null; });
  });
  return { headers: headers, rows: rows };
}

function readHeaders_(sheet) {
  if (sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (value) { return String(value || '').trim(); });
}

function ensureColumn_(sheet, columnName) {
  const headers = readHeaders_(sheet);
  if (headers.indexOf(columnName) >= 0) return;
  const column = Math.max(1, sheet.getLastColumn() + 1);
  sheet.getRange(1, column).setValue(columnName);
}

function appendObjectRow_(sheet, record) {
  const headers = readHeaders_(sheet);
  const missing = Object.keys(record).filter(function (key) { return headers.indexOf(key) < 0; });
  if (missing.length) throw new Error('هيدرز ناقصة في ' + sheet.getName() + ': ' + missing.join(', '));
  const row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
  });
  sheet.appendRow(row);
}

function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('التبويب المطلوب غير موجود: ' + name);
  return sheet;
}

function isTrue_(value) {
  if (value === true || value === 1) return true;
  return ['true', 'yes', '1', 'نعم'].indexOf(String(value == null ? '' : value).trim().toLowerCase()) >= 0;
}

function number_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function text_(value) {
  return value == null ? '' : String(value).trim();
}

function limitedText_(value, maxLength) {
  return text_(value).substring(0, maxLength);
}

function safeImageUrl_(value) {
  const url = text_(value);
  return /^https:\/\/[A-Za-z0-9.-]+\//.test(url) ? url : '';
}

function safeErrorMessage_(error) {
  const message = String(error && error.message ? error.message : error || 'حصل خطأ غير متوقع.');
  return message.substring(0, 350);
}

function validStatus_(value) {
  const allowed = ['NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
  const status = text_(value).toUpperCase();
  return allowed.indexOf(status) >= 0 ? status : 'NEW';
}

function isoDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
