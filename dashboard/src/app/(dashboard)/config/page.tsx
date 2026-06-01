"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConfig } from "@/hooks/useAriaData";
import { fmt } from "@/lib/api";
import { Settings, Shield, Zap, Clock } from "lucide-react";

function Row({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {badge}
        <span className="font-mono tabular-nums font-medium">{value}</span>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const { data: config, isLoading } = useConfig();

  return (
    <div className="flex flex-col h-full">
      <Header title="Runtime Config" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading…</div>
        )}

        {config && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Mode + Exchange */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Mode & Exchange</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Row
                  label="Run Mode"
                  value={config.mode}
                  badge={
                    <Badge variant={config.mode === "paper" ? "info" : config.mode === "live" ? "profit" : "muted"}>
                      {config.mode}
                    </Badge>
                  }
                />
                <Row label="Exchange" value={config.exchange} />
                <Row label="Symbols" value={String(config.symbol_count)} />
                <Row label="Max Leverage" value={`${config.max_leverage}×`} />
              </CardContent>
            </Card>

            {/* Risk */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Risk Parameters</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Row label="Risk Per Trade" value={`${fmt(config.risk_per_trade_pct)}%`} />
                <Row label="Max Drawdown" value={`${fmt(config.max_drawdown_pct)}%`} />
                <Row label="Max Open Positions" value={String(config.max_open_positions)} />
                <Row
                  label="Partial TP"
                  value={config.partial_tp_enabled ? "Enabled" : "Disabled"}
                  badge={<Badge variant={config.partial_tp_enabled ? "profit" : "muted"}>{config.partial_tp_enabled ? "ON" : "OFF"}</Badge>}
                />
              </CardContent>
            </Card>

            {/* Time + Strategies */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Timing</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Row
                  label="Max Hold Time"
                  value={`${Math.floor(config.max_hold_secs / 60)}m`}
                />
                <Row label="Metrics Bind" value={config.metrics_bind} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Active Strategies</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 pt-1">
                  {config.active_strategies.map((s) => (
                    <Badge key={s} variant="secondary" className="font-mono text-xs">
                      {s.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
