use super::{Channel, ChannelError, IncomingMessage};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

/// Telegram Bot API channel using long polling.
pub struct TelegramChannel {
    bot_token: String,
    client: reqwest::Client,
    last_update_id: AtomicI64,
    connected: AtomicBool,
    allowed_chat_ids: Option<Vec<i64>>,
}

// --- Telegram API types ---

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramMessage {
    message_id: i64,
    from: Option<TelegramUser>,
    chat: TelegramChat,
    text: Option<String>,
    date: i64,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramUser {
    id: i64,
    first_name: String,
    last_name: Option<String>,
    username: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
    #[serde(rename = "type")]
    chat_type: String,
    title: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramBotInfo {
    id: i64,
    first_name: String,
    username: Option<String>,
}

#[derive(Debug, Serialize)]
struct SendMessageRequest<'a> {
    chat_id: &'a str,
    text: &'a str,
    parse_mode: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct SendChatActionRequest<'a> {
    chat_id: &'a str,
    action: &'a str,
}

/// Telegram-specific config parsed from JSON.
#[derive(Debug, Deserialize)]
struct TelegramConfig {
    bot_token: String,
    #[serde(default)]
    allowed_chat_ids: Option<Vec<i64>>,
}

impl TelegramChannel {
    pub fn from_config(config: serde_json::Value) -> Result<Self, ChannelError> {
        let cfg: TelegramConfig = serde_json::from_value(config)
            .map_err(|e| ChannelError::InvalidConfig(e.to_string()))?;

        if cfg.bot_token.is_empty() {
            return Err(ChannelError::InvalidConfig(
                "bot_token is required".to_string(),
            ));
        }

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| ChannelError::Other(e.to_string()))?;

        Ok(Self {
            bot_token: cfg.bot_token,
            client,
            last_update_id: AtomicI64::new(0),
            connected: AtomicBool::new(false),
            allowed_chat_ids: cfg.allowed_chat_ids,
        })
    }

    fn api_url(&self, method: &str) -> String {
        format!(
            "https://api.telegram.org/bot{}/{}",
            self.bot_token, method
        )
    }

    /// Check if a chat_id is in the whitelist (if configured).
    fn is_chat_allowed(&self, chat_id: i64) -> bool {
        match &self.allowed_chat_ids {
            Some(ids) if !ids.is_empty() => ids.contains(&chat_id),
            _ => true, // No whitelist = allow all
        }
    }

    /// Convert raw Telegram updates into IncomingMessages, updating the offset.
    fn process_updates(&self, updates: Vec<TelegramUpdate>) -> Result<Vec<IncomingMessage>, ChannelError> {
        let mut messages = Vec::new();

        for update in updates {
            self.last_update_id
                .store(update.update_id, Ordering::SeqCst);

            if let Some(msg) = update.message {
                let text = match msg.text {
                    Some(t) if !t.is_empty() => t,
                    _ => continue,
                };

                if !self.is_chat_allowed(msg.chat.id) {
                    continue;
                }

                let sender = match &msg.from {
                    Some(user) => {
                        if let Some(ref username) = user.username {
                            format!("@{}", username)
                        } else if let Some(ref last) = user.last_name {
                            format!("{} {}", user.first_name, last)
                        } else {
                            user.first_name.clone()
                        }
                    }
                    None => "Unknown".to_string(),
                };

                messages.push(IncomingMessage {
                    channel: "telegram".to_string(),
                    chat_id: msg.chat.id.to_string(),
                    sender,
                    text,
                    timestamp: msg.date as u64,
                });
            }
        }

        Ok(messages)
    }
}

#[async_trait]
impl Channel for TelegramChannel {
    fn name(&self) -> &str {
        "telegram"
    }

    async fn connect(&mut self) -> Result<(), ChannelError> {
        // Verify bot token by calling /getMe
        let resp: TelegramResponse<TelegramBotInfo> = self
            .client
            .get(self.api_url("getMe"))
            .send()
            .await?
            .json()
            .await?;

        if !resp.ok {
            return Err(ChannelError::InvalidConfig(
                resp.description
                    .unwrap_or_else(|| "Invalid bot token".to_string()),
            ));
        }

        if let Some(bot) = resp.result {
            eprintln!(
                "[Telegram] Connected as @{} (id: {})",
                bot.username.as_deref().unwrap_or(&bot.first_name),
                bot.id
            );
        }

        // Delete any active webhook so long polling works without conflict.
        // Also drops pending updates to avoid re-processing old messages.
        let _ = self
            .client
            .post(self.api_url("deleteWebhook"))
            .json(&serde_json::json!({ "drop_pending_updates": true }))
            .send()
            .await;

        // Flush pending getUpdates by doing a non-blocking call with offset=-1.
        // This ensures no other getUpdates is in flight when we start polling.
        if let Ok(resp) = self
            .client
            .get(format!("{}?offset=-1&timeout=0", self.api_url("getUpdates")))
            .send()
            .await
        {
            if let Ok(parsed) = resp.json::<TelegramResponse<Vec<TelegramUpdate>>>().await {
                if let Some(updates) = parsed.result {
                    if let Some(last) = updates.last() {
                        self.last_update_id.store(last.update_id, Ordering::SeqCst);
                    }
                }
            }
        }

        self.connected.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn poll_messages(&self) -> Result<Vec<IncomingMessage>, ChannelError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(ChannelError::NotConnected);
        }

        let offset = self.last_update_id.load(Ordering::SeqCst) + 1;
        let url = format!(
            "{}?offset={}&timeout=30&allowed_updates=[\"message\"]",
            self.api_url("getUpdates"),
            offset
        );

        let http_resp = self.client.get(&url).send().await?;

        // Handle 409 Conflict: another getUpdates is still in flight.
        // Wait for it to expire and retry with a short timeout.
        if http_resp.status().as_u16() == 409 {
            eprintln!("[Telegram] 409 Conflict — waiting for old polling to expire...");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            // Retry with short timeout to take over
            let retry_url = format!(
                "{}?offset={}&timeout=1&allowed_updates=[\"message\"]",
                self.api_url("getUpdates"),
                offset
            );
            let retry_resp = self.client.get(&retry_url).send().await?;
            if retry_resp.status().as_u16() == 409 {
                // Still conflicting — return empty, the loop will retry
                eprintln!("[Telegram] Still 409 — will retry next cycle");
                return Ok(vec![]);
            }
            let parsed: TelegramResponse<Vec<TelegramUpdate>> = retry_resp.json().await?;
            if !parsed.ok {
                return Ok(vec![]); // Ignore transient errors during takeover
            }
            // Process the retry result (fall through below with empty updates if none)
            let updates = parsed.result.unwrap_or_default();
            return self.process_updates(updates);
        }

        let resp: TelegramResponse<Vec<TelegramUpdate>> = http_resp.json().await?;

        if !resp.ok {
            return Err(ChannelError::Other(
                resp.description.unwrap_or_else(|| "getUpdates failed".to_string()),
            ));
        }

        let updates = resp.result.unwrap_or_default();
        self.process_updates(updates)
    }

    async fn send_response(&self, chat_id: &str, text: &str) -> Result<(), ChannelError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(ChannelError::NotConnected);
        }

        // Telegram has a 4096 character limit per message — split if needed
        let chunks = split_message(text, 4000);

        for chunk in chunks {
            let body = SendMessageRequest {
                chat_id,
                text: &chunk,
                parse_mode: Some("Markdown"),
            };

            let resp = self
                .client
                .post(self.api_url("sendMessage"))
                .json(&body)
                .send()
                .await?;

            // If Markdown parsing fails, retry without parse_mode
            if !resp.status().is_success() {
                let fallback = SendMessageRequest {
                    chat_id,
                    text: &chunk,
                    parse_mode: None,
                };
                self.client
                    .post(self.api_url("sendMessage"))
                    .json(&fallback)
                    .send()
                    .await?;
            }
        }

        Ok(())
    }

    async fn send_typing(&self, chat_id: &str) -> Result<(), ChannelError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(ChannelError::NotConnected);
        }

        let body = SendChatActionRequest {
            chat_id,
            action: "typing",
        };

        let _ = self
            .client
            .post(self.api_url("sendChatAction"))
            .json(&body)
            .send()
            .await;

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), ChannelError> {
        self.connected.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}

/// Split a long message into chunks that fit Telegram's limit.
fn split_message(text: &str, max_len: usize) -> Vec<String> {
    if text.len() <= max_len {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.len() <= max_len {
            chunks.push(remaining.to_string());
            break;
        }

        // Try to split at a newline near the limit
        let split_at = remaining[..max_len]
            .rfind('\n')
            .unwrap_or_else(|| {
                // Fall back to splitting at a space
                remaining[..max_len].rfind(' ').unwrap_or(max_len)
            });

        chunks.push(remaining[..split_at].to_string());
        remaining = &remaining[split_at..].trim_start();
    }

    chunks
}
