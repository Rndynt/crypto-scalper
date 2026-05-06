//! Brain agent — owns the existing LLM specialist. Listens for allowed
//! `RiskVerdict` events, builds a `MarketContext` (with the historical
//! summary injected), calls the LLM, and emits `BrainOutcomeReady`.

use crate::agents::messages::{
    AgentEvent, BrainOutcome, FeedsSnapshotMsg, ManagerProposal, RiskOutcome,
};
use crate::agents::MessageBus;
use crate::feeds::ExternalSnapshot;
use crate::learning::LearningPolicy;
use crate::llm::engine::{Decision, LlmEngine};
use crate::llm::ContextBuilder;
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
const LLM_COOLDOWN_SECS: u64 = 45;

pub fn spawn(
    bus: MessageBus,
    llm: Arc<LlmEngine>,
    states: Arc<Mutex<HashMap<String, SymbolState>>>,
    policy: LearningPolicy,
    feeds_cache: Arc<PlRwLock<HashMap<String, ExternalSnapshot>>>,
) -> JoinHandle<()> {
    let mut rx = bus.subscribe();
    // Track last LLM call time per symbol for deduplication
    let last_llm_call: Arc<PlRwLock<HashMap<String, Instant>>> =
        Arc::new(PlRwLock::new(HashMap::new()));

    tokio::spawn(async move {
        info!("brain agent starting");
        while let Ok(ev) = rx.recv().await {
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
                            warn!(error = %e, "brain agent: LLM call failed");
                            continue;
                        }
                    };

                    // Apply LLM position sizing recommendation
                    // High conviction = larger size, Low conviction = smaller size
                    let llm_size_pct = llm_out.decision.position_size_pct.clamp(0.1, 1.0);
                    let adjusted_size = risk.size * llm_size_pct;
                    
                    info!(
                        symbol = %symbol,
                        risk_size = risk.size,
                        llm_size_pct = llm_size_pct,
                        adjusted_size = adjusted_size,
                        "brain: position sizing applied"
                    );

                    // Update risk size with LLM-adjusted size
                    let mut adjusted_risk = risk.clone();
                    adjusted_risk.size = adjusted_size;

                    // Use LLM-adjusted SL/TP — brain sets exact levels
                    let final_sl = llm_out.decision.sl_adjustment.unwrap_or(signal.stop_loss);
                    let final_tp = llm_out.decision.tp_adjustment.unwrap_or(signal.take_profit);
                    let final_entry = llm_out.decision.entry_price.unwrap_or(signal.entry);

                    let _proposal = ManagerProposal {
                        symbol: symbol.clone(),
                        side: signal.side,
                        strategy: signal.strategy.as_str().to_string(),
                        regime: regime.as_str().to_string(),
                        entry: final_entry,
                        stop_loss: final_sl,
                        take_profit: final_tp,
                        size: adjusted_size,
                        ta_confidence: signal.ta_confidence,
                        llm_confidence: llm_out.decision.confidence,
                    };

                    info!(
                        symbol = %symbol,
                        decision = ?llm_out.decision.decision,
                        confidence = llm_out.decision.confidence,
                        offline_fallback = llm_out.offline_fallback,
                        reason = %llm_out.decision.reasoning.summary,
                        "brain: decision"
                    );

                    // REJECT low-confidence GOs — brain must be CERTAIN
                    if llm_out.decision.decision == Decision::Go && llm_out.decision.confidence < 70 {
                        info!(
                            symbol = %symbol,
                            confidence = llm_out.decision.confidence,
                            "brain: REJECTED — Go but confidence too low (< 70)"
                        );
                        continue;
                    }

                    // REJECT if not Go
                    if llm_out.decision.decision != Decision::Go {
                        info!(
                            symbol = %symbol,
                            decision = ?llm_out.decision.decision,
                            "brain: REJECTED — not Go"
                        );
                        continue;
                    }

                    bus.publish(AgentEvent::BrainOutcomeReady(BrainOutcome {
                        signal: Box::new(signal),
                        regime,
                        risk: adjusted_risk,
                        decision: llm_out.decision,
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
