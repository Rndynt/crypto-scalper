"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, TrendingUp, History, Radio,
  ShieldAlert, BarChart2, BookOpen, Settings, Zap,
} from "lucide-react";
import { useHealth } from "@/hooks/useAriaData";

const nav = [
  { href: "/overview",   label: "Overview",    icon: LayoutDashboard },
  { href: "/positions",  label: "Positions",   icon: TrendingUp },
  { href: "/trades",     label: "Trades",      icon: History },
  { href: "/signals",    label: "Signals",     icon: Radio },
  { href: "/survival",   label: "Survival",    icon: ShieldAlert },
  { href: "/strategies", label: "Strategies",  icon: BarChart2 },
  { href: "/lessons",    label: "Lessons",     icon: BookOpen },
  { href: "/config",     label: "Config",      icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useHealth();
  const online = health === "ok";
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => { setPending(null); }, [pathname]);

  function isActive(href: string) {
    if (pending) return pending === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex h-screen flex-col border-r border-border bg-card shrink-0 w-[180px]">
        <div className="flex h-12 items-center gap-3 px-4 border-b border-border shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30 shrink-0">
            <Zap className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-bold leading-none tracking-widest text-foreground">ARIA</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-1">Crypto Scalper</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setPending(href)}
                className={cn(
                  "group flex items-center gap-3 px-3 h-9 w-full rounded-md text-[13px] font-medium transition-colors duration-100 select-none",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-2 shrink-0">
          <div className={cn(
            "flex items-center gap-2 px-3 h-8 rounded-md text-[11px] font-medium",
            online ? "text-primary" : "text-muted-foreground"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", online ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
            {online ? "Connected" : "Offline"}
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 flex h-12 items-center gap-3 px-4 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30 shrink-0">
          <Zap className="h-3.5 w-3.5 text-primary" />
        </div>
        <p className="text-[13px] font-bold tracking-widest text-foreground">ARIA</p>
        <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
        <span className="ml-auto text-[10px] font-medium text-muted-foreground">{online ? "● live" : "○ offline"}</span>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border">
        {/* Row 1: first 4 items */}
        <div className="grid grid-cols-4 h-14">
          {nav.slice(0, 4).map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setPending(href)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 select-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </div>
        {/* Divider */}
        <div className="h-px bg-border/50 mx-4" />
        {/* Row 2: last 4 items */}
        <div className="grid grid-cols-4 h-14">
          {nav.slice(4).map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setPending(href)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 select-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
