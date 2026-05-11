//! Strategy C — VWAP Order Flow Scalping.
//!
//! Tuned for HFT: wider zones, more permissive slope check, tighter SL for
//! faster risk resolution.

use super::Strategy;
use super::state::{PreSignal, StrategyName, SymbolState};
use crate::data::{Candle, Side};

pub struct VwapScalp;

impl Strategy for VwapScalp {
    fn name(&self) -> StrategyName {
        StrategyName::VwapScalp
    }

    fn evaluate(&self, s: &SymbolState, c: &Candle) -> Option<PreSignal> {
        let vwap = s.last_vwap?;
        let slope = s.last_vwap_slope.unwrap_or(0.0);
        let _atr = s.last_atr?;

        let dist_pct = (c.close - vwap) / vwap.max(1e-9) * 100.0;

        // Wider zones: ±1.0% from VWAP (was ±0.5%) — crypto is volatile
        let long_zone = (-1.0..=0.3).contains(&dist_pct);
        let short_zone = (-0.3..=1.0).contains(&dist_pct);

        // Allow trades even with flat slope — the zone itself is the edge
        let side = if long_zone && slope >= -0.001 {
            Side::Long
        } else if short_zone && slope <= 0.001 {
            Side::Short
        } else {
            return None;
        };

        // Fixed % SL/TP for 100x leverage HFT: 1.5% SL, 3.0% TP (R:R = 1:2)
        let (sl, tp) = match side {
            Side::Long => (c.close * 0.985, c.close * 1.030),
            Side::Short => (c.close * 1.015, c.close * 0.970),
        };

        let mut score: f64 = 62.0; // Above the 60 threshold
        if slope.abs() > 0.0003 {
            score += 8.0;
        }
        // Closer to VWAP = higher confidence
        if dist_pct.abs() < 0.15 {
            score += 10.0;
        } else if dist_pct.abs() < 0.3 {
            score += 5.0;
        }
        // OFI confirmation
        if (side == Side::Long && s.last_ofi.unwrap_or(0.0) > 0.0)
            || (side == Side::Short && s.last_ofi.unwrap_or(0.0) < 0.0)
        {
            score += 5.0;
        }

        Some(PreSignal {
            symbol: s.symbol.clone(),
            strategy: StrategyName::VwapScalp,
            side,
            entry: c.close,
            stop_loss: sl,
            take_profit: tp,
            ta_confidence: score.clamp(0.0, 100.0) as u8,
            reason: format!("VWAP {vwap:.4} slope {slope:.5} dist {dist_pct:.2}%"),
        })
    }
}
