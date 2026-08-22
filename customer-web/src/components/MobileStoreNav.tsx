import { Grid2X2, Home, MessageCircle, Search, ShoppingCart } from 'lucide-react';
import { formatJod } from '../utils/money';

interface MobileStoreNavProps {
  cartPackages: number;
  cartTotal: number;
  whatsappUrl: string;
  onHome: () => void;
  onCategories: () => void;
  onSearch: () => void;
  onCart: () => void;
}

export function MobileStoreNav({ cartPackages, cartTotal, whatsappUrl, onHome, onCategories, onSearch, onCart }: MobileStoreNavProps) {
  const items = [
    { label: 'الرئيسية', icon: Home, action: onHome },
    { label: 'الأقسام', icon: Grid2X2, action: onCategories },
    { label: 'البحث', icon: Search, action: onSearch },
    { label: 'السلة', icon: ShoppingCart, action: onCart },
  ];
  return (
    <>
      {cartPackages > 0 && (
        <button type="button" onClick={onCart} className="fixed inset-x-3 bottom-[5.4rem] z-40 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white shadow-2xl md:hidden">
          <span className="text-right"><strong className="block text-xs font-black">{cartPackages.toLocaleString('ar-JO')} طرد في السلة</strong><span className="text-[9px] font-bold text-slate-300">اضغط لمراجعة الطلب</span></span>
          <span className="text-sm font-black text-orange-300">{formatJod(cartTotal)}</span>
        </button>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-2 pb-[max(.55rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_35px_-25px_rgba(15,23,42,.55)] backdrop-blur-xl md:hidden" aria-label="تنقل المتجر">
        {items.map((item) => {
          const Icon = item.icon;
          return <button type="button" key={item.label} onClick={item.action} className="relative flex flex-col items-center gap-1 text-[9px] font-black text-slate-600"><Icon className="h-5 w-5 text-blue-700" />{item.label}{item.label === 'السلة' && cartPackages > 0 && <span className="absolute -top-1 left-3 rounded-full bg-orange-500 px-1.5 text-[8px] text-white">{cartPackages}</span>}</button>;
        })}
        <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-[9px] font-black text-emerald-700"><MessageCircle className="h-5 w-5" />واتساب</a>
      </nav>
    </>
  );
}
