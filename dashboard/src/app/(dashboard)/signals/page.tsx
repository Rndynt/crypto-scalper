"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSignals, useScreening } from "@/hooks/useAriaData";
import { fmt, timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";

function ConfidenceBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value >= 70 ? "bg-profit" : value >= 55 ? "bg-warning" : "bg-loss";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums w-6 text-right">{value}</span>
    </div>
  );
}

export default function SignalsPage() {
  const { data: signals, isLoading } = useSignals();
  const { data: biases } = useScreening();

  return (
    <div className="flex flex-col h-full">
      <Header title="Signal Feed" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Screening biases */}
        {biases && biases.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {biases.map((b) => (
              <Card key={b.symbol} className="border-border/50">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{b.symbol}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(b.ts)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      variant={
                        b.bias === "bullish" ? "profit" :
                        b.bias === "bearish" ? "loss" :
                        "muted"
                      }
                    >
                      {b.bias}
                    </Badge>
                    <div className="flex gap-1">
                      {b.allows_long && <Badge variant="profit" className="text-[9px] px-1.5 py-0">L</Badge>}
                      {b.allows_short && <Badge variant="loss" className="text-[9px] px-1.5 py-0">S</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Signals list */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Recent Signals (last 50)</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading…</div>
            )}
            {!isLoading && (!signals || signals.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Radio className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No signals yet</p>
              </div>
            )}
            <div className="divide-y divide-border/50">
              {signals?.map((s) => (
                <div key={s.signal_id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Side */}
                    {s.side === "LONG" ? (
                      <TrendingUp className="h-4 w-4 text-profit shrink-0" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-loss shrink-0" />
                    )}
                    <Badge variant={s.side === "LONG" ? "profit" : "loss"}>{s.side}</Badge>
                    <span className="font-semibold text-sm">{s.symbol}</span>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {s.strategy.replace("_", " ")}
                    </Badge>
                    <Badge variant="muted" className="font-mono text-[10px]">{s.regime}</Badge>
                    <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(s.ts)}</span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-0.5">Entry</p>
                      <p className="text-xs font-mono tabular-nums">{fmt(s.entry)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-loss mb-0.5">Stop Loss</p>
                      <p className="text-xs font-mono tabular-nums text-loss">{fmt(s.stop_loss)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-profit mb-0.5">Take Profit</p>
                      <p className="text-xs font-mono tabular-nums text-profit">{fmt(s.take_profit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-0.5">TA Confidence</p>
                      <ConfidenceBar value={s.ta_confidence} />
                    </div>
                  </div>

                  {s.reason && (
                    <div className="mt-2 flex items-start gap-1.5">
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{s.reason}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
