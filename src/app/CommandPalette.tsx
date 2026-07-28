import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useAppStore } from "@/stores/appStore";
import { NAV_ITEMS } from "@/app/nav";
import { Icon } from "@/components/ui/Icon";
import { TIER_COLOR } from "@/features/cases/actions";

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: string;
  tone?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const records = useAppStore((s) => s.result?.records);
  const selectMerchant = useAppStore((s) => s.selectMerchant);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const navCmds: Command[] = NAV_ITEMS.filter((n) => !n.disabled).map((n) => ({
      id: `nav:${n.to}`,
      label: n.label,
      hint: "Navigate",
      icon: n.icon,
      run: () => navigate(n.to),
    }));

    const q = query.trim().toLowerCase();
    const merchantCmds: Command[] = (records ?? [])
      .filter((r) => {
        if (!q) return r.scores.tier === "critical";
        return (
          r.merchant.merchantId.toLowerCase().includes(q) ||
          r.merchant.tradeName.toLowerCase().includes(q) ||
          r.merchant.legalName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.scores.finalRiskScore - a.scores.finalRiskScore)
      .slice(0, 8)
      .map((r) => ({
        id: `m:${r.merchant.merchantId}`,
        label: `${r.merchant.tradeName} · ${r.merchant.merchantId}`,
        hint: `${r.scores.finalRiskScore}/100 ${r.scores.tier}`,
        icon: "Building2",
        tone: TIER_COLOR[r.scores.tier],
        run: () => {
          selectMerchant(r.merchant.merchantId);
          navigate(`/investigate/${r.merchant.merchantId}`);
        },
      }));

    return [...merchantCmds, ...navCmds];
  }, [query, records, navigate, selectMerchant]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  if (!open) return null;

  const exec = (c: Command) => {
    c.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Icon name="Search" size={16} className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(filtered.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter" && filtered[cursor]) {
                exec(filtered[cursor]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search merchants or jump to a module…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-3">esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-ink-3">No matches.</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => exec(c)}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                  i === cursor ? "bg-cyan/10" : "hover:bg-surface-2",
                )}
              >
                <Icon name={c.icon} size={16} className={c.tone ?? "text-ink-3"} />
                <span className="flex-1 truncate text-[13px]">{c.label}</span>
                <span className={clsx("text-[11px] tnum", c.tone ?? "text-ink-3")}>{c.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
