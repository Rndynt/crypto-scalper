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
  { href: "/overview",    label: "Overview",    icon: LayoutDashboard },
  { href: "/positions",   label: "Positions",   icon: TrendingUp },
  { href: "/trades",      label: "Trades",      icon: History },
  { href: "/signals",     label: "Signals",     icon: Radio },
  { href: "/survival",    label: "Survival",    icon: ShieldAlert },
  { href: "/strategies",  label: "Strategies",  icon: BarChart2 },
  { href: "/lessons",     label: "Lessons",     icon: BookOpen },
  { href: "/config",      label: "Config",      icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useHealth();
  const online = health === "ok";

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex h-screen w-52 flex-col border-r border-border bg-card/50 shrink-0">
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

      {/* ── Mobile top bar (logo + status) ──────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-12 items-center gap-2.5 border-b border-border bg-card/95 backdrop-blur-sm px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 ring-1 ring-primary/40">
          <Zap className="h-3.5 w-3.5 text-primary" />
        </div>
        <p className="text-sm font-semibold tracking-wide">ARIA</p>
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full ml-0.5",
            online ? "bg-profit animate-pulse-green" : "bg-muted-foreground"
          )}
        />
        <span className="text-[10px] text-muted-foreground ml-auto">
          {online ? "connected" : "offline"}
        </span>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center border-t border-border bg-card/95 backdrop-blur-sm">
        {nav.slice(0, 5).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
        {/* More menu — show remaining pages grouped under last slot */}
        {(() => {
          const moreActive = nav.slice(5).some(
            ({ href }) => pathname === href || pathname.startsWith(href + "/")
          );
          return (
            <Link
              href={pathname.startsWith("/strategies") || pathname.startsWith("/lessons") || pathname.startsWith("/config") ? pathname : "/strategies"}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors",
                moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart2 className="h-5 w-5 shrink-0" />
              <span className="leading-none">More</span>
            </Link>
          );
        })()}
      </nav>
    </>
  );
}
