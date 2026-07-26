import type { Persona } from "@/stores/appStore";

export interface NavItem {
  to: string;
  label: string;
  icon: string; // lucide icon name
  group: "Overview" | "Typologies" | "Operations" | "Models" | "System";
  personas?: Persona[]; // if set, emphasized for these personas
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Command Center", icon: "LayoutDashboard", group: "Overview", personas: ["executive"] },
  { to: "/explorer", label: "Data Explorer", icon: "Search", group: "Overview", personas: ["data-scientist", "analyst"] },
  { to: "/anatomy", label: "Anatomy", icon: "Fingerprint", group: "Overview", personas: ["executive", "analyst"] },
  { to: "/typologies", label: "Typology Hub", icon: "Layers", group: "Overview" },
  { to: "/mcc", label: "MCC Miscoding Models", icon: "ScanSearch", group: "Typologies", personas: ["analyst"] },
  { to: "/mcc-abuse", label: "MCC Abuse Models", icon: "Receipt", group: "Typologies", personas: ["analyst"] },
  { to: "/split", label: "Split-Ticketing Models", icon: "Split", group: "Typologies" },
  { to: "/factoring", label: "Factoring Models", icon: "Share2", group: "Typologies" },
  { to: "/descriptors", label: "Descriptor Models", icon: "Type", group: "Typologies" },
  { to: "/cash", label: "Cash-Disbursement Models", icon: "Banknote", group: "Typologies" },
  { to: "/cases", label: "Case Queue", icon: "Briefcase", group: "Operations", personas: ["analyst", "operations"] },
  { to: "/models", label: "Model Store", icon: "Boxes", group: "Models", personas: ["data-scientist", "executive"] },
  { to: "/observatory", label: "Model Observatory", icon: "Activity", group: "Models", personas: ["data-scientist"] },
  { to: "/simulator", label: "Impact Simulator", icon: "SlidersHorizontal", group: "Models", personas: ["data-scientist", "operations"] },
  { to: "/rules", label: "Rules Engine", icon: "Filter", group: "Models" },
  { to: "/architecture", label: "Architecture", icon: "Workflow", group: "System" },
];

export const NAV_GROUPS: NavItem["group"][] = [
  "Overview",
  "Typologies",
  "Operations",
  "Models",
  "System",
];
