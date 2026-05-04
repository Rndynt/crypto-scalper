//! Learning agent — periodically rebuilds the `LearningPolicy` from the
//! trade journal and broadcasts the refresh event.
//!
//! Also feeds closed trade PnL into the QuantEngine for Kelly sizing.
//! Persists learning state snapshots to `data/learning_state.json` for
//! fast startup after rebuilds.

use crate::agents::messages::{AgentEvent, AgentId};
use crate::agents::MessageBus;
use crate::learning::{
    lessons::{LessonConfig, LessonExtractor},
    LearningPolicy, PerformanceMemory,
};
use crate::monitoring::{logger::LearningStateSnapshot, TradeJournal};
use crate::quant::QuantEngine;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::{info, warn};

pub fn spawn(
    bus: MessageBus,
    journal: Arc<TradeJournal>,
    policy: LearningPolicy,
    cfg: LessonConfig,
    refresh_secs: u64,
    quant_engine: Option<Arc<QuantEngine>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        info!(refresh_secs, "learning agent starting");

        // Try to load persisted learning state for fast startup.
        let saved = LearningStateSnapshot::load();
        if saved.overall_trades > 0 {
            info!(
                trades = saved.overall_trades,
                wins = saved.overall_wins,
                lessons = saved.lessons_count,
                "loaded persisted learning state"
            );
        }

        let extractor = LessonExtractor::new(cfg);
        let mut tick = tokio::time::interval(Duration::from_secs(refresh_secs.max(60)));
        // Independent heartbeat task — learning's own refresh interval
        // can be many minutes long, far longer than the watchdog
        // tolerance. Send a 30s heartbeat so the watchdog never trips
        // just because we're between policy refreshes.
        {
            let bus_hb = bus.clone();
            tokio::spawn(async move {
                let mut hb = tokio::time::interval(Duration::from_secs(30));
                loop {
                    hb.tick().await;
                    bus_hb.publish(AgentEvent::Heartbeat {
                        from: AgentId::Learning,
                        ts: Utc::now(),
                    });
                }
            });
        }
        // Also listen for PositionClosed events to feed the quant engine
        // in real-time (don't wait for the 5-min refresh).
        if let Some(ref qe) = quant_engine {
            let qe_rt = Arc::clone(qe);
            let bus_rt = bus.clone();
            tokio::spawn(async move {
                let mut rx = bus_rt.subscribe();
                while let Ok(ev) = rx.recv().await {
                    if let AgentEvent::PositionClosed { pnl_usd, .. } = ev {
                        qe_rt.record_trade(pnl_usd);
                    }
                    if let AgentEvent::Shutdown = ev {
                        break;
                    }
                }
            });
        }

        // First tick fires immediately; if the journal is empty the
        // policy simply stays empty.
        loop {
            tick.tick().await;
            match journal.closed_trades(500) {
                Ok(trades) => {
                    // Feed all historical trade outcomes into the quant
                    // engine so Kelly has data from day 1.
                    if let Some(ref qe) = quant_engine {
                        for t in &trades {
                            qe.record_trade(t.pnl_usd);
                        }
                    }

                    let mem = PerformanceMemory::build(&trades);
                    let lessons = extractor.extract(&mem);
                    let trades_count = mem.overall.trades;
                    let wins = mem.overall.wins;
                    let losses = mem.overall.losses;
                    let net_pnl = mem.overall.net_pnl_usd;
                    let lessons_count = lessons.len();

                    info!(
                        trades = trades_count,
                        lessons = lessons_count,
                        "learning agent: policy refreshed"
                    );
                    policy.update(mem, lessons);
                    bus.publish(AgentEvent::PolicyRefreshed {
                        lessons_count,
                        ts: Utc::now(),
                    });

                    // Persist learning state to JSON for survival across rebuilds.
                    let snapshot = LearningStateSnapshot {
                        lessons_count,
                        last_refresh_ts: Some(Utc::now().to_rfc3339()),
                        overall_trades: trades_count,
                        overall_wins: wins,
                        overall_losses: losses,
                        overall_net_pnl: net_pnl,
                    };
                    if let Err(e) = snapshot.save() {
                        warn!(error = %e, "failed to persist learning state");
                    }
                }
                Err(e) => {
                    warn!(error = %e, "learning agent: failed to read journal");
                }
            }
        }
    })
}
