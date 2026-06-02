"use client";
import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTrades } from "@/hooks/useAriaData";
import { fmt, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

const STRATEGY_COLORS: Record<string, "info" | "profit" | "warning" | "secondary"> = {
  ema_ribbon: "info",
  vwap_scalp: "profit",
  squeeze: "warning",
  mean_reversion: "secondary",
  momentum: "secondary",
  screened_vwap_scalp: "info",
};

export default function TradesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTrades(page, 50);

  const trades = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const wins = trades.filter((t) => t.is_win).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl_usd, 0);
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="Trade History" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

        {/* Summary bar */}
        {trades.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Showing", value: `${trades.length} of ${total}` },
              { label: "Win Rate", value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? "text-profit" : "text-loss" },
              { label: "Net P&L", value: `${totalPnl >= 0 ? "+" : ""}$${fmt(totalPnl)}`, color: totalPnl >= 0 ? "text-profit" : "text-loss" },
              { label: "W / L", value: `${wins} / ${trades.length - wins}` },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
                  <p className={cn("text-sm font-mono font-semibold tabular-nums", color ?? "text-foreground")}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Closed Trades</CardTitle>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Page {page}/{totalPages}</span>
                  <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {!isLoading && trades.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <History className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No closed trades yet</p>
              </div>
            )}
            {trades.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {/* Mobile: show fewer columns */}
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap">Dir</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap">Symbol</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap hidden sm:table-cell">Strategy</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap">P&L</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap">%</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap hidden md:table-cell">TA</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap hidden md:table-cell">LLM</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap hidden sm:table-cell">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {trades.map((t) => (
                      <tr key={t.signal_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <Badge variant={t.direction === "LONG" ? "profit" : "loss"}>{t.direction}</Badge>
                        </td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">{t.symbol}</td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <Badge variant={STRATEGY_COLORS[t.strategy] ?? "secondary"} className="whitespace-nowrap">
                            {t.strategy.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className={cn(
                          "px-3 py-2.5 font-mono tabular-nums font-semibold whitespace-nowrap",
                          t.is_win ? "text-profit" : "text-loss"
                        )}>
                          {t.pnl_usd >= 0 ? "+" : ""}${fmt(t.pnl_usd)}
                        </td>
                        <td className={cn(
                          "px-3 py-2.5 font-mono tabular-nums whitespace-nowrap",
                          t.is_win ? "text-profit" : "text-loss"
                        )}>
                          {t.pnl_pct >= 0 ? "+" : ""}{fmt(t.pnl_pct)}%
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground hidden md:table-cell">
                          {t.ta_confidence ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground hidden md:table-cell">
                          {t.llm_confidence ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                          {timeAgo(t.exit_time)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
