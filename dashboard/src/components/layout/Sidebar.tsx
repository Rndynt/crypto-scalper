"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
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
  MoreHorizontal,
} from "lucide-react";
import { useHealth } from "@/hooks/useAriaData";

const nav = [
  { href: "/overview",    label: "Overview",    icon: LayoutDashboard },
  { href: "/positions",   label: "Positions",   icon: TrendingUp },
  { href: "/trades",      label: "Trades",      icon: History },
  { href: "/signals",     label: "Signals",     icon: Radio },
  { href: "/survival",    label: "Survival",    icon: ShieldAlert },
  { href: "/strategies",  label: "Strategies",  icon: BarChart2 },
  { href: "/lessons",     label: "Lessons",     icon: BookOpen },
  { href: "/config",      label: "Config",      icon: Settings },
];

const mobileNav = nav.slice(0, 5);
const moreNav   = nav.slice(5);

export function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useHealth();
  const online = health === "ok";

  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setPending(null);
  }, [pathname]);

  function isActive(href: string) {
    if (pending) return pending === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  const moreActive = moreNav.some(({ href }) => isActive(href));
  const moreTarget = moreNav.find(({ href }) => isActive(href))?.href ?? moreNav[0].href;

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex h-screen w-[200px] flex-col border-r border-border bg-card shrink-0">
        {/* Logo */}
        <div className="flex h-[52px] items-center gap-3 px-4 border-b border-border">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-profit/15 ring-1 ring-profit/30 shrink-0">
            <Zap className="h-3.5 w-3.5 text-profit" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold leading-none tracking-widest text-foreground">ARIA</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-1">Crypto Scalper</p>
          </div>
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full shrink-0 transition-colors",
              online ? "bg-profit animate-pulse-green" : "bg-muted-foreground/40"
            )}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setPending(href)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-100 select-none",
                  active
                    ? "bg-profit/10 text-profit nav-active-glow"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-profit" : "text-muted-foreground group-hover:text-foreground")} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3">
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11px] font-medium",
            online ? "bg-profit/8 text-profit" : "bg-secondary text-muted-foreground"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              online ? "bg-profit" : "bg-muted-foreground/50"
            )} />
            {online ? "Bot connected" : "Bot offline"}
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ───────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-11 items-center gap-2.5 border-b border-border glass px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-profit/15 ring-1 ring-profit/30">
          <Zap className="h-3.5 w-3.5 text-profit" />
        </div>
        <p className="text-[13px] font-bold tracking-widest">ARIA</p>
        <span className={cn(
          "h-1.5 w-1.5 rounded-full ml-0.5",
          online ? "bg-profit animate-pulse-green" : "bg-muted-foreground/40"
        )} />
        <span className="text-[10px] text-muted-foreground ml-auto">
          {online ? "● connected" : "○ offline"}
        </span>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-border glass h-[60px]">
        {mobileNav.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setPending(href)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-100 select-none active:scale-95",
                active ? "text-profit" : "text-muted-foreground"
              )}
            >
              <div className={cn(
                "flex items-center justify-center h-7 w-7 rounded-lg transition-all",
                active ? "bg-profit/12" : ""
              )}>
                <Icon className="h-[18px] w-[18px] shrink-0" />
              </div>
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}

        {/* More slot */}
        <Link
          href={moreTarget}
          onClick={() => setPending(moreTarget)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-100 select-none active:scale-95",
            moreActive ? "text-profit" : "text-muted-foreground"
          )}
        >
          <div className={cn(
            "flex items-center justify-center h-7 w-7 rounded-lg transition-all",
            moreActive ? "bg-profit/12" : ""
          )}>
            <MoreHorizontal className="h-[18px] w-[18px] shrink-0" />
          </div>
          <span className="leading-none">More</span>
        </Link>
      </nav>
    </>
  );
}
