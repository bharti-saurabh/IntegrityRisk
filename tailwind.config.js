/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light foundation (premium fintech). Note: the page background token is
        // named `canvas`, NOT `base`, so it never collides with Tailwind's
        // built-in `text-base` font-size utility.
        canvas: "#f6f8fb", // page background — very light cool gray
        surface: "#ffffff", // cards
        "surface-2": "#f1f4f9", // subtle blue-gray (inputs, chips, hover, tracks)
        elevated: "#e7edf6", // raised / stronger hover tint
        border: "#e3e8f0", // crisp hairline border
        "border-soft": "#eef2f7", // faint divider
        ink: "#0f172a", // primary text — charcoal / slate-900
        "ink-2": "#475569", // secondary — slate-600
        "ink-3": "#64748b", // muted — slate-500 (accessible on white)
        // Accents (vivid but controlled)
        cyan: "#2563eb", // primary — refined blue
        violet: "#7c3aed", // secondary — violet
        amber: "#d97706", // warning / elevated
        // Risk semantics
        ok: "#059669", // positive — emerald-600
        warn: "#d97706",
        high: "#e11d48", // high risk — rose-600
        critical: "#dc2626", // critical — red-600
        ai: "#7c3aed", // AI accent — violet
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        // Soft, layered light-theme shadows (no neon glow).
        card: "0 1px 2px rgba(15,23,42,0.04), 0 6px 20px -12px rgba(15,23,42,0.16)",
        "card-hover": "0 1px 3px rgba(15,23,42,0.06), 0 12px 28px -12px rgba(15,23,42,0.22)",
        glow: "0 0 0 1px rgba(37,99,235,0.20), 0 14px 34px -16px rgba(37,99,235,0.35)",
        "glow-critical": "0 0 0 1px rgba(220,38,38,0.18), 0 14px 34px -16px rgba(220,38,38,0.32)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseglow: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        pulseglow: "pulseglow 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
