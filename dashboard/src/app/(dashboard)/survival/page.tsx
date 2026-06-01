"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSurvival, useStatus } from "@/hooks/useAriaData";
import { fmt, fmtPct } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, ShieldX, Flame, Snowflake, Clock } from "lucide-react";

function GaugeBar({
  value, max = 100, label, thresholds,
}: {
  value: number;
  max?: number;
  label: string;
  thresholds: { warn: number; danger: number };
}) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    value >= thresholds.danger ? "bg-loss" :
    value >= thresholds.warn ? "bg-warning" :
    "bg-profit";
  const textColor =
    value >= thresholds.danger ? "text-loss" :
    value >= thresholds.warn ? "text-warning" :
    "text-profit";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono tabular-nums font-medium", textColor)}>
          {fmt(value, 2)}%
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SurvivalPage() {
  const { data: survival, isLoading } = useSurvival();
  const { data: status } = useStatus();
  const shared = status?.shared;

  const mode = survival?.mode ?? shared?.survival_mode ?? "nominal";
  const score = survival?.score ?? shared?.survival_score ?? 1;
  const drawdown = survival?.drawdown_pct ?? shared?.drawdown_pct ?? 0;
  const isFrozen = survival?.is_frozen ?? false;

  const modeConfig = {
    nominal: { icon: ShieldCheck, color: "text-profit", badge: "profit" as const, label: "Nominal" },
    caution: { icon: ShieldAlert, color: "text-warning", badge: "warning" as const, label: "Caution" },
    danger: { icon: ShieldAlert, color: "text-loss", badge: "loss" as const, label: "Danger" },
    frozen: { icon: ShieldX, color: "text-loss", badge: "loss" as const, label: "Frozen" },
    cooldown: { icon: Snowflake, color: "text-info", badge: "info" as const, label: "Cooldown" },
    flat: { icon: ShieldX, color: "text-warning", badge: "warning" as const, label: "Flat-All" },
  }[mode] ?? { icon: ShieldCheck, color: "text-muted-foreground", badge: "muted" as const, label: mode };

  const Icon = modeConfig.icon;

  return (
    <div className="flex flex-col h-full">
      <Header title="Survival Monitor" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Status hero */}
        <Card className={cn(
          "border-2",
          isFrozen ? "border-loss/50" :
          mode === "caution" ? "border-warning/30" :
          "border-profit/20"
        )}>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className={cn(
                "flex items-center justify-center h-14 w-14 rounded-xl",
                isFrozen ? "bg-loss/10" : mode === "caution" ? "bg-warning/10" : "bg-profit/10"
              )}>
                <Icon className={cn("h-8 w-8", modeConfig.color)} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold">{modeConfig.label}</h2>
                  <Badge variant={modeConfig.badge}>{mode}</Badge>
                  {isFrozen && (
                    <Badge variant="loss" className="flex items-center gap-1">
                      <Snowflake className="h-3 w-3" /> FROZEN
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Survival score: <span className={cn("font-mono font-medium", modeConfig.color)}>{fmt(score * 100, 1)}</span>
                </p>
                {survival?.cooldown_until && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" />
                    Cooldown until: {new Date(survival.cooldown_until).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Gauges */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Risk Gauges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <GaugeBar
                value={drawdown}
                label="Current Drawdown"
                thresholds={{ warn: 4, danger: 7 }}
              />
              <GaugeBar
                value={survival?.daily_loss_pct ?? 0}
                label="Daily Loss"
                thresholds={{ warn: 1.5, danger: 2.5 }}
              />
              <GaugeBar
                value={((survival?.death_line_pct ?? 0.7) - 1) * -100}
                max={30}
                label="Distance to Death Line"
                thresholds={{ warn: 15, danger: 25 }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Streak & Equity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  label: "Loss Streak",
                  value: String(survival?.loss_streak ?? 0),
                  icon: Flame,
                  color: (survival?.loss_streak ?? 0) >= 5 ? "text-loss" : (survival?.loss_streak ?? 0) >= 3 ? "text-warning" : "text-muted-foreground",
                },
                {
                  label: "Current Equity",
                  value: `$${fmt(shared?.equity ?? 0)}`,
                  icon: ShieldCheck,
                  color: "text-foreground",
                },
                {
                  label: "Peak Equity",
                  value: `$${fmt(shared?.peak_equity ?? 0)}`,
                  icon: ShieldCheck,
                  color: "text-profit",
                },
                {
                  label: "Unrealized P&L",
                  value: `${(shared?.unrealized_pnl ?? 0) >= 0 ? "+" : ""}$${fmt(shared?.unrealized_pnl ?? 0)}`,
                  icon: ShieldCheck,
                  color: (shared?.unrealized_pnl ?? 0) >= 0 ? "text-profit" : "text-loss",
                },
                {
                  label: "Auto-Flat Triggered",
                  value: survival?.auto_flat_triggered ? "YES" : "No",
                  icon: ShieldX,
                  color: survival?.auto_flat_triggered ? "text-loss" : "text-muted-foreground",
                },
              ].map(({ label, value, icon: I, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <I className={cn("h-3.5 w-3.5", color)} />
                    {label}
                  </div>
                  <span className={cn("font-mono tabular-nums font-medium", color)}>{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
