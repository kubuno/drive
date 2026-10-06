use config::{Config, ConfigError, Environment, File};
use kubuno_storage::StorageConfig;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub server:   ServerSettings,
    pub core:     CoreSettings,
    pub database: DatabaseSettings,
    pub storage:  StorageConfig,
    pub files:    FilesSettings,
    pub logging:  LoggingSettings,
    #[serde(default)]
    pub embeddings: EmbeddingsSettings,
}

/// Fournisseur d'embeddings OPTIONNEL (compatible OpenAI). Désactivé par défaut.
/// Decoupled from any module: the URL can target Ollama, OpenAI, the assistant module…
/// La recherche plein-texte fonctionne entièrement sans cette section.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct EmbeddingsSettings {
    #[serde(default)]
    pub enabled:      bool,
    #[serde(default)]
    pub provider_url: Option<String>,   // ex: http://127.0.0.1:11434/v1
    #[serde(default)]
    pub api_key:      Option<String>,
    #[serde(default)]
    pub model:        Option<String>,   // ex: nomic-embed-text, text-embedding-3-small
    #[serde(default)]
    pub dim:          Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSettings {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoreSettings {
    pub url:             String,
    pub internal_secret: String,
}

/// The `[database]` section is owned by kubuno-db: which of its fields matter
/// depends on the engine the administrator chooses at run time, and the pool is
/// opened by `kubuno_db::connect`.
pub use kubuno_db::DbSettings as DatabaseSettings;

#[derive(Debug, Clone, Deserialize)]
pub struct FilesSettings {
    pub max_upload_bytes: u64,
    pub thumbnail_size:   u32,
    pub chunk_size:       u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingSettings {
    pub level:  String,
    pub format: LogFormat,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Pretty,
    Json,
}

impl Settings {
    pub fn load() -> Result<Self, ConfigError> {
        let mut builder = Config::builder()
            .set_default("server.host", "127.0.0.1")?
            .set_default("server.port", 3101)?
            .set_default("core.url", "http://127.0.0.1:8080")?
            .set_default("core.internal_secret", "")?
            .set_default("database.max_connections", 10u64)?
            .set_default("database.min_connections", 1u64)?
            .set_default("database.connect_timeout", 10u64)?
            .set_default("database.run_migrations", true)?
            .set_default("database.engine", "postgres")?
            // SQLite only: where `<schema>.sqlite` lives.
            .set_default("database.path", "./data/db")?
            .set_default("storage.backend", "local")?
            .set_default("storage.local_path", "./data/files")?
            .set_default("storage.temp_path", "./data/temp")?
            .set_default("files.max_upload_bytes", 5_368_709_120u64)?
            .set_default("files.thumbnail_size", 256u64)?
            .set_default("files.chunk_size", 10_485_760u64)?
            .set_default("logging.level", "info")?
            .set_default("logging.format", "pretty")?
            .set_default("embeddings.enabled", false)?
            .add_source(File::with_name("config").required(false))
            .add_source(File::with_name("/etc/kubuno/modules/drive/config").required(false))
            .add_source(
                Environment::with_prefix("KD")
                    .separator("__")
                    .try_parsing(true),
            );

        // Variables injectées par le superviseur core — priorité maximale
        if let Ok(v) = std::env::var("KUBUNO_CORE_URL")        { builder = builder.set_override("core.url",             v)?; }
        if let Ok(v) = std::env::var("KUBUNO_INTERNAL_SECRET") { builder = builder.set_override("core.internal_secret", v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_HOST")         { builder = builder.set_override("database.host",     v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PORT")         { builder = builder.set_override("database.port",     v.parse::<i64>().unwrap_or(5432))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_USER")         { builder = builder.set_override("database.user",     v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PASSWORD")     { builder = builder.set_override("database.password", v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_NAME")         { builder = builder.set_override("database.database", v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PATH")         { builder = builder.set_override("database.path",     v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_ENGINE")       { builder = builder.set_override("database.engine",   v)?; }

        // Embeddings (optionnels) — activables aussi via env pour faciliter le déploiement
        if let Ok(v) = std::env::var("KUBUNO_EMBEDDINGS_URL")   { builder = builder.set_override("embeddings.provider_url", v)?; builder = builder.set_override("embeddings.enabled", true)?; }
        if let Ok(v) = std::env::var("KUBUNO_EMBEDDINGS_KEY")   { builder = builder.set_override("embeddings.api_key",  v)?; }
        if let Ok(v) = std::env::var("KUBUNO_EMBEDDINGS_MODEL") { builder = builder.set_override("embeddings.model",    v)?; }

        builder.build()?.try_deserialize()
    }
}
