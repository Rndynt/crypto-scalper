//! Learning agent — periodically rebuilds the `LearningPolicy` from the
//! trade journal and broadcasts the refresh event.
//!
//! Also feeds closed trade PnL into the QuantEngine for Kelly sizing.
//! Persists learning state snapshots to `data/learning_state.json` for
//! fast startup after rebuilds.
//!
//! NOW: Also updates SharedState with strategy health and lessons
//! for cross-agent coordination.

use crate::agents::MessageBus;
use crate::agents::messages::{AgentEvent, AgentId};
use crate::learning::{
    LearningPolicy, PerformanceMemory,
    lessons::{LessonConfig, LessonExtractor},
};
use crate::monitoring::{TradeJournal, logger::LearningStateSnapshot};
use crate::quant::QuantEngine;
use crate::shared_state::SharedState;
use chrono::Utc;
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Bounded dedup window to avoid unbounded memory growth while still
/// preventing near-term duplicate ingestion.
#[derive(Debug)]
struct DedupWindow {
    seen: HashSet<String>,
    order: VecDeque<String>,
    capacity: usize,
}

impl DedupWindow {
    fn new(capacity: usize) -> Self {
        Self {
            seen: HashSet::with_capacity(capacity),
            order: VecDeque::with_capacity(capacity),
            capacity: capacity.max(1_000),
        }
    }

    /// Returns true if key is new and inserted; false if duplicate.
    fn insert(&mut self, key: String) -> bool {
        if self.seen.contains(&key) {
            return false;
        }
        self.seen.insert(key.clone());
        self.order.push_back(key);
        while self.order.len() > self.capacity {
            if let Some(old) = self.order.pop_front() {
                self.seen.remove(&old);
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::DedupWindow;

    #[test]
    fn dedup_window_blocks_duplicates() {
        let mut w = DedupWindow::new(3);
        assert!(w.insert("a".into()));
        assert!(!w.insert("a".into()));
    }

    #[test]
    fn dedup_window_evicts_oldest_when_full() {
        let mut w = DedupWindow::new(1_000);
        assert!(w.insert("a".into()));
        for i in 0..1_000 {
            assert!(w.insert(format!("k{i}")));
        }
        assert!(w.insert("a".into())); // should be insertable again
    }
}

pub fn spawn(
    bus: MessageBus,
    journal: Arc<TradeJournal>,
    policy: LearningPolicy,
    cfg: LessonConfig,
    refresh_secs: u64,
    quant_engine: Option<Arc<QuantEngine>>,
    shared_state: Arc<SharedState>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        info!(refresh_secs, "learning agent starting");
        shared_state.heartbeat("learning");

        // Try to load persisted learning state for fast startup.
        let saved = LearningStateSnapshot::load();
        if saved.overall_trades > 0 {
            info!(
                trades = saved.overall_trades,
                wins = saved.overall_wins,
                lessons = saved.lessons_count,
                "loaded persisted learning state"
            );
            if !saved.lessons.is_empty() {
                policy.update(PerformanceMemory::default(), saved.lessons.clone());
                for lesson in &saved.lessons {
                    shared_state.add_lesson(format!("{:?}", lesson));
                }
            }
        }

        let extractor = LessonExtractor::new(cfg);
        // Dedup guards so we never count the same closed trade multiple times.
        let seen_realtime_trades = Arc::new(parking_lot::Mutex::new(DedupWindow::new(10_000)));
        let seen_history_trades = Arc::new(parking_lot::Mutex::new(DedupWindow::new(20_000)));
        let mut tick = tokio::time::interval(Duration::from_secs(refresh_secs.max(60)));
        // Independent heartbeat task — learning's own refresh interval
        // can be many minutes long, far longer than the watchdog
        // tolerance. Send a 30s heartbeat so the watchdog never trips
        // just because we're between policy refreshes.
        {
            let bus_hb = bus.clone();
            let ss_hb = shared_state.clone();
            tokio::spawn(async move {
                let mut hb = tokio::time::interval(Duration::from_secs(30));
                loop {
                    hb.tick().await;
                    ss_hb.heartbeat("learning");
                    bus_hb.publish(AgentEvent::Heartbeat {
                        from: AgentId::Learning,
                        ts: Utc::now(),
                    });
                }
            });
        }
        // Also listen for PositionClosed events to feed the quant engine
        // AND update SharedState strategy health in real-time.
        {
            let qe_rt = quant_engine.as_ref().map(Arc::clone);
            let bus_rt = bus.clone();
            let ss_rt = shared_state.clone();
            let seen_rt = seen_realtime_trades.clone();
            tokio::spawn(async move {
                let mut rx = bus_rt.subscribe();
                while let Ok(ev) = rx.recv().await {
                    if let AgentEvent::PositionClosed {
                        ref client_id,
                        pnl_usd,
                        ref strategy,
                        entry_price,
                        exit_price,
                        size,
                        ..
                    } = ev
                    {
                        // Prefer client_id as stable unique key; include a suffix
                        // so repeated replays of the same event are discarded.
                        let fp = format!(
                            "{client_id}|{strategy}|{entry_price:.8}|{exit_price:.8}|{size:.8}|{pnl_usd:.8}"
                        );
                        if !seen_rt.lock().insert(fp) {
                            continue;
                        }
                        // Feed quant engine
                        if let Some(ref qe) = qe_rt {
                            qe.record_trade(pnl_usd);
                        }

                        // Update SharedState equity
                        ss_rt.update_equity(pnl_usd);
                        ss_rt.on_position_closed();

                        // Update strategy health using ACTUAL strategy name
                        ss_rt.record_strategy_trade(strategy, pnl_usd);

                        // Add lesson if strategy is performing poorly
                        let (
                            should_disable,
                            should_reduce,
                            win_rate,
                            loss_streak,
                            total_pnl,
                            enabled,
                        ) = {
                            let health = ss_rt.strategy_health.read();
                            if let Some(h) = health.get(strategy.as_str()) {
                                (
                                    h.should_disable(),
                                    h.should_reduce_size(),
                                    h.win_rate,
                                    h.loss_streak,
                                    h.total_pnl,
                                    h.enabled,
                                )
                            } else {
                                (false, false, 0.0, 0, 0.0, true)
                            }
                        };

                        if should_disable && enabled {
                            ss_rt.add_lesson(format!(
                                "⚠️ Strategy {} disabled: {:.0}% win rate, {} loss streak, ${:.2} PnL",
                                strategy, win_rate * 100.0, loss_streak, total_pnl
                            ));
                        } else if should_reduce {
                            ss_rt.add_lesson(format!(
                                "📉 Strategy {} size reduced: {:.0}% win rate, {} loss streak",
                                strategy,
                                win_rate * 100.0,
                                loss_streak
                            ));
                        }
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
                    // Feed only NEW historical trades into Kelly + strategy health.
                    for trade in &trades {
                        let fp = format!(
                            "{}|{}|{}|{}|{:.8}",
                            trade.symbol,
                            trade.strategy,
                            trade.entry_time.timestamp(),
                            trade.exit_time.timestamp(),
                            trade.pnl_usd
                        );
                        let is_new = seen_history_trades.lock().insert(fp);
                        if !is_new {
                            continue;
                        }
                        if let Some(ref qe) = quant_engine {
                            qe.record_trade(trade.pnl_usd);
                        }
                        // Use strategy field for health tracking
                        shared_state.record_strategy_trade(&trade.strategy, trade.pnl_usd);
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
                        strategy_summary = %shared_state.get_strategy_summary(),
                        "learning agent: policy refreshed"
                    );

                    // Update SharedState lessons
                    for lesson in &lessons {
                        shared_state.add_lesson(format!("{:?}", lesson));
                    }

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
                        lessons: policy.active_lessons(),
                    };
                    if let Err(e) = snapshot.save() {
                        warn!(error = %e, "failed to persist learning state");
                    }
                }
                Err(e) => {
                    warn!(error = %e, "learning agent: failed to read journal");
                    shared_state.report_error("learning", &e.to_string());
                }
            }
        }
    })
}
