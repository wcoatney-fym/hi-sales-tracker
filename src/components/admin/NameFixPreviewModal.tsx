import { useState, useEffect, useRef, useMemo } from "react";
import { X, ArrowRight, Check, Loader2, Type } from "lucide-react";
import type { AgentRow } from "../../types";
import { toProperCase, isNameMalformatted } from "../../lib/nameFormat";

interface NameCorrection {
  agent: AgentRow;
  correctedFirst: string;
  correctedLast: string;
  selected: boolean;
}

interface NameFixPreviewModalProps {
  open: boolean;
  agents: AgentRow[];
  saving: boolean;
  onApply: (corrections: { agent: AgentRow; firstName: string; lastName: string }[]) => void;
  onClose: () => void;
}

export default function NameFixPreviewModal({
  open,
  agents,
  saving,
  onApply,
  onClose,
}: NameFixPreviewModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => {
    if (!open) return [];
    return agents
      .filter((a) => isNameMalformatted(a.firstName) || isNameMalformatted(a.lastName))
      .map((agent): NameCorrection => ({
        agent,
        correctedFirst: isNameMalformatted(agent.firstName) ? toProperCase(agent.firstName) : agent.firstName,
        correctedLast: isNameMalformatted(agent.lastName) ? toProperCase(agent.lastName) : agent.lastName,
        selected: true,
      }))
      .filter(
        (c) => c.correctedFirst !== c.agent.firstName || c.correctedLast !== c.agent.lastName
      );
  }, [open, agents]);

  const [corrections, setCorrections] = useState<NameCorrection[]>([]);

  useEffect(() => {
    if (open) setCorrections(initial);
  }, [open, initial]);

  if (!open) return null;

  const displayCorrections = corrections;
  const selectedCount = displayCorrections.filter((c) => c.selected).length;

  const toggleAll = () => {
    const allSelected = displayCorrections.every((c) => c.selected);
    setCorrections(
      displayCorrections.map((c) => ({ ...c, selected: !allSelected }))
    );
  };

  const toggleOne = (index: number) => {
    setCorrections(
      displayCorrections.map((c, i) =>
        i === index ? { ...c, selected: !c.selected } : c
      )
    );
  };

  const updateCorrectedName = (
    index: number,
    field: "correctedFirst" | "correctedLast",
    value: string
  ) => {
    setCorrections(
      displayCorrections.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      )
    );
  };

  const handleApply = () => {
    const selected = displayCorrections
      .filter((c) => c.selected)
      .map((c) => ({
        agent: c.agent,
        firstName: c.correctedFirst,
        lastName: c.correctedLast,
      }));
    onApply(selected);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current && !saving) onClose();
      }}
    >
      <div className="bg-navy rounded-xl shadow-xl max-w-2xl w-full mx-4 overflow-hidden animate-scale-in max-h-[85vh] flex flex-col border border-slate-700/50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-900/30 flex items-center justify-center">
              <Type size={16} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Fix Agent Names</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {displayCorrections.length} name{displayCorrections.length !== 1 ? "s" : ""} need correction
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-navy-light transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {displayCorrections.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 bg-emerald-900/30 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Check size={24} className="text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-white">All names look good</p>
            <p className="text-xs text-slate-500 mt-1">No capitalization issues detected</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-3 bg-navy-light/50 border-b border-slate-700/30 flex items-center justify-between shrink-0">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={displayCorrections.every((c) => c.selected)}
                  onChange={toggleAll}
                  disabled={saving}
                  className="w-4 h-4 rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                />
                <span className="text-xs font-medium text-slate-300">
                  Select all ({selectedCount} of {displayCorrections.length})
                </span>
              </label>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-slate-700/30">
              {displayCorrections.map((correction, idx) => (
                <div
                  key={`${correction.agent.firstName}-${correction.agent.lastName}-${idx}`}
                  className={`px-6 py-3 flex items-center gap-3 transition-colors ${
                    correction.selected ? "bg-navy" : "bg-navy-light/30 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={correction.selected}
                    onChange={() => toggleOne(idx)}
                    disabled={saving}
                    className="w-4 h-4 rounded border-slate-600 text-gold focus:ring-gold bg-navy-light shrink-0"
                  />

                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-500 line-through truncate block">
                        {correction.agent.firstName} {correction.agent.lastName}
                      </span>
                    </div>

                    <ArrowRight size={14} className="text-slate-600 shrink-0" />

                    <div className="flex-1 min-w-0 flex gap-1.5">
                      <input
                        type="text"
                        value={correction.correctedFirst}
                        onChange={(e) => updateCorrectedName(idx, "correctedFirst", e.target.value)}
                        disabled={saving || !correction.selected}
                        className="w-1/2 px-2 py-1 text-sm font-medium text-white border border-slate-600 rounded bg-navy-light focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold disabled:opacity-50"
                      />
                      <input
                        type="text"
                        value={correction.correctedLast}
                        onChange={(e) => updateCorrectedName(idx, "correctedLast", e.target.value)}
                        disabled={saving || !correction.selected}
                        className="w-1/2 px-2 py-1 text-sm font-medium text-white border border-slate-600 rounded bg-navy-light focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 px-6 py-4 bg-navy-light/50 border-t border-slate-700/30 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="btn-secondary text-sm px-4 py-2"
          >
            {displayCorrections.length === 0 ? "Close" : "Cancel"}
          </button>
          {displayCorrections.length > 0 && (
            <button
              onClick={handleApply}
              disabled={saving || selectedCount === 0}
              className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg font-medium bg-gold text-navy-dark hover:bg-gold-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy focus:ring-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check size={15} />
                  Apply {selectedCount} Correction{selectedCount !== 1 ? "s" : ""}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
