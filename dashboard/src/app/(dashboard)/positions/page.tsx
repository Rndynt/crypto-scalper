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
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3">

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {!isLoading && (!positions || positions.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No open positions</p>
              <p className="text-[11px] text-muted-foreground/60">ARIA opens positions when signals align</p>
            </CardContent>
          </Card>
        )}

        {positions?.map((p) => {
          const rr = p.entry_price > 0 && p.stop_loss > 0 && p.take_profit > 0
            ? Math.abs(p.take_profit - p.entry_price) / Math.abs(p.entry_price - p.stop_loss)
            : null;
          const holdPct  = (p.duration_mins * 60) / maxHoldSecs;
          const nearExpiry = holdPct > 0.8;
          const isLong   = p.side === "LONG";
          const pnl      = p.unrealized_pnl ?? 0;
          const pnlPct   = p.unrealized_pnl_pct ?? 0;

          return (
            <Card
              key={p.client_id}
              className={cn(
                "border transition-colors",
                isLong ? "border-profit/20" : "border-loss/20"
              )}
            >
              <CardContent className="p-4">
                {/* Top row */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Badge variant={isLong ? "profit" : "loss"} className="text-xs px-2.5 py-1">
                      {p.side}
                    </Badge>
                    <div>
                      <p className="text-[15px] font-bold">{p.symbol}</p>
                      <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{p.strategy.replace(/_/g, " ")}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    {p.unrealized_pnl != null ? (
                      <p className={cn(
                        "text-[18px] font-bold font-mono tabular-nums",
                        pnl >= 0 ? "text-profit" : "text-loss"
                      )}>
                        {fmtPnl(pnl)}
                        <span className="text-sm font-medium ml-1 opacity-80">
                          ({fmtPct(pnlPct)})
                        </span>
                      </p>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">Updating…</p>
                    )}
                    <div className={cn(
                      "flex items-center justify-end gap-1 text-[11px] mt-0.5",
                      nearExpiry ? "text-warning" : "text-muted-foreground"
                    )}>
                      {nearExpiry && <AlertTriangle className="h-3 w-3" />}
                      <Clock className="h-3 w-3" />
                      {formatDuration(p.duration_mins)}
                    </div>
                  </div>
                </div>

                {/* Price levels */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Entry",       value: fmt(p.entry_price), color: "text-foreground" },
                    { label: "Stop Loss",   value: fmt(p.stop_loss),   color: "text-loss" },
                    { label: "Take Profit", value: fmt(p.take_profit), color: "text-profit" },
                    { label: "Size",        value: fmt(p.size, 4),     color: "text-foreground" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg bg-secondary/60 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                      <p className={cn("text-[13px] font-mono tabular-nums font-semibold", color)}>{value}</p>
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
                    <Badge variant="profit">
                      Partial +${fmt(p.partial_realized_pnl)}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Hold</span>
                    <div className="w-20 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", nearExpiry ? "bg-warning" : "bg-primary")}
                        style={{ width: `${Math.min(holdPct * 100, 100)}%` }}
                      />
                    </div>
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
