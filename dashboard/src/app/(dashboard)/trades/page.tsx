"use client";
import { useState, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTrades } from "@/hooks/useAriaData";
import { fmt, fmtPnl, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, History, TrendingUp, TrendingDown, Filter } from "lucide-react";

const STRATEGY_COLORS: Record<string, "info" | "profit" | "warning" | "secondary"> = {
  ema_ribbon:          "info",
  vwap_scalp:          "profit",
  squeeze:             "warning",
  mean_reversion:      "secondary",
  momentum:            "secondary",
  screened_vwap_scalp: "info",
};

function ConfBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = value >= 70 ? "bg-profit" : value >= 50 ? "bg-warning" : "bg-loss";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums w-5 text-right">{value}</span>
    </div>
  );
}

export default function TradesPage() {
  const [page, setPage]         = useState(1);
  const [filterDir, setFilterDir]   = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [filterResult, setFilterResult] = useState<"ALL" | "WIN" | "LOSS">("ALL");
  const { data, isLoading } = useTrades(page, 100);

  const allTrades  = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 100);

  const trades = useMemo(() => {
    return allTrades.filter((t) => {
      if (filterDir !== "ALL" && t.direction !== filterDir) return false;
      if (filterResult === "WIN" && !t.is_win) return false;
      if (filterResult === "LOSS" && t.is_win) return false;
      return true;
    });
  }, [allTrades, filterDir, filterResult]);

  const wins      = trades.filter((t) => t.is_win).length;
  const losses    = trades.length - wins;
  const totalPnl  = trades.reduce((s, t) => s + t.pnl_usd, 0);
  const winRate   = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const grossProfit = trades.filter(t => t.is_win).reduce((s, t) => s + t.pnl_usd, 0);
  const grossLoss   = Math.abs(trades.filter(t => !t.is_win).reduce((s, t) => s + t.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const avgWin    = wins > 0 ? grossProfit / wins : 0;
  const avgLoss   = losses > 0 ? grossLoss / losses : 0;

  const byStrategy = useMemo(() => {
    const map: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = {};
    trades.forEach((t) => {
      if (!map[t.strategy]) map[t.strategy] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
      map[t.strategy].trades++;
      map[t.strategy].pnl += t.pnl_usd;
      if (t.is_win) map[t.strategy].wins++; else map[t.strategy].losses++;
    });
    return Object.entries(map).sort((a, b) => b[1].pnl - a[1].pnl);
  }, [trades]);

  const byRegime = useMemo(() => {
    const map: Record<string, { wins: number; total: number; pnl: number }> = {};
    trades.forEach((t) => {
      if (!map[t.regime]) map[t.regime] = { wins: 0, total: 0, pnl: 0 };
      map[t.regime].total++;
      map[t.regime].pnl += t.pnl_usd;
      if (t.is_win) map[t.regime].wins++;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [trades]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Trade History" />
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: "Total",    value: String(total),                            color: "" },
            { label: "Showing",  value: String(trades.length),                    color: "" },
            { label: "Win Rate", value: `${winRate.toFixed(1)}%`,                 color: winRate >= 50 ? "text-profit" : "text-loss" },
            { label: "W / L",    value: `${wins} / ${losses}`,                   color: "" },
            { label: "Net P&L",  value: `${totalPnl >= 0 ? "+" : ""}$${fmt(totalPnl)}`, color: totalPnl >= 0 ? "text-profit" : "text-loss" },
            { label: "P.Factor", value: profitFactor > 100 ? "∞" : fmt(profitFactor), color: profitFactor >= 1.5 ? "text-profit" : profitFactor >= 1 ? "text-warning" : "text-loss" },
            { label: "Avg Win",  value: `+$${fmt(avgWin)}`,                       color: "text-profit" },
            { label: "Avg Loss", value: `-$${fmt(avgLoss)}`,                      color: "text-loss" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
                <p className={cn("text-[12px] font-mono font-bold tabular-nums", color || "text-foreground")}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Filter:</span>
          {(["ALL", "LONG", "SHORT"] as const).map((d) => (
            <button key={d} onClick={() => setFilterDir(d)}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                filterDir === d ? (d === "LONG" ? "bg-profit/20 text-profit" : d === "SHORT" ? "bg-loss/20 text-loss" : "bg-primary/20 text-primary")
                  : "text-muted-foreground hover:bg-secondary")}>
              {d}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          {(["ALL", "WIN", "LOSS"] as const).map((r) => (
            <button key={r} onClick={() => setFilterResult(r)}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                filterResult === r ? (r === "WIN" ? "bg-profit/20 text-profit" : r === "LOSS" ? "bg-loss/20 text-loss" : "bg-primary/20 text-primary")
                  : "text-muted-foreground hover:bg-secondary")}>
              {r}
            </button>
          ))}
        </div>

        {/* Strategy + Regime breakdown */}
        {byStrategy.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader><CardTitle>By Strategy</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {byStrategy.map(([name, s]) => {
                  const wr = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
                  return (
                    <div key={name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant={STRATEGY_COLORS[name] ?? "secondary"} className="text-[10px]">
                            {name.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{s.trades} trades</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-mono">{fmt(wr, 1)}%</span>
                          <span className={cn("text-[11px] font-mono font-bold", s.pnl >= 0 ? "text-profit" : "text-loss")}>{fmtPnl(s.pnl)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden flex">
                        <div className="bg-profit/60 h-full rounded-l-full transition-all" style={{ width: `${wr}%` }} />
                        <div className="bg-loss/40 h-full rounded-r-full transition-all" style={{ width: `${100 - wr}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>By Market Regime</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {byRegime.map(([regime, s]) => {
                  const wr = s.total > 0 ? (s.wins / s.total) * 100 : 0;
                  return (
                    <div key={regime} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="muted" className="text-[10px]">{regime || "unknown"}</Badge>
                          <span className="text-[11px] text-muted-foreground">{s.total} trades</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-mono">{fmt(wr, 1)}%</span>
                          <span className={cn("text-[11px] font-mono font-bold", s.pnl >= 0 ? "text-profit" : "text-loss")}>{fmtPnl(s.pnl)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden flex">
                        <div className="bg-profit/60 h-full rounded-l-full transition-all" style={{ width: `${wr}%` }} />
                        <div className="bg-loss/40 h-full rounded-r-full transition-all" style={{ width: `${100 - wr}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trade table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>Closed Trades</CardTitle>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Page {page}/{totalPages} · {total} total</span>
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="h-7 w-7 rounded-lg flex items-center justify-center border border-border hover:bg-secondary disabled:opacity-40 transition-colors">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="h-7 w-7 rounded-lg flex items-center justify-center border border-border hover:bg-secondary disabled:opacity-40 transition-colors">
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
                <p className="text-sm text-muted-foreground">No trades match filter</p>
              </div>
            )}
            {trades.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">#</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Dir</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Symbol</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden sm:table-cell">Strategy</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden md:table-cell">Regime</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">P&L ($)</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">P&L (%)</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden lg:table-cell">TA Conf</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden lg:table-cell">LLM Conf</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden sm:table-cell">Opened</th>
                      <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold hidden sm:table-cell">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {trades.map((t, i) => (
                      <tr key={t.signal_id} className={cn("hover:bg-secondary/40 transition-colors", t.is_win ? "bg-profit/3" : "bg-loss/3")}>
                        <td className="px-3 py-2.5 text-muted-foreground font-mono">{(page - 1) * 100 + i + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            {t.direction === "LONG"
                              ? <TrendingUp className="h-3 w-3 text-profit" />
                              : <TrendingDown className="h-3 w-3 text-loss" />}
                            <Badge variant={t.direction === "LONG" ? "profit" : "loss"} className="text-[9px] px-1.5 py-0">{t.direction}</Badge>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-bold text-[13px] whitespace-nowrap">{t.symbol}</td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <Badge variant={STRATEGY_COLORS[t.strategy] ?? "secondary"} className="text-[9px]">
                            {t.strategy.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell text-[11px]">{t.regime || "—"}</td>
                        <td className={cn("px-3 py-2.5 font-mono tabular-nums font-bold whitespace-nowrap", t.is_win ? "text-profit" : "text-loss")}>
                          {t.pnl_usd >= 0 ? "+" : ""}${fmt(t.pnl_usd)}
                        </td>
                        <td className={cn("px-3 py-2.5 font-mono tabular-nums whitespace-nowrap", t.is_win ? "text-profit" : "text-loss")}>
                          {t.pnl_pct >= 0 ? "+" : ""}{fmt(t.pnl_pct)}%
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell">
                          {t.ta_confidence != null ? <ConfBar value={t.ta_confidence} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell">
                          {t.llm_confidence != null ? <ConfBar value={t.llm_confidence} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell text-[11px]">{timeAgo(t.entry_time)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell text-[11px]">{timeAgo(t.exit_time)}</td>
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
