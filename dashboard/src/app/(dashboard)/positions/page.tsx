"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePositions, useStatus } from "@/hooks/useAriaData";
import { fmt, fmtPct, fmtPnl, formatDuration } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Clock, ShieldCheck, TrendingUp, AlertTriangle } from "lucide-react";

export default function PositionsPage() {
  const { data: positions, isLoading } = usePositions();
  const { data: status } = useStatus();

  const maxHoldSecs = status?.config?.max_hold_secs ?? 3600;

  return (
    <div className="flex flex-col h-full">
      <Header title="Open Positions" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Loading positions…
          </div>
        )}

        {!isLoading && (!positions || positions.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No open positions</p>
              <p className="text-xs text-muted-foreground/60">ARIA will open positions when signals align</p>
            </CardContent>
          </Card>
        )}

        {positions?.map((p) => {
          const rr = p.entry_price > 0 && p.stop_loss > 0 && p.take_profit > 0
            ? Math.abs(p.take_profit - p.entry_price) / Math.abs(p.entry_price - p.stop_loss)
            : null;
          const holdPct = (p.duration_mins * 60) / maxHoldSecs;
          const nearExpiry = holdPct > 0.8;

          return (
            <Card key={p.client_id} className={cn(
              "border transition-colors",
              p.side === "LONG" ? "border-profit/20" : "border-loss/20"
            )}>
              <CardContent className="p-4">
                {/* Top row: symbol + PnL */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Badge variant={p.side === "LONG" ? "profit" : "loss"} className="text-sm px-3 py-1">
                      {p.side}
                    </Badge>
                    <div>
                      <p className="text-base font-semibold">{p.symbol}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[160px] sm:max-w-none">{p.strategy}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    {p.unrealized_pnl != null ? (
                      <p className={cn(
                        "text-lg font-bold font-mono tabular-nums",
                        p.unrealized_pnl >= 0 ? "text-profit" : "text-loss"
                      )}>
                        {fmtPnl(p.unrealized_pnl)}
                        <span className="text-sm ml-1">
                          ({fmtPct(p.unrealized_pnl_pct ?? 0)})
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">P&L updating…</p>
                    )}
                    <div className={cn(
                      "flex items-center justify-end gap-1 text-xs mt-0.5",
                      nearExpiry ? "text-warning" : "text-muted-foreground"
                    )}>
                      {nearExpiry && <AlertTriangle className="h-3 w-3" />}
                      <Clock className="h-3 w-3" />
                      {formatDuration(p.duration_mins)}
                    </div>
                  </div>
                </div>

                {/* Price levels */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
                  {[
                    { label: "Entry",       value: fmt(p.entry_price), color: "text-foreground" },
                    { label: "Stop Loss",   value: fmt(p.stop_loss),   color: "text-loss" },
                    { label: "Take Profit", value: fmt(p.take_profit), color: "text-profit" },
                    { label: "Size",        value: fmt(p.size, 4),     color: "text-foreground" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-md bg-muted/50 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                      <p className={cn("text-sm font-mono tabular-nums font-medium", color)}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Flags + hold bar */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {rr != null && <Badge variant="secondary">R:R {fmt(rr, 2)}</Badge>}
                  {p.trailing_activated && (
                    <Badge variant="info" className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Trailing SL
                    </Badge>
                  )}
                  {p.breakeven_activated && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" /> Breakeven
                    </Badge>
                  )}
                  {p.partial_taken && (
                    <Badge variant="profit" className="flex items-center gap-1">
                      ⚡ Partial +${fmt(p.partial_realized_pnl)}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Hold</span>
                    <div className="w-16 sm:w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", nearExpiry ? "bg-warning" : "bg-primary")}
                        style={{ width: `${Math.min(holdPct * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDuration(Math.round(maxHoldSecs / 60))}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
