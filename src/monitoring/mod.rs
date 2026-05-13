//! Layer 5 — trade journal, Telegram alerts, HTTP metrics dashboard.

pub mod logger;
pub mod metrics;
pub mod telegram;

pub use logger::{LearningStateSnapshot, TradeJournal, TradeRecord};
pub use metrics::{
    DashboardState, MetricsSnapshot, MetricsState, spawn_dashboard_server, spawn_metrics_server,
};
pub use telegram::{InlineButton, TelegramNotifier};
