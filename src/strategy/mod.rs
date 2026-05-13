//! Layer 2 — strategy engine.
//!
//! QUANT STRATEGIES (order flow + microstructure, no TA indicators):
//! - OrderFlow: OFI + bid-ask imbalance + VPIN gate
//! - TradeFlow: VPIN toxicity + price velocity + OFI
//! - MicrostructureReversion: VWAP deviation + OFI reversal
//! - KalmanTrend: Kalman velocity + acceleration + OFI

pub mod ab_test;
pub mod alpha_gate;
pub mod hmm;
pub mod kalman;
pub mod kalman_trend;
pub mod microstructure_reversion;
pub mod multi_timeframe;
pub mod order_flow;
pub mod pairs;
pub mod regime;
pub mod retirement;
pub mod squeeze;
pub mod state;
pub mod trade_flow;

// Legacy TA strategies kept for reference but not used in production
pub mod ema_ribbon;
pub mod mean_reversion;
pub mod momentum;
pub mod vwap_scalp;

pub use regime::{Regime, RegimeDetector};
pub use state::{PreSignal, StrategyName, SymbolState};

use crate::data::Candle;

/// Shared trait for all strategies.
pub trait Strategy {
    fn name(&self) -> StrategyName;
    fn evaluate(&self, state: &SymbolState, closed: &Candle) -> Option<PreSignal>;
}

/// Select quant strategies based on regime.
/// All strategies use OFI/VPIN/Kalman — regime only determines emphasis.
pub fn select_strategies(active: &[StrategyName], regime: Regime) -> Vec<StrategyName> {
    // All 4 quant strategies run in all regimes — they self-filter via VPIN/OFI
    // Regime only shifts preference order
    let preferred: &[StrategyName] = match regime {
        Regime::TrendingBullish | Regime::TrendingBearish => &[
            StrategyName::EmaRibbon, // → OrderFlow strategy
            StrategyName::Momentum,  // → TradeFlow strategy
            StrategyName::VwapScalp, // → KalmanTrend strategy
        ],
        Regime::Ranging | Regime::Squeeze => &[
            StrategyName::MeanReversion, // → MicrostructureReversion
            StrategyName::VwapScalp,     // → KalmanTrend
            StrategyName::EmaRibbon,     // → OrderFlow
        ],
        Regime::Volatile => &[
            StrategyName::Momentum,  // → TradeFlow (VPIN gate handles safety)
            StrategyName::EmaRibbon, // → OrderFlow
        ],
        Regime::Unknown => &[
            StrategyName::EmaRibbon,
            StrategyName::Momentum,
            StrategyName::VwapScalp,
            StrategyName::MeanReversion,
        ],
    };
    preferred
        .iter()
        .copied()
        .filter(|s| active.contains(s))
        .collect()
}

/// Build the active quant strategy instances.
/// Maps StrategyName slots to their quant implementations.
pub fn build_strategies() -> Vec<Box<dyn Strategy + Send + Sync>> {
    vec![
        Box::new(order_flow::OrderFlow),
        Box::new(trade_flow::TradeFlow),
        Box::new(kalman_trend::KalmanTrendStrategy),
        Box::new(microstructure_reversion::MicrostructureReversion),
        Box::new(squeeze::Squeeze),
    ]
}
