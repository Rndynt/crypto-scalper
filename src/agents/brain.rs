//! Brain agent — owns the existing LLM specialist. Listens for allowed
//! `RiskVerdict` events, builds a `MarketContext` (with the historical
//! summary injected), calls the LLM, and emits `BrainOutcomeReady`.

use crate::agents::MessageBus;
use crate::agents::messages::{AgentEvent, AgentId, BrainOutcome, FeedsSnapshotMsg, RiskOutcome};
use crate::feeds::ExternalSnapshot;
use crate::learning::LearningPolicy;
use crate::llm::ContextBuilder;
use crate::llm::engine::{Decision, LlmEngine};
use crate::strategy::state::SymbolState;
use parking_lot::RwLock as PlRwLock;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

/// Minimum seconds between LLM calls for the same symbol.
/// Prevents redundant API calls when multiple signals fire in quick succession.
const LLM_COOLDOWN_SECS: u64 = 12;

pub fn spawn(
    bus: MessageBus,
    llm: Arc<LlmEngine>,
    states: Arc<Mutex<HashMap<String, SymbolState>>>,
    policy: LearningPolicy,
    feeds_cache: Arc<PlRwLock<HashMap<String, ExternalSnapshot>>>,
    shared_state: Option<Arc<crate::shared_state::SharedState>>,
    fail_closed_without_llm: bool,
    min_confidence: u8,
) -> JoinHandle<()> {
    let mut rx = bus.subscribe();
    // Track last LLM call time per symbol for deduplication
    let last_llm_call: Arc<PlRwLock<HashMap<String, Instant>>> =
        Arc::new(PlRwLock::new(HashMap::new()));

    tokio::spawn(async move {
        info!("brain agent starting");
        crate::agents::heartbeat::spawn(bus.clone(), AgentId::Brain);
        loop {
            let ev = match rx.recv().await {
                Ok(ev) => ev,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "brain: broadcast lagged — skipping events");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            match ev {
                AgentEvent::FeedsSnapshot(FeedsSnapshotMsg {
                    symbol, snapshot, ..
                }) => {
                    feeds_cache.write().insert(symbol, snapshot);
                }
                AgentEvent::RiskVerdict(risk) => {
                    if risk.outcome != RiskOutcome::Allowed {
                        continue;
                    }
                    let signal = (*risk.signal).clone();
                    let regime = risk.regime;
                    let symbol = signal.symbol.clone();

                    // Deduplication: skip if same symbol analyzed recently
                    {
                        let mut cache = last_llm_call.write();
                        if let Some(last) = cache.get(&symbol) {
                            if last.elapsed().as_secs() < LLM_COOLDOWN_SECS {
                                debug!(
                                    symbol = %symbol,
                                    elapsed_ms = last.elapsed().as_millis() as u64,
                                    cooldown_ms = LLM_COOLDOWN_SECS * 1000,
                                    "brain: LLM cooldown active — skipping"
                                );
                                continue;
                            }
                        }
                        cache.insert(symbol.clone(), Instant::now());
                    }

                    let external = feeds_cache.read().get(&symbol).cloned().unwrap_or_default();

                    let mut ctx = {
                        let states = states.lock().await;
                        match states.get(&symbol) {
                            Some(s) => ContextBuilder::build(s, regime, &signal, external),
                            None => continue,
                        }
                    };
                    ctx.historical_summary = policy.historical_summary(
                        signal.strategy.as_str(),
                        regime.as_str(),
                        &symbol,
                    );

                    // Populate strategy performance data from SharedState
                    if let Some(ref ss) = shared_state {
                        let strategy_perf = ss.get_strategy_health(signal.strategy.as_str());
                        let overall_perf = ss.get_overall_stats();

                        ctx.strategy_win_rate = strategy_perf.win_rate;
                        ctx.strategy_total_trades = strategy_perf.total_trades;
                        ctx.strategy_recent_pnl = strategy_perf.total_pnl;
                        ctx.strategy_loss_streak = strategy_perf.loss_streak;
                        ctx.overall_win_rate = overall_perf.win_rate;
                        ctx.overall_total_trades = overall_perf.total_trades;
                        ctx.recent_trade_pnl = overall_perf.last_trade_pnl;
                    }

                    info!(
                        symbol = %symbol,
                        side = %signal.side.as_str(),
                        strategy = %signal.strategy.as_str(),
                        regime = %regime.as_str(),
                        ta_confidence = signal.ta_confidence,
                        entry = signal.entry,
                        sl = signal.stop_loss,
                        tp = signal.take_profit,
                        "brain: analyzing risk-approved setup"
                    );

                    let llm_out = match llm.analyze(&ctx).await {
                        Ok(o) => o,
                        Err(e) => {
                            warn!(error = %e, fail_closed = fail_closed_without_llm, "brain agent: LLM call failed");
                            continue;
                        }
                    };

                    // Risk engine already calculates optimal size using
                    // survival score, learning policy, quant engine (Kelly, vol-target, VaR).
                    // Brain LLM should NOT further reduce size — it only decides GO/NOGO.
                    // Use risk.size directly (already well-calibrated).
                    let adjusted_size = risk.size;

                    info!(
                        symbol = %symbol,
                        risk_size = risk.size,
                        adjusted_size = adjusted_size,
                        "brain: position sizing (risk engine direct)"
                    );

                    // Update risk size with LLM-adjusted size
                    let mut adjusted_risk = risk.clone();
                    adjusted_risk.size = adjusted_size;

                    // Use LLM-adjusted SL/TP — brain sets exact levels
                    let final_sl = llm_out.decision.sl_adjustment.unwrap_or(signal.stop_loss);
                    let final_tp = llm_out.decision.tp_adjustment.unwrap_or(signal.take_profit);
                    let final_entry = llm_out.decision.entry_price.unwrap_or(signal.entry);

                    // Validate LLM-adjusted SL/TP geometry — reject if wrong side of entry
                    let geometry_ok = match signal.side {
                        crate::data::Side::Long => final_sl < final_entry && final_tp > final_entry,
                        crate::data::Side::Short => {
                            final_sl > final_entry && final_tp < final_entry
                        }
                    };
                    if !geometry_ok {
                        info!(
                            symbol = %symbol,
                            sl = final_sl, tp = final_tp, entry = final_entry,
                            side = %signal.side.as_str(),
                            "brain: REJECTED — LLM-adjusted SL/TP geometry invalid"
                        );
                        continue;
                    }

                    // Validate minimum R:R after LLM adjustment
                    let risk_dist = (final_entry - final_sl).abs();
                    let reward_dist = (final_tp - final_entry).abs();
                    let rr = if risk_dist > 0.0 {
                        reward_dist / risk_dist
                    } else {
                        0.0
                    };
                    if rr < 0.8 {
                        info!(
                            symbol = %symbol,
                            rr = %format!("{:.2}", rr),
                            "brain: REJECTED — LLM-adjusted SL/TP gives R:R < 0.8"
                        );
                        continue;
                    }

                    info!(
                        symbol = %symbol,
                        decision = ?llm_out.decision.decision,
                        confidence = llm_out.decision.confidence,
                        offline_fallback = llm_out.offline_fallback,
                        reason = %llm_out.decision.reasoning.summary,
                        "brain: decision"
                    );

                    // BLOCK TA-only fallback if fail_closed_without_llm is set.
                    if llm_out.offline_fallback && fail_closed_without_llm {
                        warn!(symbol = %symbol, "brain: BLOCKED — LLM unavailable, fail_closed=true");
                        continue;
                    }

                    // HARD RULE: regime alignment — never trade against the trend
                    // LONG in BEARISH or SHORT in BULLISH = instant reject
                    {
                        let states_r = states.lock().await;
                        if let Some(st) = states_r.get(&symbol) {
                            let regime = crate::strategy::RegimeDetector::detect(st);
                            let is_long = matches!(signal.side, crate::data::Side::Long);
                            let regime_str = regime.as_str().to_lowercase();
                            let bearish = regime_str.contains("bear");
                            let bullish = regime_str.contains("bull");
                            if (is_long && bearish) || (!is_long && bullish) {
                                info!(
                                    symbol = %symbol,
                                    regime = %regime.as_str(),
                                    side = ?signal.side,
                                    "brain: BLOCKED — trade against regime trend"
                                );
                                continue;
                            }
                        }
                    }

                    // Confidence floor from config only — no dynamic raising.
                    // Learning policy handles size reduction, not signal gating.
                    let live_conf_floor = min_confidence;
                    // REJECT low-confidence GOs with calibrated floor.
                    if llm_out.decision.decision == Decision::Go
                        && llm_out.decision.confidence < live_conf_floor
                    {
                        info!(
                            symbol = %symbol,
                            confidence = llm_out.decision.confidence,
                            conf_floor = live_conf_floor,
                            "brain: REJECTED — confidence below calibrated floor"
                        );
                        continue;
                    }

                    let final_decision = llm_out.decision.clone();

                    // REJECT if not Go
                    if final_decision.decision != Decision::Go {
                        info!(
                            symbol = %symbol,
                            decision = ?final_decision.decision,
                            "brain: REJECTED — not Go"
                        );
                        continue;
                    }

                    bus.publish(AgentEvent::BrainOutcomeReady(BrainOutcome {
                        signal: Box::new(signal),
                        regime,
                        risk: adjusted_risk,
                        decision: final_decision,
                        latency_ms: llm_out.latency_ms,
                        offline_fallback: llm_out.offline_fallback,
                    }));
                }
                AgentEvent::Shutdown => break,
                _ => {}
            }
        }
    })
}
