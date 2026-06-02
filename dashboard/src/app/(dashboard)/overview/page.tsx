"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EquityMiniChart } from "@/components/charts/EquityMiniChart";
import { PnlBarChart } from "@/components/charts/PnlBarChart";
import { WinRateDonut } from "@/components/charts/WinRateDonut";
import { useStatus, useTrades, usePositions } from "@/hooks/useAriaData";
import { fmt, fmtPct, fmtPnl, formatDuration } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, DollarSign, Activity,
  Brain, Layers, Clock, ShieldCheck,
} from "lucide-react";
import { useState, useEffect } from "react";

interface EquityPoint { t: string; v: number; }

function KpiCard({
  title, value, sub, icon: Icon, color, trend,
}: {
  title: string; value: string; sub?: string;
  icon: React.ElementType; color: string; trend?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
          <div className={cn("flex items-center justify-center h-7 w-7 rounded-lg", color + "/10")}>
            <Icon className={cn("h-3.5 w-3.5", color)} />
          </div>
        </div>
        <p className={cn("text-xl font-bold font-mono tabular-nums", color)}>{value}</p>
        <div className="flex items-center justify-between mt-1">
          {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          {trend && (
            <span className={cn(
              "text-[10px] font-semibold font-mono",
              trend.startsWith("+") ? "text-profit" : "text-loss"
            )}>{trend}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { data: status } = useStatus();
  const { data: trades } = useTrades(1, 100);
  const { data: positions } = usePositions();
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);

  const shared       = status?.shared;
  const metrics      = status?.metrics;
  const equity       = shared?.equity ?? 0;
  const initialEquity = shared?.initial_equity ?? equity;
  const pnlToday     = shared?.realized_pnl_today ?? 0;
  const drawdown     = shared?.drawdown_pct ?? 0;
  const openPositions = shared?.open_positions ?? 0;
  const totalPnl     = equity - initialEquity;
  const totalPnlPct  = initialEquity > 0 ? ((equity - initialEquity) / initialEquity) * 100 : 0;

  const closedTrades  = trades?.items ?? [];
  const wins          = closedTrades.filter((t) => t.is_win).length;
  const losses        = closedTrades.filter((t) => !t.is_win).length;
  const totalTrades   = wins + losses;
  const winRate       = totalTrades > 0 ? wins / totalTrades : 0;
  const grossProfit   = closedTrades.filter((t) => t.is_win).reduce((s, t) => s + t.pnl_usd, 0);
  const grossLoss     = Math.abs(closedTrades.filter((t) => !t.is_win).reduce((s, t) => s + t.pnl_usd, 0));
  const profitFactor  = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  useEffect(() => {
    if (!equity) return;
    const now = new Date();
    const t = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setEquityHistory((prev) => [...prev, { t, v: equity }].slice(-120));
  }, [equity]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Overview" />
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            title="Equity"
            value={`$${fmt(equity)}`}
            sub={`Initial $${fmt(initialEquity)}`}
            icon={DollarSign}
            color="text-foreground"
            trend={totalPnlPct !== 0 ? fmtPct(totalPnlPct) : undefined}
          />
          <KpiCard
            title="Daily P&L"
            value={fmtPnl(pnlToday)}
            sub={`${metrics?.trades_today ?? 0} trades today`}
            icon={pnlToday >= 0 ? TrendingUp : TrendingDown}
            color={pnlToday >= 0 ? "text-profit" : "text-loss"}
          />
          <KpiCard
            title="Drawdown"
            value={fmtPct(-drawdown)}
            sub={`Peak $${fmt(shared?.peak_equity ?? equity)}`}
            icon={Activity}
            color={drawdown > 5 ? "text-loss" : drawdown > 2 ? "text-warning" : "text-profit"}
          />
          <KpiCard
            title="Open"
            value={String(openPositions)}
            sub={`Max ${status?.config?.max_open_positions ?? "—"}`}
            icon={Layers}
            color={openPositions > 0 ? "text-info" : "text-muted-foreground"}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Equity Curve</CardTitle>
                <span className={cn(
                  "text-xs font-mono tabular-nums font-semibold",
                  totalPnlPct >= 0 ? "text-profit" : "text-loss"
                )}>
                  {fmtPct(totalPnlPct)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-36 md:h-44">
                <EquityMiniChart
                  data={equityHistory}
                  color={totalPnlPct >= 0 ? "#16c784" : "#ea3943"}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Win Rate</CardTitle>
                <span className="text-[11px] text-muted-foreground">{totalTrades} trades</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-36 md:h-44">
                <WinRateDonut winRate={winRate} wins={wins} losses={losses} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Trade bars + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Last 30 Trades (P&L)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-28 md:h-32">
                <PnlBarChart trades={closedTrades} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stats</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { label: "Profit Factor", value: profitFactor > 100 ? "∞" : fmt(profitFactor), color: profitFactor >= 1.5 ? "text-profit" : profitFactor >= 1 ? "text-warning" : "text-loss" },
                  { label: "Gross Profit",  value: `+$${fmt(grossProfit)}`,    color: "text-profit" },
                  { label: "Gross Loss",    value: `-$${fmt(grossLoss)}`,      color: "text-loss" },
                  { label: "LLM Go",        value: String(metrics?.llm_go ?? 0),   color: "text-profit" },
                  { label: "LLM No-Go",     value: String(metrics?.llm_nogo ?? 0), color: "text-loss" },
                  { label: "LLM Conf",      value: `${fmt(metrics?.llm_avg_confidence ?? 0, 0)}%`, color: "text-foreground" },
                  { label: "Latency",       value: `${metrics?.llm_avg_latency_ms ?? 0}ms`,        color: "text-muted-foreground" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className={cn("text-[11px] font-mono tabular-nums font-semibold", color)}>{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Open positions */}
        {positions && positions.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Open Positions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {positions.map((p) => (
                <div key={p.client_id} className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 border",
                  p.side === "LONG" ? "bg-profit/5 border-profit/15" : "bg-loss/5 border-loss/15"
                )}>
                  <Badge variant={p.side === "LONG" ? "profit" : "loss"}>{p.side}</Badge>
                  <span className="text-[13px] font-semibold">{p.symbol}</span>
                  <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">{p.strategy}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">@{fmt(p.entry_price)}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatDuration(p.duration_mins)}
                  </span>
                  {p.trailing_activated && <Badge variant="info">trailing</Badge>}
                  {p.breakeven_activated && <Badge variant="secondary">BE</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* LLM + Regime */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="h-3.5 w-3.5 text-muted-foreground" />
                <CardTitle>LLM Brain</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { label: "Strategies", value: status?.config?.active_strategies?.join(", ") ?? "—" },
                  { label: "Offline Fallbacks", value: String(metrics?.llm_offline_fallbacks ?? 0) },
                  { label: "Active Lessons",    value: String(metrics?.active_lessons ?? 0) },
                  { label: "Signals Today",     value: String(metrics?.signals_today ?? 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-mono text-foreground truncate max-w-[55%] text-right">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <CardTitle>Market Regime</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { label: "Regime",          value: shared?.current_regime ?? "—" },
                  { label: "Survival Mode",   value: shared?.survival_mode ?? "—" },
                  { label: "Survival Score",  value: fmt(shared?.survival_score ?? 0) },
                  { label: "Unrealized P&L",  value: fmtPnl(shared?.unrealized_pnl ?? 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-mono text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
