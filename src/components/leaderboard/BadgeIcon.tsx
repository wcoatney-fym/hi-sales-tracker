import {
  Rocket,
  Flame,
  Zap,
  Crown,
  Trophy,
  Gem,
  Target,
  Shield,
  TrendingUp,
  RefreshCw,
  Users,
  Award,
} from "lucide-react";
import type { BadgeDefinition } from "../../types/leaderboard";

const iconMap: Record<string, React.ElementType> = {
  rocket: Rocket,
  flame: Flame,
  zap: Zap,
  crown: Crown,
  trophy: Trophy,
  gem: Gem,
  target: Target,
  shield: Shield,
  "trending-up": TrendingUp,
  "refresh-cw": RefreshCw,
  users: Users,
  award: Award,
};

interface BadgeIconProps {
  slug: string;
  size?: number;
  badges: BadgeDefinition[];
  showTooltip?: boolean;
}

export default function BadgeIcon({ slug, size = 16, badges, showTooltip = false }: BadgeIconProps) {
  const badge = badges.find((b) => b.slug === slug);
  const iconKey = badge?.icon_key || "award";
  const Icon = iconMap[iconKey] || Award;

  return (
    <div className="relative group">
      <div className="w-6 h-6 rounded-full bg-gold/10 flex items-center justify-center">
        <Icon size={size} className="text-gold" />
      </div>
      {showTooltip && badge && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-navy border border-slate-600 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-nowrap">
          <p className="text-xs font-semibold text-gold">{badge.label}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{badge.description}</p>
        </div>
      )}
    </div>
  );
}
