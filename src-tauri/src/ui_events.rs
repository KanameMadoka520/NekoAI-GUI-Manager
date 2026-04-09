use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast;

#[derive(Serialize)]
struct UiEventEnvelope {
    name: String,
    payload: Value,
}

static UI_EVENT_BUS: OnceLock<broadcast::Sender<String>> = OnceLock::new();

pub fn init_ui_events() {
    let _ = UI_EVENT_BUS.get_or_init(|| {
        let (tx, _rx) = broadcast::channel(512);
        tx
    });
}

pub fn subscribe_ui_events() -> Option<broadcast::Receiver<String>> {
    UI_EVENT_BUS.get().map(|tx| tx.subscribe())
}

pub fn emit_ui_event<T: Serialize>(app: Option<&AppHandle>, name: &str, payload: &T) {
    if let Some(app_handle) = app {
        let _ = app_handle.emit_all(name, payload);
    }

    let Some(tx) = UI_EVENT_BUS.get() else {
        return;
    };

    let payload_value = serde_json::to_value(payload).unwrap_or(Value::Null);
    let envelope = UiEventEnvelope {
        name: name.to_string(),
        payload: payload_value,
    };

    if let Ok(serialized) = serde_json::to_string(&envelope) {
        let _ = tx.send(serialized);
    }
}
