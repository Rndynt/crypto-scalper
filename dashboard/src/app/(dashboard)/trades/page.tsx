"use client";
import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTrades } from "@/hooks/useAriaData";
import { fmt, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

const STRATEGY_COLORS: Record<string, "info" | "profit" | "warning" | "secondary"> = {
  ema_ribbon:          "info",
  vwap_scalp:          "profit",
  squeeze:             "warning",
  mean_reversion:      "secondary",
  momentum:            "secondary",
  screened_vwap_scalp: "info",
};

export default function TradesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTrades(page, 50);

  const trades     = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);
  const wins       = trades.filter((t) => t.is_win).length;
  const totalPnl   = trades.reduce((s, t) => s + t.pnl_usd, 0);
  const winRate    = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="Trade History" />
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3">

        {/* Summary bar */}
        {trades.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Showing",   value: `${trades.length} / ${total}`,    color: "" },
              { label: "Win Rate",  value: `${winRate.toFixed(1)}%`,          color: winRate >= 50 ? "text-profit" : "text-loss" },
              { label: "Net P&L",   value: `${totalPnl >= 0 ? "+" : ""}$${fmt(totalPnl)}`, color: totalPnl >= 0 ? "text-profit" : "text-loss" },
              { label: "W / L",     value: `${wins} / ${trades.length - wins}`, color: "" },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
                  <p className={cn("text-[13px] font-mono font-bold tabular-nums", color || "text-foreground")}>{value}</p>
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
                  <span className="text-[11px] text-muted-foreground">{page}/{totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="h-7 w-7 rounded-lg flex items-center justify-center border border-border hover:bg-secondary disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="h-7 w-7 rounded-lg flex items-center justify-center border border-border hover:bg-secondary disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading…</div>
            )}
            {!isLoading && trades.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                  <History className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">No closed trades yet</p>
              </div>
            )}
            {trades.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Dir", "Symbol", "Strategy", "P&L", "%", "TA", "LLM", "Closed"].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold whitespace-nowrap",
                            i === 2 && "hidden sm:table-cell",
                            i === 5 && "hidden md:table-cell",
                            i === 6 && "hidden md:table-cell",
                            i === 7 && "hidden sm:table-cell",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {trades.map((t) => (
                      <tr key={t.signal_id} className="hover:bg-secondary/40 transition-colors">
                        <td className="px-3 py-2.5">
                          <Badge variant={t.direction === "LONG" ? "profit" : "loss"}>{t.direction}</Badge>
                        </td>
                        <td className="px-3 py-2.5 font-semibold whitespace-nowrap text-[13px]">{t.symbol}</td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <Badge variant={STRATEGY_COLORS[t.strategy] ?? "secondary"}>
                            {t.strategy.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className={cn(
                          "px-3 py-2.5 font-mono tabular-nums font-bold whitespace-nowrap",
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
                        <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground hidden md:table-cell">{t.ta_confidence ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground hidden md:table-cell">{t.llm_confidence ?? "—"}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">{timeAgo(t.exit_time)}</td>
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
