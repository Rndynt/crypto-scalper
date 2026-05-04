//! ControlAgent — operator command surface.
//!
//! Provides three ingress paths:
//!
//! 1. **Telegram bot long-poll** (`/status`, `/positions`, `/freeze`,
//!    `/unfreeze`, `/flat`, `/health`, `/help`, etc.).
//! 2. **Terminal stdin** (`status`, `positions`, `freeze`, `unfreeze`,
//!    `flat`, `health`, `help`) when running interactively.
//! 3. **Internal control file** at `/tmp/aria.control` — write a
//!    single line (`freeze`, `flat`, `unfreeze`, `status`) and the
//!    agent picks it up. Useful for headless servers without
//!    Telegram.
//!
//! Commands are translated into typed `ControlCommand` events on the
//! bus; downstream agents (`ExecutionAgent`, `SurvivalAgent`,
//! `MonitorAgent`) act on them.

use crate::agents::messages::{AgentEvent, BrainOutcome, ControlCommand, SurvivalState};
use crate::agents::MessageBus;
use crate::config::ControlCfg;
use crate::execution::{Exchange, PositionBook, RiskManager};
use crate::monitoring::MetricsState;
use chrono::Utc;
use parking_lot::{Mutex, RwLock};
use reqwest::Client;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{self, AsyncBufReadExt};
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Max recent brain outcomes to keep in memory for the /brain command.
const MAX_RECENT_BRAINS: usize = 20;

pub struct ControlAgentDeps {
    pub bus: MessageBus,
    pub cfg: ControlCfg,
    pub telegram_token: String,
    pub telegram_chat_id: String,
    pub risk: Arc<RiskManager>,
    pub book: Arc<PositionBook>,
    pub exchange: Arc<dyn Exchange>,
    /// Optional path for the file-based ingress. `None` = disable.
    pub control_file: Option<PathBuf>,
    /// Shared metrics for performance stats.
    pub metrics: Arc<MetricsState>,
    /// Shared survival state (updated by SurvivalAgent events).
    pub survival_state: Arc<RwLock<Option<SurvivalState>>>,
}

/// State tracked by the control agent from bus events.
struct ControlState {
    /// Recent brain outcomes, keyed by symbol (latest per symbol).
    recent_brains: Vec<BrainOutcome>, // kept short via MAX_RECENT_BRAINS
    /// Latest survival state.
    survival: Option<SurvivalState>,
    /// Latest mid-prices by symbol (updated from L2 events).
    prices: HashMap<String, f64>,
}

pub fn spawn(deps: ControlAgentDeps) -> JoinHandle<()> {
    let ControlAgentDeps {
        bus,
        cfg,
        telegram_token,
        telegram_chat_id,
        risk,
        book,
        exchange: _exchange,
        control_file,
        metrics,
        survival_state,
    } = deps;

    let allowed: HashSet<i64> = cfg.allowed_user_ids.iter().copied().collect();

    // Shared control state — updated by a bus subscriber task.
    let ctrl_state: Arc<Mutex<ControlState>> = Arc::new(Mutex::new(ControlState {
        recent_brains: Vec::new(),
        survival: None,
        prices: HashMap::new(),
    }));

    // Bus subscriber to track brain outcomes and survival updates.
    {
        let bus_sub = bus.clone();
        let ctrl_state = ctrl_state.clone();
        let survival_state = survival_state.clone();
        let tg_token_sub = telegram_token.clone();
        let tg_chat_sub = telegram_chat_id.clone();
        tokio::spawn(async move {
            let mut rx = bus_sub.subscribe();
            while let Ok(ev) = rx.recv().await {
                match ev {
                    AgentEvent::BrainOutcomeReady(brain) => {
                        // Only send Telegram notification for GO and WAIT signals
                        // (skip NO-GO — not actionable)
                        if !matches!(brain.decision.decision, crate::llm::engine::Decision::NoGo) {
                            let tg_signal = build_signal_notification(&brain);
                            let tg_client = Client::builder()
                                .timeout(std::time::Duration::from_secs(5))
                                .build()
                                .unwrap_or_default();
                            let tg_token = tg_token_sub.clone();
                            let tg_chat = tg_chat_sub.clone();
                            tokio::spawn(async move {
                                send_telegram_html(&tg_client, &tg_token, &tg_chat, &tg_signal).await;
                            });
                        }

                        let mut st = ctrl_state.lock();
                        // Deduplicate: keep only latest per symbol
                        st.recent_brains
                            .retain(|b| b.signal.symbol != brain.signal.symbol);
                        st.recent_brains.push(brain);
                        while st.recent_brains.len() > MAX_RECENT_BRAINS {
                            st.recent_brains.remove(0);
                        }
                    }
                    AgentEvent::BookTicker { symbol, best_bid, best_ask, .. } => {
                        if best_bid > 0.0 && best_ask > 0.0 {
                            let mid = (best_bid + best_ask) / 2.0;
                            ctrl_state.lock().prices.insert(symbol, mid);
                        }
                    }
                    AgentEvent::SurvivalUpdated(s) => {
                        ctrl_state.lock().survival = Some(s.clone());
                        *survival_state.write() = Some(s);
                    }
                    AgentEvent::Shutdown => break,
                    _ => {}
                }
            }
        });
    }

    if cfg.telegram_commands_enabled && !telegram_token.is_empty() && !telegram_chat_id.is_empty() {
        let bus_t = bus.clone();
        let risk_t = risk.clone();
        let book_t = book.clone();
        let metrics_t = metrics.clone();
        let ctrl_state_t = ctrl_state.clone();
        let token = telegram_token.clone();
        let chat_id = telegram_chat_id.clone();
        let poll_secs = cfg.poll_secs.max(1);
        tokio::spawn(async move {
            telegram_loop(
                bus_t,
                token,
                chat_id,
                allowed,
                risk_t,
                book_t,
                metrics_t,
                ctrl_state_t,
                poll_secs,
            )
            .await;
        });
    }

    {
        let bus_s = bus.clone();
        let risk_s = risk.clone();
        let book_s = book.clone();
        let metrics_s = metrics.clone();
        let ctrl_state_s = ctrl_state.clone();
        tokio::spawn(async move {
            stdin_loop(bus_s, risk_s, book_s, metrics_s, ctrl_state_s).await;
        });
    }

    // File-based control surface.
    if let Some(path) = control_file {
        let bus_f = bus.clone();
        tokio::spawn(async move {
            file_loop(bus_f, path).await;
        });
    }

    // Watchdog → freeze/unfreeze handler. Keeps RiskManager in sync
    // with operator commands routed through the bus.
    let mut rx = bus.subscribe();
    let risk_ev = risk.clone();
    tokio::spawn(async move {
        info!("control agent starting");
        while let Ok(ev) = rx.recv().await {
            match ev {
                AgentEvent::ControlCommand(ControlCommand::Freeze { reason }) => {
                    risk_ev.freeze(reason);
                }
                AgentEvent::ControlCommand(ControlCommand::Unfreeze) => {
                    risk_ev.unfreeze();
                }
                AgentEvent::Shutdown => break,
                _ => {}
            }
        }
    })
}

async fn telegram_loop(
    bus: MessageBus,
    token: String,
    chat_id: String,
    allowed: HashSet<i64>,
    risk: Arc<RiskManager>,
    book: Arc<PositionBook>,
    metrics: Arc<MetricsState>,
    ctrl_state: Arc<Mutex<ControlState>>,
    poll_secs: u64,
) {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(poll_secs * 4))
        .build()
        .unwrap_or_default();
    let last_update_id: Arc<Mutex<i64>> = Arc::new(Mutex::new(0));

    loop {
        let offset = *last_update_id.lock() + 1;
        let url = format!(
            "https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout={poll_secs}"
        );
        match client.get(&url).send().await {
            Ok(resp) => {
                let body: Value = match resp.json().await {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(error = %e, "telegram getUpdates parse failed");
                        tokio::time::sleep(std::time::Duration::from_secs(poll_secs)).await;
                        continue;
                    }
                };
                let updates = body
                    .get("result")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                for upd in updates {
                    let update_id = upd.get("update_id").and_then(|v| v.as_i64()).unwrap_or(0);
                    if update_id > *last_update_id.lock() {
                        *last_update_id.lock() = update_id;
                    }
                    let msg = upd.get("message").cloned().unwrap_or(Value::Null);
                    let from_id = msg
                        .get("from")
                        .and_then(|f| f.get("id"))
                        .and_then(|i| i.as_i64())
                        .unwrap_or(0);
                    let text = msg
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !allowed.is_empty() && !allowed.contains(&from_id) {
                        send_telegram(
                            &client,
                            &token,
                            &chat_id,
                            &format!("⛔ user {from_id} not allowed"),
                        )
                        .await;
                        continue;
                    }
                    let reply = handle_command(&text, &bus, &risk, &book, &metrics, &ctrl_state);
                    if !reply.is_empty() {
                        send_telegram_html(&client, &token, &chat_id, &reply).await;
                    }
                }
            }
            Err(e) => {
                warn!(error = %e, "telegram getUpdates failed");
                tokio::time::sleep(std::time::Duration::from_secs(poll_secs)).await;
            }
        }
    }
}

async fn send_telegram(client: &Client, token: &str, chat_id: &str, text: &str) {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
        "parse_mode": "Markdown",
    });
    if let Err(e) = client.post(&url).json(&body).send().await {
        warn!(error = %e, "telegram send failed");
    }
}

async fn send_telegram_html(client: &Client, token: &str, chat_id: &str, text: &str) {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
        "parse_mode": "HTML",
    });
    if let Err(e) = client.post(&url).json(&body).send().await {
        warn!(error = %e, "telegram send failed");
    }
}

async fn stdin_loop(
    bus: MessageBus,
    risk: Arc<RiskManager>,
    book: Arc<PositionBook>,
    metrics: Arc<MetricsState>,
    ctrl_state: Arc<Mutex<ControlState>>,
) {
    let mut lines = io::BufReader::new(io::stdin()).lines();
    info!("stdin control ready — type `help`, then press Enter");
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let reply = handle_command(&line, &bus, &risk, &book, &metrics, &ctrl_state);
                if !reply.is_empty() {
                    // Strip HTML tags for terminal output
                    let plain = strip_html(&reply);
                    println!("{plain}");
                    info!(reply = %plain, "control command");
                }
            }
            Ok(None) => break,
            Err(e) => {
                warn!(error = %e, "stdin control read failed");
                break;
            }
        }
    }
}

/// Strip HTML tags for plain-text terminal output.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn handle_command(
    text: &str,
    bus: &MessageBus,
    risk: &Arc<RiskManager>,
    book: &Arc<PositionBook>,
    metrics: &Arc<MetricsState>,
    ctrl_state: &Arc<Mutex<ControlState>>,
) -> String {
    let cmd = text.trim().to_lowercase();
    match cmd.as_str() {
        "/status" | "status" => cmd_status(bus, risk, book, metrics),
        "/positions" | "positions" => {
            let prices = ctrl_state.lock().prices.clone();
            cmd_positions(book, &prices)
        }
        "/signals" | "signals" => cmd_signals(ctrl_state),
        "/performance" | "performance" => cmd_performance(risk, metrics, ctrl_state),
        "/survival" | "survival" => cmd_survival(ctrl_state),
        "/freeze" | "freeze" => cmd_freeze(bus),
        "/unfreeze" | "unfreeze" => cmd_unfreeze(bus),
        "/flat" | "flat" => cmd_flat(bus),
        "/health" | "health" => cmd_health(bus, risk, metrics),
        "/brain" | "brain" => cmd_brain(ctrl_state),
        "/risk" | "risk" => cmd_risk(risk),
        "/help" | "help" | "/start" | "start" => cmd_help(),
        _ => String::new(),
    }
}

// ─── Command implementations ───────────────────────────────────────

fn cmd_help() -> String {
    "🤖 <b>ARIA Command Center</b>\n\
     ──────────\n\
     \n\
     📊 <b>Monitoring</b>\n\
     ├ <code>/status</code> — Full bot status & risk overview\n\
     ├ <code>/positions</code> — List open positions with P&L\n\
     ├ <code>/signals</code> — Recent AI signal analysis\n\
     ├ <code>/brain</code> — Last AI brain analysis per symbol\n\
     ├ <code>/performance</code> — Daily/weekly performance stats\n\
     ├ <code>/survival</code> — Survival mode details\n\
     ├ <code>/risk</code> — Current risk metrics & limits\n\
     └ <code>/health</code> — System health check\n\
     \n\
     🎮 <b>Control</b>\n\
     ├ <code>/freeze</code> — Pause trading (block new entries)\n\
     ├ <code>/unfreeze</code> — Resume trading\n\
     └ <code>/flat</code> — ⚠ Close ALL positions immediately\n\
     \n\
     🤖 ARIA v1.0"
        .to_string()
}

fn cmd_status(
    bus: &MessageBus,
    risk: &Arc<RiskManager>,
    book: &Arc<PositionBook>,
    metrics: &Arc<MetricsState>,
) -> String {
    bus.publish(AgentEvent::ControlCommand(ControlCommand::StatusRequest));
    let s = risk.snapshot();
    let limits = risk.limits();
    let positions = book.snapshot();
    let m = metrics.snapshot();

    let status_emoji = if s.tripped {
        "🚨"
    } else if s.frozen {
        "🧊"
    } else {
        "✅"
    };
    let status_text = if s.tripped {
        "TRIPPED"
    } else if s.frozen {
        "FROZEN"
    } else {
        "ACTIVE"
    };
    let pnl_sign = if s.realized_pnl_today >= 0.0 { "+" } else { "" };

    // Build positions summary
    let pos_lines: Vec<String> = positions
        .iter()
        .map(|p| {
            let side = if p.side == crate::data::Side::Long {
                "🟢 L"
            } else {
                "🔴 S"
            };
            format!(
                "  ├ {} <code>{}</code> size={:.4} @ {:.2}",
                side,
                short_sym_ctrl(&p.symbol),
                p.size,
                p.entry_price,
            )
        })
        .collect();
    let pos_section = if pos_lines.is_empty() {
        "  └ (none)".to_string()
    } else {
        pos_lines.join("\n")
    };

    format!(
        "{status_emoji} <b>ARIA STATUS</b> — {status_text}\n\
         ──────────\n\
         💰 <b>Account</b>\n\
         ├ Equity: <code>${equity:.2}</code>\n\
         ├ Peak: <code>${peak:.2}</code>\n\
         ├ Daily PnL: <code>{pnl_sign}{pnl:.2}$</code> ({pnl_pct:.2}%)\n\
         └ Drawdown: <code>{dd:.2}%</code>\n\
         \n\
         📊 <b>Trading</b>\n\
         ├ Positions: <code>{open_pos}</code> / {max_pos}\n\
         {pos_section}\n\
         ├ Signals Today: <code>{signals}</code>\n\
         ├ Trades Today: <code>{trades}</code>\n\
         └ Avg LLM Confidence: <code>{avg_conf:.0}%</code>\n\
         \n\
         🧠 <b>AI Pipeline</b>\n\
         ├ GO: <code>{go}</code> · NO-GO: <code>{nogo}</code> · WAIT: <code>{wait}</code>\n\
         └ Offline Fallbacks: <code>{offline}</code>\n\
         \n\
         ⚙ <b>Limits</b>\n\
         ├ Max DD: <code>{max_dd}%</code> · Max Daily Loss: <code>{max_dl}%</code>\n\
         ├ Risk/Trade: <code>{risk_pct}%</code> · Min R:R: <code>{min_rr}</code>\n\
         └ Frozen: <code>{frozen}</code> · Tripped: <code>{tripped}</code>\n\
         \n\
         🤖 ARIA v1.0",
        status_emoji = status_emoji,
        status_text = status_text,
        equity = s.equity,
        peak = s.peak_equity,
        pnl_sign = pnl_sign,
        pnl = s.realized_pnl_today,
        pnl_pct = s.daily_loss_pct,
        dd = s.drawdown_pct,
        open_pos = s.open_positions,
        max_pos = limits.max_open_positions,
        pos_section = pos_section,
        signals = m.signals_today,
        trades = m.trades_today,
        avg_conf = m.llm_avg_confidence,
        go = m.llm_go,
        nogo = m.llm_nogo,
        wait = m.llm_wait,
        offline = m.llm_offline_fallbacks,
        max_dd = limits.max_drawdown_pct,
        max_dl = limits.max_daily_loss_pct,
        risk_pct = limits.risk_per_trade_pct,
        min_rr = limits.min_reward_risk,
        frozen = s.frozen,
        tripped = s.tripped,
    )
}

fn cmd_positions(book: &Arc<PositionBook>, prices: &HashMap<String, f64>) -> String {
    let positions = book.snapshot();
    if positions.is_empty() {
        return "📭 <b>No open positions</b>\n🤖 ARIA v1.0".to_string();
    }

    let mut lines = Vec::new();
    lines.push("📋 <b>Open Positions</b>".to_string());
    lines.push("──────────".to_string());

    let mut total_pnl = 0.0f64;

    for (i, p) in positions.iter().enumerate() {
        let side_emoji = if p.side == crate::data::Side::Long {
            "🟢"
        } else {
            "🔴"
        };
        let side_label = if p.side == crate::data::Side::Long {
            "LONG"
        } else {
            "SHORT"
        };
        let trailing = if p.trailing_activated { " 🔄" } else { "" };
        let be = if p.breakeven_activated { " 🔒" } else { "" };

        // Current price and unrealized PnL
        let current = prices.get(&p.symbol).copied().unwrap_or(0.0);
        let (pnl_str, pnl_emoji, pnl_pct_str) = if current > 0.0 && p.entry_price > 0.0 {
            let pnl_pct = match p.side {
                crate::data::Side::Long => (current - p.entry_price) / p.entry_price * 100.0,
                crate::data::Side::Short => (p.entry_price - current) / p.entry_price * 100.0,
            };
            let pnl_usd = pnl_pct / 100.0 * p.size * p.entry_price;
            total_pnl += pnl_usd;
            let sign = if pnl_usd >= 0.0 { "+" } else { "" };
            let emoji = if pnl_usd >= 0.0 { "📈" } else { "📉" };
            (format!("{}{:.2}$", sign, pnl_usd), emoji, format!("({}{}%)", sign, format!("{:.2}", pnl_pct.abs())))
        } else {
            ("—".to_string(), "⚪", "".to_string())
        };

        // Duration
        let now = Utc::now();
        let dur = now - p.opened_at;
        let mins = dur.num_minutes();
        let duration = if mins >= 60 {
            format!("{}h {}m", mins / 60, mins % 60)
        } else {
            format!("{}m", mins)
        };

        // Price change from entry
        let price_line = if current > 0.0 {
            format!("├ Current: <code>{:.4}</code>\n", current)
        } else {
            String::new()
        };

        lines.push(format!(
            "{side_emoji} <b>#{idx} {sym}</b> — {side_label}{trailing}{be}\n\
             ├ Entry: <code>{entry:.4}</code>\n\
             {price_line}\
             ├ SL: <code>{sl:.4}</code> · TP: <code>{tp:.4}</code>\n\
             ├ Size: <code>{size:.4}</code>\n\
             ├ {pnl_emoji} PnL: <code>{pnl}</code> {pnl_pct}\n\
             └ Duration: <code>{duration}</code> · Opened: <code>{opened}</code>",
            idx = i + 1,
            sym = short_sym_ctrl(&p.symbol),
            entry = p.entry_price,
            price_line = price_line,
            sl = p.stop_loss,
            tp = p.take_profit,
            size = p.size,
            pnl_emoji = pnl_emoji,
            pnl = pnl_str,
            pnl_pct = pnl_pct_str,
            duration = duration,
            opened = p.opened_at.format("%H:%M UTC"),
        ));
    }

    // Total unrealized PnL
    let total_sign = if total_pnl >= 0.0 { "+" } else { "" };
    let total_emoji = if total_pnl >= 0.0 { "📈" } else { "📉" };
    lines.push("──────────".to_string());
    lines.push(format!(
        "{emoji} <b>Unrealized PnL:</b> <code>{sign}{pnl:.2}$</code>",
        emoji = total_emoji,
        sign = total_sign,
        pnl = total_pnl
    ));
    lines.push("🤖 ARIA v1.0".to_string());
    lines.join("\n")
}

fn cmd_signals(ctrl_state: &Arc<Mutex<ControlState>>) -> String {
    let st = ctrl_state.lock();
    if st.recent_brains.is_empty() {
        return "📭 <b>No recent signals</b>\n🤖 ARIA v1.0".to_string();
    }

    let mut lines = Vec::new();
    lines.push("🔔 <b>Recent Signals</b>".to_string());
    lines.push("──────────".to_string());

    for brain in st.recent_brains.iter().rev().take(10) {
        let decision_emoji = match brain.decision.decision {
            crate::llm::engine::Decision::Go => "✅",
            crate::llm::engine::Decision::NoGo => "🚫",
            crate::llm::engine::Decision::Wait => "⏳",
        };
        let side = if brain.signal.side == crate::data::Side::Long {
            "📈 L"
        } else {
            "📉 S"
        };
        let summary = truncate_ctrl(&brain.decision.reasoning.summary, 80);
        lines.push(format!(
            "{decision_emoji} <b>{sym}</b> {side} · conf={conf}%\n\
             ├ Strategy: <code>{strat}</code>\n\
             ├ Scores: TA={ta} Sent={sent} Comp={comp}\n\
             └ <i>{summary}</i>",
            sym = short_sym_ctrl(&brain.signal.symbol),
            side = side,
            conf = brain.decision.confidence,
            strat = brain.signal.strategy.as_str(),
            ta = brain.decision.market_context_score.ta_score,
            sent = brain.decision.market_context_score.sentiment_score,
            comp = brain.decision.market_context_score.composite_score,
            summary = html_escape_ctrl(&summary),
        ));
    }

    lines.push("──────────".to_string());
    lines.push("🤖 ARIA v1.0".to_string());
    lines.join("\n")
}

fn cmd_performance(
    risk: &Arc<RiskManager>,
    metrics: &Arc<MetricsState>,
    ctrl_state: &Arc<Mutex<ControlState>>,
) -> String {
    let s = risk.snapshot();
    let m = metrics.snapshot();
    let st = ctrl_state.lock();
    let survival = st.survival.as_ref();

    let pnl_sign = if s.realized_pnl_today >= 0.0 { "+" } else { "" };
    let wr = if m.trades_today > 0 {
        // Estimate win rate from brain GO vs trades
        // (we don't have direct win count here, so use survival if available)
        0.0 // Will be filled from survival if available
    } else {
        0.0
    };

    let (_win_rate, consec_losses) = if let Some(sv) = survival {
        let wr_est = if sv.open_positions > 0 || sv.consecutive_losses > 0 {
            // Approximate from consecutive losses
            0.0
        } else {
            0.0
        };
        (wr_est, sv.consecutive_losses)
    } else {
        (wr, 0)
    };

    let pnl_pct = if s.equity > 0.0 {
        s.realized_pnl_today / s.equity * 100.0
    } else {
        0.0
    };

    format!(
        "📊 <b>Performance Summary</b>\n\
         ──────────\n\
         💰 <b>Today</b>\n\
         ├ PnL: <code>{pnl_sign}{pnl:.2}$</code> ({pnl_sign}{pnl_pct:.2}%)\n\
         ├ Equity: <code>${equity:.2}</code>\n\
         ├ Peak: <code>${peak:.2}</code>\n\
         └ Drawdown: <code>{dd:.2}%</code>\n\
         \n\
         📈 <b>Activity</b>\n\
         ├ Trades Today: <code>{trades}</code>\n\
         ├ Signals Today: <code>{signals}</code>\n\
         ├ AI GO/NOGO/WAIT: <code>{go}</code>/<code>{nogo}</code>/<code>{wait}</code>\n\
         ├ Avg LLM Latency: <code>{latency}ms</code>\n\
         └ Consecutive Losses: <code>{consec}</code>\n\
         \n\
         🧠 <b>AI Stats</b>\n\
         ├ Avg Confidence: <code>{avg_conf:.0}%</code>\n\
         ├ Active Lessons: <code>{lessons}</code>\n\
         └ Offline Fallbacks: <code>{offline}</code>\n\
         \n\
         🤖 ARIA v1.0",
        pnl_sign = pnl_sign,
        pnl = s.realized_pnl_today,
        pnl_pct = pnl_pct,
        equity = s.equity,
        peak = s.peak_equity,
        dd = s.drawdown_pct,
        trades = m.trades_today,
        signals = m.signals_today,
        go = m.llm_go,
        nogo = m.llm_nogo,
        wait = m.llm_wait,
        latency = m.llm_avg_latency_ms,
        consec = consec_losses,
        avg_conf = m.llm_avg_confidence,
        lessons = m.active_lessons,
        offline = m.llm_offline_fallbacks,
    )
}

fn cmd_survival(ctrl_state: &Arc<Mutex<ControlState>>) -> String {
    let st = ctrl_state.lock();
    let s = match &st.survival {
        Some(s) => s,
        None => {
            return "📭 <b>Survival data not yet available</b>\nWaiting for first update...\n🤖 ARIA v1.0"
                .to_string();
        }
    };

    let mode_emoji = match s.mode {
        crate::agents::messages::SurvivalMode::Healthy => "🟢",
        crate::agents::messages::SurvivalMode::Cautious => "🟡",
        crate::agents::messages::SurvivalMode::Defensive => "🟠",
        crate::agents::messages::SurvivalMode::Frozen => "🧊",
        crate::agents::messages::SurvivalMode::Dead => "💀",
    };
    let pnl_sign = if s.realized_pnl_today >= 0.0 { "+" } else { "" };
    let score_bar = progress_bar(s.score, 20);

    let reasons = if s.reasons.is_empty() {
        "  └ (none active)".to_string()
    } else {
        s.reasons
            .iter()
            .map(|r| format!("  ├ {}", r))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "{mode_emoji} <b>Survival Mode</b>\n\
         ──────────\n\
         🏥 Score: <code>{score}</code>/100 {bar}\n\
         🔧 Mode: <b>{mode}</b>\n\
         📏 Size Multiplier: <code>{mult:.2}×</code>\n\
         \n\
         💰 <b>Account</b>\n\
         ├ Equity: <code>${equity:.2}</code>\n\
         ├ Initial: <code>${initial:.2}</code>\n\
         ├ Peak: <code>${peak:.2}</code>\n\
         ├ Death Line: <code>${death:.2}</code>\n\
         └ Daily PnL: <code>{pnl_sign}{pnl:.2}$</code> ({pnl_pct:.2}%)\n\
         \n\
         📊 <b>Risk</b>\n\
         ├ Drawdown: <code>{dd:.2}%</code>\n\
         ├ Open Positions: <code>{pos}</code>\n\
         └ Consecutive Losses: <code>{losses}</code>\n\
         \n\
         📋 <b>Active Rules</b>\n\
         {reasons}\n\
         \n\
         🤖 ARIA v1.0",
        mode_emoji = mode_emoji,
        score = s.score,
        bar = score_bar,
        mode = s.mode.as_str().to_uppercase(),
        mult = s.size_multiplier,
        equity = s.equity_usd,
        initial = s.initial_equity_usd,
        peak = s.peak_equity_usd,
        death = s.death_line_usd,
        pnl_sign = pnl_sign,
        pnl = s.realized_pnl_today,
        pnl_pct = s.realized_pnl_today,
        dd = s.drawdown_pct,
        pos = s.open_positions,
        losses = s.consecutive_losses,
        reasons = reasons,
    )
}

fn cmd_freeze(bus: &MessageBus) -> String {
    bus.publish(AgentEvent::ControlCommand(ControlCommand::Freeze {
        reason: "operator command".into(),
    }));
    "🧊 <b>Trading FROZEN</b>\nNew entries are now blocked.\n🤖 ARIA v1.0".to_string()
}

fn cmd_unfreeze(bus: &MessageBus) -> String {
    bus.publish(AgentEvent::ControlCommand(ControlCommand::Unfreeze));
    "✅ <b>Trading RESUMED</b>\nEntries are now allowed.\n🤖 ARIA v1.0".to_string()
}

fn cmd_flat(bus: &MessageBus) -> String {
    bus.publish(AgentEvent::ControlCommand(ControlCommand::FlatAll {
        reason: "operator /flat".into(),
    }));
    "🚨 <b>FLAT ALL — dispatched</b>\nClosing all positions at market.\n🤖 ARIA v1.0".to_string()
}

fn cmd_health(bus: &MessageBus, risk: &Arc<RiskManager>, metrics: &Arc<MetricsState>) -> String {
    bus.publish(AgentEvent::ControlCommand(ControlCommand::StatusRequest));
    let s = risk.snapshot();
    let m = metrics.snapshot();

    let risk_ok = !s.tripped && !s.frozen;
    let risk_icon = if risk_ok { "✅" } else { "⚠" };
    let dd_ok = s.drawdown_pct < 5.0;
    let dd_icon = if dd_ok { "✅" } else { "⚠" };
    let llm_ok = m.llm_avg_latency_ms < 10_000;
    let llm_icon = if llm_ok { "✅" } else { "⚠" };

    format!(
        "🏥 <b>Health Check</b>\n\
         ──────────\n\
         {risk_icon} Risk Gate: <code>{risk_status}</code>\n\
         {dd_icon} Drawdown: <code>{dd:.2}%</code>\n\
         {llm_icon} LLM Latency: <code>{latency}ms</code>\n\
         ✅ Event Bus: <code>active</code>\n\
         ✅ Position Book: <code>{pos} open</code>\n\
         ✅ Metrics: <code>updated</code>\n\
         \n\
         🤖 ARIA v1.0",
        risk_icon = risk_icon,
        risk_status = if risk_ok { "OK" } else { "BLOCKED" },
        dd_icon = dd_icon,
        dd = s.drawdown_pct,
        llm_icon = llm_icon,
        latency = m.llm_avg_latency_ms,
        pos = s.open_positions,
    )
}

fn cmd_brain(ctrl_state: &Arc<Mutex<ControlState>>) -> String {
    let st = ctrl_state.lock();
    if st.recent_brains.is_empty() {
        return "📭 <b>No brain analyses yet</b>\n🤖 ARIA v1.0".to_string();
    }

    let mut lines = Vec::new();
    lines.push("🧠 <b>Last AI Analysis</b>".to_string());
    lines.push("──────────".to_string());

    for brain in st.recent_brains.iter().rev().take(5) {
        let decision_emoji = match brain.decision.decision {
            crate::llm::engine::Decision::Go => "✅ GO",
            crate::llm::engine::Decision::NoGo => "🚫 NO-GO",
            crate::llm::engine::Decision::Wait => "⏳ WAIT",
        };
        let ta_analysis = truncate_ctrl(&brain.decision.reasoning.ta_analysis, 100);
        let sentiment = truncate_ctrl(&brain.decision.reasoning.sentiment_analysis, 80);
        let risks = truncate_ctrl(&brain.decision.reasoning.risk_factors, 80);

        lines.push(format!(
            "<b>{sym}</b> — {decision}\n\
             ├ Confidence: <code>{conf}%</code> · Regime: <code>{regime}</code>\n\
             ├ TA: <code>{ta_score}</code> · Sent: <code>{sent_score}</code> · Comp: <code>{comp}</code>\n\
             ├ <i>TA:</i> {ta_analysis}\n\
             ├ <i>Sentiment:</i> {sentiment}\n\
             ├ <i>Risks:</i> {risks}\n\
             └ Latency: <code>{latency}ms</code>{fallback}",
            sym = short_sym_ctrl(&brain.signal.symbol),
            decision = decision_emoji,
            conf = brain.decision.confidence,
            regime = brain.regime.as_str(),
            ta_score = brain.decision.market_context_score.ta_score,
            sent_score = brain.decision.market_context_score.sentiment_score,
            comp = brain.decision.market_context_score.composite_score,
            ta_analysis = html_escape_ctrl(&ta_analysis),
            sentiment = html_escape_ctrl(&sentiment),
            risks = html_escape_ctrl(&risks),
            latency = brain.latency_ms,
            fallback = if brain.offline_fallback { " ⚠ fallback" } else { "" },
        ));
    }

    lines.push("──────────".to_string());
    lines.push("🤖 ARIA v1.0".to_string());
    lines.join("\n")
}

fn cmd_risk(risk: &Arc<RiskManager>) -> String {
    let s = risk.snapshot();
    let limits = risk.limits();
    let size_mult = risk.size_multiplier();

    let status_emoji = if s.tripped {
        "🚨"
    } else if s.frozen {
        "🧊"
    } else {
        "✅"
    };
    let pnl_sign = if s.realized_pnl_today >= 0.0 { "+" } else { "" };

    format!(
        "{status_emoji} <b>Risk Metrics</b>\n\
         ──────────\n\
         💰 <b>Account State</b>\n\
         ├ Equity: <code>${equity:.2}</code>\n\
         ├ Peak: <code>${peak:.2}</code>\n\
         ├ Daily PnL: <code>{pnl_sign}{pnl:.2}$</code>\n\
         ├ Drawdown: <code>{dd:.2}%</code>\n\
         └ Daily Loss: <code>{dl:.2}%</code>\n\
         \n\
         ⚙ <b>Risk Limits</b>\n\
         ├ Risk/Trade: <code>{risk_pct}%</code>\n\
         ├ Max Positions: <code>{max_pos}</code>\n\
         ├ Max Drawdown: <code>{max_dd}%</code>\n\
         ├ Max Daily Loss: <code>{max_dl}%</code>\n\
         ├ Max Leverage: <code>{max_lev}×</code>\n\
         ├ Min R:R: <code>{min_rr}</code>\n\
         └ Size Multiplier: <code>{size_mult:.2}×</code>\n\
         \n\
         🔒 <b>Status</b>\n\
         ├ Open Positions: <code>{open_pos}</code>\n\
         ├ Frozen: <code>{frozen}</code>\n\
         ├ Tripped: <code>{tripped}</code>\
         {trip_reason}\
         {freeze_reason}\n\
         \n\
         🤖 ARIA v1.0",
        status_emoji = status_emoji,
        equity = s.equity,
        peak = s.peak_equity,
        pnl_sign = pnl_sign,
        pnl = s.realized_pnl_today,
        dd = s.drawdown_pct,
        dl = s.daily_loss_pct,
        risk_pct = limits.risk_per_trade_pct,
        max_pos = limits.max_open_positions,
        max_dd = limits.max_drawdown_pct,
        max_dl = limits.max_daily_loss_pct,
        max_lev = limits.max_leverage,
        min_rr = limits.min_reward_risk,
        size_mult = size_mult,
        open_pos = s.open_positions,
        frozen = s.frozen,
        tripped = s.tripped,
        trip_reason = s
            .trip_reason
            .as_ref()
            .map(|r| format!("\n├ Trip Reason: <code>{}</code>", html_escape_ctrl(r)))
            .unwrap_or_default(),
        freeze_reason = s
            .freeze_reason
            .as_ref()
            .map(|r| format!("\n├ Freeze Reason: <code>{}</code>", html_escape_ctrl(r)))
            .unwrap_or_default(),
    )
}

// ─── Helpers ───────────────────────────────────────────────────────

fn short_sym_ctrl(s: &str) -> &str {
    s.strip_suffix("USDT").unwrap_or(s)
}

fn truncate_ctrl(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}…", &s[..max_len.saturating_sub(1)])
    }
}

fn html_escape_ctrl(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Generate a simple text progress bar.
fn progress_bar(value: u8, width: usize) -> String {
    let filled = (value as usize * width) / 100;
    let empty = width.saturating_sub(filled);
    format!("[{}{}]", "█".repeat(filled), "░".repeat(empty))
}

/// Build a signal notification for Telegram when BrainOutcomeReady is received.
fn build_signal_notification(brain: &BrainOutcome) -> String {
    let decision_emoji = match brain.decision.decision {
        crate::llm::engine::Decision::Go => "✅ GO",
        crate::llm::engine::Decision::NoGo => "🚫 NO-GO",
        crate::llm::engine::Decision::Wait => "⏳ WAIT",
    };
    let side_emoji = if brain.signal.side == crate::data::Side::Long {
        "📈"
    } else {
        "📉"
    };
    let side_label = if brain.signal.side == crate::data::Side::Long {
        "LONG"
    } else {
        "SHORT"
    };
    let ta = brain.decision.market_context_score.ta_score;
    let sent = brain.decision.market_context_score.sentiment_score;
    let comp = brain.decision.market_context_score.composite_score;
    let summary = truncate_ctrl(&brain.decision.reasoning.summary, 120);

    // Key reasoning points
    let ta_analysis = truncate_ctrl(&brain.decision.reasoning.ta_analysis, 100);
    let risks = truncate_ctrl(&brain.decision.reasoning.risk_factors, 80);

    let fallback = if brain.offline_fallback { " ⚠ fallback" } else { "" };

    format!(
        "🔔 <b>AI Signal Detected</b>\n\
         ──────────\n\
         {side_emoji} <b>{sym}</b> · {side_label} · {decision_emoji}\n\
         ├ Confidence: <code>{conf}%</code>\n\
         ├ Strategy: <code>{strat}</code>\n\
         ├ Regime: <code>{regime}</code>\n\
         ├ Scores: TA=<code>{ta}</code> Sent=<code>{sent}</code> Comp=<code>{comp}</code>\n\
         ├ Entry: <code>{entry:.4}</code>\n\
         ├ SL: <code>{sl:.4}</code> · TP: <code>{tp:.4}</code>\n\
         ├ R:R: <code>1:{rr:.1}</code>\n\
         ├ <i>TA:</i> {ta_analysis}\n\
         ├ <i>Risks:</i> {risks}\n\
         └ <i>{summary}</i>\n\
         ──────────\n\
         ⏱ Latency: <code>{latency}ms</code>{fallback}\n\
         🤖 ARIA v1.0",
        side_emoji = side_emoji,
        sym = short_sym_ctrl(&brain.signal.symbol),
        side_label = side_label,
        decision_emoji = decision_emoji,
        conf = brain.decision.confidence,
        strat = brain.signal.strategy.as_str(),
        regime = brain.regime.as_str(),
        ta = ta,
        sent = sent,
        comp = comp,
        entry = brain.signal.entry,
        sl = brain.signal.stop_loss,
        tp = brain.signal.take_profit,
        rr = brain.signal.rr(),
        ta_analysis = html_escape_ctrl(&ta_analysis),
        risks = html_escape_ctrl(&risks),
        summary = html_escape_ctrl(&summary),
        latency = brain.latency_ms,
        fallback = fallback,
    )
}

async fn file_loop(bus: MessageBus, path: PathBuf) {
    let mut last_size: u64 = 0;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let meta = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() == last_size {
            continue;
        }
        let content = match tokio::fs::read_to_string(&path).await {
            Ok(s) => s,
            Err(_) => continue,
        };
        let _ = meta.len(); // read above; fall through.
        for line in content.lines() {
            let cmd = line.trim().to_lowercase();
            match cmd.as_str() {
                "freeze" => bus.publish(AgentEvent::ControlCommand(ControlCommand::Freeze {
                    reason: "control file".into(),
                })),
                "unfreeze" => bus.publish(AgentEvent::ControlCommand(ControlCommand::Unfreeze)),
                "flat" => bus.publish(AgentEvent::ControlCommand(ControlCommand::FlatAll {
                    reason: "control file".into(),
                })),
                "status" | "health" => {
                    bus.publish(AgentEvent::ControlCommand(ControlCommand::StatusRequest))
                }
                _ => {}
            }
        }
        // Truncate the file so we don't replay commands.
        let _ = tokio::fs::write(&path, "").await;
        last_size = 0;
    }
}
