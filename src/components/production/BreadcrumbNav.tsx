import { ChevronRight } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbNavProps {
  segments: BreadcrumbSegment[];
}

export default function BreadcrumbNav({ segments }: BreadcrumbNavProps) {
  return (
    <nav className="flex items-center gap-1.5 text-sm mb-5">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-slate-500" />}
            {isLast ? (
              <span className="text-white font-semibold">{seg.label}</span>
            ) : (
              <button
                onClick={seg.onClick}
                className="text-slate-400 hover:text-gold transition-colors font-medium"
              >
                {seg.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
