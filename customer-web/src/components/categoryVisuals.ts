import {
  BadgePercent,
  CakeSlice,
  Candy,
  CircleDot,
  Cookie,
  CupSoda,
  Droplets,
  Gift,
  LayoutGrid,
  PackageOpen,
  Popcorn,
  Sparkles,
  Wheat,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryVisual {
  icon: LucideIcon;
  accent: string;
  active: string;
  glow: string;
}

export const ALL_CATEGORY_VISUAL: CategoryVisual = {
  icon: LayoutGrid,
  accent: 'bg-blue-50 text-blue-700',
  active: 'from-[#0b1b3f] to-blue-700',
  glow: 'shadow-blue-950/25',
};

const DEFAULT_VISUAL: CategoryVisual = {
  icon: PackageOpen,
  accent: 'bg-slate-100 text-slate-700',
  active: 'from-slate-700 to-slate-900',
  glow: 'shadow-slate-900/20',
};

const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'CAT-BEV': {
    icon: CupSoda,
    accent: 'bg-blue-50 text-blue-700',
    active: 'from-blue-600 to-cyan-500',
    glow: 'shadow-blue-900/25',
  },
  'CAT-WATER': {
    icon: Droplets,
    accent: 'bg-cyan-50 text-cyan-700',
    active: 'from-cyan-600 to-sky-400',
    glow: 'shadow-cyan-900/25',
  },
  'CAT-ENERGY': {
    icon: Zap,
    accent: 'bg-amber-50 text-amber-700',
    active: 'from-amber-500 to-orange-500',
    glow: 'shadow-orange-900/25',
  },
  'CAT-BISCUIT': {
    icon: Cookie,
    accent: 'bg-orange-50 text-orange-700',
    active: 'from-orange-600 to-amber-500',
    glow: 'shadow-orange-900/25',
  },
  'CAT-CAKE': {
    icon: CakeSlice,
    accent: 'bg-pink-50 text-pink-700',
    active: 'from-pink-600 to-rose-500',
    glow: 'shadow-pink-900/25',
  },
  'CAT-CHOCO': {
    icon: Candy,
    accent: 'bg-amber-50 text-amber-900',
    active: 'from-amber-800 to-orange-700',
    glow: 'shadow-amber-950/25',
  },
  'CAT-CANDY': {
    icon: Sparkles,
    accent: 'bg-fuchsia-50 text-fuchsia-700',
    active: 'from-fuchsia-600 to-pink-500',
    glow: 'shadow-fuchsia-900/25',
  },
  'CAT-GUM': {
    icon: CircleDot,
    accent: 'bg-violet-50 text-violet-700',
    active: 'from-violet-600 to-purple-500',
    glow: 'shadow-violet-900/25',
  },
  'CAT-CHIPS': {
    icon: Popcorn,
    accent: 'bg-yellow-50 text-yellow-700',
    active: 'from-yellow-500 to-orange-500',
    glow: 'shadow-yellow-900/25',
  },
  'CAT-FOOD': {
    icon: Wheat,
    accent: 'bg-emerald-50 text-emerald-700',
    active: 'from-emerald-600 to-teal-500',
    glow: 'shadow-emerald-900/25',
  },
  'CAT-GIFTS': {
    icon: Gift,
    accent: 'bg-indigo-50 text-indigo-700',
    active: 'from-indigo-600 to-violet-500',
    glow: 'shadow-indigo-900/25',
  },
  'CAT-OFFERS': {
    icon: BadgePercent,
    accent: 'bg-rose-50 text-rose-700',
    active: 'from-rose-600 to-orange-500',
    glow: 'shadow-rose-900/25',
  },
};

export function getCategoryVisual(code: string): CategoryVisual {
  return CATEGORY_VISUALS[code] ?? DEFAULT_VISUAL;
}
