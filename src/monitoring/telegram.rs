//! Telegram Bot API notifier with forum topic support and inline keyboard.

use crate::errors::Result;
use reqwest::Client;
use serde_json::json;
use tracing::warn;

/// Destination for a Telegram message.
#[derive(Debug, Clone)]
pub enum TgDestination {
    /// Direct message or simple chat (no thread).
    Chat(String),
    /// Forum topic in a group chat.
    Topic { chat_id: String, thread_id: i64 },
}

/// A single inline keyboard button.
#[derive(Debug, Clone)]
pub struct InlineButton {
    pub text: String,
    pub callback_data: String,
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
    pub fn new(token: String, chat_id: String, signal_topic: Option<TgDestination>) -> Self {
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
        self.send_to(&TgDestination::Chat(self.chat_id.clone()), text)
            .await
    }

    /// Send to the signal topic (if configured), falling back to primary chat.
    pub async fn send_signal(&self, text: &str) -> Result<()> {
        let dest = self
            .signal_topic
            .clone()
            .unwrap_or_else(|| TgDestination::Chat(self.chat_id.clone()));
        self.send_to(&dest, text).await
    }

    /// Send to a specific destination.
    pub async fn send_to(&self, dest: &TgDestination, text: &str) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let url = format!("https://api.telegram.org/bot{}/sendMessage", self.token);
        let mut body = json!({
            "text": text,
            "disable_web_page_preview": true,
            "parse_mode": "HTML",
        });

        match dest {
            TgDestination::Chat(chat_id) => {
                body["chat_id"] = json!(chat_id);
            }
            TgDestination::Topic { chat_id, thread_id } => {
                body["chat_id"] = json!(chat_id);
                body["message_thread_id"] = json!(thread_id);
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

    /// Send a message with inline keyboard buttons.
    pub async fn send_with_buttons(
        &self,
        chat_id: &str,
        text: &str,
        buttons: Vec<Vec<InlineButton>>,
    ) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let url = format!("https://api.telegram.org/bot{}/sendMessage", self.token);

        // Build inline keyboard JSON
        let keyboard: Vec<Vec<serde_json::Value>> = buttons
            .iter()
            .map(|row| {
                row.iter()
                    .map(|btn| {
                        json!({
                            "text": btn.text,
                            "callback_data": btn.callback_data,
                        })
                    })
                    .collect()
            })
            .collect();

        let body = json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true,
            "parse_mode": "HTML",
            "reply_markup": {
                "inline_keyboard": keyboard,
            },
        });

        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            warn!(status = %status, body = %body_text, "telegram send_with_buttons failed");
        }
        Ok(())
    }

    /// Answer a callback query (button click) to remove the loading state.
    pub async fn answer_callback(&self, callback_id: &str, text: Option<&str>) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let url = format!(
            "https://api.telegram.org/bot{}/answerCallbackQuery",
            self.token
        );
        let mut body = json!({
            "callback_query_id": callback_id,
        });
        if let Some(t) = text {
            body["text"] = json!(t);
            body["show_alert"] = json!(false);
        }

        let resp = self.client.post(&url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            warn!(status = %status, body = %body_text, "telegram answer_callback failed");
        }
        Ok(())
    }
}
