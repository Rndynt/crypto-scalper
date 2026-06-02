"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSignals, useScreening, useStatus } from "@/hooks/useAriaData";
import { fmt, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, TrendingDown, Target, ShieldAlert, Zap } from "lucide-react";

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const color = value >= 70 ? "bg-profit" : value >= 55 ? "bg-warning" : "bg-loss";
  const textColor = value >= 70 ? "text-profit" : value >= 55 ? "text-warning" : "text-loss";
  return (
    <div className="space-y-1">
      {label && <p className="text-[10px] text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
        </div>
        <span className={cn("text-[11px] font-mono tabular-nums font-bold w-7 text-right", textColor)}>{value}</span>
      </div>
    </div>
  );
}

function RiskReward({ entry, sl, tp, side }: { entry: number; sl: number; tp: number; side: string }) {
  if (!entry || !sl || !tp) return null;
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  return (
    <div className="flex items-center gap-1">
      <Target className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground">R:R</span>
      <span className={cn("text-[11px] font-mono font-bold", rr >= 2 ? "text-profit" : rr >= 1.5 ? "text-warning" : "text-loss")}>
        {fmt(rr, 2)}
      </span>
    </div>
  );
}

export default function SignalsPage() {
  const { data: signals, isLoading } = useSignals();
  const { data: biases } = useScreening();
  const { data: status } = useStatus();

  const metrics = status?.metrics;

  const totalSignals = signals?.length ?? 0;
  const longSignals  = signals?.filter(s => s.side === "LONG").length ?? 0;
  const shortSignals = signals?.filter(s => s.side === "SHORT").length ?? 0;
  const avgConf      = totalSignals > 0
    ? (signals?.reduce((s, sig) => s + sig.ta_confidence, 0) ?? 0) / totalSignals : 0;
  const highConf     = signals?.filter(s => s.ta_confidence >= 70).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="Signal Feed" />
      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">

        {/* Signal stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Signals Buffered", value: String(totalSignals), color: "text-foreground" },
            { label: "Long Signals",     value: String(longSignals),  color: "text-profit" },
            { label: "Short Signals",    value: String(shortSignals), color: "text-loss" },
            { label: "High Conf (≥70)",  value: String(highConf),     color: "text-primary" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
                <p className={cn("text-[16px] font-mono font-bold tabular-nums", color)}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Today's metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Signals Today", value: String(metrics?.signals_today ?? 0) },
            { label: "LLM Go",        value: String(metrics?.llm_go ?? 0),   color: "text-profit" },
            { label: "LLM No-Go",     value: String(metrics?.llm_nogo ?? 0), color: "text-loss" },
            { label: "LLM Wait",      value: String(metrics?.llm_wait ?? 0), color: "text-warning" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardContent className="p-3 flex items-center gap-2">
                <Zap className={cn("h-3.5 w-3.5 shrink-0", color ?? "text-muted-foreground")} />
                <div>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn("text-[14px] font-mono font-bold", color ?? "text-foreground")}>{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Screening biases */}
        {biases && biases.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  <CardTitle>HTF Screening Bias</CardTitle>
                </div>
                <span className="text-[11px] text-muted-foreground">{biases.length} symbols</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      {["Symbol", "Bias", "Allows Long", "Allows Short", "Updated"].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {[...biases].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((b) => (
                      <tr key={b.symbol} className="hover:bg-secondary/40 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-[13px]">{b.symbol}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={b.bias === "bullish" ? "profit" : b.bias === "bearish" ? "loss" : "muted"}>
                            {b.bias}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {b.allows_long
                            ? <Badge variant="profit" className="text-[10px]">✓ Long</Badge>
                            : <span className="text-[11px] text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {b.allows_short
                            ? <Badge variant="loss" className="text-[10px]">✓ Short</Badge>
                            : <span className="text-[11px] text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-[11px]">{timeAgo(b.ts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Signal list */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-primary animate-pulse" />
              <CardTitle>Recent Signals</CardTitle>
              {signals && signals.length > 0 && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {signals.length} signals · avg conf <span className="font-mono text-foreground">{fmt(avgConf, 1)}</span>
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading…</div>
            )}
            {!isLoading && (!signals || signals.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                  <Radio className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">No signals in buffer</p>
                <p className="text-[11px] text-muted-foreground/60">Signals appear here when strategies fire</p>
              </div>
            )}
            <div className="divide-y divide-border/40">
              {signals?.map((s) => {
                const slDist = s.entry > 0 && s.stop_loss > 0
                  ? Math.abs(((s.entry - s.stop_loss) / s.entry) * 100) : null;
                const tpDist = s.entry > 0 && s.take_profit > 0
                  ? Math.abs(((s.take_profit - s.entry) / s.entry) * 100) : null;

                return (
                  <div key={s.signal_id} className={cn(
                    "px-4 py-4 hover:bg-secondary/30 transition-colors",
                    s.side === "LONG" ? "border-l-2 border-l-profit/30" : "border-l-2 border-l-loss/30"
                  )}>
                    {/* Header */}
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {s.side === "LONG"
                        ? <TrendingUp className="h-4 w-4 text-profit shrink-0" />
                        : <TrendingDown className="h-4 w-4 text-loss shrink-0" />}
                      <Badge variant={s.side === "LONG" ? "profit" : "loss"} className="font-bold">{s.side}</Badge>
                      <span className="font-bold text-[15px]">{s.symbol}</span>
                      <Badge variant="secondary" className="font-mono">{s.strategy.replace(/_/g, " ")}</Badge>
                      <Badge variant="muted" className="hidden sm:inline-flex">{s.regime}</Badge>
                      <RiskReward entry={s.entry} sl={s.stop_loss} tp={s.take_profit} side={s.side} />
                      <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(s.ts)}</span>
                    </div>

                    {/* Price levels */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
                      {[
                        { label: "Entry",       value: fmt(s.entry),      color: "text-foreground" },
                        { label: "Stop Loss",   value: fmt(s.stop_loss),  color: "text-loss" },
                        { label: "Take Profit", value: fmt(s.take_profit),color: "text-profit" },
                        { label: "SL Distance", value: slDist != null ? `${fmt(slDist, 2)}%` : "—", color: "text-loss/80" },
                        { label: "TP Distance", value: tpDist != null ? `${fmt(tpDist, 2)}%` : "—", color: "text-profit/80" },
                        { label: "Signal ID",   value: s.signal_id.slice(0, 8) + "…", color: "text-muted-foreground" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-lg bg-secondary/50 px-2.5 py-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                          <p className={cn("text-[11px] font-mono tabular-nums font-semibold", color)}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Confidence */}
                    <div className="mb-3">
                      <ConfidenceBar value={s.ta_confidence} label="TA Confidence" />
                    </div>

                    {/* Reason */}
                    {s.reason && (
                      <div className="rounded-lg bg-secondary/30 px-3 py-2">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Reason</p>
                        <p className="text-[12px] text-foreground/80 leading-relaxed">{s.reason}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
