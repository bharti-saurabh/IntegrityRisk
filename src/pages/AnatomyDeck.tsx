import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";

/**
 * The Anatomy tab is a launcher for two self-contained, editorial "anatomy"
 * documents (authored as standalone HTML in /public/anatomy). A card grid lands
 * the user; clicking one opens that document full-screen in an isolated iframe so
 * its own typography, palette and GSAP motion render exactly as authored.
 */

interface Anatomy {
  key: string;
  file: string;
  eyebrow: string;
  title: string;
  blurb: string;
  icon: string;
  accent: string; // echoes the document's own accent
  accentBg: string;
}

const ANATOMIES: Anatomy[] = [
  {
    key: "mcc",
    file: "mcc_miscoding_anatomy3.html",
    eyebrow: "Integrity typology",
    title: "MCC Miscoding",
    blurb:
      "How a merchant declares one category and behaves like another — the signals that expose the gap, and how the model reads them into a risk score.",
    icon: "ScanSearch",
    accent: "#2F7D51",
    accentBg: "#EDF5EF",
  },
  {
    key: "cpp",
    file: "cpp_anatomy3.html",
    eyebrow: "Fraud analytics",
    title: "CPP — Common Point of Purchase",
    blurb:
      "How a shared merchant surfaces as the origin of a fraud cluster — tracing compromised cards back to where they were all last seen.",
    icon: "GitMerge",
    accent: "#2456D6",
    accentBg: "#EBF0FC",
  },
  {
    key: "surcharge",
    file: "surcharge_abuse_anatomy.html",
    eyebrow: "Fee-integrity typology",
    title: "Card Surcharge Abuse",
    blurb:
      "How the same card fee is legal in one country and banned across the border — a deterministic jurisdiction rulebook, not a peer model, decides the verdict and the recovery.",
    icon: "BadgePercent",
    accent: "#0F7A52",
    accentBg: "#E7F5EF",
  },
];

function AnatomyCard({ a, onOpen }: { a: Anatomy; onOpen: (a: Anatomy) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-left transition-all hover:-translate-y-0.5 hover:border-transparent hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
    >
      {/* accent header band, in the document's own palette */}
      <div className="relative h-28 overflow-hidden" style={{ background: a.accentBg }}>
        <div
          className="absolute -right-6 -top-8 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
          style={{ background: a.accent }}
        />
        <div className="absolute left-5 top-5 flex items-center gap-2">
          <span
            className="grid h-11 w-11 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: a.accent }}
          >
            <Icon name={a.icon} size={22} />
          </span>
        </div>
        <span
          className="absolute bottom-4 left-5 text-[10.5px] font-bold uppercase tracking-[0.14em]"
          style={{ color: a.accent }}
        >
          {a.eyebrow}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-bold tracking-tight text-ink">{a.title}</h3>
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink-2">{a.blurb}</p>
        <span
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold"
          style={{ color: a.accent }}
        >
          View anatomy
          <Icon name="ArrowRight" size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function FullscreenViewer({ a, onClose }: { a: Anatomy; onClose: () => void }) {
  const src = `${import.meta.env.BASE_URL}anatomy/${a.file}`;

  // Escape closes; lock the body scroll while the overlay is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#14181D]">
      {/* slim control bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#14181D] px-4 py-2.5 text-white">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Icon name="ArrowLeft" size={16} /> Back
        </button>
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md text-white" style={{ background: a.accent }}>
            <Icon name={a.icon} size={13} />
          </span>
          <span className="text-sm font-semibold">{a.title}</span>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-white/70 hover:bg-white/10 hover:text-white"
        >
          <Icon name="ExternalLink" size={14} /> Open in new tab
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <Icon name="X" size={18} />
        </button>
      </div>

      <iframe
        title={a.title}
        src={src}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}

export default function AnatomyDeck() {
  const [active, setActive] = useState<Anatomy | null>(null);

  return (
    <div>
      <PageHeader
        icon="Fingerprint"
        title="Anatomy"
        subtitle="Deep-dive anatomies of how each integrity pattern actually works · open one to read it full-screen"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        {ANATOMIES.map((a) => (
          <AnatomyCard key={a.key} a={a} onOpen={setActive} />
        ))}
      </div>

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-snug text-ink-3">
        <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
        <span>
          Each anatomy is a self-contained explainer rendered exactly as authored. All entities and figures
          within are synthetic and illustrative — decision-support context, not compliance determinations.
        </span>
      </p>

      {active ? <FullscreenViewer a={active} onClose={() => setActive(null)} /> : null}
    </div>
  );
}
