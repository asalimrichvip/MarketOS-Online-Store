# إعداد Google Apps Script

1. افتح ملف Google Sheets.
2. قبل تخزين أي بيانات عملاء، افتح **مشاركة → الوصول العام → مقيّد (Restricted)**.
3. من ملف الشيت اختر **Extensions → Apps Script**.
4. استبدل محتوى `Code.gs` بملف [Code.gs الموجود في المستودع](https://github.com/asalimrichvip/MarketOS-Online-Store/blob/main/apps-script/Code.gs)، ثم احفظ.
5. اختر الدالة `setupMarketOS` واضغط Run، ووافق على صلاحيات Google. هذا يضيف عمودَي `tracking_token` و`payload_hash` إلى Orders إذا لم يكونا موجودين.
6. اختر **Deploy → New deployment → Web app**، واجعل **Execute as: Me** و**Who has access: Anyone**، ثم Deploy وانسخ رابط `/exec`.

لا تجعل الشيت عامًا لتشغيل الـ API. يجب أن يبقى الشيت مقيّدًا؛ السكربت يصل إليه من حسابك. إذا لم يظهر خيار Anyone، لا تغيّر مشاركة الشيت وأخبرني.

أثناء الإعداد اترك `Settings.orders_enabled` = `FALSE`. اختبر الكتالوج أولًا بفتح `YOUR_EXEC_URL?action=catalog`؛ يجب أن يظهر JSON فيه `store` و`products`. أرسل لي رابط `/exec` بعد النشر لأربط الموقع به.

تغيير حالة الطلب يكون في عمود `status` داخل Orders: `NEW`, `CONFIRMED`, `PREPARING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`. تفعيل الطلبات في Settings يُترك للاختبار بعد حماية الشيت والتحقق من قراءة المنتجات.

هذه نسخة عرض أولية. Sheets لا يوفر معاملات قواعد بيانات كاملة؛ سنختبر التزامن واسترجاع المخزون قبل استخدامها لطلبات حقيقية.
