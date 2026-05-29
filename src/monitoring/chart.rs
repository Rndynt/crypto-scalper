//! Generate candlestick chart images for signal notifications.
//!
//! Uses `plotters` with an in-memory bitmap backend.

use crate::data::Side;
use plotters::prelude::*;
use tracing::debug;

/// Candle data for chart rendering.
#[derive(Debug, Clone, Copy)]
pub struct ChartCandle {
    pub open_time: chrono::DateTime<chrono::Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

impl From<&crate::data::Candle> for ChartCandle {
    fn from(c: &crate::data::Candle) -> Self {
        Self {
            open_time: c.open_time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
        }
    }
}

/// Fetch recent klines from Binance Futures public API.
pub async fn fetch_klines(
    client: &reqwest::Client,
    symbol: &str,
    interval: &str,
    limit: u32,
) -> Result<Vec<ChartCandle>, String> {
    let url = format!(
        "https://fapi.binance.com/fapi/v1/klines?symbol={}&interval={}&limit={}",
        symbol, interval, limit
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("kline fetch: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("kline status {}", resp.status()));
    }

    let raw: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("kline parse: {}", e))?;

    let mut candles = Vec::with_capacity(raw.len());
    for r in &raw {
        let arr = r.as_array().ok_or("kline: not array")?;
        if arr.len() < 6 {
            continue;
        }
        let ts_ms = arr[0].as_i64().unwrap_or(0);
        let open_time = chrono::DateTime::from_timestamp_millis(ts_ms).unwrap_or_default();
        candles.push(ChartCandle {
            open_time,
            open: arr[1].as_str().unwrap_or("0").parse().unwrap_or(0.0),
            high: arr[2].as_str().unwrap_or("0").parse().unwrap_or(0.0),
            low: arr[3].as_str().unwrap_or("0").parse().unwrap_or(0.0),
            close: arr[4].as_str().unwrap_or("0").parse().unwrap_or(0.0),
            volume: arr[5].as_str().unwrap_or("0").parse().unwrap_or(0.0),
        });
    }
    debug!("chart: fetched {} klines for {}", candles.len(), symbol);
    Ok(candles)
}

/// Generate a candlestick chart image with entry/TP/SL levels.
/// Returns raw BMP bytes.
pub fn generate_signal_chart(
    symbol: &str,
    side: Side,
    entry: f64,
    sl: f64,
    tp: f64,
    candles: &[ChartCandle],
) -> Result<Vec<u8>, String> {
    if candles.is_empty() {
        return Err("no candle data".into());
    }

    let w = 900u32;
    let h = 520u32;
    let n = candles.len() as i32;

    // Colors
    let bg = RGBColor(18, 18, 30);
    let bull = RGBColor(38, 166, 91);
    let bear = RGBColor(231, 76, 60);
    let grid = RGBColor(35, 35, 55);
    let txt = RGBColor(190, 190, 210);
    let entry_c = RGBColor(52, 152, 219);
    let sl_c = RGBColor(231, 76, 60);
    let tp_c = RGBColor(46, 204, 113);
    let gold = RGBColor(255, 215, 0);

    // Price range
    let mut pmin = candles.iter().map(|c| c.low).fold(f64::MAX, f64::min);
    let mut pmax = candles.iter().map(|c| c.high).fold(f64::MIN, f64::max);
    for &p in &[entry, sl, tp] {
        if p > 0.0 {
            pmin = pmin.min(p);
            pmax = pmax.max(p);
        }
    }
    let pad = (pmax - pmin) * 0.10;
    pmin -= pad;
    pmax += pad;

    let mut buf = vec![0u8; (w * h * 3) as usize];

    {
        let root = BitMapBackend::with_buffer(&mut buf, (w, h)).into_drawing_area();
        root.fill(&bg).map_err(|e| e.to_string())?;

        // Title (top 36px)
        let (title_area, chart_area) = root.split_vertically(36).map_err(|e| e.to_string())?;

        let slabel = if side == Side::Long { "📈 LONG" } else { "📉 SHORT" };
        let title = format!(
            "{} {}  ·  Entry {:.2}  SL {:.2}  TP {:.2}",
            symbol.replace("USDT", ""),
            slabel,
            entry,
            sl,
            tp
        );
        title_area
            .draw(&Text::new(
                title,
                (15, 8),
                ("sans-serif", 18).into_font().color(&txt),
            ))
            .map_err(|e| e.to_string())?;

        // Chart
        let mut chart = ChartBuilder::on(&chart_area)
            .margin_left(60)
            .margin_right(65)
            .margin_top(5)
            .margin_bottom(22)
            .build_cartesian_2d(0i32..n, pmin..pmax)
            .map_err(|e| e.to_string())?;

        chart
            .configure_mesh()
            .x_label_formatter(&|x| {
                let i = *x as usize;
                if i < candles.len() {
                    candles[i].open_time.format("%H:%M").to_string()
                } else {
                    String::new()
                }
            })
            .y_label_formatter(&|y| format!("{:.2}", y))
            .x_labels(8)
            .y_labels(8)
            .label_style(("sans-serif", 10).into_font().color(&txt))
            .light_line_style(grid)
            .bold_line_style(grid)
            .draw()
            .map_err(|e| e.to_string())?;

        // Candlesticks
        for (i, c) in candles.iter().enumerate() {
            let x = i as i32;
            let col = if c.close >= c.open { bull } else { bear };
            let top = c.open.max(c.close);
            let bot = c.open.min(c.close);

            // Wick
            chart
                .draw_series(std::iter::once(PathElement::new(
                    vec![(x, c.low), (x, c.high)],
                    &col,
                )))
                .map_err(|e| e.to_string())?;

            // Body
            if (top - bot).abs() > (pmax - pmin) * 0.0005 {
                chart
                    .draw_series(std::iter::once(Rectangle::new(
                        [(x, bot), (x, top)],
                        col.filled(),
                    )))
                    .map_err(|e| e.to_string())?;
            }
        }

        // Volume (bottom 12%)
        let vol_max = candles.iter().map(|c| c.volume).fold(0.0f64, f64::max);
        let vol_h = (pmax - pmin) * 0.12;
        if vol_max > 0.0 {
            for (i, c) in candles.iter().enumerate() {
                let x = i as i32;
                let vh = (c.volume / vol_max) * vol_h;
                let vc = if c.close >= c.open {
                    bull.mix(0.2)
                } else {
                    bear.mix(0.2)
                };
                chart
                    .draw_series(std::iter::once(Rectangle::new(
                        [(x, pmin), (x, pmin + vh)],
                        vc.filled(),
                    )))
                    .map_err(|e| e.to_string())?;
            }
        }

        // Entry line
        if entry > 0.0 {
            chart
                .draw_series(std::iter::once(PathElement::new(
                    vec![(0, entry), (n, entry)],
                    ShapeStyle { color: entry_c.to_rgba(), filled: false, stroke_width: 2 },
                )))
                .map_err(|e| e.to_string())?;
            chart
                .draw_series(std::iter::once(Text::new(
                    format!("ENTRY {:.2}", entry),
                    (1, entry + (pmax - pmin) * 0.018),
                    ("sans-serif", 11).into_font().color(&entry_c),
                )))
                .map_err(|e| e.to_string())?;
        }

        // SL line
        if sl > 0.0 {
            chart
                .draw_series(std::iter::once(PathElement::new(
                    vec![(0, sl), (n, sl)],
                    ShapeStyle { color: sl_c.to_rgba(), filled: false, stroke_width: 2 },
                )))
                .map_err(|e| e.to_string())?;
            chart
                .draw_series(std::iter::once(Text::new(
                    format!("SL {:.2}", sl),
                    (n - 8, sl + (pmax - pmin) * 0.018),
                    ("sans-serif", 11).into_font().color(&sl_c),
                )))
                .map_err(|e| e.to_string())?;
        }

        // TP line
        if tp > 0.0 {
            chart
                .draw_series(std::iter::once(PathElement::new(
                    vec![(0, tp), (n, tp)],
                    ShapeStyle { color: tp_c.to_rgba(), filled: false, stroke_width: 2 },
                )))
                .map_err(|e| e.to_string())?;
            chart
                .draw_series(std::iter::once(Text::new(
                    format!("TP {:.2}", tp),
                    (n - 8, tp + (pmax - pmin) * 0.018),
                    ("sans-serif", 11).into_font().color(&tp_c),
                )))
                .map_err(|e| e.to_string())?;
        }

        // R:R badge
        if entry > 0.0 && sl > 0.0 && tp > 0.0 {
            let risk = (entry - sl).abs();
            let reward = (tp - entry).abs();
            if risk > 0.0 {
                let rr = reward / risk;
                chart
                    .draw_series(std::iter::once(Text::new(
                        format!("R:R = 1:{:.1}", rr),
                        (2, pmin + (pmax - pmin) * 0.03),
                        ("sans-serif", 13).into_font().color(&gold),
                    )))
                    .map_err(|e| e.to_string())?;
            }
        }

        root.present().map_err(|e| e.to_string())?;
    }

    let bmp = encode_bmp(w, h, &buf);
    debug!("chart: {}x{} BMP {} bytes for {}", w, h, bmp.len(), symbol);
    Ok(bmp)
}

fn encode_bmp(width: u32, height: u32, rgb: &[u8]) -> Vec<u8> {
    let row = (width * 3) as usize;
    let pad = (4 - (row % 4)) % 4;
    let prow = row + pad;
    let dsize = prow * height as usize;
    let fsize = 54 + dsize;

    let mut out = Vec::with_capacity(fsize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(fsize as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(dsize as u32).to_le_bytes());
    out.extend_from_slice(&2835u32.to_le_bytes());
    out.extend_from_slice(&2835u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());

    for y in (0..height as usize).rev() {
        for x in 0..width as usize {
            let i = (y * width as usize + x) * 3;
            out.push(rgb[i + 2]);
            out.push(rgb[i + 1]);
            out.push(rgb[i]);
        }
        for _ in 0..pad {
            out.push(0);
        }
    }
    out
}
