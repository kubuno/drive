use anyhow::{Context, Result};
use clap::Parser;
use uuid::Uuid;
use kubuno_drive::{
    config::Settings,
    router,
    services::{indexer, watcher},
    state::AppState,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;

// ── Lecture de module.toml ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Manifest {
    module:        ManifestModule,
    #[serde(default)]
    sidebar_items: Vec<SidebarItemRaw>,
    events:        Option<ManifestEvents>,
    #[serde(default)]
    cli_commands:  Vec<CliCommandRaw>,
}

#[derive(Deserialize)]
struct ManifestModule {
    id:            String,
    display_name:  String,
    description:   Option<String>,
    settings_path: Option<String>,
}

#[derive(Deserialize)]
struct SidebarItemRaw {
    id:       String,
    label:    String,
    icon:     String,
    path:     String,
    position: i32,
}

#[derive(Deserialize)]
struct ManifestEvents {
    #[serde(default)]
    subscribed: Vec<String>,
}

#[derive(Deserialize)]
struct CliCommandRaw {
    name:        String,
    description: Option<String>,
    usage:       Option<String>,
}

fn load_manifest() -> Option<Manifest> {
    // 1. Variable injectée par le superviseur kubuno-core
    let path = if let Ok(dir) = std::env::var("KUBUNO_MODULE_DIR") {
        std::path::PathBuf::from(dir).join("module.toml")
    } else {
        // 2. Même dossier que le binaire (développement / installation manuelle)
        std::env::current_exe().ok()?.parent()?.join("module.toml")
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| tracing::warn!(path = %path.display(), error = %e, "module.toml introuvable"))
        .ok()?;

    toml::from_str::<Manifest>(&content)
        .map_err(|e| tracing::error!(path = %path.display(), error = %e, "module.toml invalide"))
        .ok()
}

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(
    name    = "kubuno-drive",
    version,
    about   = "Module fichiers Kubuno",
    subcommand_required = false,
    arg_required_else_help = false,
)]
struct Cli {
    #[arg(short, long, env = "KD_CONFIG_FILE")]
    config: Option<String>,
    #[command(subcommand)]
    command: Option<CliCommand>,
}

#[derive(clap::Subcommand, Debug)]
enum CliCommand {
    /// Uploade un ou plusieurs fichiers vers Kubuno
    #[command(name = "files:upload")]
    Upload(UploadArgs),
}

#[derive(clap::Args, Debug)]
struct UploadArgs {
    /// Fichier(s) à envoyer
    #[arg(required = true, num_args = 1..)]
    files: Vec<String>,
    /// Token d'API personnel (ou variable d'env KUBUNO_TOKEN)
    #[arg(short, long, env = "KUBUNO_TOKEN")]
    token: String,
    /// URL du serveur Kubuno
    #[arg(short, long, default_value = "http://localhost:8080")]
    server: String,
    /// Dossier de destination : nom, chemin (ex: Documents/Livres) ou UUID (racine si omis)
    #[arg(short, long)]
    folder: Option<String>,
}

// ── Résolution chemin de dossier → UUID ──────────────────────────────────────

/// Accepte :
///   - un UUID brut                      → utilisé tel quel
///   - un nom simple   "Documents"       → dossier racine nommé "Documents"
///   - un chemin       "Documents/Livres" → traverse l'arborescence
async fn resolve_folder_path(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    path: &str,
) -> Result<Uuid> {
    if let Ok(id) = Uuid::parse_str(path) {
        return Ok(id);
    }

    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        anyhow::bail!("Chemin de dossier vide");
    }

    let base = server.trim_end_matches('/');
    let mut parent: Option<Uuid> = None;

    for part in &parts {
        let url = match parent {
            Some(pid) => format!("{base}/api/v1/files/folders?parent_id={pid}"),
            None      => format!("{base}/api/v1/files/folders"),
        };

        let resp = client
            .get(&url)
            .header("authorization", format!("Bearer {token}"))
            .send()
            .await
            .context("Requête liste des dossiers")?;

        if !resp.status().is_success() {
            anyhow::bail!("Impossible de lister les dossiers (HTTP {})", resp.status());
        }

        let body: serde_json::Value = resp.json().await.context("Réponse JSON invalide")?;
        let folders = body["folders"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Réponse inattendue du serveur"))?;

        let found = folders.iter().find(|f| {
            f["name"].as_str().map(|n| n.eq_ignore_ascii_case(part)).unwrap_or(false)
        });

        match found {
            Some(f) => {
                let id_str = f["id"].as_str()
                    .ok_or_else(|| anyhow::anyhow!("Dossier sans identifiant"))?;
                parent = Some(Uuid::parse_str(id_str).context("UUID de dossier invalide")?);
            }
            None => {
                anyhow::bail!("Dossier introuvable : « {part} »");
            }
        }
    }

    parent.ok_or_else(|| anyhow::anyhow!("Résolution du chemin échouée"))
}

// ── Commande files:upload ─────────────────────────────────────────────────────

async fn cmd_files_upload(args: UploadArgs) -> Result<()> {
    const RESET:  &str = "\x1b[0m";
    const BOLD:   &str = "\x1b[1m";
    const GREEN:  &str = "\x1b[32m";
    const YELLOW: &str = "\x1b[33m";
    const RED:    &str = "\x1b[31m";
    const CYAN:   &str = "\x1b[36m";

    println!("{BOLD}{CYAN}kubuno files:upload{RESET}");
    println!();
    println!("    Serveur : {}", args.server);

    let client = reqwest::Client::new();

    // Résoudre le chemin de dossier en UUID si nécessaire
    let folder_id: Option<Uuid> = match &args.folder {
        None => None,
        Some(raw) => {
            print!("    Dossier : {raw}");
            use std::io::Write as _;
            std::io::stdout().flush().ok();
            match resolve_folder_path(&client, &args.server, &args.token, raw).await {
                Ok(id) => {
                    println!(" ({id})");
                    Some(id)
                }
                Err(e) => {
                    println!();
                    eprintln!(" {RED}✗{RESET}  {e}");
                    std::process::exit(1);
                }
            }
        }
    };

    println!("    Fichiers: {}", args.files.len());
    println!();

    let upload_url = format!("{}/api/v1/files/upload", args.server.trim_end_matches('/'));

    let mut success = 0u32;
    let mut failed  = 0u32;

    for path_str in &args.files {
        let path = std::path::Path::new(path_str);

        if !path.exists() {
            println!(" {YELLOW}⚠{RESET}  Introuvable : {path_str}");
            failed += 1;
            continue;
        }
        if path.is_dir() {
            println!(" {YELLOW}⚠{RESET}  Répertoire ignoré : {path_str}");
            failed += 1;
            continue;
        }

        let filename = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        let file_bytes = std::fs::read(path)
            .with_context(|| format!("Lecture de {path_str}"))?;
        let size = file_bytes.len();

        print!("  Envoi de {filename} ({}) … ", human_size(size));
        use std::io::Write as _;
        std::io::stdout().flush().ok();

        let mime = guess_mime(filename);
        let part = reqwest::multipart::Part::bytes(file_bytes)
            .file_name(filename.to_string())
            .mime_str(mime)
            .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]));

        let mut form = reqwest::multipart::Form::new().part("file", part);
        if let Some(id) = folder_id {
            form = form.text("folder_id", id.to_string());
        }

        match client
            .post(&upload_url)
            .header("authorization", format!("Bearer {}", args.token))
            .multipart(form)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                let file_id = body["file"]["id"].as_str().unwrap_or("?");
                println!("{GREEN}✓{RESET}  (id: {file_id})");
                success += 1;
            }
            Ok(resp) => {
                let status = resp.status();
                let body   = resp.text().await.unwrap_or_default();
                println!("{RED}✗{RESET}");
                eprintln!("    HTTP {status} — {body}");
                failed += 1;
            }
            Err(e) => {
                println!("{RED}✗{RESET}");
                eprintln!("    Erreur réseau : {e}");
                failed += 1;
            }
        }
    }

    println!();
    if failed == 0 {
        println!(" {GREEN}✓{RESET}  {success} fichier(s) uploadé(s) avec succès.");
    } else {
        println!(" {YELLOW}⚠{RESET}  {success} succès, {failed} échec(s).");
        if success == 0 {
            std::process::exit(1);
        }
    }

    Ok(())
}

fn guess_mime(filename: &str) -> &'static str {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png"          => "image/png",
        "gif"          => "image/gif",
        "webp"         => "image/webp",
        "svg"          => "image/svg+xml",
        "pdf"          => "application/pdf",
        "txt"          => "text/plain",
        "md"           => "text/markdown",
        "html" | "htm" => "text/html",
        "css"          => "text/css",
        "js"           => "application/javascript",
        "json"         => "application/json",
        "xml"          => "application/xml",
        "zip"          => "application/zip",
        "tar"          => "application/x-tar",
        "gz"           => "application/gzip",
        "mp4"          => "video/mp4",
        "mp3"          => "audio/mpeg",
        "wav"          => "audio/wav",
        "ogg"          => "audio/ogg",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _              => "application/octet-stream",
    }
}

fn human_size(bytes: usize) -> String {
    const KB: usize = 1024;
    const MB: usize = 1024 * KB;
    const GB: usize = 1024 * MB;
    if bytes >= GB      { format!("{:.1} GB", bytes as f64 / GB as f64) }
    else if bytes >= MB { format!("{:.1} MB", bytes as f64 / MB as f64) }
    else if bytes >= KB { format!("{:.1} KB", bytes as f64 / KB as f64) }
    else                { format!("{bytes} B") }
}

// ── Point d'entrée ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let cli = Cli::parse();

    // Sous-commande CLI (pas de démarrage du serveur)
    if let Some(cmd) = cli.command {
        return match cmd {
            CliCommand::Upload(args) => cmd_files_upload(args).await,
        };
    }

    let settings = Settings::load().context("Chargement de la configuration")?;

    let log_level = settings.logging.level.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&log_level))
        );

    match settings.logging.format {
        kubuno_drive::config::LogFormat::Json   => subscriber.json().init(),
        kubuno_drive::config::LogFormat::Pretty => subscriber.init(),
    }

    tracing::info!("Kubuno Drive v{} démarrage…", env!("CARGO_PKG_VERSION"));

    // Pool PostgreSQL
    let opts = settings.database.connect_options()?;
    let pool = PgPoolOptions::new()
        .max_connections(settings.database.max_connections)
        .min_connections(settings.database.min_connections)
        .acquire_timeout(settings.database.connect_timeout)
        .connect_with(opts)
        .await
        .context("Connexion PostgreSQL")?;

    // Migrations
    if settings.database.run_migrations {
        sqlx::query("CREATE SCHEMA IF NOT EXISTS drive")
            .execute(&pool)
            .await
            .context("Création du schéma drive")?;

        let migration_opts = settings.database.connect_options()?
            .options([("search_path", "drive,public")]);
        let migration_pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(settings.database.connect_timeout)
            .connect_with(migration_opts)
            .await
            .context("Pool de migration")?;

        sqlx::migrate!("./migrations")
            .run(&migration_pool)
            .await
            .context("Migrations")?;
    }

    // Storage
    let storage = kubuno_storage::from_config(&settings.storage)
        .await
        .context("Initialisation du backend de stockage")?;

    let state = AppState {
        db:       pool,
        settings: Arc::new(settings.clone()),
        storage,
    };

    // Enregistrement auprès du core (avec retry infini)
    let http = Client::new();
    register_with_core(&http, &settings).await;

    // Heartbeat toutes les 30s — re-enregistre si le core nous a supprimés du registre
    {
        let http2     = http.clone();
        let settings2 = settings.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let url    = format!("{}/internal/modules/drive/heartbeat", settings2.core.url);
                let secret = &settings2.core.internal_secret;
                match http2.post(&url).header("X-Internal-Secret", secret.as_str()).send().await {
                    Ok(r) if r.status().is_success() => {}
                    Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {
                        tracing::info!("Heartbeat 404 — module retiré du registre, ré-enregistrement…");
                        register_with_core(&http2, &settings2).await;
                    }
                    Ok(r) if r.status() == reqwest::StatusCode::FORBIDDEN => {
                        tracing::info!("Heartbeat 403 — module désactivé, attente…");
                    }
                    Ok(r)  => tracing::warn!(status = %r.status(), "Heartbeat réponse inattendue"),
                    Err(e) => tracing::warn!(error = %e, "Heartbeat erreur réseau"),
                }
            }
        });
    }

    // Serveur HTTP
    let addr = format!("{}:{}", settings.server.host, settings.server.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Bind sur {addr}"))?;

    tracing::info!("Kubuno Drive démarré sur http://{addr}");

    // Watcher filesystem — détecte les fichiers déposés directement sur le disque
    {
        let storage_base = std::path::PathBuf::from(settings.storage.local_path());
        let db_watch     = state.db.clone();
        tokio::spawn(async move {
            watcher::start_watcher(storage_base, db_watch).await;
        });
    }

    // Worker d'indexation de recherche — backfill initial + suivi des changements
    {
        let state_idx = state.clone();
        tokio::spawn(async move {
            indexer::run_worker(state_idx).await;
        });
    }

    let app = router::build(state);
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await
        .context("Erreur du serveur HTTP")?;

    Ok(())
}

fn backoff(attempt: u32) -> u64 {
    if attempt <= 10 { (attempt * 2) as u64 } else { 30 }
}

async fn register_with_core(http: &Client, settings: &Settings) {
    let base_url = format!("http://{}:{}", settings.server.host, settings.server.port);
    let core_url = &settings.core.url;
    let secret   = &settings.core.internal_secret;

    // Lire le manifest — valeurs par défaut si absent
    let manifest = load_manifest();
    let display_name  = manifest.as_ref().map(|m| m.module.display_name.as_str()).unwrap_or("Files").to_string();
    let description   = manifest.as_ref().and_then(|m| m.module.description.clone());
    let settings_path = manifest.as_ref().and_then(|m| m.module.settings_path.clone());
    let sidebar_items: Vec<Value> = manifest.as_ref()
        .map(|m| m.sidebar_items.iter().map(|s| json!({
            "id":       s.id,
            "label":    s.label,
            "icon":     s.icon,
            "path":     s.path,
            "position": s.position,
        })).collect())
        .unwrap_or_else(|| vec![
            json!({ "id": "drive", "label": "Mes fichiers", "icon": "FolderOpen", "path": "/drive", "position": 10 }),
        ]);
    let subscribed_events: Vec<String> = manifest.as_ref()
        .and_then(|m| m.events.as_ref())
        .map(|e| e.subscribed.clone())
        .unwrap_or_else(|| vec!["UserDeleted".into(), "QuotaUpdated".into()]);

    let cli_commands: Vec<Value> = manifest.as_ref()
        .map(|m| m.cli_commands.iter().map(|c| json!({
            "name":        c.name,
            "description": c.description,
            "usage":       c.usage,
        })).collect())
        .unwrap_or_default();

    let payload = json!({
        "module_id":          "drive",
        "display_name":       display_name,
        "description":        description,
        "settings_path":      settings_path,
        "base_url":           base_url,
        "version":            env!("CARGO_PKG_VERSION"),
        "routes":             [{ "method": "*", "path": "/*" }],
        "sidebar_items":      sidebar_items,
        "subscribed_events":  subscribed_events,
        "cli_commands":       cli_commands,
        "mcp_tools": [{
            "name":        "files_list",
            "description": "Liste les fichiers de l'utilisateur, optionnellement dans un dossier donné.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "folder_id": { "type": "string", "description": "ID du dossier (optionnel ; racine si absent)" }
                }
            },
            "route":  "/",
            "method": "GET",
        }],
    });

    for attempt in 1u32.. {
        let url = format!("{core_url}/internal/modules/register");
        match http.post(&url)
            .header("X-Internal-Secret", secret.as_str())
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("Module drive enregistré auprès du core (display_name={})", display_name);
                return;
            }
            Ok(resp) if resp.status() == reqwest::StatusCode::FORBIDDEN => {
                tracing::info!(attempt, "Module désactivé par l'admin, nouvel essai dans 30s…");
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
            Ok(resp) => {
                let wait = backoff(attempt);
                tracing::warn!(attempt, status = %resp.status(), "Enregistrement échoué, retry dans {wait}s…");
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
            Err(e) => {
                let wait = backoff(attempt);
                tracing::warn!(attempt, error = %e, "Core inaccessible, retry dans {wait}s…");
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
        }
    }
    unreachable!()
}
