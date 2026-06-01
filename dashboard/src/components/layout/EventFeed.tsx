"use client";
import { useState, useCallback } from "react";
import { useSse } from "@/hooks/useSse";
import type { ApiEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FeedItem {
  id: number;
  type: string;
  text: string;
  ts: number;
  color: string;
}

let idSeq = 0;

const TYPE_CONFIG: Record<string, { color: string; emoji: string }> = {
  signal: { color: "text-info", emoji: "📡" },
  fill: { color: "text-profit", emoji: "✅" },
  close: { color: "text-foreground", emoji: "🔒" },
  partial: { color: "text-warning", emoji: "⚡" },
  sl_moved: { color: "text-muted-foreground", emoji: "🛡" },
  survival: { color: "text-warning", emoji: "⚠️" },
  equity: { color: "text-muted-foreground", emoji: "💰" },
  screening: { color: "text-muted-foreground", emoji: "🔍" },
  error: { color: "text-loss", emoji: "❌" },
};

function describeEvent(event: ApiEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.event_type) {
    case "signal":
      return `${d.side} ${d.symbol} @ ${d.entry} · ${d.strategy} · conf ${d.ta_confidence}`;
    case "fill":
      return `FILL ${d.side} ${d.symbol} × ${d.size} @ ${d.fill_price}`;
    case "close":
      return `CLOSE ${d.side} ${d.symbol} · ${Number(d.pnl_usd) >= 0 ? "+" : ""}$${Number(d.pnl_usd ?? 0).toFixed(2)} · ${d.reason}`;
    case "partial":
      return `PARTIAL ${d.symbol} · +$${Number(d.pnl_usd ?? 0).toFixed(2)}`;
    case "sl_moved":
      return `SL → ${d.new_sl} (${d.reason}) ${d.symbol}`;
    case "survival":
      return `Survival mode: ${d.mode} score=${Number(d.score ?? 0).toFixed(2)}`;
    case "equity":
      return `Equity: $${Number(d.equity ?? 0).toFixed(2)}`;
    case "screening":
      return `Bias ${d.symbol}: ${d.bias}`;
    case "error":
      return `Error: ${d.reason ?? d.message ?? "unknown"}`;
    default:
      return JSON.stringify(d).slice(0, 60);
  }
}

export function EventFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);

  const onEvent = useCallback((event: ApiEvent) => {
    const cfg = TYPE_CONFIG[event.event_type] ?? { color: "text-muted-foreground", emoji: "•" };
    const item: FeedItem = {
      id: idSeq++,
      type: event.event_type,
      text: describeEvent(event),
      ts: event.ts,
      color: cfg.color,
    };
    setItems((prev) => [item, ...prev].slice(0, 80));
  }, []);

  useSse("/aria-api/api/events", onEvent);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Live Events</p>
        <div className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-profit animate-pulse-green" />
          <span className="text-[10px] text-muted-foreground">SSE</span>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-3 py-2 space-y-1">
          {items.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-4 text-center">Waiting for events…</p>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 py-0.5 animate-slide-in"
            >
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground/60 shrink-0 mt-0.5 w-16">
                {new Date(item.ts * 1000).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </span>
              <span className={cn("text-[11px] font-mono leading-relaxed break-all", item.color)}>
                {TYPE_CONFIG[item.type]?.emoji} {item.text}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
