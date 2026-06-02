"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStatus } from "@/hooks/useAriaData";
import { fmt, fmtPnl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BarChart2, TrendingUp, TrendingDown, Flame } from "lucide-react";

export default function StrategiesPage() {
  const { data: status } = useStatus();
  const strategies = Object.values(status?.shared?.strategy_health ?? {});
  const sorted     = [...strategies].sort((a, b) => b.total_pnl - a.total_pnl);

  return (
    <div className="flex flex-col h-full">
      <Header title="Strategy Health" />
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">

        {strategies.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                <BarChart2 className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">No strategy data yet</p>
              <p className="text-[11px] text-muted-foreground/60">Run some trades first</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sorted.map((s) => {
            const winRate = s.win_rate * 100;
            const winPct  = s.total_trades > 0 ? (s.wins / s.total_trades) * 100 : 0;
            const lossPct = 100 - winPct;

            return (
              <Card
                key={s.name}
                className={cn("border transition-opacity", !s.enabled && "opacity-50 border-dashed")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle>{s.name.replace(/_/g, " ")}</CardTitle>
                      {!s.enabled && <Badge variant="muted">Disabled</Badge>}
                      {s.enabled && s.size_multiplier < 1 && (
                        <Badge variant="warning">×{fmt(s.size_multiplier, 2)} size</Badge>
                      )}
                    </div>
                    <Badge variant={s.total_pnl >= 0 ? "profit" : "loss"}>
                      {fmtPnl(s.total_pnl)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Win rate bar */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-muted-foreground">Win rate</span>
                      <span className={cn("font-mono font-semibold", winRate >= 50 ? "text-profit" : "text-loss")}>
                        {winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                      <div className="bg-profit/60 h-full rounded-l-full" style={{ width: `${winPct}%` }} />
                      <div className="bg-loss/50 h-full rounded-r-full" style={{ width: `${lossPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] mt-1">
                      <span className="text-profit font-semibold">{s.wins}W</span>
                      <span className="text-loss font-semibold">{s.losses}L</span>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Total Trades", value: String(s.total_trades), color: "" },
                      { label: "Avg P&L",      value: fmtPnl(s.avg_pnl),     color: s.avg_pnl >= 0 ? "text-profit" : "text-loss" },
                      { label: "Size Mult",    value: `×${fmt(s.size_multiplier, 2)}`, color: s.size_multiplier >= 1 ? "text-foreground" : "text-warning" },
                      { label: "Loss Streak",  value: String(s.loss_streak),  color: s.loss_streak >= 5 ? "text-loss" : s.loss_streak >= 3 ? "text-warning" : "text-muted-foreground", icon: s.loss_streak >= 3 ? Flame : null },
                    ].map(({ label, value, color, icon: I }) => (
                      <div key={label} className="rounded-lg bg-secondary/60 px-3 py-2">
                        <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                        <p className={cn("text-[12px] font-mono tabular-nums font-semibold flex items-center gap-1", color || "text-foreground")}>
                          {I && <I className="h-3 w-3" />}
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* P&L bar */}
                  <div className="flex items-center gap-2">
                    {s.total_pnl >= 0
                      ? <TrendingUp  className="h-4 w-4 text-profit shrink-0" />
                      : <TrendingDown className="h-4 w-4 text-loss shrink-0" />}
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", s.total_pnl >= 0 ? "bg-profit" : "bg-loss")}
                        style={{ width: `${Math.min(Math.abs(s.total_pnl) / 100 * 20 + 10, 100)}%` }}
                      />
                    </div>
                    <span className={cn("text-[12px] font-mono tabular-nums font-semibold", s.total_pnl >= 0 ? "text-profit" : "text-loss")}>
                      {fmtPnl(s.total_pnl)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
