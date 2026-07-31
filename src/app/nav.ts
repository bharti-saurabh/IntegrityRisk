import type { Persona } from "@/stores/appStore";

export interface NavItem {
  to: string;
  label: string;
  icon: string; // lucide icon name
  group: "Overview" | "Typologies" | "Models";
  personas?: Persona[]; // if set, emphasized for these personas
  disabled?: boolean; // rendered as a non-clickable "coming soon" entry
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Command Center", icon: "LayoutDashboard", group: "Overview", personas: ["executive"] },
  { to: "/explorer", label: "Data Explorer", icon: "Search", group: "Overview", personas: ["data-scientist", "analyst"] },
  { to: "/anatomy", label: "Anatomy", icon: "Fingerprint", group: "Overview", personas: ["executive", "analyst"] },
  { to: "/mcc", label: "MCC Miscoding Models", icon: "ScanSearch", group: "Typologies", personas: ["analyst"] },
  { to: "/surcharge", label: "Card Surcharge", icon: "BadgePercent", group: "Typologies" },
  // Kept visible but disabled ("Soon") — these three typologies aren't wired to a
  // live console yet, so their nav entries render non-clickable and their routes
  // redirect to the Command Center (see App.tsx).
  { to: "/mcc-abuse", label: "MCC Abuse", icon: "Repeat", group: "Typologies", disabled: true },
  { to: "/split", label: "Split-Ticketing", icon: "Scissors", group: "Typologies", disabled: true },
  { to: "/cash", label: "Cash Disbursement", icon: "Banknote", group: "Typologies", disabled: true },
  { to: "/models", label: "Model Store", icon: "Boxes", group: "Models", personas: ["data-scientist", "executive"] },
  { to: "/rules", label: "Rules Engine", icon: "Filter", group: "Models" },
];

export const NAV_GROUPS: NavItem["group"][] = [
  "Overview",
  "Typologies",
  "Models",
];
