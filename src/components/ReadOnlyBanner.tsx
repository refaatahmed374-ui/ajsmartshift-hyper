import Icons from './Icon'

interface Props { onActivate: () => void }

export default function ReadOnlyBanner({ onActivate }: Props) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 text-xs"
      style={{ background: 'rgba(248,81,73,0.12)', borderBottom: '1px solid rgba(248,81,73,0.3)' }}>
      <Icons.Lock size={14} className="text-danger flex-shrink-0" />
      <span className="text-danger font-semibold">
        انتهت الفترة التجريبية — البرنامج في وضع القراءة فقط
      </span>
      <span className="text-surface-400 hidden md:inline">
        لا يمكن إضافة أو تعديل أو حذف أي بيانات حتى تفعيل النسخة
      </span>
      <button onClick={onActivate}
        className="mr-auto btn-primary btn-sm">
        <Icons.Check size={13} /> تفعيل النسخة الآن
      </button>
    </div>
  )
}
