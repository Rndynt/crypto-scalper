"use client";
import { useStatus } from "@/hooks/useAriaData";
import { fmt, fmtPct } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Header({ title }: { title: string }) {
  const { data, isLoading, mutate } = useStatus();

  const equity = data?.shared?.equity ?? 0;
  const pnlToday = data?.shared?.realized_pnl_today ?? 0;
  const mode = data?.config?.mode ?? "…";
  const positions = data?.shared?.open_positions ?? 0;
  const drawdown = data?.shared?.drawdown_pct ?? 0;

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border px-6 gap-6">
      <h1 className="text-sm font-semibold text-foreground">{title}</h1>

      <div className="ml-auto flex items-center gap-4">
        {/* Mode badge */}
        <Badge variant={mode === "paper" ? "info" : mode === "live" ? "profit" : "muted"}>
          {mode}
        </Badge>

        {/* Equity */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Equity</span>
          <span className="font-mono font-medium tabular-nums">${fmt(equity)}</span>
        </div>

        {/* Daily PnL */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Daily P&L</span>
          <span
            className={cn(
              "font-mono font-medium tabular-nums flex items-center gap-0.5",
              pnlToday >= 0 ? "text-profit" : "text-loss"
            )}
          >
            {pnlToday >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {fmtPct(pnlToday)}
          </span>
        </div>

        {/* Open positions */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Open</span>
          <span className="font-mono font-medium">{positions}</span>
        </div>

        {/* Drawdown */}
        {drawdown > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">DD</span>
            <span
              className={cn(
                "font-mono font-medium tabular-nums",
                drawdown > 5 ? "text-loss" : drawdown > 2 ? "text-warning" : "text-muted-foreground"
              )}
            >
              {fmtPct(-drawdown)}
            </span>
          </div>
        )}

        {/* Refresh */}
        <button
          onClick={() => mutate()}
          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </div>
    </header>
  );
}
