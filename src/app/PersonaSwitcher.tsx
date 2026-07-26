import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { useAppStore, type Persona } from "@/stores/appStore";
import { Icon } from "@/components/ui/Icon";

const PERSONAS: { id: Persona; label: string; blurb: string; icon: string }[] = [
  { id: "executive", label: "Executive", blurb: "Portfolio exposure & trends", icon: "LayoutDashboard" },
  { id: "analyst", label: "Integrity Analyst", blurb: "Investigate & disposition", icon: "ScanSearch" },
  { id: "data-scientist", label: "Data Scientist", blurb: "Model metrics & features", icon: "Activity" },
  { id: "operations", label: "Operations", blurb: "Queue & SLA management", icon: "Briefcase" },
];

export function PersonaSwitcher() {
  const persona = useAppStore((s) => s.persona);
  const setPersona = useAppStore((s) => s.setPersona);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PERSONAS.find((p) => p.id === persona)!;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs hover:border-ink-3"
      >
        <Icon name={current.icon} size={14} className="text-cyan" />
        <span className="hidden font-medium sm:inline">{current.label}</span>
        <Icon name="ChevronDown" size={14} className="text-ink-3" />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-card">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">
            View as persona
          </div>
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPersona(p.id);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                p.id === persona ? "bg-cyan/10" : "hover:bg-surface-2",
              )}
            >
              <Icon name={p.icon} size={16} className={p.id === persona ? "text-cyan" : "text-ink-3"} />
              <div className="flex-1">
                <div className="text-[13px] font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-3">{p.blurb}</div>
              </div>
              {p.id === persona ? <Icon name="Check" size={14} className="text-cyan" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
