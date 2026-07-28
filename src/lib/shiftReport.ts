// ═══════════════════════════════════════════════════════════
//  v2.34.28 — توليد تقرير اليومية PDF (مشترك) — صفحتان ثابتتان:
//  الصفحة 1: بيانات الشيفت + جدول البنود (مضغوط ليتّسع لصفحة واحدة)
//  الصفحة 2: ملخّص الشيفت الكامل (الصندوق/فوري/طرق الدفع/الإغلاق والعهدة/النتيجة)
//  ملاحظة: هذا هو تقرير الطباعة/PDF فقط — لا علاقة له بالتقرير المعروض على الشاشة داخل البرنامج (Reports.tsx)، وهو غير متأثر إطلاقًا.
// ═══════════════════════════════════════════════════════════
import { api, call } from './api'
import { fmt, fmtDate, shiftTypeLabel } from './format'
import { calcShiftClosing } from '../../core/engine'
import type { Shift, Transaction, ShiftFawry, ShiftCustody } from '../../core/types'
import { APP_VERSION } from '../version'

const PAY_LABELS: Record<string, string> = {
  cashier: 'كاشير', management: 'الصندوق', credit: 'آجل', visa: 'فيزا',
}

export async function generateShiftReportPDF(s: Shift): Promise<void> {
  // جلب البيانات
  const [txs, fawry, custody, settings, fundPos] = await Promise.all([
    call(api.tx.getByShift(s.id))                  as Promise<Transaction[]>,
    call(api.fawry.get(s.id)).catch(() => null)    as Promise<ShiftFawry | null>,
    call(api.custody.get(s.id)).catch(() => null)  as Promise<ShiftCustody | null>,
    call(api.settings.getAll()).catch(() => [])    as Promise<{ key: string; value: string }[]>,
    // إصلاح: كانت "رصيد أول الصندوق" تُقرأ من shift.openingBalance (حقل شبه ميت، يظل 0 دومًا) بدل رصيد
    // الخزينة الفعلي المرحَّل من الشيفتات السابقة — نفس المصدر المستخدَم في شاشة اليومية الحيّة (ShiftSheet)
    call(api.treasury.shiftPosition(s.id)).catch(() => null) as Promise<{ before: number; cashIn: number; mgmtOut: number; after: number } | null>,
  ])
  const getSetting = (k: string) => settings.find(x => x.key === k)?.value ?? ''
  const companyLogo = getSetting('biz.logo')
  const companyName = getSetting('biz.name')

  const totalIn  = txs.reduce((sm, t) => sm + t.amountIn,  0)
  const totalOut = txs.reduce((sm, t) => sm + t.amountOut, 0)
  const collections = txs.filter(t => t.mainCategoryName === 'تحصيل').reduce((sm, t) => sm + t.amountIn, 0)
  const mgmtOut = txs.filter(t => t.payMethod === 'management').reduce((sm, t) => sm + t.amountOut, 0)
  const shiftExpenses = totalOut - mgmtOut
  // ADR-012 v2 — المعادلة الرسمية: (نقدية الكاشير + مصروفات الكاشير + التحصيل) − مبيعات POS
  const cashierExpenses = txs.filter(t => t.payMethod === 'cashier' && t.mainCategoryName !== 'تحصيل').reduce((sm, t) => sm + t.amountIn + t.amountOut, 0)
  const { result, status } = calcShiftClosing({ posSales: s.posSales ?? 0, cashierRemaining: s.cashierRemaining ?? 0, cashierExpenses, collections })
  const resultColor = status === 'surplus' ? '#10b981' : status === 'deficit' ? '#ef4444' : '#f59e0b'
  const resultLabel = status === 'surplus' ? 'أوفر' : status === 'deficit' ? 'عجز' : 'مطابق'

  // حركة الصندوق (4 خلايا): رصيد أول + مضاف − منصرف = متبقي
  const boxOpening   = fundPos?.before ?? 0
  const boxAdded     = fundPos?.cashIn ?? (s.cashierRemaining ?? 0)
  const boxSpent     = fundPos?.mgmtOut ?? mgmtOut
  const boxRemaining = fundPos ? fundPos.after : boxOpening + boxAdded - boxSpent
  const boxRemColor  = boxRemaining >= 0 ? '#10b981' : '#ef4444'

  const payDist = (['cashier', 'management'] as const).map(pm => {
    const list = txs.filter(t => t.payMethod === pm)
    return {
      method: PAY_LABELS[pm], count: list.length,
      in: list.reduce((sm, t) => sm + t.amountIn,  0),
      out: list.reduce((sm, t) => sm + t.amountOut, 0),
    }
  })

  const pageBase = `
    font-family: 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', Arial, sans-serif;
    direction: rtl; text-align: right; background: #ffffff; color: #0f172a;
    padding: 24px 30px; width: 794px; box-sizing: border-box; line-height: 1.55;
  `

  // ═══ الصفحة 1: بيانات الشيفت + جدول البنود (مضغوط) ═══
  const page1Html = `
    <div id="aj-report-page1" style="${pageBase}">
      <div style="background: linear-gradient(135deg, #1e3a8a, #1e293b);
        color: white; padding: 16px 22px; border-radius: 12px; margin-bottom: 16px;
        display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 14px;">
          ${companyLogo
            ? `<div style="width: 46px; height: 46px; background: #ffffff; border-radius: 12px;
                 display: flex; align-items: center; justify-content: center; overflow: hidden;
                 box-shadow: 0 4px 14px rgba(0,0,0,0.25);">
                 <img src="${companyLogo}" style="max-width: 100%; max-height: 100%; object-fit: contain;" /></div>`
            : `<div style="width: 46px; height: 46px; background: linear-gradient(135deg, #3b82f6, #1e3a8a);
                 border-radius: 12px; display: flex; align-items: center; justify-content: center;
                 font-size: 20px; font-weight: 900; color: white; box-shadow: 0 4px 14px rgba(59,130,246,0.5);">AJ</div>`}
          <div>
            <div style="font-size: 20px; font-weight: 900; margin-bottom: 3px;">${companyName || 'AJ Smart Shift Hyper'}</div>
            <div style="font-size: 11px; opacity: 0.85;">تقرير يومية الشيفت — v${APP_VERSION}</div>
          </div>
        </div>
        <div style="text-align: left; font-size: 10.5px; opacity: 0.85;">
          <div>تاريخ التقرير</div>
          <div style="font-weight: 700; font-size: 12px; margin-top: 3px;">${new Date().toLocaleDateString('ar-EG')}</div>
        </div>
      </div>

      <div style="border: 1.5px solid #1e3a8a; border-radius: 12px; padding: 12px 14px;
        margin-bottom: 14px; background: rgba(30,58,138,0.04);">
        <div style="font-size: 13px; font-weight: 800; color: #1e3a8a; margin-bottom: 8px;
          border-bottom: 2px solid #1e3a8a33; padding-bottom: 5px;">📋 بيانات الشيفت</div>
        <table style="width: 100%; font-size: 11.5px; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 8px; color: #64748b; width: 22%;">رقم الشيفت</td>
            <td style="padding: 4px 8px; font-weight: 800; color: #1e3a8a; font-size: 13px;">#${s.monthlyShiftNum}</td>
            <td style="padding: 4px 8px; color: #64748b; width: 22%;">نوع الشيفت</td>
            <td style="padding: 4px 8px; font-weight: 700;">${shiftTypeLabel(s.type)}</td>
          </tr>
          <tr style="background: rgba(30,58,138,0.04);">
            <td style="padding: 4px 8px; color: #64748b;">التاريخ</td>
            <td style="padding: 4px 8px; font-weight: 700;">${fmtDate(s.date)}</td>
            <td style="padding: 4px 8px; color: #64748b;">الكاشير</td>
            <td style="padding: 4px 8px; font-weight: 700;">${s.cashierName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 8px; color: #64748b;">بداية / نهاية الشيفت</td>
            <td style="padding: 4px 8px; font-weight: 700;">${s.startTime || '—'} → ${s.endTime || '—'}</td>
            <td style="padding: 4px 8px; color: #64748b;">حالة الشيفت</td>
            <td style="padding: 4px 8px; font-weight: 800; color: ${resultColor};">${resultLabel}</td>
          </tr>
        </table>
      </div>

      <div>
        <div style="font-size: 13px; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;
          border-bottom: 2px solid #1e3a8a33; padding-bottom: 5px;">📊 بنود اليومية (${txs.length} بند)</div>
        ${txs.length === 0 ? `<div style="text-align: center; padding: 14px; color: #64748b; font-style: italic;">لا توجد بنود</div>` : `
        <table style="width: 100%; font-size: 9px; border-collapse: collapse; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #1e3a8a; color: white;">
              <th style="padding: 4px 5px; text-align: center; border: 1px solid #1e3a8a;">#</th>
              <th style="padding: 4px 5px; text-align: right; border: 1px solid #1e3a8a;">الوقت</th>
              <th style="padding: 4px 5px; text-align: right; border: 1px solid #1e3a8a;">البيان</th>
              <th style="padding: 4px 5px; text-align: right; border: 1px solid #1e3a8a;">التصنيف</th>
              <th style="padding: 4px 5px; text-align: center; border: 1px solid #1e3a8a;">الدفع</th>
              <th style="padding: 4px 5px; text-align: center; background: #10b981; border: 1px solid #10b981;">وارد</th>
              <th style="padding: 4px 5px; text-align: center; background: #ef4444; border: 1px solid #ef4444;">منصرف</th>
            </tr>
          </thead>
          <tbody>
            ${txs.map((tx, i) => `
              <tr style="background: ${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
                <td style="padding: 2.5px 5px; text-align: center; border: 1px solid #e2e8f0; color: #64748b;">${i + 1}</td>
                <td style="padding: 2.5px 5px; border: 1px solid #e2e8f0; color: #64748b;">${tx.time}</td>
                <td style="padding: 2.5px 5px; border: 1px solid #e2e8f0; font-weight: 600;">${tx.description}</td>
                <td style="padding: 2.5px 5px; border: 1px solid #e2e8f0; color: #475569; font-size: 8.5px;">${tx.mainCategoryName}${tx.subCategoryName ? ' › ' + tx.subCategoryName : ''}</td>
                <td style="padding: 2.5px 5px; text-align: center; border: 1px solid #e2e8f0;">${PAY_LABELS[tx.payMethod] ?? tx.payMethod}</td>
                <td style="padding: 2.5px 5px; text-align: center; border: 1px solid #e2e8f0; color: #10b981; font-weight: 700;">${tx.amountIn > 0 ? fmt(tx.amountIn) : '—'}</td>
                <td style="padding: 2.5px 5px; text-align: center; border: 1px solid #e2e8f0; color: #ef4444; font-weight: 700;">${tx.amountOut > 0 ? fmt(tx.amountOut) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #1e293b; color: white; font-weight: 800;">
              <td colspan="5" style="padding: 5px; text-align: right; border: 1px solid #1e293b;">الإجمالي</td>
              <td style="padding: 5px; text-align: center; border: 1px solid #1e293b; color: #10b981;">${fmt(totalIn)} ج</td>
              <td style="padding: 5px; text-align: center; border: 1px solid #1e293b; color: #ef4444;">${fmt(totalOut)} ج</td>
            </tr>
          </tfoot>
        </table>`}
      </div>
    </div>
  `

  // ═══ الصفحة 2: ملخّص الشيفت الكامل ═══
  const page2Html = `
    <div id="aj-report-page2" style="${pageBase}">
      <div style="display:flex; justify-content:space-between; align-items:center;
        margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #1e3a8a33;">
        <span style="font-size: 15px; font-weight: 800; color: #1e3a8a;">${companyName || 'AJ Smart Shift Hyper'} — ملخّص الشيفت</span>
        <span style="font-size: 11px; font-weight: 600; color: #64748b;">شيفت #${s.monthlyShiftNum} — ${fmtDate(s.date)}</span>
      </div>

      <div style="margin-bottom: 18px;">
        <div style="font-size: 14px; font-weight: 800; color: #0ea5e9; margin-bottom: 8px;
          border-bottom: 2px solid #0ea5e933; padding-bottom: 6px;">💰 حركة الصندوق</div>
        <div style="display: flex; gap: 10px;">
          ${[
            { label: 'رصيد أول الصندوق', value: boxOpening,   color: '#1e3a8a' },
            { label: 'مضاف',            value: boxAdded,     color: '#10b981' },
            { label: 'منصرف',           value: boxSpent,     color: '#ef4444' },
            { label: 'رصيد آخر الصندوق', value: boxRemaining, color: boxRemColor },
          ].map(c => `
            <div style="flex: 1; border: 1.5px solid ${c.color}44; border-radius: 12px;
              padding: 12px 10px; text-align: center; background: ${c.color}0c;">
              <div style="font-size: 11px; color: #64748b; margin-bottom: 6px; font-weight: 600;">${c.label}</div>
              <div style="font-size: 18px; font-weight: 900; color: ${c.color}; line-height: 1.2;">
                ${fmt(c.value)} <span style="font-size: 11px; font-weight: 700;">ج</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="margin-top: 6px; font-size: 10.5px; color: #94a3b8; text-align: center;">
          رصيد آخر الصندوق = رصيد أول الصندوق + المضاف − المنصرف
        </div>
      </div>

      ${fawry ? `
      <div style="margin-bottom: 18px;">
        <div style="font-size: 14px; font-weight: 800; color: #8b5cf6; margin-bottom: 8px;
          border-bottom: 2px solid #8b5cf633; padding-bottom: 6px;">📡 ماكينة فوري</div>
        <table style="width: 100%; font-size: 11px; border-collapse: collapse; border: 1px solid #cbd5e1;">
          <thead><tr style="background: #8b5cf6; color: white;">
            <th style="padding: 7px 8px; text-align: right; border: 1px solid #8b5cf6;">الحركة</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #8b5cf6;">أساسي</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #8b5cf6;">إير تايم</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #8b5cf6;">كاش أوت</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style="padding: 6px 8px; font-weight: 700; color: #10b981; border: 1px solid #e2e8f0;">⬇ استلام</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.basicReceive)}</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.airReceive)}</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.cashoutReceive)}</td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="padding: 6px 8px; font-weight: 700; color: #ef4444; border: 1px solid #e2e8f0;">⬆ تسليم</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.basicDeliver)}</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.airDeliver)}</td>
              <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${fmt(fawry.cashoutDeliver)}</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top: 8px; font-size: 11px; color: #64748b;">
          مبيعات فوري + الربحية: <b style="color: #10b981;">${fmt(fawry.fawryTotalManual || fawry.programSales)} ج</b>
          &nbsp;·&nbsp; أول بون: <b>${fawry.firstVoucher}</b>
          &nbsp;·&nbsp; آخر بون: <b>${fawry.lastVoucher}</b>
        </div>
      </div>` : ''}

      <div style="margin-bottom: 18px;">
        <div style="font-size: 14px; font-weight: 800; color: #06b6d4; margin-bottom: 8px;
          border-bottom: 2px solid #06b6d433; padding-bottom: 6px;">💳 توزيع طرق الدفع</div>
        <table style="width: 100%; font-size: 11px; border-collapse: collapse; border: 1px solid #cbd5e1;">
          <thead><tr style="background: #06b6d4; color: white;">
            <th style="padding: 7px 8px; text-align: right; border: 1px solid #06b6d4;">طريقة الدفع</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #06b6d4;">عدد البنود</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #06b6d4;">وارد</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #06b6d4;">منصرف</th>
          </tr></thead>
          <tbody>
            ${payDist.map((p, i) => `
              <tr style="background: ${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
                <td style="padding: 6px 8px; font-weight: 700; border: 1px solid #e2e8f0;">${p.method}</td>
                <td style="padding: 6px 8px; text-align: center; border: 1px solid #e2e8f0;">${p.count}</td>
                <td style="padding: 6px 8px; text-align: center; color: #10b981; border: 1px solid #e2e8f0;">${fmt(p.in)}</td>
                <td style="padding: 6px 8px; text-align: center; color: #ef4444; border: 1px solid #e2e8f0;">${fmt(p.out)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-bottom: 18px;">
        <div style="font-size: 14px; font-weight: 800; color: #f59e0b; margin-bottom: 8px;
          border-bottom: 2px solid #f59e0b33; padding-bottom: 6px;">🔒 بيانات الإغلاق والعهدة</div>
        <table style="width: 100%; font-size: 12px; border-collapse: collapse; border: 1px solid #cbd5e1;">
          <thead><tr style="background: #f59e0b; color: white;">
            <th style="padding: 7px 8px; text-align: right; border: 1px solid #f59e0b;">البيان</th>
            <th style="padding: 7px 8px; text-align: center; border: 1px solid #f59e0b;">القيمة</th>
          </tr></thead>
          <tbody>
            ${([
              ['مبيعات POS',       fmt(s.posSales ?? 0) + ' ج',   '#3b82f6'],
              ['نقدية الكاشير',    fmt(s.cashierRemaining ?? 0) + ' ج', '#10b981'],
              ['التحصيلات',        fmt(collections) + ' ج',       '#1a1a1a'],
              ['مصروفات الكاشير',  fmt(shiftExpenses) + ' ج',     '#ef4444'],
            ] as [string, string, string][]).map(([label, value, color], i) => `
              <tr style="background: ${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
                <td style="padding: 6px 8px; color: #64748b; border: 1px solid #e2e8f0;">${label}</td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: ${color}; border: 1px solid #e2e8f0;">${value}</td>
              </tr>
            `).join('')}
            ${custody ? `
              <tr>
                <td style="padding: 6px 8px; color: #64748b; border: 1px solid #e2e8f0;">عهدة مستلمة</td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 700; border: 1px solid #e2e8f0;">${fmt(custody.addFromFund)} ج</td>
              </tr>
              <tr style="background: #f8fafc;">
                <td style="padding: 6px 8px; color: #64748b; border: 1px solid #e2e8f0;">عهدة منصرفة</td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: #f59e0b; border: 1px solid #e2e8f0;">${fmt(custody.managementPaid)} ج</td>
              </tr>
              <tr style="background: #fef9c3;">
                <td style="padding: 6px 8px; color: #64748b; border: 1px solid #e2e8f0;">عهدة متبقية</td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 800; color: #a16207; border: 1px solid #e2e8f0;">${fmt(custody.addFromFund - custody.managementPaid)} ج</td>
              </tr>
              <tr style="background: #dcfce7;">
                <td style="padding: 6px 8px; color: #64748b; border: 1px solid #e2e8f0;">إجمالي المتبقي <span style="font-size:9.5px; color:#94a3b8;">(نقدية الكاشير + المتبقي من العهدة)</span></td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 800; color: #15803d; border: 1px solid #e2e8f0;">${fmt((s.cashierRemaining ?? 0) + (custody.addFromFund - custody.managementPaid))} ج</td>
              </tr>` : ''}
          </tbody>
        </table>
      </div>

      <div style="border: 2px solid ${resultColor}; border-radius: 16px; padding: 18px;
        background: ${resultColor}10; text-align: center; margin-bottom: 16px;
        box-shadow: 0 4px 18px ${resultColor}30;">
        <div style="font-size: 13px; color: #475569; margin-bottom: 10px; font-weight: 600;">نتيجة الشيفت</div>
        <div style="font-size: 32px; font-weight: 900; color: ${resultColor}; line-height: 1.3; margin-bottom: 12px;">
          ${fmt(Math.abs(result))} <span style="font-size: 16px;">ج</span>
        </div>
        <div style="display: inline-block; padding: 6px 18px;
          background: ${resultColor}; color: white; border-radius: 999px;
          font-weight: 800; font-size: 13px;">${resultLabel}</div>
      </div>

      <div style="border-top: 1px solid #cbd5e1; padding-top: 12px;
        display: flex; justify-content: space-between; font-size: 10px; color: #64748b;">
        <div>
          <div style="margin-bottom: 4px;">👤 الكاشير: <b style="color: #0f172a;">${s.cashierName}</b></div>
          <div>📌 شيفت مغلق رسمياً</div>
        </div>
        <div style="text-align: left;">
          <div style="margin-bottom: 4px;">AJ Smart Shift Hyper v${APP_VERSION}</div>
          <div>تطوير: <b>أحمد جلال #1637</b></div>
        </div>
      </div>
    </div>
  `

  // إنشاء div مؤقت يحتوي الصفحتين معًا (كل صفحة عنصر مستقل يُصوَّر على حدة)
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left     = '-9999px'
  container.style.top      = '0'
  container.innerHTML      = page1Html + page2Html
  document.body.appendChild(container)

  try {
    const html2canvas = (await import('html2canvas')).default
    const { default: jsPDF } = await import('jspdf')

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    const pageW = 210, pageH = 297, margin = 8
    const imgW = pageW - margin * 2
    const usableH_mm = pageH - margin * 2
    const JPEG_QUALITY = 0.82

    // يضيف عنصرًا واحدًا (صفحة) للـPDF — لو تجاوز ارتفاعه صفحة A4 رغم الضغط (عدد بنود كبير جدًا استثنائيًا)
    // يُقسَّم تلقائيًا لأكتر من صفحة بدل ما تُفقَد أي بيانات من الطباعة
    async function addSectionAsPages(el: HTMLElement, isVeryFirstPage: boolean) {
      const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true })
      const imgH_mm = (canvas.height * imgW) / canvas.width

      if (imgH_mm <= usableH_mm) {
        if (!isVeryFirstPage) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', margin, margin, imgW, imgH_mm)
        return
      }
      const sliceH_px = Math.floor((usableH_mm * canvas.width) / imgW)
      let yPx = 0
      let isFirstSlice = true
      while (yPx < canvas.height) {
        const remainingPx = canvas.height - yPx
        const currentSlicePx = Math.min(sliceH_px, remainingPx)
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width  = canvas.width
        sliceCanvas.height = currentSlicePx
        const ctx = sliceCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
        ctx.drawImage(canvas, 0, -yPx)

        const sliceH_mm = (currentSlicePx * imgW) / canvas.width
        if (!(isVeryFirstPage && isFirstSlice)) pdf.addPage()
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', margin, margin, imgW, sliceH_mm)

        isFirstSlice = false
        yPx += currentSlicePx
      }
    }

    const page1El = container.querySelector('#aj-report-page1') as HTMLElement
    const page2El = container.querySelector('#aj-report-page2') as HTMLElement
    await addSectionAsPages(page1El, true)
    await addSectionAsPages(page2El, false)

    const typeLabel = shiftTypeLabel(s.type)
    const filename = `يومية-${typeLabel}-${s.date}-${s.monthlyShiftNum}.pdf`
    pdf.save(filename)
  } finally {
    document.body.removeChild(container)
  }
}
