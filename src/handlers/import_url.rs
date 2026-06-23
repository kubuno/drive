use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use bytes::Bytes;
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    middleware::FilesUser,
    services::files::{folder_virt_path, insert_or_update_record, resolve_for_write, update_used_bytes},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ImportUrlDto {
    pub url:       String,
    pub folder_id: Option<Uuid>,
    /// Nom de fichier forcé (si absent, extrait de l'URL ou Content-Disposition)
    pub name:      Option<String>,
    #[serde(default)]
    pub overwrite: bool,
}

pub async fn import_from_url(
    State(state): State<AppState>,
    Extension(user): Extension<FilesUser>,
    Json(dto): Json<ImportUrlDto>,
) -> Result<(StatusCode, Json<Value>)> {
    // ── Validation URL ────────────────────────────────────────────────────────

    let url = dto.url.trim().to_string();

    let parsed = url::Url::parse(&url)
        .map_err(|_| FilesError::Validation("URL invalide".into()))?;

    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(FilesError::Validation(format!("Schéma '{s}' non autorisé — http/https uniquement"))),
    }

    // Protection SSRF basique : bloquer les IPs privées
    if let Some(host) = parsed.host_str() {
        block_private_host(host)?;
    }

    let max_bytes = state.settings.files.max_upload_bytes;

    // ── HEAD pour obtenir taille + nom ────────────────────────────────────────

    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| FilesError::Internal(anyhow::anyhow!(e)))?;

    let head = client.head(&url).send().await
        .map_err(|e| FilesError::Remote(format!("HEAD échoué: {e}")))?;

    if !head.status().is_success() {
        return Err(FilesError::Remote(format!("Ressource inaccessible ({})", head.status())));
    }

    // Taille déclarée (si présente)
    let declared_size: Option<u64> = head.headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok());

    if let Some(size) = declared_size {
        if size > max_bytes {
            return Err(FilesError::FileTooLarge);
        }
    }

    // Vérification quota avant téléchargement
    let user_row = sqlx::query!(
        "SELECT quota_bytes, used_bytes FROM core.users WHERE id = $1",
        user.id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FilesError::Internal(anyhow::anyhow!("Utilisateur introuvable")))?;

    if let Some(size) = declared_size {
        if user_row.used_bytes + size as i64 > user_row.quota_bytes {
            return Err(FilesError::QuotaExceeded);
        }
    }

    // Nom de fichier : priorité → dto.name → Content-Disposition → path URL
    let filename = if let Some(n) = dto.name.filter(|n| !n.trim().is_empty()) {
        sanitize_filename::sanitize(&n)
    } else if let Some(name) = extract_content_disposition_filename(head.headers()) {
        sanitize_filename::sanitize(&name)
    } else {
        // Extraire depuis le path de l'URL
        let path = parsed.path();
        let raw = path.rsplit('/').next().unwrap_or("fichier");
        let decoded = urlencoding::decode(raw).unwrap_or_default();
        sanitize_filename::sanitize(decoded.as_ref())
    };

    let filename = if filename.is_empty() { "fichier".to_string() } else { filename };

    // ── Téléchargement streaming ───────────────────────────────────────────────

    let resp = client.get(&url).send().await
        .map_err(|e| FilesError::Remote(format!("GET échoué: {e}")))?;

    if !resp.status().is_success() {
        return Err(FilesError::Remote(format!("Téléchargement échoué ({})", resp.status())));
    }

    // Lire le flux en accumulant les bytes (avec limite de taille)
    let mut stream  = resp.bytes_stream();
    let mut chunks: Vec<Bytes> = Vec::new();
    let mut total: u64 = 0;
    let mut hasher = Sha256::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| FilesError::Remote(format!("Erreur lecture flux: {e}")))?;
        total += chunk.len() as u64;
        if total > max_bytes {
            return Err(FilesError::FileTooLarge);
        }
        hasher.update(&chunk);
        chunks.push(chunk);
    }

    let hash = hex::encode(hasher.finalize());
    let data: Bytes = chunks.into_iter().flatten().collect();
    let size = data.len() as i64;

    // Vérification quota avec taille réelle
    if user_row.used_bytes + size > user_row.quota_bytes {
        return Err(FilesError::QuotaExceeded);
    }

    // ── Stockage ──────────────────────────────────────────────────────────────

    use kubuno_storage::path as storage_path;
    use mime_guess::MimeGuess;

    let (safe_name, existing) = resolve_for_write(&state.db, user.id, dto.folder_id, &filename, dto.overwrite, false).await?;
    let mime        = MimeGuess::from_path(&safe_name).first_or_octet_stream().to_string();
    let virt_path   = folder_virt_path(&state.db, dto.folder_id, user.id).await?;
    let dest        = storage_path::user_file_path(user.id, &virt_path, &safe_name);
    let dest_str    = dest.to_string_lossy().to_string();

    state.storage.put(&dest_str, data).await?;

    // ── Enregistrement DB (insert ou remplacement en place sur overwrite) ─────
    let file = insert_or_update_record(
        &state.db, &state.storage, user.id, dto.folder_id,
        &safe_name, &mime, size, &dest_str, Some(&hash), None, existing,
    ).await?;

    update_used_bytes(&state.db, user.id, size).await;

    tracing::info!(
        url = %url,
        name = %safe_name,
        size = size,
        owner = %user.id,
        "Fichier importé depuis URL"
    );

    Ok((StatusCode::CREATED, Json(json!({ "file": file }))))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn block_private_host(host: &str) -> Result<()> {
    // Bloquer localhost et variantes
    if matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0") {
        return Err(FilesError::Validation("URL vers hôte local non autorisée".into()));
    }

    // Bloquer les IPs RFC1918 / link-local
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err(FilesError::Validation("URL vers IP privée non autorisée".into()));
        }
    }

    // Bloquer les domaines .local et .internal
    if host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".lan") {
        return Err(FilesError::Validation("URL vers hôte local non autorisée".into()));
    }

    Ok(())
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8
            o[0] == 10
                || (o[0] == 172 && o[1] >= 16 && o[1] <= 31)
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 169 && o[1] == 254)
                || o[0] == 127
                || o[0] == 0
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

fn extract_content_disposition_filename(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let cd = headers.get(reqwest::header::CONTENT_DISPOSITION)?.to_str().ok()?;
    // Cherche filename="..." ou filename*=UTF-8''...
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename=") {
            let name = rest.trim_matches('"').to_string();
            if !name.is_empty() { return Some(name); }
        }
        if let Some(rest) = p.strip_prefix("filename*=") {
            // Format: charset''encoded-name
            if let Some(encoded) = rest.splitn(3, '\'').nth(2) {
                if let Ok(decoded) = urlencoding::decode(encoded) {
                    return Some(decoded.into_owned());
                }
            }
        }
    }
    None
}
