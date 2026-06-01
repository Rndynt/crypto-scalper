"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EquityMiniChart } from "@/components/charts/EquityMiniChart";
import { PnlBarChart } from "@/components/charts/PnlBarChart";
import { WinRateDonut } from "@/components/charts/WinRateDonut";
import { useStatus, useTrades, usePositions } from "@/hooks/useAriaData";
import { fmt, fmtPct, fmtPnl, formatDuration, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, DollarSign, Activity,
  BarChart2, Brain, Layers, Clock,
} from "lucide-react";
import { useState, useEffect } from "react";

interface EquityPoint { t: string; v: number; }

function KpiCard({
  title, value, sub, icon: Icon, color, badge,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: "profit" | "loss" | "neutral" | "info" | "warning";
  badge?: string;
}) {
  const colorMap = {
    profit: "text-profit",
    loss: "text-loss",
    neutral: "text-foreground",
    info: "text-info",
    warning: "text-warning",
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Icon className={cn("h-4 w-4", colorMap[color])} />
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold font-mono tabular-nums", colorMap[color])}>
          {value}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        {badge && (
          <Badge variant={color === "profit" ? "profit" : color === "loss" ? "loss" : "muted"} className="mt-2">
            {badge}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { data: status } = useStatus();
  const { data: trades } = useTrades(1, 100);
  const { data: positions } = usePositions();
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);

  const shared = status?.shared;
  const metrics = status?.metrics;
  const equity = shared?.equity ?? 0;
  const initialEquity = shared?.initial_equity ?? equity;
  const pnlToday = shared?.realized_pnl_today ?? 0;
  const drawdown = shared?.drawdown_pct ?? 0;
  const openPositions = shared?.open_positions ?? 0;
  const totalPnl = equity - initialEquity;
  const totalPnlPct = initialEquity > 0 ? ((equity - initialEquity) / initialEquity) * 100 : 0;

  const closedTrades = trades?.items ?? [];
  const wins = closedTrades.filter((t) => t.is_win).length;
  const losses = closedTrades.filter((t) => !t.is_win).length;
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const grossProfit = closedTrades.filter((t) => t.is_win).reduce((s, t) => s + t.pnl_usd, 0);
  const grossLoss = Math.abs(closedTrades.filter((t) => !t.is_win).reduce((s, t) => s + t.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  useEffect(() => {
    if (!equity) return;
    const now = new Date();
    const t = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setEquityHistory((prev) => {
      const next = [...prev, { t, v: equity }].slice(-120);
      return next;
    });
  }, [equity]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Overview" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Equity"
            value={`$${fmt(equity)}`}
            sub={`Initial: $${fmt(initialEquity)}`}
            icon={DollarSign}
            color="neutral"
            badge={totalPnl >= 0 ? fmtPct(totalPnlPct) : undefined}
          />
          <KpiCard
            title="Daily P&L"
            value={fmtPnl(pnlToday)}
            sub={`${metrics?.trades_today ?? 0} trades today`}
            icon={pnlToday >= 0 ? TrendingUp : TrendingDown}
            color={pnlToday >= 0 ? "profit" : "loss"}
          />
          <KpiCard
            title="Drawdown"
            value={fmtPct(-drawdown)}
            sub={`Peak: $${fmt(shared?.peak_equity ?? equity)}`}
            icon={Activity}
            color={drawdown > 5 ? "loss" : drawdown > 2 ? "warning" : "profit"}
          />
          <KpiCard
            title="Open Positions"
            value={String(openPositions)}
            sub={`Max ${status?.config?.max_open_positions ?? "—"}`}
            icon={Layers}
            color={openPositions > 0 ? "info" : "neutral"}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Equity chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Equity Curve (live)</CardTitle>
                <span className={cn(
                  "text-xs font-mono tabular-nums",
                  totalPnlPct >= 0 ? "text-profit" : "text-loss"
                )}>
                  {fmtPct(totalPnlPct)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-40">
                <EquityMiniChart
                  data={equityHistory}
                  color={totalPnlPct >= 0 ? "#22c55e" : "#ef4444"}
                />
              </div>
            </CardContent>
          </Card>

          {/* Win rate donut */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Win Rate</CardTitle>
                <span className="text-xs text-muted-foreground">{totalTrades} trades</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-40">
                <WinRateDonut winRate={winRate} wins={wins} losses={losses} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Trade PnL bars + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Last 30 Trades (P&L per trade)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-32">
                <PnlBarChart trades={closedTrades} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {[
                  { label: "Profit Factor", value: profitFactor > 100 ? "∞" : fmt(profitFactor), color: profitFactor >= 1.5 ? "text-profit" : profitFactor >= 1 ? "text-warning" : "text-loss" },
                  { label: "Gross Profit", value: `+$${fmt(grossProfit)}`, color: "text-profit" },
                  { label: "Gross Loss", value: `-$${fmt(grossLoss)}`, color: "text-loss" },
                  { label: "LLM Go", value: String(metrics?.llm_go ?? 0), color: "text-profit" },
                  { label: "LLM No-Go", value: String(metrics?.llm_nogo ?? 0), color: "text-loss" },
                  { label: "LLM Avg Conf", value: `${fmt(metrics?.llm_avg_confidence ?? 0, 0)}%`, color: "text-foreground" },
                  { label: "Avg Latency", value: `${metrics?.llm_avg_latency_ms ?? 0}ms`, color: "text-muted-foreground" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={cn("font-mono tabular-nums font-medium", color)}>{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Open positions preview */}
        {positions && positions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Open Positions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {positions.map((p) => (
                  <div
                    key={p.client_id}
                    className="flex items-center gap-4 rounded-lg bg-muted/50 px-3 py-2.5 text-xs"
                  >
                    <Badge variant={p.side === "LONG" ? "profit" : "loss"}>{p.side}</Badge>
                    <span className="font-medium">{p.symbol}</span>
                    <span className="text-muted-foreground font-mono">{p.strategy}</span>
                    <span className="text-muted-foreground">@{fmt(p.entry_price)}</span>
                    <span className="text-muted-foreground ml-auto flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatDuration(p.duration_mins)}
                    </span>
                    {p.trailing_activated && (
                      <Badge variant="info">trailing</Badge>
                    )}
                    {p.breakeven_activated && (
                      <Badge variant="secondary">BE</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* LLM + Regime */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-muted-foreground" />
                <CardTitle>LLM Brain</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {[
                  { label: "Provider / Model", value: `${status?.config?.active_strategies?.join(", ") ?? "—"}` },
                  { label: "Offline Fallbacks", value: String(metrics?.llm_offline_fallbacks ?? 0) },
                  { label: "Active Lessons", value: String(metrics?.active_lessons ?? 0) },
                  { label: "Signals Today", value: String(metrics?.signals_today ?? 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Market Regime</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {[
                  { label: "Current Regime", value: shared?.current_regime ?? "—" },
                  { label: "Survival Mode", value: shared?.survival_mode ?? "—" },
                  { label: "Survival Score", value: fmt(shared?.survival_score ?? 0) },
                  { label: "Unrealized P&L", value: fmtPnl(shared?.unrealized_pnl ?? 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{value}</span>
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
