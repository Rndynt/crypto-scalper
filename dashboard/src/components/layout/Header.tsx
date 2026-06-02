"use client";
import { useStatus } from "@/hooks/useAriaData";
import { fmt, fmtPct } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

export function Header({ title }: { title: string }) {
  const { data, isLoading, mutate } = useStatus();

  const equity    = data?.shared?.equity ?? 0;
  const pnlToday  = data?.shared?.realized_pnl_today ?? 0;
  const mode      = data?.config?.mode ?? "—";
  const positions = data?.shared?.open_positions ?? 0;

  return (
    <header className="flex h-[52px] shrink-0 items-center border-b border-border px-4 md:px-5 gap-4">
      <h1 className="text-[13px] font-semibold text-foreground tracking-wide">{title}</h1>

      <div className="ml-auto flex items-center gap-3 overflow-hidden">
        {/* Mode pill */}
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md",
          mode === "paper" ? "bg-info/15 text-info" :
          mode === "live"  ? "bg-profit/15 text-profit" :
                             "bg-secondary text-muted-foreground"
        )}>
          {mode}
        </span>

        {/* Equity */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="hidden sm:block text-muted-foreground text-[11px]">EQ</span>
          <span className="font-mono font-semibold tabular-nums">${fmt(equity)}</span>
        </div>

        {/* Daily P&L */}
        <div className={cn(
          "hidden sm:flex items-center gap-1 text-xs font-mono font-semibold tabular-nums",
          pnlToday >= 0 ? "text-profit" : "text-loss"
        )}>
          {pnlToday >= 0
            ? <TrendingUp className="h-3 w-3" />
            : <TrendingDown className="h-3 w-3" />}
          {fmtPct(pnlToday)}
        </div>

        {/* Open positions */}
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
          <span className="text-[11px]">Open</span>
          <span className={cn("font-mono font-semibold", positions > 0 ? "text-info" : "text-foreground")}>
            {positions}
          </span>
        </div>

        {/* Refresh */}
        <button
          onClick={() => mutate()}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </div>
    </header>
  );
}
