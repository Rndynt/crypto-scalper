//! Telegram Bot API notifier with forum topic support.

use crate::errors::Result;
use reqwest::Client;
use tracing::warn;

/// Destination for a Telegram message.
#[derive(Debug, Clone)]
pub enum TgDestination {
    /// Direct message or simple chat (no thread).
    Chat(String),
    /// Forum topic in a group chat.
    Topic {
        chat_id: String,
        thread_id: i64,
    },
}

pub struct TelegramNotifier {
    client: Client,
    token: String,
    /// Primary chat ID (DM / owner) — used for commands and alerts.
    chat_id: String,
    /// Optional: post signals to a forum topic.
    signal_topic: Option<TgDestination>,
    enabled: bool,
}

impl TelegramNotifier {
    pub fn new(
        token: String,
        chat_id: String,
        signal_topic: Option<TgDestination>,
    ) -> Self {
        let enabled = !token.is_empty() && !chat_id.is_empty();
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
            token,
            chat_id,
            signal_topic,
            enabled,
        }
    }

    /// Send to the primary chat (DM / owner).
    pub async fn send(&self, text: &str) -> Result<()> {
        self.send_to(&TgDestination::Chat(self.chat_id.clone()), text).await
    }

    /// Send to the signal topic (if configured), falling back to primary chat.
    pub async fn send_signal(&self, text: &str) -> Result<()> {
        let dest = self.signal_topic.clone()
            .unwrap_or_else(|| TgDestination::Chat(self.chat_id.clone()));
        self.send_to(&dest, text).await
    }

    /// Send to a specific destination.
    pub async fn send_to(&self, dest: &TgDestination, text: &str) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let url = format!("https://api.telegram.org/bot{}/sendMessage", self.token);
        let mut body = serde_json::json!({
            "text": text,
            "disable_web_page_preview": true,
            "parse_mode": "HTML",
        });

        match dest {
            TgDestination::Chat(chat_id) => {
                body["chat_id"] = serde_json::json!(chat_id);
            }
            TgDestination::Topic { chat_id, thread_id } => {
                body["chat_id"] = serde_json::json!(chat_id);
                body["message_thread_id"] = serde_json::json!(thread_id);
            }
        }

        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            warn!(status = %status, body = %body_text, "telegram send failed");
        }
        Ok(())
    }
}
