# AJ SmartShift Hyper

نظام إدارة سوبر ماركت متكامل — تطبيق سطح مكتب (Electron + React + Vite + TypeScript + better-sqlite3).

> مستودع **خاص**. يحتوي كود التحقق من الترخيص (SECRET) — لا يُحوَّل إلى public أبداً.

## التطوير المحلي
```bash
npm install
npm run dev          # تشغيل التطبيق (Electron + Vite)
npm run build:app    # بناء الواجهة والـ main
```

## البناء والنشر (CI سحابي)
النشر آليّ عبر **GitHub Actions** على خادم `windows-latest`:

1. حدّث `version` في `package.json` (مثلاً `2.31.3`).
2. اعمل commit وادفعه.
3. أنشئ وسماً بنفس الرقم وادفعه:
   ```bash
   git tag v2.31.3
   git push origin v2.31.3
   ```
4. تبدأ Actions تلقائياً: `npm ci` → بناء → تغليف → **رفع الإصدار `v2.31.3-hyper` إلى مستودع الإصدارات العام** ووسمه Latest → يصل التحديث التلقائي للعملاء.

يمكن أيضاً التشغيل يدوياً من تبويب **Actions → Build & Release Hyper → Run workflow**.

## ⚙️ المتطلب الوحيد قبل أول نشر: سرّ CI
أضف في **Settings → Secrets and variables → Actions → New repository secret**:

| الاسم | القيمة |
|---|---|
| `RELEASES_TOKEN` | PAT (توكن) بصلاحية **`repo`** يملك صلاحية الكتابة على `refaatahmed374-ui/ajsmartshift-releases` (المستودع العام للإصدارات). |

> السبب: `GITHUB_TOKEN` المدمج مقصور على هذا المستودع الخاص فقط، بينما الإصدارات تُنشر في مستودع عام منفصل.

## 🔒 ملاحظات أمنية
- **مولّد المفاتيح** (`tools/`) مُستبعَد عبر `.gitignore` — يبقى محلياً فقط. احتفظ بنسخة آمنة منه خارج المستودع.
- الـSECRET مدمج في `electron/database/repositories/license.ts` (يُشحن مبهماً مع التطبيق) — لهذا يبقى المستودع **خاصاً**.
- كل الأسرار في **GitHub Secrets** فقط، لا في الكود.

## البنية
```
core/        منطق مشترك (types + engine)
electron/    عملية Electron الرئيسية + قاعدة SQLite + repositories
src/         واجهة React
resources/   الأيقونات
.github/      workflows البناء والنشر
```
