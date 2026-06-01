"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  History,
  Radio,
  ShieldAlert,
  BarChart2,
  BookOpen,
  Settings,
  Zap,
} from "lucide-react";
import { useHealth } from "@/hooks/useAriaData";

const nav = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/trades", label: "Trades", icon: History },
  { href: "/signals", label: "Signals", icon: Radio },
  { href: "/survival", label: "Survival", icon: ShieldAlert },
  { href: "/strategies", label: "Strategies", icon: BarChart2 },
  { href: "/lessons", label: "Lessons", icon: BookOpen },
  { href: "/config", label: "Config", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useHealth();
  const online = health === "ok";

  return (
    <aside className="flex h-screen w-52 flex-col border-r border-border bg-card/50 shrink-0">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/40">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none tracking-wide">ARIA</p>
          <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Crypto Scalper</p>
        </div>
        <div className="ml-auto">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              online ? "bg-profit animate-pulse-green" : "bg-muted-foreground"
            )}
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              online ? "bg-profit" : "bg-destructive"
            )}
          />
          <span className="text-[11px] text-muted-foreground truncate">
            {online ? "Bot connected" : "Bot offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}
