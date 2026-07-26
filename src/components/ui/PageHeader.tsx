import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan">
          <Icon name={icon} size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
          {subtitle ? <p className="text-xs text-ink-3">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
