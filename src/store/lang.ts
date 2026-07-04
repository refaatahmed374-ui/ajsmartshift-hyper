import { create } from 'zustand'

export type Lang = 'ar' | 'en'

interface LangState {
  lang:   Lang
  toggle: () => void
  set:    (l: Lang) => void
}

const saved = (localStorage.getItem('lang') as Lang) || 'ar'

export const useLang = create<LangState>((set) => ({
  lang: saved,
  toggle: () => set(s => {
    const next: Lang = s.lang === 'ar' ? 'en' : 'ar'
    localStorage.setItem('lang', next)
    return { lang: next }
  }),
  set: (l) => { localStorage.setItem('lang', l); set({ lang: l }) },
}))

// ===== نصوص شاشة الدخول (عربي/إنجليزي) =====
// نقطة التوسّع: تُضاف بقية الشاشات هنا مستقبلاً
export const loginText = {
  ar: {
    title:      'تسجيل الدخول',
    welcome:    'مرحباً بك',
    subtitle:   'اختر حسابك أو ادخل كلمة المرور',
    chooseAccount: 'الكاشيرون المتاحون',
    orDirect:   'أو ادخل بكلمة المرور مباشرة',
    username:   'اسم المستخدم',
    password:   'كلمة المرور',
    login:      'دخول',
    verifying:  'جاري التحقق...',
    userPlaceholder: 'mgr / c1 / c2 ...',
    tagline:    'نظام إدارة الشيفتات المتقدم',
    tagline2:   'يومية أحمد جلال',
    systemInfo: 'معلومات النظام',
    subInfo:    'بيانات الاشتراك',
    subStart:   'بدء الاشتراك',
    subEnd:     'انتهاء الاشتراك',
    license:    'الترخيص',
    env:        'البيئة',
    activeFullTitle: 'نسخة مفعّلة كاملة',
    activeFullDesc:  'جميع الميزات متاحة',
    version:    'الإصدار',
    database:   'قاعدة البيانات',
    runtime:    'بيئة التشغيل',
    client:     'العميل',
    clientName: 'مؤسسة مدماك الجنوب',
    deviceCode: 'رقم الجهاز',
    trialStart: 'بداية التجربة',
    trialEnd:   'نهاية التجربة',
    activated:  '✓ نسخة مفعّلة',
    expiredBadge:'✕ انتهت التجربة',
    trialBadge: '⏳ نسخة تجريبية',
    licensedTo: 'مرخّصة لـ',
    devName:    'أحمد جلال',
    trialLabel: 'نسخة تجريبية',
    dayOf:      (a:number,b:number)=>`يوم ${a} من ${b}`,
    endsOn:     'تنتهي في:',
    expiredTitle:'انتهت الفترة التجريبية',
    expiredDesc: 'البرنامج في وضع القراءة فقط. فعّل النسخة من الإعدادات للمتابعة.',
    credit:     'تطوير وتصميم',
    warnFields: 'أدخل اسم المستخدم وكلمة المرور',
    errLogin:   'بيانات الدخول غير صحيحة',
  },
  en: {
    title:      'Sign In',
    welcome:    'Welcome',
    subtitle:   'Choose your account or enter password',
    chooseAccount: 'Available Cashiers',
    orDirect:   'Or sign in with password directly',
    username:   'Username',
    password:   'Password',
    login:      'Sign In',
    verifying:  'Verifying...',
    userPlaceholder: 'mgr / c1 / c2 ...',
    tagline:    'Advanced Shift Management System',
    tagline2:   'Ahmed Galal Ledger',
    systemInfo: 'System Info',
    subInfo:    'Subscription',
    subStart:   'Start Date',
    subEnd:     'End Date',
    license:    'License',
    env:        'Runtime',
    activeFullTitle: 'Fully Activated',
    activeFullDesc:  'All features available',
    version:    'Version',
    database:   'Database',
    runtime:    'Runtime',
    client:     'Client',
    clientName: 'Madmak Al-Janoub Est.',
    deviceCode: 'Device ID',
    trialStart: 'Trial Start',
    trialEnd:   'Trial End',
    activated:  '✓ Activated',
    expiredBadge:'✕ Trial Expired',
    trialBadge: '⏳ Trial Version',
    licensedTo: 'Licensed to',
    devName:    'Ahmed Galal',
    trialLabel: 'Trial Version',
    dayOf:      (a:number,b:number)=>`Day ${a} of ${b}`,
    endsOn:     'Ends on:',
    expiredTitle:'Trial period ended',
    expiredDesc: 'The app is in read-only mode. Activate from Settings to continue.',
    credit:     'Developed by',
    warnFields: 'Enter username and password',
    errLogin:   'Invalid login credentials',
  },
} as const
