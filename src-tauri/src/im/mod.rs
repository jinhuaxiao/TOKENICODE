pub mod telegram;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Error type for channel operations.
#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Channel not connected")]
    NotConnected,
    #[error("Invalid config: {0}")]
    InvalidConfig(String),
    #[error("{0}")]
    Other(String),
}

/// Incoming message from an IM channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMessage {
    pub channel: String,
    pub chat_id: String,
    pub sender: String,
    pub text: String,
    pub timestamp: u64,
}

/// Channel trait — each IM platform implements this.
#[async_trait]
pub trait Channel: Send + Sync + 'static {
    fn name(&self) -> &str;
    async fn connect(&mut self) -> Result<(), ChannelError>;
    async fn poll_messages(&self) -> Result<Vec<IncomingMessage>, ChannelError>;
    async fn send_response(&self, chat_id: &str, text: &str) -> Result<(), ChannelError>;
    async fn send_typing(&self, chat_id: &str) -> Result<(), ChannelError>;
    async fn disconnect(&self) -> Result<(), ChannelError>;
    fn is_connected(&self) -> bool;
}

/// Persisted channel configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelConfig {
    #[serde(rename = "type")]
    pub channel_type: String,
    pub enabled: bool,
    pub config: serde_json::Value,
}

/// Top-level IM configuration (persisted to ~/.tokenicode/im_channels.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMConfig {
    pub channels: Vec<ChannelConfig>,
    #[serde(default = "default_session_mode")]
    pub session_mode: String,
    #[serde(default = "default_max_response_length")]
    pub max_response_length: usize,
    #[serde(default = "default_true")]
    pub send_typing_indicator: bool,
}

fn default_session_mode() -> String {
    "per_chat".to_string()
}
fn default_max_response_length() -> usize {
    4000
}
fn default_true() -> bool {
    true
}

impl Default for IMConfig {
    fn default() -> Self {
        Self {
            channels: vec![],
            session_mode: default_session_mode(),
            max_response_length: default_max_response_length(),
            send_typing_indicator: true,
        }
    }
}

/// Runtime status of a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStatus {
    pub channel_type: String,
    pub status: String, // "disconnected" | "connecting" | "connected" | "error"
    pub error: Option<String>,
}

/// An IM session mapping entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMSession {
    pub chat_key: String,    // "{channel}:{chat_id}"
    pub stdin_id: String,    // Claude CLI stdinId
    pub channel: String,
    pub chat_id: String,
    pub sender: String,
    pub created_at: u64,
}

/// Reverse mapping: stdinId → (channel_type, chat_id).
/// Used by the stdout reader to know when to forward CLI responses to IM.
#[derive(Debug, Clone)]
pub struct IMRoute {
    pub channel_type: String,
    pub chat_id: String,
}

/// Global reverse router: stdinId → IM route info.
/// Checked by the stdout reader in lib.rs to forward assistant responses to IM channels.
#[derive(Default, Clone)]
pub struct IMResponseRouter {
    inner: Arc<RwLock<HashMap<String, IMRoute>>>,
}

impl IMResponseRouter {
    pub async fn register(&self, stdin_id: &str, channel_type: &str, chat_id: &str) {
        self.inner.write().await.insert(
            stdin_id.to_string(),
            IMRoute {
                channel_type: channel_type.to_string(),
                chat_id: chat_id.to_string(),
            },
        );
    }

    pub async fn unregister(&self, stdin_id: &str) {
        self.inner.write().await.remove(stdin_id);
    }

    pub async fn get(&self, stdin_id: &str) -> Option<IMRoute> {
        self.inner.read().await.get(stdin_id).cloned()
    }
}

/// Maps IM chat keys to Claude CLI stdinIds.
#[derive(Default)]
pub struct IMSessionMap {
    inner: Arc<RwLock<HashMap<String, IMSession>>>,
}

impl IMSessionMap {
    pub async fn get(&self, chat_key: &str) -> Option<IMSession> {
        self.inner.read().await.get(chat_key).cloned()
    }

    pub async fn insert(&self, chat_key: String, session: IMSession) {
        self.inner.write().await.insert(chat_key, session);
    }

    pub async fn remove(&self, chat_key: &str) {
        self.inner.write().await.remove(chat_key);
    }

    pub async fn list(&self) -> Vec<IMSession> {
        self.inner.read().await.values().cloned().collect()
    }
}

/// Channel dispatcher — manages all channels and routes messages.
pub struct ChannelDispatcher {
    channels: HashMap<String, Arc<RwLock<Box<dyn Channel>>>>,
    session_map: Arc<IMSessionMap>,
    response_router: Arc<IMResponseRouter>,
    statuses: Arc<RwLock<HashMap<String, ChannelStatus>>>,
    /// Cancellation tokens for polling tasks
    cancel_tokens: HashMap<String, tokio::sync::watch::Sender<bool>>,
}

impl ChannelDispatcher {
    pub fn new() -> Self {
        Self {
            channels: HashMap::new(),
            session_map: Arc::new(IMSessionMap::default()),
            response_router: Arc::new(IMResponseRouter::default()),
            statuses: Arc::new(RwLock::new(HashMap::new())),
            cancel_tokens: HashMap::new(),
        }
    }

    pub fn session_map(&self) -> &Arc<IMSessionMap> {
        &self.session_map
    }

    pub fn response_router(&self) -> &Arc<IMResponseRouter> {
        &self.response_router
    }

    /// Start a channel by type and config.
    pub async fn start_channel(
        &mut self,
        channel_type: &str,
        config: serde_json::Value,
        app: tauri::AppHandle,
    ) -> Result<(), String> {
        // Stop existing channel if running
        let was_running = self.channels.contains_key(channel_type);
        self.stop_channel(channel_type).await?;

        // Brief delay to let Telegram's long polling request expire
        if was_running {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        // Update status to connecting
        self.set_status(channel_type, "connecting", None).await;

        let mut channel: Box<dyn Channel> = match channel_type {
            "telegram" => {
                let tg = telegram::TelegramChannel::from_config(config)
                    .map_err(|e| e.to_string())?;
                Box::new(tg)
            }
            _ => {
                self.set_status(channel_type, "error", Some("Unsupported channel type")).await;
                return Err(format!("Unsupported channel type: {}", channel_type));
            }
        };

        // Connect
        if let Err(e) = channel.connect().await {
            self.set_status(channel_type, "error", Some(&e.to_string())).await;
            return Err(e.to_string());
        }

        self.set_status(channel_type, "connected", None).await;

        let channel_arc = Arc::new(RwLock::new(channel));
        self.channels.insert(channel_type.to_string(), channel_arc.clone());

        // Start polling loop
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        self.cancel_tokens.insert(channel_type.to_string(), cancel_tx);

        let session_map = self.session_map.clone();
        let statuses = self.statuses.clone();
        let ch_type = channel_type.to_string();
        let app_handle = app.clone();

        tokio::spawn(async move {
            Self::polling_loop(
                channel_arc,
                session_map,
                statuses,
                ch_type,
                app_handle,
                cancel_rx,
            )
            .await;
        });

        Ok(())
    }

    /// Stop a channel.
    pub async fn stop_channel(&mut self, channel_type: &str) -> Result<(), String> {
        // Signal cancel
        if let Some(tx) = self.cancel_tokens.remove(channel_type) {
            let _ = tx.send(true);
        }

        // Disconnect
        if let Some(channel) = self.channels.remove(channel_type) {
            let ch = channel.read().await;
            let _ = ch.disconnect().await;
        }

        self.set_status(channel_type, "disconnected", None).await;
        Ok(())
    }

    /// Stop all channels.
    pub async fn stop_all(&mut self) {
        let types: Vec<String> = self.channels.keys().cloned().collect();
        for ch_type in types {
            let _ = self.stop_channel(&ch_type).await;
        }
    }

    /// Get all channel statuses.
    pub async fn list_statuses(&self) -> Vec<ChannelStatus> {
        self.statuses.read().await.values().cloned().collect()
    }

    /// Send a response to a specific channel and chat.
    pub async fn send_to_channel(
        &self,
        channel_type: &str,
        chat_id: &str,
        text: &str,
    ) -> Result<(), String> {
        if let Some(channel) = self.channels.get(channel_type) {
            let ch = channel.read().await;
            ch.send_response(chat_id, text)
                .await
                .map_err(|e| e.to_string())
        } else {
            Err(format!("Channel {} not found or not running", channel_type))
        }
    }

    /// Send typing indicator to a specific channel and chat.
    pub async fn send_typing_to_channel(
        &self,
        channel_type: &str,
        chat_id: &str,
    ) -> Result<(), String> {
        if let Some(channel) = self.channels.get(channel_type) {
            let ch = channel.read().await;
            ch.send_typing(chat_id).await.map_err(|e| e.to_string())
        } else {
            Err(format!("Channel {} not found or not running", channel_type))
        }
    }

    async fn set_status(&self, channel_type: &str, status: &str, error: Option<&str>) {
        self.statuses.write().await.insert(
            channel_type.to_string(),
            ChannelStatus {
                channel_type: channel_type.to_string(),
                status: status.to_string(),
                error: error.map(|s| s.to_string()),
            },
        );
    }

    /// The polling loop for a channel — runs in a spawned task.
    async fn polling_loop(
        channel: Arc<RwLock<Box<dyn Channel>>>,
        session_map: Arc<IMSessionMap>,
        statuses: Arc<RwLock<HashMap<String, ChannelStatus>>>,
        channel_type: String,
        app: tauri::AppHandle,
        mut cancel_rx: tokio::sync::watch::Receiver<bool>,
    ) {
        use tauri::Emitter;

        loop {
            tokio::select! {
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[IM] Polling loop for {} cancelled", channel_type);
                        break;
                    }
                }
                result = async {
                    let ch = channel.read().await;
                    ch.poll_messages().await
                } => {
                    match result {
                        Ok(messages) => {
                            if !messages.is_empty() {
                                eprintln!("[IM] Received {} message(s) from {}", messages.len(), channel_type);
                            }
                            for msg in messages {
                                let chat_key = format!("{}:{}", msg.channel, msg.chat_id);
                                eprintln!("[IM] Message from {}: chat_key={}, text={}", msg.sender, chat_key, &msg.text[..msg.text.len().min(50)]);

                                // Emit event to frontend
                                let _ = app.emit("im:message", &msg);

                                // Check if we have a session for this chat
                                let has_session = session_map.get(&chat_key).await.is_some();

                                if !has_session {
                                    eprintln!("[IM] No session for {} — emitting im:new_chat", chat_key);
                                    // Emit event so frontend can create a session
                                    let _ = app.emit("im:new_chat", serde_json::json!({
                                        "chat_key": chat_key,
                                        "channel": msg.channel,
                                        "chat_id": msg.chat_id,
                                        "sender": msg.sender,
                                        "text": msg.text,
                                        "timestamp": msg.timestamp,
                                    }));
                                } else {
                                    eprintln!("[IM] Session exists for {} — emitting im:route_message", chat_key);
                                    // Emit event to route to existing session
                                    let _ = app.emit("im:route_message", serde_json::json!({
                                        "chat_key": chat_key,
                                        "text": msg.text,
                                        "sender": msg.sender,
                                        "timestamp": msg.timestamp,
                                    }));
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[IM] Poll error for {}: {}", channel_type, e);
                            statuses.write().await.insert(
                                channel_type.clone(),
                                ChannelStatus {
                                    channel_type: channel_type.clone(),
                                    status: "error".to_string(),
                                    error: Some(e.to_string()),
                                },
                            );
                            // Back off before retrying
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        }
                    }
                }
            }
        }
    }
}

// --- Config persistence ---

/// Path to IM config file.
pub fn im_config_path() -> Result<std::path::PathBuf, String> {
    dirs::home_dir()
        .map(|d| d.join(".tokenicode").join("im_channels.json"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

/// Load IM config from disk.
pub fn load_im_config() -> Result<IMConfig, String> {
    let path = im_config_path()?;
    if !path.exists() {
        return Ok(IMConfig::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save IM config to disk.
pub fn save_im_config(config: &IMConfig) -> Result<(), String> {
    let path = im_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}
