/**
 * تشابه نصوص تقريبي (Levenshtein) — لتخمين أقرب اسم موظف تلقائياً عند استيراد Excel،
 * حتى مع اختلاف بسيط (حرف ناقص/زائد) بعد التطبيع العام (normalizeArabic).
 */

/** مسافة Levenshtein بين نصّين (عدد التعديلات: إضافة/حذف/استبدال حرف). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

/** نسبة تشابه 0..1 (1 = تطابق تام). */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length)
}

/** أقرب عنصر من قائمة مرشّحين لنص معيّن (أو null لو القائمة فارغة). */
export function bestMatch<T>(
  query: string,
  candidates: { key: string; item: T }[],
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null
  for (const c of candidates) {
    const score = similarity(query, c.key)
    if (!best || score > best.score) best = { item: c.item, score }
  }
  return best
}
