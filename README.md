# 🤖 ARIA — Autonomous Realtime Intelligence Analyst

**LLM-Powered Autonomous Crypto Futures Scalper Bot**

ARIA is a multi-agent autonomous trading bot for Binance Futures that uses Large Language Models (LLM) for trade decisions. Every layer of the stack — from signal detection to risk management to execution — runs as an independent async agent communicating over a typed message bus. An AI "Trader Manager" oversees all decisions and can veto or adjust trades before they reach the exchange.

> **Status:** Paper mode active · NeonDB persistent journal · Telegram monitoring live

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the Bot](#-running-the-bot)
- [Telegram Commands](#-telegram-commands)
- [Config Profiles](#-config-profiles)
- [LLM Providers](#-llm-providers)
- [Database (NeonDB)](#-database-neondb)
- [Project Structure](#-project-structure)
- [Risk Management](#-risk-management)
- [License](#-license)

---

## ✨ Features

### 🧠 AI-Powered Decision Making
- **Brain Agent** — LLM analyzes technical indicators, sentiment, and market context to produce trade signals (GO / NO-GO / WAIT)
- **Trader Manager Agent** — Second LLM acts as "head of desk", reviewing and vetoing/approving every trade before execution
- **Orchestrator Agent** — Central coordinator managing all agents, learning policies, and trade flow
- **Learning Agent** — Self-improving system that tracks win/loss patterns per strategy/regime and generates lessons
- **Supports any OpenAI-compatible LLM** — Xiaomi MiMo, OpenRouter, OpenAI, DeepSeek, Groq, Together, Anthropic

### 📊 Trading Strategies (Adaptive)
- **EMA Ribbon** — Trend-following with exponential moving average crossovers
- **Mean Reversion** — Counter-trend entries at statistical extremes
- **Momentum** — Velocity-based entries on strong directional moves
- **VWAP Scalp** — Volume-weighted average price deviation trades
- **Squeeze** — Bollinger Band inside Keltner Channel breakout detection
- **Kalman Filter** — Noise-smoothed price velocity estimation
- **Multi-Timeframe** — Confluence across 1m, 5m, 15m timeframes
- **HMM (Hidden Markov Model)** — Regime detection for strategy selection
- **Alpha Gate** — External signal gating with configurable thresholds

### 🛡️ Risk & Survival
- **Per-trade risk sizing** — Configurable % of equity per position
- **Maximum drawdown protection** — Auto-flat at configurable drawdown %
- **Loss streak cooldowns** — Short/long streak detection with automatic freeze
- **Daily loss limits** — Maximum daily loss count and P&L ratchet
- **Volatility spike detection** — Auto-freeze on abnormal market moves
- **News panic filter** — Blocks trades during extreme sentiment events
- **Duplicate position prevention** — Blocks multiple entries on same symbol
- **Death line** — Hard equity floor that triggers emergency shutdown

### 💰 Partial Take Profit System
- **50% close at 1R profit** — Lock in partial gains early
- **Breakeven stop** — SL moves to entry price after partial TP
- **Trailing stop** — Remaining 50% trails at 0.5× ATR
- **Time-based exit** — Auto-close after 30 minutes max hold

### 📱 Telegram Monitoring
- **Signal notifications** — AI analysis, confidence scores, entry/SL/TP to DM and group topic
- **Position opened** — Full details including partial TP plan, R:R ratio, AI reasoning
- **Position closed** — PnL, duration, win/loss result, daily stats
- **Command panel** — 12+ slash commands for real-time monitoring
- **Group topic support** — Signals posted to dedicated forum topic

### 📈 Quantitative Engine
- **Kelly Criterion** — Optimal position sizing based on historical win rate
- **Volatility targeting** — Dynamic sizing based on realized volatility
- **VaR (Value at Risk)** — Portfolio-level risk monitoring
- **Information Coefficient** — Signal quality tracking
- **Kalman smoothing** — Noise-reduced price estimation

### 💾 Persistent Storage
- **NeonDB (PostgreSQL)** — All trades, positions, and LLM decisions persist across rebuilds
- **SQLite fallback** — Local backup when DATABASE_URL is not configured
- **JSON learning state** — Bot learning data saved to `data/learning_state.json`
- **Trade journal** — Full history with entry, exit, PnL, AI reasoning per trade

### 🔍 Research & Backtesting
- **Walk-forward analysis** — Out-of-sample strategy validation
- **Information Coefficient** — Signal quality decay tracking
- **Sensitivity analysis** — Parameter robustness testing
- **Significance testing** — Statistical validation of returns
- **CSV backtest engine** — Historical simulation with slippage model

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     ARIA Multi-Agent Runtime                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │ Data     │──▶│ Signal   │──▶│ Brain    │  (LLM #1)     │
│  │ Agent    │   │ Agent    │   │ Agent    │               │
│  └──────────┘   └──────────┘   └────┬─────┘               │
│                                      │                      │
│                                      ▼                      │
│                               ┌──────────┐                  │
│                               │ Manager  │  (LLM #2)       │
│                               │ Agent    │                  │
│                               └────┬─────┘                  │
│                                      │                      │
│  ┌──────────┐                        ▼                      │
│  │Survival  │◀─────── ┌──────────────────┐                 │
│  │ Agent    │         │   Orchestrator   │                 │
│  └──────────┘         │     Agent        │                 │
│                       └────────┬─────────┘                 │
│  ┌──────────┐                  │                            │
│  │ Risk     │◀─────────────────┘                            │
│  │ Agent    │                                               │
│  └────┬─────┘                                               │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │Execution │──▶│ Monitor  │──▶│ Learning │               │
│  │ Agent    │   │ Agent    │   │ Agent    │               │
│  └──────────┘   └──────────┘   └──────────┘               │
│                                                             │
│  ┌──────────┐   ┌──────────┐                               │
│  │ Control  │   │ Watchdog │                               │
│  │ (TG Bot) │   │          │                               │
│  └──────────┘   └──────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

**Event-driven:** All agents communicate via a typed `MessageBus` (broadcast channel). No direct agent-to-agent calls.

---

## 📦 Prerequisites

- **Rust** ≥ 1.85 (edition 2021)
- **OpenSSL** development headers (for native-tls)
- **Binance Futures API key** (for live/paper trading)
- **LLM API key** (any OpenAI-compatible provider)
- **Telegram Bot Token** (for notifications)
- **NeonDB / PostgreSQL** (optional, for persistent journal)

### Termux (Android) Specific

```bash
pkg install rust openssl
export OPENSSL_INCLUDE_DIR=$PREFIX/include
export OPENSSL_LIB_DIR=$PREFIX/lib
```

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Rndynt/crypto-scalper.git
cd crypto-scalper
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys (see Configuration section)
nano .env
```

### 3. Build

```bash
# Development build (faster compile, slower runtime)
cargo build

# Release build (optimized, recommended)
cargo build --release
```

### 4. Run

```bash
# Paper mode (default — no real money)
./target/release/aria

# With aggressive config overlay
ARIA_CONFIG_OVERLAY=config/aggressive.toml ./target/release/aria

# With custom log level
RUST_LOG=debug ./target/release/aria
```

---

## ⚙️ Configuration

ARIA uses a layered configuration system:
1. **`config/default.toml`** — Base configuration (always loaded)
2. **Config overlay** — Environment-specific overrides (set via `ARIA_CONFIG_OVERLAY`)
3. **`.env`** — API keys and secrets (loaded at startup)

### Environment Variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `BINANCE_API_KEY` | Live only | Binance Futures API key |
| `BINANCE_API_SECRET` | Live only | Binance Futures API secret |
| `LLM_API_KEY` | Yes | Primary LLM API key |
| `MANAGER_API_KEY` | No | Manager LLM key (falls back to LLM_API_KEY) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram user ID (for DM notifications) |
| `TELEGRAM_GROUP_ID` | No | Telegram group chat ID (for signal topic) |
| `TELEGRAM_SIGNAL_TOPIC_ID` | No | Forum topic thread ID for signals |
| `DATABASE_URL` | No | PostgreSQL/NeonDB connection string |
| `ARIA_CONFIG_OVERLAY` | No | Path to config overlay TOML file |
| `ARIA_LLM_PROVIDER` | Yes | LLM provider: `openai`, `openrouter`, `groq`, `together` |
| `ARIA_LLM_MODEL` | Yes | Model name (e.g., `mimo-v2-omni`, `gpt-4o-mini`) |
| `ARIA_LLM_API_BASE` | Yes | LLM API endpoint URL |
| `ARIA_MANAGER_ENABLED` | No | Enable Trader Manager agent (`true`/`false`) |
| `RUST_LOG` | No | Log level: `info`, `debug`, `warn`, `error` |

### Key Config Parameters (`config/*.toml`)

```toml
[mode]
run_mode = "paper"          # "paper", "live", or "backtest"
dry_run = true              # true = no real orders

[pairs]
symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
timeframes = ["1m", "5m", "15m"]

[risk]
risk_per_trade_pct = 1.5    # % of equity per trade
max_open_positions = 6       # Max concurrent positions
max_daily_loss_pct = 6.0     # Daily loss limit
max_drawdown_pct = 18.0      # Max drawdown before freeze
max_leverage = 5             # Maximum leverage multiplier
equity_usd = 5000.0          # Starting paper equity

[survival]
death_line_pct = 0.60        # Emergency stop at 60% equity
loss_streak_short = 12       # Losses before short cooldown
auto_flat_drawdown_pct = 15.0 # Auto-close all at 15% DD

[quant]
enabled = true               # Enable quant engine
kelly_cap = 0.40             # Max Kelly fraction
target_vol_annual = 0.30     # Target annualized volatility
```

---

## 🏃 Running the Bot

### Paper Mode (Recommended for Testing)

```bash
# Basic paper mode
./target/release/aria

# With aggressive scalping config
ARIA_CONFIG_OVERLAY=config/aggressive.toml ./target/release/aria
```

### Live Mode

```bash
# 1. Set your Binance API keys in .env
# 2. Change run_mode to "live" in config overlay
# 3. Start with low risk settings first!
ARIA_CONFIG_OVERLAY=config/production.toml ./target/release/aria
```

### Backtest Mode

```bash
# Set run_mode = "backtest" in config
# Provide CSV data file
./target/release/aria
```

### Background Process

```bash
# Run with nohup
nohup ./target/release/aria > aria.log 2>&1 &

# Or use screen/tmux
screen -S aria
./target/release/aria
# Ctrl+A, D to detach
```

---

## 📱 Telegram Commands

Send these commands to your bot in DM or group:

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/status` | Bot status, equity, P&L, signal counts |
| `/positions` | List open positions with current P&L |
| `/signals` | Recent AI signals and decisions |
| `/performance` | Win rate, daily P&L, trade statistics |
| `/survival` | Survival mode status and cooldowns |
| `/risk` | Risk limits, current exposure, VaR |
| `/brain` | Last AI brain decision details |
| `/health` | System health check (agents, latency) |
| `/freeze` | Manually freeze trading |
| `/unfreeze` | Resume trading after freeze |
| `/flat` | Close all positions immediately |

### Notification Types

- **🔔 AI Signal Detected** — New signal with confidence, strategy, scores
- **🟢/🔴 POSITION OPENED** — Entry, SL, TP, partial TP plan, AI reasoning
- **🎯 TAKE PROFIT HIT** — Full TP exit with PnL
- **🎯 PARTIAL TAKE PROFIT** — 50% close at 1R with realized PnL
- **🛑 STOP LOSS HIT** — SL exit with loss details
- **🔄 TRAILING STOP** — Trailing stop exit
- **⏰ TIME EXIT** — Max hold time reached

---

## 📁 Config Profiles

| Profile | File | Description |
|---------|------|-------------|
| Default | `config/default.toml` | Base config, always loaded |
| Aggressive | `config/aggressive.toml` | HFT scalping, tight SL/TP, 24/7 |
| Paper | `config/paper.toml` | Paper trading with conservative settings |
| Production | `config/production.toml` | Live trading with safety limits |
| LLM Anthropic | `config/llm-anthropic.toml` | Anthropic Claude as LLM provider |
| LLM OpenRouter | `config/llm-openrouter-cheap.toml` | OpenRouter cheap models |

### Using a Config Overlay

```bash
# Via environment variable
ARIA_CONFIG_OVERLAY=config/aggressive.toml ./target/release/aria

# Or in .env file
ARIA_CONFIG_OVERLAY=config/aggressive.toml
```

---

## 🤖 LLM Providers

ARIA supports any OpenAI-compatible API. Configure in `.env`:

### Xiaomi MiMo (Recommended — Fast & Free)

```env
ARIA_LLM_PROVIDER=openai
ARIA_LLM_MODEL=mimo-v2-omni
ARIA_LLM_API_BASE=https://token-plan-sgp.xiaomimimo.com/v1/chat/completions
LLM_API_KEY=your_mimo_key
```

### OpenRouter

```env
ARIA_LLM_PROVIDER=openrouter
ARIA_LLM_MODEL=anthropic/claude-3.5-haiku
ARIA_LLM_API_BASE=https://openrouter.ai/api/v1/chat/completions
LLM_API_KEY=your_openrouter_key
```

### OpenAI

```env
ARIA_LLM_PROVIDER=openai
ARIA_LLM_MODEL=gpt-4o-mini
ARIA_LLM_API_BASE=https://api.openai.com/v1/chat/completions
LLM_API_KEY=your_openai_key
```

### DeepSeek

```env
ARIA_LLM_PROVIDER=openai
ARIA_LLM_MODEL=deepseek-chat
ARIA_LLM_API_BASE=https://api.deepseek.com/v1/chat/completions
LLM_API_KEY=your_deepseek_key
```

### Groq

```env
ARIA_LLM_PROVIDER=groq
ARIA_LLM_MODEL=llama-3.3-70b-versatile
ARIA_LLM_API_BASE=https://api.groq.com/openai/v1/chat/completions
LLM_API_KEY=your_groq_key
```

> **Note:** The Manager Agent can use a different LLM than the Brain Agent. Set `ARIA_MANAGER_*` variables separately.

---

## 🗄️ Database (NeonDB)

ARIA persists all trade data to PostgreSQL (NeonDB). Data survives rebuilds and restarts.

### Setup

1. Create a free NeonDB account at [neon.tech](https://neon.tech)
2. Create a database and copy the connection string
3. Add to `.env`:

```env
DATABASE_URL=postgresql://user:pass@ep-xxx.pooler.us-east-1.aws.neon.tech/dbname?sslmode=require
```

### Schema (Auto-Created)

```sql
-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    size DOUBLE PRECISION NOT NULL,
    entry_price DOUBLE PRECISION NOT NULL,
    exit_price DOUBLE PRECISION,
    pnl_usd DOUBLE PRECISION,
    pnl_pct DOUBLE PRECISION,
    reason TEXT,
    strategy TEXT,
    regime TEXT,
    ai_confidence INTEGER,
    ai_reasoning TEXT,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LLM decisions table
CREATE TABLE IF NOT EXISTS llm_decisions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decision TEXT NOT NULL,
    confidence INTEGER,
    reasoning TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Fallback

If `DATABASE_URL` is not set, ARIA falls back to local SQLite at `data/aria.db`.

---

## 📂 Project Structure

```
crypto-scalper/
├── src/
│   ├── main.rs                    # Entry point, agent orchestration
│   ├── config.rs                  # Config loading (TOML + overlay)
│   ├── errors.rs                  # Error types
│   ├── quant.rs                   # Quantitative engine (Kelly, VaR, vol-target)
│   ├── agents/
│   │   ├── mod.rs                 # Module declarations
│   │   ├── bus.rs                 # MessageBus (typed broadcast channel)
│   │   ├── messages.rs            # AgentEvent enum, all message types
│   │   ├── brain.rs               # Brain Agent (LLM trade analysis)
│   │   ├── control.rs             # Control Agent (Telegram commands, signal notif)
│   │   ├── data.rs                # Data Agent (market data processing)
│   │   ├── execution.rs           # Execution Agent (order management, partial TP)
│   │   ├── feeds.rs               # Feeds Agent (external data aggregation)
│   │   ├── learning.rs            # Learning Agent (self-improvement)
│   │   ├── manager.rs             # Trader Manager Agent (LLM oversight)
│   │   ├── monitor.rs             # Monitor Agent (metrics, journal, notifs)
│   │   ├── orchestrator.rs        # Orchestrator Agent (central coordinator)
│   │   ├── risk.rs                # Risk Agent (position validation)
│   │   ├── signal.rs              # Signal Agent (strategy signal generation)
│   │   ├── survival.rs            # Survival Agent (capital protection)
│   │   └── watchdog.rs            # Watchdog Agent (health monitoring)
│   ├── execution/
│   │   ├── mod.rs                 # Exchange trait, PaperExchange
│   │   ├── binance.rs             # Binance Futures API client
│   │   ├── position.rs            # Position tracking, partial TP, trailing stop
│   │   ├── risk.rs                # RiskManager (limits, sizing)
│   │   └── tcm.rs                 # Transaction Cost Model
│   ├── strategy/
│   │   ├── mod.rs                 # Strategy selection, regime routing
│   │   ├── regime.rs              # Market regime detection
│   │   ├── ema_ribbon.rs          # EMA Ribbon strategy
│   │   ├── mean_reversion.rs      # Mean Reversion strategy
│   │   ├── momentum.rs            # Momentum strategy
│   │   ├── vwap_scalp.rs          # VWAP Scalp strategy
│   │   ├── squeeze.rs             # Squeeze (BB inside Keltner) strategy
│   │   ├── kalman.rs              # Kalman filter price estimator
│   │   ├── hmm.rs                 # Hidden Markov Model regime detection
│   │   ├── multi_timeframe.rs     # Multi-timeframe confluence
│   │   ├── alpha_gate.rs          # External signal gating
│   │   ├── ab_test.rs             # Strategy A/B testing
│   │   ├── pairs.rs               # Pairs trading
│   │   ├── retirement.rs          # Strategy retirement logic
│   │   └── state.rs               # SymbolState, strategy names
│   ├── llm/
│   │   ├── engine.rs              # LLM API client (multi-provider)
│   │   ├── prompts.rs             # System prompts for Brain & Manager
│   │   └── response_parser.rs     # JSON response parsing
│   ├── monitoring/
│   │   ├── mod.rs                 # Module declarations
│   │   ├── logger.rs              # TradeJournal (SQLite + NeonDB)
│   │   ├── metrics.rs             # MetricsState, HTTP dashboard
│   │   └── telegram.rs            # TelegramNotifier (DM + group topic)
│   ├── feeds/                     # External data feeds
│   ├── portfolio/                 # Portfolio management (Kelly, VaR, correlation)
│   ├── microstructure/            # Market microstructure (VPIN)
│   ├── research/                  # Research tools (backtest, IC, walk-forward)
│   └── learning/                  # Learning system (lessons, policy, memory)
├── config/
│   ├── default.toml               # Base configuration
│   ├── aggressive.toml            # HFT scalping overlay
│   ├── paper.toml                 # Paper trading overlay
│   ├── production.toml            # Live trading overlay
│   ├── llm-anthropic.toml         # Anthropic LLM config
│   └── llm-openrouter-cheap.toml  # OpenRouter cheap models
├── data/                          # Runtime data (learning state, SQLite DB)
├── .env                           # API keys and secrets
├── Cargo.toml                     # Rust dependencies
└── README.md                      # This file
```

---

## 🛡️ Risk Management

### Position Sizing
- **Per-trade risk:** 1.5% of equity (configurable)
- **Kelly Criterion:** Optimal fraction based on historical win rate
- **Volatility targeting:** Size adjusts inversely to realized volatility
- **Max position:** 100% of equity notional

### Stop Loss / Take Profit
- **SL:** Max 2% from entry (hardcoded cap for scalping)
- **TP:** 1% from entry (tight R:R for HFT)
- **Partial TP:** 50% close at 1R profit
- **Breakeven:** SL moves to entry after partial TP
- **Trailing:** 0.5× ATR trailing on remaining position

### Circuit Breakers
- **Death line:** 60% of starting equity → emergency shutdown
- **Auto-flat:** 15% drawdown → close all positions
- **Loss streak:** 12 consecutive losses → 15min cooldown
- **Daily loss:** 20 loss count → 2hr cooldown
- **Volatility spike:** 2.5× normal volume → freeze trading

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Credits

- Built with [Rust](https://www.rust-lang.org/) and [Tokio](https://tokio.rs/)
- LLM integration via [Xiaomi MiMo](https://xiaomimimo.com/) / OpenAI-compatible APIs
- Exchange connectivity via [Binance Futures API](https://binance-docs.github.io/apidocs/futures/en/)
- Database via [NeonDB (PostgreSQL)](https://neon.tech/)

---

**🤖 ARIA v1.0** — Autonomous Realtime Intelligence Analyst
