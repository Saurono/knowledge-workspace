//! Explicit desktop capability adapter; reuse the existing Agent tool implementation.
use crate::agent::tools::{BuiltinToolRegistry, ToolContext, ToolRegistry};
use serde_json::{json, Value};
use std::path::Path;

#[tauri::command]
pub async fn platform_shell_exec(
    project_path: String,
    command: String,
    approved: bool,
    timeout_seconds: Option<u64>,
) -> Result<Value, String> {
    if !approved {
        return Err("Shell execution requires explicit approval".to_string());
    }
    let path = Path::new(&project_path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("An absolute project directory is required".to_string());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let root = canonical.to_string_lossy().to_string();
    BuiltinToolRegistry
        .execute(
            "shell.exec",
            json!({ "command": command, "timeoutSeconds": timeout_seconds.unwrap_or(120) }),
            ToolContext {
                project_path: &root,
                embedding_config: None,
                web_search_config: None,
                anytxt_config: None,
            },
        )
        .await
}
