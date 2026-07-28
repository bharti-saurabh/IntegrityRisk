import {
  LayoutDashboard, Orbit, Layers, ScanSearch, Split, Share2, Type, Banknote,
  Briefcase, Activity, SlidersHorizontal, Filter, Workflow, Command, Search,
  Sparkles, Shield, ShieldCheck, ChevronRight, ChevronDown, X, Play, Pause, ArrowRight,
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Download, RotateCcw,
  Users, Building2, MapPin, Clock, CreditCard, Network, FileText, Check,
  CircleAlert, Gauge, Zap, Eye, ChevronLeft, Info, Radar, GitBranch,
  Target, Fingerprint, Boxes, Cpu, Scale, ArrowUpRight, ArrowDownRight,
  Receipt, Table2, Route, ChevronUp,
  Globe, Landmark, ShieldAlert, Loader2, Wifi, Minus, BadgePercent,
  GitMerge, ExternalLink,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

const MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Orbit, Layers, ScanSearch, Split, Share2, Type, Banknote,
  Briefcase, Activity, SlidersHorizontal, Filter, Workflow, Command, Search,
  Sparkles, Shield, ShieldCheck, ChevronRight, ChevronDown, X, Play, Pause, ArrowRight,
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Download, RotateCcw,
  Users, Building2, MapPin, Clock, CreditCard, Network, FileText, Check,
  CircleAlert, Gauge, Zap, Eye, ChevronLeft, Info, Radar, GitBranch,
  Target, Fingerprint, Boxes, Cpu, Scale, ArrowUpRight, ArrowDownRight,
  Receipt, Table2, Route, ChevronUp,
  Globe, Landmark, ShieldAlert, Loader2, Wifi, Minus, BadgePercent,
  GitMerge, ExternalLink,
};

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  /** For the per-typology categorical colors, which are data-driven and can't be Tailwind classes. */
  style?: CSSProperties;
}) {
  const Cmp = MAP[name] ?? Info;
  return <Cmp size={size} className={className} style={style} />;
}
