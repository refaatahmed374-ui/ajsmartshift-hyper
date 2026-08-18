# تقرير أخطاء الكود — AJ Smart Shift Hyper

**الإصدار المفحوص:** v2.38.8 · **التاريخ:** 2026-08-18
**نطاق الفحص:** `core/` · `electron/` · `src/` (17,285 سطر TS/TSX)
**أدوات:** قراءة يدوية كاملة + `tsc` على المشروعين + تحقّق تنفيذي من أخطاء التوقيت.

> ملاحظة: هذا تقرير تشخيصي فقط — **لم يُعدَّل أي سطر كود**. نظام الترخيص لم يُلمس
> (حسب التعليمات الصريحة في `CLAUDE.md`)، لكن مشاكله مُدرَجة للعلم.

---

## أولاً: أخطاء حرجة (تُنتج أرقاماً محاسبية خاطئة)

### 1. «الإيرادات» و«صافي الربح» في شاشة التقارير مغلوطان تماماً
`electron/database/repositories/stats.ts:138`

```ts
revenues:  totals.rin,                 // = SUM(amount_in)
netProfit: totals.rin - totals.rout,
```

لكن الـ migration في `electron/database/index.ts` تُجبر **كل** بند ليس تحت تصنيف «تحصيل»
على أن يكون `amount_out`:

```sql
UPDATE transactions SET amount_out = amount_in, amount_in = 0
  WHERE amount_in > 0 AND (main_category_id IS NULL OR main_category_id NOT IN
        (SELECT id FROM main_categories WHERE name = 'تحصيل'))
```

**النتيجة:** `amount_in` لا يحتوي إلا على التحصيل. فـ«الإيرادات» = التحصيل فقط،
و«صافي الربح» = التحصيل − كل المنصرف ⇒ رقم سالب ضخم بلا معنى. المبيعات الحقيقية
مخزَّنة في `shifts.pos_sales` ولا تدخل هذه المعادلة إطلاقاً.

**المتأثر:** بطاقات KPI في `src/pages/Reports.tsx:339-342` وجدول قائمة الدخل `:353-365`.

---

### 2. الذمم المدينة (الآجل) لا تنقص أبداً عند التحصيل
`electron/database/repositories/stats.ts:144`

```ts
receivables: credRow.out - credRow.inn,   // sub_categories.name = 'مبيعات آجل'
```

التحصيل يُسجَّل تحت رئيسي «تحصيل» ← فرعي «تحصيل مبيعات آجلة»، **لا** تحت «مبيعات آجل».
فـ`credRow.inn` يساوي صفراً دائماً، والذمم المدينة تتراكم بلا نهاية مهما حصّل العميل.

---

### 3. قيود كشف حساب العملاء تتحوّل إلى أيتام (ديون وهمية دائمة)
`electron/database/repositories/transactions.ts:113-160` مقابل `:196`

`addTransaction` تُنشئ قيداً في `party_ledger` عند وجود `customerId`
(بيع آجل ⇒ مدين، تحصيل ⇒ دائن). لكن:

- `deleteTransaction` (سطر 196) تحذف البند فقط — **ولا تحذف قيد الكشف**.
- `updateTransaction` (سطر 170) تعدّل المبلغ/العميل — **ولا تحدّث الكشف**.
- `deleteShift` (`shifts.ts:326`) تحذف كل بنود الشيفت — **ولا تحذف قيود الكشف**.

والسبب البنيوي: جدول `party_ledger` **لا يحتوي أصلاً على عمود `transaction_id`**
(انظر `parties.ts:110`)، فلا توجد أي وسيلة للربط أو للحذف المتتالي.

**النتيجة:** حذف/تعديل أي فاتورة آجلة يترك ديناً وهمياً على العميل إلى الأبد،
ورصيد العميل في `getParties` يظل خاطئاً.

---

### 4. آخر يوم في كل شهر يسقط من لوحة المعلومات (خطأ منطقة زمنية) ✅ مُتحقَّق منه
`src/pages/Dashboard.tsx:59`

```ts
toExclusive = new Date(filterYear, filterMonth, 1).toISOString().slice(0, 10)
```

`new Date(y, m, 1)` يبني منتصف ليل **محلي**، و`toISOString()` يحوّله لـ UTC.
في مصر (UTC+2/+3) هذا يرجع لليوم السابق.

تحقّق فعلي بـ `TZ=Africa/Cairo`:

| المطلوب | الناتج الفعلي |
|---|---|
| `2026-09-01` | **`2026-08-31`** |

وبما أن `toExclusive` حصري ⇒ **كل شيفتات يوم 31 أغسطس محذوفة من لوحة المعلومات.**
يتكرر هذا مع كل شهر.

---

### 5. تاريخ نهاية الفترة في التقفيل الشهري ناقص يوم كامل ✅ مُتحقَّق منه
`src/pages/Reports.tsx:1336`

```ts
const periodEnd = (() => { const d = new Date(`${month}-01T00:00:00`)
  d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10) })()
```

تحقّق فعلي بـ `TZ=Africa/Cairo` لشهر 2026-08: الناتج **`2026-08-30`** بدل `2026-08-31`.

---

### 6. `todayISO()` يرجع تاريخ الأمس في الشيفتات الليلية ✅ مُتحقَّق منه
`src/lib/format.ts:23`

```ts
return new Date().toISOString().slice(0, 10)   // UTC وليس محلي
```

تحقّق فعلي: الساعة 01:30 بتوقيت القاهرة يوم 18 أغسطس ⇒ يرجع **`2026-08-17`**.

**الأسوأ:** `nowTime()` (سطر 27) يستخدم `toTimeString()` وهو **محلي**. فشيفت يُفتَح
1:30 صباحاً يُسجَّل بتاريخ الأمس + وقت 01:30 ⇒ `detectShiftType` يصنّفه «بيتوين».

**نقاط الاستخدام المتأثرة:** فتح الشيفت (`Daily.tsx:21`)، الحضور
(`Employees.tsx:97,159`)، كشوف الحسابات (`Parties.tsx:42`)، وفي الـ Main Process:
`transactions.ts:122` (تاريخ قيد كشف الحساب)، `employees.ts:321`،
`treasury.ts:247`، `stats.ts:42`.

---

## ثانياً: أخطاء عالية الأثر

### 7. «عتبة تنبيه العجز/الأوفر» إعداد ميت لا يقرؤه أي كود
مبذور في `electron/database/seed.ts:94` (`alert_threshold = 50000`)، وقابل للتحرير في
`src/pages/Settings.tsx:26-31` — لكن **لا يوجد سطر واحد في المشروع يقرأ هذه القيمة
لاتخاذ قرار**. `closeShift` (`shifts.ts:190`) يُطلق تنبيهاً على **أي** فرق ≠ 0 ولو قرش واحد.

**النتيجة:** شاشة إعدادات تُوهم المستخدم بالتحكم + إغراق شاشة التنبيهات.

---

### 8. تسجيل موظف من بوابة السلف يفبرك حضوراً لم يحدث
`electron/database/repositories/employees.ts:320-330`

`registerFromAdvance` ← `linkAdvancesToEmployee` ← `fillAttendanceForMonth` تملأ
**كل أيام الشهر** بحالة `present` وساعات كاملة، متجاهلة:

- تاريخ تعيين الموظف (`startDate`) — تُملأ أيام قبل التحاقه أصلاً.
- الإجازات الأسبوعية والعطلات.

`INSERT OR IGNORE` يحمي السجلات اليدوية الموجودة فقط، لكنه يفبرك كل يوم غير مسجَّل.
و`dueSalary` يُحسب من `presentDays × dailyWage` ⇒ **راتب مستحق منتفخ**.

---

### 9. الموظف الذي ترك العمل يختفي من كشف الرواتب
`electron/database/repositories/employees.ts:168`

```ts
const emps = getActiveEmployees(db)   // status='active' فقط
```

موظف استقال يوم 20 من الشهر ⇒ حالته `inactive` ⇒ **يسقط كلياً** من كشف رواتب الشهر،
ويضيع مستحقّه عن 20 يوم عمل فعلي.

---

### 10. الاستيراد يصفّر «مبيعات POS» أو «نقدية الكاشير» صامتاً
`electron/services/excelImport/pipeline.ts:279-284`

```ts
if (b.closing.posSales !== undefined || b.closing.cashierRemaining !== undefined)
  updateShiftCloseInputs(db, shift.id, {
    posSales:         Math.round((b.closing.posSales ?? 0) * 100),
    cashierRemaining: Math.round((b.closing.cashierRemaining ?? 0) * 100),
  })
```

الشرط `||` لكن التمرير `?? 0`: لو الشيت فيه «نقدية الكاشير» فقط بلا «إجمالي مبيعات»،
تُكتب `pos_sales = 0` فوق القيمة الصحيحة ⇒ معادلة التقفيل تُظهر عجزاً وهمياً بحجم كل مبيعات الشيفت.

---

### 11. الشيفتات المستوردة تبقى بـ `cashier_collections = 0`
نفس الملف. `updateShiftCloseInputs` (التي تحسب التحصيل والمصروفات من البنود) تُستدعى
**فقط** داخل الشرط أعلاه، و`closeShift` لا تُستدعى للشيفتات المستوردة إطلاقاً.
فإن خلا الشيت من خانتَي التقفيل، يبقى التحصيل صفراً رغم وجود بنود تحصيل فعلية.

---

### 12. رقم الشيفت الشهري يتكرر بعد أي حذف
`electron/database/repositories/shifts.ts:76-81`

```ts
const existing = db.prepare(`SELECT id FROM shifts WHERE date LIKE ?`).all(`${month}%`)
const monthlyNum = calcMonthlyShiftNum(existing)   // = length + 1
```

الشيفتات 1,2,3 موجودة ⇒ حذف #2 ⇒ العدد = 2 ⇒ الشيفت الجديد يأخذ **#3 مكرر**.
ونفس المشكلة في `journal_num` المبني منه: `J-YYYYMMDD-NN`.

---

### 13. لا يوجد أي فحص صلاحيات في الـ Main Process
`electron/database/repositories/permissions.ts:56` تُعرّف `hasPermission(...)` —
وبحث في كل المستودع أثبت أنها **لا تُستدعى ولا مرة واحدة**.

كل الـ 90+ قناة IPC في `electron/main.ts` تُنفَّذ بلا أي تحقّق، بما فيها
`shifts:delete` و`data:wipe` و`monthlyClose:unapprove` و`users:updatePassword`.
الصلاحيات مطبَّقة في الواجهة فقط (`src/store/permissions.ts`) — أي إخفاء أزرار.

في تطبيق محاسبي متعدد المستخدمين هذه ثغرة حقيقية: كاشير يفتح DevTools ويكتب
`window.api.data.wipe('all')`.

---

### 14. فك اعتماد الشيفت يُبقي بيانات الاعتماد القديمة
`electron/database/repositories/shifts.ts:139-142`

فرع `else` (الحالات `open`/`review`) يحدّث `status` فقط ولا يصفّر
`approved_by` / `approved_at`. فشيفت أُعيد فتحه يظل يحمل توقيع من اعتمده.

---

### 15. حارس القفل الشهري مثقوب
`assertMonthUnlocked` مُطبَّق على الشيفتات والبنود، لكن **غير مستدعىً** في:

- `addTreasuryAdjustment` (`treasury.ts:222`)
- `addTreasuryCheckpoint` (`treasury.ts:57`)
- `savePayrollReport` / `deletePayrollReport` (`treasury.ts:231,244`)

فالشهر «المُجمَّد» يظل قابلاً للتعديل عبر تسويات الخزينة والرواتب.

---

## ثالثاً: أخطاء متوسطة

### 16. النسخ الاحتياطية `before-restore-*` تتراكم بلا سقف
`electron/database/repositories/backups.ts:74` تُنشئ `before-restore-<stamp>.db.gz`،
لكن تصنيف النوع في `listBackups()` (سطر 40) يعتمد على البادئات
`auto-` / `exit-` / `import-` فقط ⇒ أي اسم آخر يُصنَّف `manual`.
و`pruneBackups` (سطر 128) تستثني `manual` دائماً ⇒ **نمو غير محدود** في مساحة القرص.

### 17. «إعادة الضبط الكاملة» لا تمسح نقاط ارتكاز الخزينة
`electron/database/index.ts:794` — `treasury_checkpoints` غير موجود في
`BUSINESS_TABLES` ولا `IDENTITY_TABLES`. بعد محو كل البيانات تبقى نقاط الارتكاز
القديمة، فيُحسب رصيد صندوق موروث من بيانات ممحوّة.

### 18. `backup:restore` يستخدم `db` بعد إغلاقه
`electron/main.ts:293-297` — `closeDb()` ثم `restoreBackup(db, ...)`
التي تقرأ `db.name` عبر `srcDbPath()`. يعمل حالياً بالصدفة لأن better-sqlite3 يُبقي
`.name` بعد الإغلاق، لكنه اعتماد هشّ على تفصيلة تنفيذ.

### 19. استخدام `alert()` الأصلي — مخالفة صريحة لـ CLAUDE.md
`src/pages/Reports.tsx:683`

```ts
if (!res.ok) { alert(res.reason ?? 'تعذّر الحذف'); setDeleteShift(null); return }
```

`CLAUDE.md` ينصّ حرفياً: «لا تستخدم `confirm()`/`alert()` الأصلية أبداً» لأنها تعطّل
تركيز نافذة Electron وتُجمّد أول `<input type="date">` بعدها — وشاشة التقارير مليئة بها.

### 20. حذف شيفت في شهر مُقفَل يفشل بصمت تام
`src/pages/Reports.tsx:686` — `catch (e) { console.error(e) }` فقط.
الخطأ الذي يرميه `assertMonthUnlocked` (وهو رسالة مفيدة جداً للمستخدم) لا يظهر إطلاقاً.

### 21. عتبة التنبيه تُحفظ كـ `NaN` عند الإدخال الفارغ
`src/pages/Settings.tsx:30` — `Math.round(parseFloat('') * 100)` ⇒ `NaN` ⇒ يُخزَّن
النص `"NaN"` ⇒ القراءة في سطر 27 ترجع `NaN` أيضاً.

---

## رابعاً: نظام الترخيص (للعلم فقط — لم يُلمس)

| # | الموضع | المشكلة |
|---|---|---|
| 22 | `license.ts:132` | حذف `aj.lic` يُعيد الفترة التجريبية 35 يوماً **بلا حد** — `readLicense` تكتب ملفاً جديداً بـ `trialStart = now` عند غياب/تلف الملف |
| 23 | `license.ts:141` | الملف **JSON عادي غير موقَّع** — تعديل `subExists:true, subActive:true, subExpire:null` يمنح ترخيصاً دائماً |
| 24 | `license.ts:73` | `deviceId` من `hostname` ⇒ تغيير اسم الجهاز يُبطل الترخيص؛ وجهازان بنفس الاسم/المواصفات يتشاركانه |
| 25 | `license.ts:311` | `activateLicense` لا تضبط `transitionStart` ⇒ الفترة الانتقالية (30 يوم) لا تنتهي أبداً أوفلاين |
| 26 | `license.ts:237` | `f.expireDate?.timestampValue ?? (f.expireDate?.nullValue !== undefined ? null : null)` — الشرط الثلاثي يرجع `null` في الحالتين (تعبير ميت)؛ ومستند بلا `expireDate` ⇒ ترخيص دائم |

---

## خامساً: صحة الكود والصيانة

### 27. `tsconfig.web.json` لا يمرّ من `tsc` — 20 خطأ نوع
تشغيل `tsc -p tsconfig.web.json` يفشل. الجذر: كل دوال `electron/preload.ts` ترجع
`ipcRenderer.invoke(...)` أي `Promise<any>`، فـ`call<T>` في `src/lib/api.ts` تستنتج
`unknown`/`{}` ⇒ **طبقة الـ IPC بأكملها بلا أي أمان أنواع**.

أمثلة: `src/store/shift.ts:45-118` (11 خطأ) · `src/pages/Categories.tsx:53-54`.

البناء يمرّ لأن `electron-vite` يستخدم esbuild الذي لا يفحص الأنواع إطلاقاً.

### 28. `src/` يستورد من `electron/` — مخالفة لقاعدة `core/`
أخطاء `TS6307`:
- `src/lib/api.ts:2` ← `electron/preload.ts`
- `src/pages/ImportExcel.tsx:8` ← `electron/services/excelImport/pipeline.ts`

`CLAUDE.md` ينصّ أن `core/` وحده هو المشترك بين الجانبين.

### 29. `updateFawry` تبني أسماء أعمدة SQL من مفاتيح كائن قادم عبر IPC
`electron/database/repositories/shifts.ts:264-270`

```ts
const fields = Object.keys(data).map(k => `${k.replace(/([A-Z])/g,'_$1').toLowerCase()} = ?`).join(', ')
db.prepare(`UPDATE shift_fawry SET ${fields} WHERE shift_id=?`).run(...values, shiftId)
```

بلا قائمة سماح. مسطح حقن SQL، إضافة إلى أن كائناً فارغاً `{}` يُنتج
`UPDATE shift_fawry SET  WHERE shift_id=?` ⇒ خطأ صياغة.
*(غير مستغَل حالياً — الواجهة تمرّر مفتاحاً واحداً معروفاً دائماً، لكنه سطح مكشوف.)*

### 30. `getShifts`: `OFFSET` بلا `LIMIT` ⇒ خطأ صياغة SQL
`shifts.ts:118-119` — SQLite لا يقبل `OFFSET` منفرداً.
*(غير مستدعى حالياً بـ`offset` من أي شاشة.)*
كما أن `if (opts.limit)` يتجاهل `limit = 0`.

### 31. كود ميت
- `getOverview` (`stats.ts:41-120`، 85 سطراً) — غير مربوطة بأي قناة IPC.
- شارة الإشعارات: `Sidebar.tsx:160` تقارن `item.id === 'notifications'` وهي قيمة
  **غير موجودة** في نوع `Page` (`App.tsx:30`) ولا في قائمة `NAV` — الشارة لا تظهر أبداً،
  ومع ذلك يُشغَّل `setInterval` كل 30 ثانية (`Sidebar.tsx:65-70`) يستعلم عن عدّاد لا يُعرَض.
  *(`tsc` يرصدها: `TS2367` — "no overlap")*
- `closeShift` تستقبل معاملاً ثالثاً `_cashierRemaining_ignored` غير مستخدم (`shifts.ts:150`).

### 32. لا توجد اختبارات إطلاقاً
`core/engine.ts:3` يقول: «كل دالة هنا ليها unit test مقابلها في `core/engine.test.ts`».
**الملف غير موجود**، ولا يوجد أي إطار اختبار في `package.json`.
معادلة التقفيل — أخطر معادلة في النظام — بلا أي تغطية.

### 33. قاعدة تصحيح إملائي تشير لتصنيف لم يعد موجوداً
`core/normalize.ts:54` — `'خصم عميل' → 'خصومات البيع'`، لكن migration
(`index.ts:498`) أعادت تسمية «خصومات البيع» إلى «خصومات العملاء».
فالاستيراد يصنّف هذه القيمة «مجهول».

### 34. عمليات مركّبة بلا معاملة قاعدة بيانات
- `createShift` (`shifts.ts:82-98`): 4 عمليات إدراج متتابعة (شيفت + يومية + فوري + عهدة).
- `deleteShift` (`shifts.ts:333-339`): 7 عمليات حذف متتابعة.
- `linkAdvancesToEmployee` (`employees.ts:335`): ربط + ملء حضور + حفظ خريطة.

أي فشل في المنتصف يترك بيانات نصف مكتملة.

### 35. مشاكل أداء
- `getParties` (`parties.ts:38`): استعلام `partyBalance` منفصل لكل طرف (N+1).
- `Dashboard.tsx:69`: `api.shifts.getAll({})` بلا حد ⇒ تحميل كل شيفتات التاريخ ثم كل بنودها.
- `createBackup` (`backups.ts:63`): اسم الملف بدقة الثانية ⇒ نسختان في نفس الثانية تتصادمان.

### 36. هشاشة في نظام الـ Migrations
`index.ts:703-706` — `user_version` يساوي **عدد** عناصر `MIGRATIONS`.
إدراج أي migration في **منتصف** المصفوفة (لا في نهايتها) يُزيح كل الفهارس اللاحقة
ويُطبّق migrations خاطئة على قواعد بيانات العملاء. القاعدة الضمنية (الإضافة في النهاية فقط)
غير موثّقة ولا محروسة.

---

## ملخّص العدّ

| الفئة | العدد |
|---|---|
| حرج (أرقام محاسبية خاطئة) | 6 |
| عالي الأثر | 9 |
| متوسط | 6 |
| نظام الترخيص | 5 |
| صحة كود / صيانة | 10 |
| **الإجمالي** | **36** |

## الأولويات المقترحة للإصلاح

1. **البند 4، 5، 6** — أخطاء التوقيت. إصلاح واحد مركزي (دالة `localISO()` تستبدل
   `toISOString().slice(0,10)`) يحلّ الثلاثة معاً. أقل مجهود وأعلى عائد.
2. **البند 1، 2** — معادلات `getFinancials`. الأرقام المعروضة للعميل خاطئة الآن.
3. **البند 3** — ربط `party_ledger` بـ `transaction_id` (يحتاج migration) ثم الحذف المتتالي.
4. **البند 10، 11** — تصفير بيانات التقفيل عند الاستيراد.
5. **البند 13** — تفعيل `hasPermission` في الـ Main Process.
