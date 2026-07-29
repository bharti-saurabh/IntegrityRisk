import { useState, useEffect, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { NAV_ITEMS, NAV_GROUPS } from "@/app/nav";
import { Icon } from "@/components/ui/Icon";
import { useAppStore } from "@/stores/appStore";
import { CommandPalette } from "@/app/CommandPalette";
import { PersonaSwitcher } from "@/app/PersonaSwitcher";
import { DemoTour } from "@/app/DemoTour";

export function Layout({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const persona = useAppStore((s) => s.persona);
  const meta = useAppStore((s) => s.result?.meta);
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-violet text-white shadow-sm">
            <Icon name="Shield" size={19} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-ink">Integrity IQ</div>
            <div className="text-[10px] text-ink-3">Command Center</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
          {NAV_GROUPS.map((group) => {
            const items = NAV_ITEMS.filter((i) => i.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-3">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">
                  {group}
                </div>
                {items.map((item) => {
                  const emphasized = item.personas?.includes(persona);
                  if (item.disabled) {
                    return (
                      <div
                        key={item.to}
                        aria-disabled="true"
                        title="Coming soon"
                        className="group relative flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-3/60"
                      >
                        <Icon name={item.icon} size={16} />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-3">
                          Soon
                        </span>
                      </div>
                    );
                  }
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        clsx(
                          "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                          isActive
                            ? "bg-cyan/10 text-cyan"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-cyan" />
                          ) : null}
                          <Icon name={item.icon} size={16} />
                          <span className="flex-1">{item.label}</span>
                          {emphasized ? <span className="h-1.5 w-1.5 rounded-full bg-cyan/70" /> : null}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-canvas/80 px-4 py-2 backdrop-blur-md">
          <button
            onClick={() => setPaletteOpen(true)}
            title="Search — merchants, cases, actions"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-left text-xs text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
          >
            <Icon name="Search" size={14} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-2.5 py-1 text-[11px] font-medium text-ai sm:inline-flex">
              <Icon name="Sparkles" size={12} /> AI: Demo (deterministic)
            </span>
            <PersonaSwitcher />
          </div>
        </header>

        <main key={location.pathname} className="flex-1 animate-fade-up px-4 py-5 sm:px-6">
          {children}
        </main>

        <footer className="border-t border-border px-6 py-3 text-center text-[11px] text-ink-3">
          Demonstration environment. All data and entities are synthetic. Outputs are
          decision-support indicators, not final compliance determinations.
          {meta ? <span className="ml-2 opacity-60">· data {meta.dataVersion}</span> : null}
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <DemoTour />
    </div>
  );
}
