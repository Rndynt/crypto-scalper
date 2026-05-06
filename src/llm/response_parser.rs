//! Parse LLM responses into a `TradeDecision`, tolerating common quirks
//! from free models (markdown fences, leading prose, BOM, word numbers,
//! missing fields, trailing commas).

use crate::errors::Result;
use crate::llm::engine::{ContextScore, Decision, DecisionReasoning, TradeDecision};

/// Main entry point — tries strict parse first, then lenient, then regex fallback.
pub fn parse_trade_decision(raw: &str) -> Result<TradeDecision> {
    let cleaned = clean(raw);

    // 1. Try strict serde_json parse
    if let Ok(d) = serde_json::from_str::<TradeDecision>(&cleaned) {
        return Ok(d);
    }

    // 2. Try with word-to-number fixup
    let fixed = fix_word_numbers(&cleaned);
    if let Ok(d) = serde_json::from_str::<TradeDecision>(&fixed) {
        return Ok(d);
    }

    // 3. Try removing trailing commas
    let no_trailing = remove_trailing_commas(&fixed);
    if let Ok(d) = serde_json::from_str::<TradeDecision>(&no_trailing) {
        return Ok(d);
    }

    // 4. Regex-based fallback extraction
    if let Some(d) = regex_fallback(&cleaned) {
        return Ok(d);
    }

    // 5. Last resort: build from whatever we can find
    Ok(last_resort_fallback(&cleaned))
}

fn clean(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches('\u{feff}');
    let trimmed = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // If there's surrounding prose, try to extract the outermost braces.
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            return trimmed[start..=end].to_string();
        }
    }
    trimmed.to_string()
}

/// Replace English number words with digits (common free-LLM quirk)
fn fix_word_numbers(s: &str) -> String {
    let replacements = [
        ("\"fifty\"", "\"50\""),
        ("\"sixty\"", "\"60\""),
        ("\"seventy\"", "\"70\""),
        ("\"eighty\"", "\"80\""),
        ("\"ninety\"", "\"90\""),
        ("\"forty\"", "\"40\""),
        ("\"thirty\"", "\"30\""),
        ("\"twenty\"", "\"20\""),
        ("\"ten\"", "\"10\""),
        ("fifty", "50"),
        ("sixty", "60"),
        ("seventy", "70"),
        ("eighty", "80"),
        ("ninety", "90"),
        ("forty", "40"),
        ("thirty", "30"),
        ("twenty", "20"),
    ];
    let mut result = s.to_string();
    for (from, to) in &replacements {
        result = result.replace(from, to);
    }
    result
}

/// Remove trailing commas before } or ]
fn remove_trailing_commas(s: &str) -> String {
    let mut result = s.to_string();
    // Pattern: comma followed by whitespace and closing brace/bracket
    while let Some(pos) = result.find(",}") {
        result = format!("{}{}", &result[..pos], &result[pos + 1..]);
    }
    while let Some(pos) = result.find(",]") {
        result = format!("{}{}", &result[..pos], &result[pos + 1..]);
    }
    result
}

/// Regex-based fallback — extract key fields from messy JSON
fn regex_fallback(raw: &str) -> Option<TradeDecision> {
    let lower = raw.to_lowercase();

    // Extract decision
    let decision = if lower.contains("\"go\"") {
        Decision::Go
    } else if lower.contains("\"no_go\"") || lower.contains("\"nogo\"") {
        Decision::NoGo
    } else if lower.contains("\"wait\"") {
        Decision::Wait
    } else {
        Decision::Go // Default to GO — aggressive trading
    };

    // Extract direction
    let direction = if lower.contains("\"long\"") || lower.contains("long") {
        "LONG"
    } else if lower.contains("\"short\"") || lower.contains("short") {
        "SHORT"
    } else {
        "LONG" // Default to LONG in bull market
    };

    // Extract confidence — look for "confidence": NUMBER
    let confidence = extract_number_field(raw, "confidence").unwrap_or(60.0) as u8;

    // Extract prices
    let entry_price = extract_number_field(raw, "entry_price");
    let sl_adjustment = extract_number_field(raw, "sl_adjustment")
        .or_else(|| extract_number_field(raw, "sl_adjustment"));
    let tp_adjustment = extract_number_field(raw, "tp_adjustment")
        .or_else(|| extract_number_field(raw, "tp_adjustment"));

    // Extract scores
    let ta_score = extract_number_field(raw, "ta_score").unwrap_or(60.0) as u8;
    let sentiment_score = extract_number_field(raw, "sentiment_score").unwrap_or(50.0) as u8;
    let fundamental_score = extract_number_field(raw, "fundamental_score").unwrap_or(50.0) as u8;
    let risk_score = extract_number_field(raw, "risk_score").unwrap_or(60.0) as u8;
    let composite_score = extract_number_field(raw, "composite_score").unwrap_or(55.0) as u8;

    // Extract reasoning text
    let summary =
        extract_string_field(raw, "summary").unwrap_or_else(|| "AI analysis complete".into());

    Some(TradeDecision {
        decision,
        direction: direction.to_string(),
        confidence,
        entry_price,
        sl_adjustment,
        tp_adjustment,
        position_size_pct: extract_number_field(raw, "position_size_pct")
            .unwrap_or(0.5)
            .clamp(0.1, 1.0),
        reasoning: DecisionReasoning {
            summary,
            ta_analysis: extract_string_field(raw, "ta_analysis")
                .unwrap_or_else(|| "Technical analysis applied".into()),
            sentiment_analysis: extract_string_field(raw, "sentiment_analysis")
                .unwrap_or_else(|| "Sentiment neutral".into()),
            fundamental_analysis: extract_string_field(raw, "fundamental_analysis")
                .unwrap_or_else(|| "No major catalysts".into()),
            risk_factors: extract_string_field(raw, "risk_factors")
                .unwrap_or_else(|| "Standard market risk".into()),
            invalidation: extract_string_field(raw, "invalidation")
                .unwrap_or_else(|| "Trend reversal".into()),
        },
        market_context_score: ContextScore {
            ta_score,
            sentiment_score,
            fundamental_score,
            risk_score,
            composite_score,
        },
    })
}

/// Last resort — build a default GO decision from whatever text we have
fn last_resort_fallback(raw: &str) -> TradeDecision {
    let lower = raw.to_lowercase();
    let is_nogo = lower.contains("no_go") || lower.contains("nogo") || lower.contains("no go");
    let is_go = lower.contains("\"go\"") || lower.contains("decision.*go") || !is_nogo;
    let decision = if is_nogo {
        Decision::NoGo
    } else {
        Decision::Go // Default GO — aggressive
    };
    let is_long = lower.contains("long") || !lower.contains("short");

    TradeDecision {
        decision,
        direction: if is_long {
            "LONG".into()
        } else {
            "SHORT".into()
        },
        confidence: 55,
        entry_price: None,
        sl_adjustment: None,
        tp_adjustment: None,
        position_size_pct: 0.5, // Default 50% for fallback
        reasoning: DecisionReasoning {
            summary: "Fallback parse — LLM response was malformed".into(),
            ta_analysis: format!("Raw response: {}...", &raw[..raw.len().min(200)]),
            sentiment_analysis: "Unable to parse sentiment".into(),
            fundamental_analysis: "Unable to parse fundamentals".into(),
            risk_factors: "Parse failure increases uncertainty".into(),
            invalidation: "Manual review recommended".into(),
        },
        market_context_score: ContextScore {
            ta_score: 55,
            sentiment_score: 50,
            fundamental_score: 50,
            risk_score: 50,
            composite_score: 55,
        },
    }
}

/// Extract a numeric value from JSON-like text using pattern matching
fn extract_number_field(text: &str, field: &str) -> Option<f64> {
    // Try pattern: "field": 123.45 or "field": 123
    let patterns = [
        format!("\"{}\":", field),
        format!("\"{}\" :", field),
        format!("{}:", field),
    ];
    for pat in &patterns {
        if let Some(pos) = text.find(pat.as_str()) {
            let after = &text[pos + pat.len()..].trim_start();
            // Skip null
            if after.starts_with("null") {
                continue;
            }
            // Extract number (possibly negative, possibly float)
            let num_str: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                .collect();
            if !num_str.is_empty() && num_str != "-" {
                if let Ok(n) = num_str.parse::<f64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

/// Extract a string value from JSON-like text
fn extract_string_field(text: &str, field: &str) -> Option<String> {
    let patterns = [
        format!("\"{}\":\"", field),
        format!("\"{}\": \"", field),
        format!("\"{}\" : \"", field),
    ];
    for pat in &patterns {
        if let Some(pos) = text.find(pat.as_str()) {
            let after = &text[pos + pat.len()..];
            if let Some(end) = after.find('"') {
                let value = &after[..end];
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wrapped_json() {
        let raw = r#"Here is my analysis:
```json
{
  "decision": "GO",
  "direction": "LONG",
  "confidence": 75,
  "entry_price": 67240.0,
  "sl_adjustment": null,
  "tp_adjustment": null,
  "reasoning": {
    "summary": "Strong setup",
    "ta_analysis": "Indicators aligned",
    "sentiment_analysis": "Neutral",
    "fundamental_analysis": "No catalysts",
    "risk_factors": "Standard",
    "invalidation": "Break below support"
  },
  "market_context_score": {
    "ta_score": 70,
    "sentiment_score": 70,
    "fundamental_score": 70,
    "risk_score": 70,
    "composite_score": 70
  }
}
```
"#;
        let d = parse_trade_decision(raw).unwrap();
        assert_eq!(d.confidence, 75);
    }

    #[test]
    fn handles_word_numbers() {
        let raw = r#"{
  "decision": "GO",
  "direction": "LONG",
  "confidence": 60,
  "entry_price": 2331.88,
  "sl_adjustment": 2231.51,
  "tp_adjustment": 2467.37,
  "reasoning": {
    "summary": "Test",
    "ta_analysis": "Test",
    "sentiment_analysis": "Test",
    "fundamental_analysis": "Test",
    "risk_factors": "Test",
    "invalidation": "Test"
  },
  "market_context_score": {
    "ta_score": 62,
    "sentiment_score": fifty,
    "fundamental_score": 55,
    "risk_score": 70,
    "composite_score": 59
  }
}"#;
        let d = parse_trade_decision(raw).unwrap();
        assert_eq!(d.confidence, 60);
        assert_eq!(d.market_context_score.sentiment_score, 50);
    }

    #[test]
    fn handles_trailing_commas() {
        let raw = r#"{
  "decision": "GO",
  "direction": "LONG",
  "confidence": 70,
}"#;
        let d = parse_trade_decision(raw).unwrap();
        assert_eq!(d.confidence, 70);
    }

    #[test]
    fn regex_fallback_works() {
        let raw = r#"The decision is GO with direction LONG and confidence 65.
Entry price: 78500.0, SL: 77000.0, TP: 81000.0
ta_score: 70, sentiment_score: 55, composite_score: 62
summary: Bullish momentum building"#;
        let d = parse_trade_decision(raw).unwrap();
        assert_eq!(d.confidence, 65);
        assert_eq!(d.direction, "LONG");
    }
}
