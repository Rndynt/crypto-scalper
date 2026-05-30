---
name: P0 Refactor decisions
description: Architecture decisions from the full P0 refactor — PositionAction, HTF screening, ExecutionFailed, strategy aliases
---

## PositionAction enum (P0-4/P0-5)
`check_exits` in `execution/position.rs` returns `Vec<PositionAction>` not `Vec<(Position, PositionExitReason)>`.
- `Close(pos, reason)` → full close, emit `PositionClosed`, call `risk.on_position_closed`
- `Reduce(pos, reduce_size, reason)` → partial TP, emit `PositionReduced` only, do NOT call `risk.on_position_closed`
- `MoveSL(pos, new_sl)` → cancel old `{client_id}-sl` broker order, place new stop order
- `PositionAction` is exported from `execution/mod.rs`

**Why:** PartialTP was calling `risk.on_position_closed` which freed a position slot and fired learning, even though the trade was still open.

## HTF Screening layer (P0-1/P0-2/P0-3)
`SignalAgentConfig` has 3 new fields: `screening_timeframe_secs: i64`, `rest_base_url: String`, `symbols: Vec<String>`.
- Signal agent owns local `htf_states: HashMap<String, SymbolState>` — NOT shared with main.rs states
- 15m candles update htf_states; 1m candles drive entry signals
- `compute_htf_bias()`: 5-candle majority vote, 60% threshold → Bullish/Bearish/NoTrade/Unknown
- `bootstrap_htf_states()` called inside `tokio::spawn` before the event loop
- `ScreeningBias::Unknown` allows both directions (graceful degradation when few candles)
- In `main.rs`, `screening_timeframe_secs` = max timeframe that differs from `entry_timeframe`

**Why:** All timeframes fed into the same SymbolState, so 15m state was contaminated by 1m candles.

## ExecutionFailed release (P0-7)
`AgentEvent::ExecutionFailed { symbol, reason }` emitted from `execution.rs` on:
1. `place_order` returns `Err(e)` 
2. `fill_price <= 0.0` (ghost position)

`risk.rs` handles it: `pending_symbols.lock().remove(&symbol)`.

**Why:** Without this, a failed order leaves `pending_symbols` permanently locked, blocking that symbol from ever re-entering.

## Quant strategy alias mapping (P0-9)
Backtest uses live strategy implementations via the `StrategyName` enum aliases:
- `EmaRibbon` → `OrderFlow.evaluate()`
- `Momentum` → `TradeFlow.evaluate()`
- `VwapScalp` → `KalmanTrendStrategy.evaluate()`
- `MeanReversion` → `MicrostructureReversion.evaluate()`
- `Squeeze` → `Squeeze.evaluate()`

**Why:** The backtest was calling phantom legacy strategy names that no longer matched the live signal code, making backtest results meaningless.

## alpha_gate real API
`advanced_alpha_gate(inputs: AdvancedAlphaInputs, signal_is_long: bool) -> AlphaGateDecision`
- `AlphaGateDecision` variants are unit (no data): `Allow | Reduce | Block`
- `AdvancedAlphaInputs { alt_data, funding_rate, trend_score, min_abs_score }`
- `kalman_trend_score(prices: &[f64], process_noise: f64, measurement_noise: f64) -> f64`
- `alt_data_inputs_from_snapshot(snapshot: &ExternalSnapshot) -> AltDataInputs` (1 arg)
- `funding_rate_from_snapshot(snapshot: &ExternalSnapshot) -> f64` (1 arg, not Option)
