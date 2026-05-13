//! Execution agent — listens for `ManagerVerdictEmitted` events,
//! applies any size/SL/TP adjustments, dispatches the order, and
//! publishes `OrderFilled` plus `PositionClosed` events.
//!
//! After every successful entry fill, the agent also dispatches a
//! broker-side STOP_MARKET (SL) and TAKE_PROFIT_MARKET (TP) order
//! with `closePosition=true`. This guarantees that even if our
//! process dies the position has protective exits sitting at the
//! broker — survival rule #1.

use crate::agents::MessageBus;
use crate::agents::messages::{
    AgentEvent, AgentId, ControlCommand, ManagerAction, ManagerProposal, ManagerVerdict,
    SurvivalMode, SurvivalState,
};
use crate::data::Side;
use crate::execution::limit_order::plan_limit_order;
use crate::execution::quality::{ExecutionQuality, TradeQualityRecord};
use crate::execution::{
    Exchange, OrderRequest, Position, PositionBook, PositionConfig, PositionExitReason,
    RiskManager, orders::OrderType,
};
use crate::learning::LearningPolicy;
use chrono::Utc;
use parking_lot::Mutex as PlMutex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

type BookTop = (f64, f64, f64, f64);
type SharedMap<T> = Arc<PlMutex<HashMap<String, T>>>;

pub struct ExecutionAgentDeps {
    pub bus: MessageBus,
    pub exchange: Arc<dyn Exchange>,
    pub risk: Arc<RiskManager>,
    pub book: Arc<PositionBook>,
    /// If true, the executor will refuse new entries while
    /// `SurvivalState.mode` is `Frozen` or `Dead`. This is the
    /// "trade for life" gate — capital protection trumps any
    /// brain/manager approval.
    pub honor_survival: bool,
    pub protective_orders_required: bool,
    pub policy: LearningPolicy,
    pub enforce_single_position_per_symbol: bool,
}

pub fn spawn(deps: ExecutionAgentDeps) -> JoinHandle<()> {
    let ExecutionAgentDeps {
        bus,
        exchange,
        risk,
        book,
        honor_survival,
        protective_orders_required,
        policy,
        enforce_single_position_per_symbol,
    } = deps;

    let mut rx = bus.subscribe();
    let bus_for_close = bus.clone();
    let survival = Arc::new(PlMutex::new(None::<SurvivalState>));
    let last_marks: SharedMap<f64> = Arc::new(PlMutex::new(HashMap::new()));
    let last_books: SharedMap<BookTop> = Arc::new(PlMutex::new(HashMap::new()));
    let exec_quality = Arc::new(PlMutex::new(ExecutionQuality::default()));
    let decision_prices: SharedMap<f64> = Arc::new(PlMutex::new(HashMap::new()));
    let pos_cfg = PositionConfig {
        max_hold_secs: 900,       // 15 min max hold for HFT
        trail_atr_mult: 0.3,      // Tighter trail at 0.3× ATR
        trail_activate_r: 1.0,    // Activate trailing at 1R profit
        breakeven_r: 0.5,         // Move SL to entry at 0.5R profit
        partial_tp_enabled: true, // Take 50% at 1R profit
        partial_tp_r: 1.0,        // Trigger at 1R profit
    };

    tokio::spawn(async move {
        info!("execution agent starting");
        crate::agents::heartbeat::spawn(bus.clone(), AgentId::Execution);
        while let Ok(ev) = rx.recv().await {
            match ev {
                AgentEvent::Tick { symbol, trade } => {
                    if trade.price <= 0.0 {
                        continue; // drop zero-price ticks — WS artifact
                    }
                    last_marks.lock().insert(symbol.clone(), trade.price);
                    // Mark-price exit checks happen here so we own the
                    // bus emission when a position closes.
                    let exits = book.check_exits(&symbol, trade.price, &pos_cfg);
                    for (pos, reason) in exits {
                        let pnl = crate::execution::position::pnl_usd(&pos, trade.price);
                        risk.on_position_closed(pnl);
                        let _ = exchange.cancel_all(&pos.symbol).await;
                        let pnl_pct = if pos.entry_price > 0.0 {
                            (trade.price - pos.entry_price) / pos.entry_price * 100.0
                        } else {
                            0.0
                        };
                        info!(
                            symbol  = %pos.symbol,
                            side    = %pos.side.as_str(),
                            reason  = %reason.as_str(),
                            entry   = %format!("{:.4}", pos.entry_price),
                            exit    = %format!("{:.4}", trade.price),
                            sl      = %format!("{:.4}", pos.stop_loss),
                            tp      = %format!("{:.4}", pos.take_profit),
                            size    = %format!("{:.6}", pos.size),
                            pnl_usd = %format!("{:+.4}", pnl),
                            pnl_pct = %format!("{:+.4}%", pnl_pct),
                            "execution: position closed"
                        );
                        bus_for_close.publish(AgentEvent::PositionClosed {
                            client_id: pos.client_id.clone(),
                            symbol: pos.symbol.clone(),
                            side: pos.side,
                            size: pos.size,
                            entry_price: pos.entry_price,
                            exit_price: trade.price,
                            pnl_usd: pnl,
                            reason,
                            strategy: pos.strategy.clone(),
                        });
                    }
                }
                AgentEvent::BookTicker {
                    symbol,
                    best_bid,
                    bid_qty,
                    best_ask,
                    ask_qty,
                } => {
                    last_books
                        .lock()
                        .insert(symbol, (best_bid, bid_qty, best_ask, ask_qty));
                }
                AgentEvent::SurvivalUpdated(s) => {
                    *survival.lock() = Some(s);
                }
                AgentEvent::ControlCommand(ControlCommand::FlatAll { reason }) => {
                    warn!(%reason, "execution: flat-all requested — closing every position");
                    let positions = book.snapshot();
                    let marks = last_marks.lock().clone();
                    for pos in positions {
                        let mark = *marks.get(&pos.symbol).unwrap_or(&pos.entry_price);
                        // Cancel SL/TP first so we don't double-close.
                        let _ = exchange.cancel_all(&pos.symbol).await;
                        // Send a reduce-only market in the opposite direction.
                        let close_side = match pos.side {
                            Side::Long => Side::Short,
                            Side::Short => Side::Long,
                        };
                        let close_req = OrderRequest {
                            client_id: format!(
                                "aria-flat-{}-{}",
                                pos.symbol,
                                Utc::now().timestamp_millis()
                            ),
                            symbol: pos.symbol.clone(),
                            side: close_side,
                            size: pos.size,
                            price: None,
                            stop_price: None,
                            stop_loss: 0.0,
                            take_profit: 0.0,
                            order_type: OrderType::Market,
                            reduce_only: true,
                        };
                        if let Err(e) = exchange.place_order(&close_req).await {
                            warn!(error = %e, symbol = %pos.symbol, "flat-all close failed");
                        }
                        let pnl = crate::execution::position::pnl_usd(&pos, mark);
                        risk.on_position_closed(pnl);
                        if let Some(closed) = book.close_by_id(&pos.client_id) {
                            let pnl_pct = if closed.entry_price > 0.0 {
                                (mark - closed.entry_price) / closed.entry_price * 100.0
                            } else {
                                0.0
                            };
                            info!(
                                symbol  = %closed.symbol,
                                side    = %closed.side.as_str(),
                                reason  = "MANUAL(flat-all)",
                                entry   = %format!("{:.4}", closed.entry_price),
                                exit    = %format!("{:.4}", mark),
                                sl      = %format!("{:.4}", closed.stop_loss),
                                tp      = %format!("{:.4}", closed.take_profit),
                                size    = %format!("{:.6}", closed.size),
                                pnl_usd = %format!("{:+.4}", pnl),
                                pnl_pct = %format!("{:+.4}%", pnl_pct),
                                "execution: position closed"
                            );
                            bus_for_close.publish(AgentEvent::PositionClosed {
                                client_id: closed.client_id,
                                symbol: closed.symbol,
                                side: closed.side,
                                size: closed.size,
                                entry_price: closed.entry_price,
                                exit_price: mark,
                                pnl_usd: pnl,
                                reason: PositionExitReason::Manual,
                                strategy: closed.strategy.clone(),
                            });
                        }
                    }
                }
                AgentEvent::ManagerVerdictEmitted(v) => {
                    if matches!(v.action, ManagerAction::Veto { .. }) {
                        info!(
                            symbol = %v.proposal.symbol,
                            reason = %extract_reason(&v.action),
                            "execution: manager vetoed"
                        );
                        continue;
                    }
                    if v.proposal.entry <= 0.0 || v.proposal.size <= 0.0 {
                        warn!(
                            symbol = %v.proposal.symbol,
                            entry = v.proposal.entry,
                            size = v.proposal.size,
                            "execution: invalid proposal (entry/size <= 0) — discarding"
                        );
                        continue;
                    }
                    // Survival gate.
                    if honor_survival {
                        if let Some(s) = survival.lock().as_ref() {
                            if matches!(s.mode, SurvivalMode::Frozen | SurvivalMode::Dead) {
                                info!(
                                    symbol = %v.proposal.symbol,
                                    mode = %s.mode.as_str(),
                                    "execution: survival mode gate refused entry"
                                );
                                continue;
                            }
                        }
                    }
                    if risk.is_blocked() {
                        info!(symbol = %v.proposal.symbol, "execution: risk manager blocked entry");
                        continue;
                    }

                    // Final learning-policy gate at the last mile.
                    // Ensures newly learned lessons can still block/derate
                    // right before execution (defense in depth).
                    let exec_policy = policy.evaluate(
                        v.proposal.strategy.as_str(),
                        v.proposal.regime.as_str(),
                        v.proposal.symbol.as_str(),
                    );
                    if !exec_policy.allowed {
                        info!(
                            symbol = %v.proposal.symbol,
                            strategy = %v.proposal.strategy,
                            regime = %v.proposal.regime,
                            lessons = ?exec_policy.matched_lessons,
                            "execution: blocked by learning policy"
                        );
                        continue;
                    }

                    // Final anti-stacking guard: verify both local book and
                    // exchange truth before opening a new entry for symbol.
                    if enforce_single_position_per_symbol {
                        if has_open_position_for_symbol(&book, v.proposal.symbol.as_str()) {
                            warn!(symbol = %v.proposal.symbol, "execution: blocked duplicate (local book)");
                            continue;
                        }
                        match exchange
                            .fetch_open_positions(std::slice::from_ref(&v.proposal.symbol))
                            .await
                        {
                            Ok(positions) => {
                                let has_exchange_pos = positions
                                    .iter()
                                    .any(|p| p.symbol == v.proposal.symbol && p.size.abs() > 0.0);
                                if has_exchange_pos {
                                    warn!(
                                        symbol = %v.proposal.symbol,
                                        count = positions.len(),
                                        "execution: blocked duplicate (exchange position already open)"
                                    );
                                    continue;
                                }
                            }
                            Err(e) => {
                                warn!(
                                    symbol = %v.proposal.symbol,
                                    error = %e,
                                    "execution: failed fetching exchange positions — failing closed"
                                );
                                continue;
                            }
                        }
                    }

                    // Record decision price for execution quality tracking
                    decision_prices
                        .lock()
                        .insert(v.proposal.symbol.clone(), v.proposal.entry);

                    let mut req = build_entry_request(&v);
                    // Apply last-mile lesson-derived size multiplier so
                    // derate/boost policies also influence final execution.
                    req.size *= exec_policy.size_multiplier.clamp(0.0, 2.0);
                    if req.size <= 0.0 {
                        info!(
                            symbol = %v.proposal.symbol,
                            strategy = %v.proposal.strategy,
                            regime = %v.proposal.regime,
                            size_mult = exec_policy.size_multiplier,
                            "execution: blocked by lesson size multiplier"
                        );
                        continue;
                    }
                    if !has_valid_brackets(&req) {
                        warn!(
                            symbol = %req.symbol,
                            side = %req.side.as_str(),
                            entry = req.price.unwrap_or(0.0),
                            sl = req.stop_loss,
                            tp = req.take_profit,
                            "execution: invalid SL/TP geometry — discarding proposal"
                        );
                        continue;
                    }

                    // Smart order routing: use limit order when spread allows
                    // Scoped so the MutexGuard is dropped before any .await
                    let (use_limit, limit_price) = {
                        let books = last_books.lock();
                        if let Some((bid, _bq, ask, _aq)) = books.get(&v.proposal.symbol) {
                            let mid = (bid + ask) / 2.0;
                            let spread_bps = (ask - bid) / mid * 10_000.0;
                            if spread_bps > 1.5 {
                                if let Some(plan) = plan_limit_order(
                                    req.side,
                                    *bid,
                                    *ask,
                                    v.proposal.entry,
                                    0.0,
                                    1.0,
                                    5.0,
                                ) {
                                    (true, Some(plan.price))
                                } else {
                                    (false, None)
                                }
                            } else {
                                (false, None)
                            }
                        } else {
                            (false, None)
                        }
                    }; // books guard dropped here

                    let actual_req = if use_limit && limit_price.is_some() {
                        OrderRequest {
                            order_type: OrderType::Limit,
                            price: limit_price,
                            ..req.clone()
                        }
                    } else {
                        req.clone()
                    };

                    match exchange.place_order(&actual_req).await {
                        Ok(ack) => {
                            let fill_price = if ack.avg_fill_price > 0.0 {
                                ack.avg_fill_price
                            } else {
                                req.price.unwrap_or(0.0)
                            };
                            if fill_price <= 0.0 {
                                warn!(
                                    symbol = %req.symbol,
                                    "execution: fill_price is zero — discarding ghost position"
                                );
                                continue;
                            }
                            risk.on_position_opened();

                            // Record execution quality
                            if let Some(decision_px) = decision_prices.lock().remove(&req.symbol) {
                                let arrival_px = last_marks
                                    .lock()
                                    .get(&req.symbol)
                                    .copied()
                                    .unwrap_or(fill_price);
                                exec_quality.lock().record(TradeQualityRecord {
                                    symbol: req.symbol.clone(),
                                    decision_price: decision_px,
                                    arrival_price: arrival_px,
                                    fill_price,
                                    side: req.side,
                                    size: req.size,
                                });
                                let is = (fill_price - decision_px).abs() / decision_px * 10_000.0;
                                if is > 5.0 {
                                    info!(
                                        symbol = %req.symbol,
                                        is_bps = %format!("{:.1}", is),
                                        "execution: high implementation shortfall"
                                    );
                                    bus.publish(AgentEvent::SlippageObserved {
                                        symbol: req.symbol.clone(),
                                        shortfall_bps: is,
                                    });
                                }
                            }

                            info!(
                                symbol = %req.symbol,
                                side  = %format!("{:?}", req.side),
                                entry = %format!("{:.4}", fill_price),
                                sl    = %format!("{:.4}", req.stop_loss),
                                tp    = %format!("{:.4}", req.take_profit),
                                size  = %format!("{:.6}", req.size),
                                "execution: position opened"
                            );
                            let pos = Position {
                                client_id: req.client_id.clone(),
                                symbol: req.symbol.clone(),
                                side: req.side,
                                size: req.size,
                                entry_price: fill_price,
                                stop_loss: req.stop_loss,
                                take_profit: req.take_profit,
                                opened_at: Utc::now(),
                                trailing_activated: false,
                                peak_price: fill_price,
                                trough_price: fill_price,
                                atr_at_entry: 0.0, // Will use profit-based fallback
                                partial_taken: false,
                                breakeven_activated: false,
                                strategy: v.proposal.strategy.clone(),
                            };
                            book.open(pos.clone());

                            if let Err(e) =
                                place_protective_orders(&exchange, &req, protective_orders_required)
                                    .await
                            {
                                error!(symbol = %req.symbol, error = %e, "execution: protective order setup failed");
                                let reason = format!(
                                    "protective order setup failed for {}: {e}",
                                    req.symbol
                                );
                                risk.freeze(reason.clone());
                                bus.publish(AgentEvent::ControlCommand(ControlCommand::Freeze {
                                    reason,
                                }));
                                let _ = exchange.cancel_all(&req.symbol).await;
                                continue;
                            }

                            bus.publish(AgentEvent::OrderFilled {
                                client_id: req.client_id,
                                symbol: req.symbol,
                                side: req.side,
                                size: req.size,
                                ack,
                            });
                        }
                        Err(e) => warn!(error = %e, "execution: place_order failed"),
                    }
                }
                AgentEvent::Shutdown => break,
                _ => {}
            }
        }
    })
}

fn extract_reason(a: &ManagerAction) -> String {
    match a {
        ManagerAction::Veto { reason } => reason.clone(),
        ManagerAction::Adjust { reason, .. } => reason.clone(),
        ManagerAction::Approve => String::new(),
    }
}

fn build_entry_request(v: &ManagerVerdict) -> OrderRequest {
    let p: &ManagerProposal = &v.proposal;
    let (size, sl, tp) = match &v.action {
        ManagerAction::Approve | ManagerAction::Veto { .. } => (p.size, p.stop_loss, p.take_profit),
        ManagerAction::Adjust {
            size_multiplier,
            sl_offset_bps,
            tp_offset_bps,
            ..
        } => {
            let size = p.size * size_multiplier;
            let sl_adj = bps_offset(p.entry, *sl_offset_bps, p.side, true);
            let tp_adj = bps_offset(p.entry, *tp_offset_bps, p.side, false);
            (size, p.stop_loss + sl_adj, p.take_profit + tp_adj)
        }
    };
    OrderRequest {
        client_id: idempotent_client_id(&p.symbol, &p.strategy, &p.side, p.entry, p.size),
        symbol: p.symbol.clone(),
        side: p.side,
        size,
        price: Some(p.entry),
        stop_price: None,
        stop_loss: sl,
        take_profit: tp,
        order_type: OrderType::Market,
        reduce_only: false,
    }
}

fn has_valid_brackets(req: &OrderRequest) -> bool {
    let entry = req.price.unwrap_or(0.0);
    if entry <= 0.0 || req.stop_loss <= 0.0 || req.take_profit <= 0.0 {
        return false;
    }
    match req.side {
        Side::Long => req.stop_loss < entry && req.take_profit > entry,
        Side::Short => req.stop_loss > entry && req.take_profit < entry,
    }
}

fn build_sl_request(entry: &OrderRequest) -> Option<OrderRequest> {
    if entry.stop_loss <= 0.0 {
        return None;
    }
    let close_side = match entry.side {
        Side::Long => Side::Short,
        Side::Short => Side::Long,
    };
    Some(OrderRequest {
        client_id: format!("{}-sl", entry.client_id),
        symbol: entry.symbol.clone(),
        side: close_side,
        size: entry.size,
        price: None,
        stop_price: Some(entry.stop_loss),
        stop_loss: entry.stop_loss,
        take_profit: entry.take_profit,
        order_type: OrderType::StopLoss,
        reduce_only: true,
    })
}

fn build_tp_request(entry: &OrderRequest) -> Option<OrderRequest> {
    if entry.take_profit <= 0.0 {
        return None;
    }
    let close_side = match entry.side {
        Side::Long => Side::Short,
        Side::Short => Side::Long,
    };
    Some(OrderRequest {
        client_id: format!("{}-tp", entry.client_id),
        symbol: entry.symbol.clone(),
        side: close_side,
        size: entry.size,
        price: None,
        stop_price: Some(entry.take_profit),
        stop_loss: entry.stop_loss,
        take_profit: entry.take_profit,
        order_type: OrderType::TakeProfit,
        reduce_only: true,
    })
}

async fn place_protective_orders(
    exchange: &Arc<dyn Exchange>,
    entry: &OrderRequest,
    required: bool,
) -> crate::errors::Result<()> {
    let mut placed = 0;
    if let Some(sl_req) = build_sl_request(entry) {
        exchange.place_order(&sl_req).await?;
        placed += 1;
    }
    if let Some(tp_req) = build_tp_request(entry) {
        exchange.place_order(&tp_req).await?;
        placed += 1;
    }
    if required && placed < 2 {
        return Err(crate::errors::ScalperError::Exchange(format!(
            "expected 2 protective orders, placed {placed}"
        )));
    }
    Ok(())
}

fn bps_offset(entry: f64, bps: f64, side: Side, _is_sl: bool) -> f64 {
    // bps relative to entry price; sign convention left to the LLM.
    let raw = entry * (bps / 10_000.0);
    match side {
        Side::Long => raw,
        Side::Short => -raw,
    }
}

fn has_open_position_for_symbol(book: &PositionBook, symbol: &str) -> bool {
    book.snapshot()
        .into_iter()
        .any(|p| p.symbol == symbol && p.size.abs() > 0.0)
}

/// Deterministic client-id derived from the proposal contents.
/// Two retries of the same signal will produce the same id, so the
/// exchange will reject the duplicate rather than open two positions.
fn idempotent_client_id(
    symbol: &str,
    strategy: &str,
    side: &Side,
    entry: f64,
    size: f64,
) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let bucket = Utc::now().timestamp() / 60; // 1-minute bucket
    let side = match side {
        Side::Long => "L",
        Side::Short => "S",
    };
    let mut h = DefaultHasher::new();
    (
        symbol,
        strategy,
        side,
        (entry * 1e6) as i64,
        (size * 1e6) as i64,
        bucket,
    )
        .hash(&mut h);
    format!("aria-{}-{}-{:x}", symbol, side, h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idempotent_client_id_is_deterministic_within_bucket() {
        let a = idempotent_client_id("BTCUSDT", "ema_ribbon", &Side::Long, 67_240.5, 0.012);
        let b = idempotent_client_id("BTCUSDT", "ema_ribbon", &Side::Long, 67_240.5, 0.012);
        assert_eq!(a, b);
    }

    #[test]
    fn idempotent_client_id_differs_for_distinct_signals() {
        let a = idempotent_client_id("BTCUSDT", "ema_ribbon", &Side::Long, 67_240.5, 0.012);
        let b = idempotent_client_id("BTCUSDT", "ema_ribbon", &Side::Short, 67_240.5, 0.012);
        assert_ne!(a, b);
    }

    fn req(side: Side, entry: f64, sl: f64, tp: f64) -> OrderRequest {
        OrderRequest {
            client_id: "t".into(),
            symbol: "BTCUSDT".into(),
            side,
            size: 0.01,
            price: Some(entry),
            stop_price: None,
            stop_loss: sl,
            take_profit: tp,
            order_type: OrderType::Market,
            reduce_only: false,
        }
    }

    #[test]
    fn long_brackets_must_be_sl_below_tp_above() {
        assert!(has_valid_brackets(&req(Side::Long, 100.0, 99.0, 101.0)));
        assert!(!has_valid_brackets(&req(Side::Long, 100.0, 101.0, 99.0)));
        assert!(!has_valid_brackets(&req(Side::Long, 100.0, 100.0, 101.0)));
    }

    #[test]
    fn short_brackets_must_be_tp_below_sl_above() {
        assert!(has_valid_brackets(&req(Side::Short, 100.0, 101.0, 99.0)));
        assert!(!has_valid_brackets(&req(Side::Short, 100.0, 99.0, 101.0)));
        assert!(!has_valid_brackets(&req(Side::Short, 100.0, 101.0, 100.0)));
    }
}
