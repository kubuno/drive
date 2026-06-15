//! Client HTTP vers l'IPC interne du module `files` + gestion centralisée des NOMS
//! (un fichier .kb*** = source de vérité du nom ; titre = nom sans extension).
//!
//! Ce module est compilé **sans** le reste du serveur `files` (dépendances légères
//! uniquement : reqwest/serde/uuid/base64). Les modules ÉDITEURS (office, notes,
//! paintsharp, flow…) en dépendent pour déléguer TOUT le stockage au module `files` :
//! ils ne touchent jamais `kubuno-storage` ni le disque directement.

use std::collections::HashMap;

use anyhow::Result;
use base64::Engine as _;
use bytes::Bytes;
use reqwest::Client;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct FileInfo {
    pub id:           Uuid,
    pub name:         String,
    pub size_bytes:   i64,
    pub storage_path: String,
    pub folder_id:    Option<Uuid>,
    pub mime_type:    String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FolderInfo {
    pub id:   Uuid,
    pub name: String,
    pub path: String,
}

/// Client HTTP vers l'IPC interne du module `files` (auth par X-Internal-Secret).
#[derive(Clone)]
pub struct FilesClient {
    http:     Client,
    base_url: String,
    secret:   String,
}

impl FilesClient {
    pub fn new(base_url: String, secret: String) -> Self {
        FilesClient { http: Client::new(), base_url, secret }
    }

    pub async fn ensure_folder_path(&self, user_id: Uuid, path: &str, protect: bool, icon: Option<&str>) -> Result<FolderInfo> {
        self.ensure_folder_path_ex(user_id, path, protect, false, icon).await
    }

    /// Variante avec `hidden` : les segments du chemin dont le nom commence par '.'
    /// sont marqués cachés (exclus du navigateur). Pour les dossiers d'assets internes.
    pub async fn ensure_folder_path_ex(&self, user_id: Uuid, path: &str, protect: bool, hidden: bool, icon: Option<&str>) -> Result<FolderInfo> {
        let resp = self.http
            .post(format!("{}/ipc/folders/ensure-path", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "path": path, "protect": protect, "hidden": hidden, "icon": icon }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("ensure_folder_path failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["folder"].clone())?)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_file_with_content(
        &self, user_id: Uuid, folder_id: Option<Uuid>, name: &str, mime_type: &str,
        content: Bytes, metadata: Option<serde_json::Value>, overwrite: bool,
    ) -> Result<FileInfo> {
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(&content);
        let resp = self.http
            .post(format!("{}/ipc/files/with-content", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({
                "user_id": user_id, "folder_id": folder_id, "name": name, "mime_type": mime_type,
                "content": content_b64, "metadata": metadata, "overwrite": overwrite,
            }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("create_file_with_content failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["file"].clone())?)
    }

    pub async fn get_file_content(&self, user_id: Uuid, file_id: Uuid) -> Result<(FileInfo, Bytes)> {
        let resp = self.http
            .get(format!("{}/ipc/files/{user_id}/{file_id}/content", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("get_file_content failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        let file: FileInfo = serde_json::from_value(body["file"].clone())?;
        let b64 = body["content"].as_str().ok_or_else(|| anyhow::anyhow!("champ 'content' manquant"))?;
        let raw = base64::engine::general_purpose::STANDARD.decode(b64)?;
        Ok((file, Bytes::from(raw)))
    }

    pub async fn update_file_content(&self, user_id: Uuid, file_id: Uuid, content: Bytes) -> Result<FileInfo> {
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(&content);
        let resp = self.http
            .put(format!("{}/ipc/files/{file_id}/content", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "content": content_b64 }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("update_file_content failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["file"].clone())?)
    }

    /// Métadonnées seules d'un fichier (sans le contenu) — pour lire son nom.
    pub async fn get_file_meta(&self, user_id: Uuid, file_id: Uuid) -> Result<FileInfo> {
        let resp = self.http
            .get(format!("{}/ipc/files/{user_id}/{file_id}", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .send().await?;
        if !resp.status().is_success() { anyhow::bail!("get_file_meta failed: {}", resp.status()); }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["file"].clone())?)
    }

    /// Noms de plusieurs fichiers en un appel (pour les listes) → { id: name }.
    pub async fn file_names(&self, user_id: Uuid, ids: &[Uuid]) -> HashMap<Uuid, String> {
        if ids.is_empty() { return HashMap::new(); }
        let resp = self.http
            .post(format!("{}/ipc/files/names", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "ids": ids }))
            .send().await;
        match resp {
            Ok(r) if r.status().is_success() => r.json::<HashMap<Uuid, String>>().await.unwrap_or_default(),
            _ => HashMap::new(),
        }
    }

    /// Renomme le fichier visible (.kb***).
    pub async fn rename_file(&self, user_id: Uuid, file_id: Uuid, name: &str) -> Result<FileInfo> {
        let resp = self.http
            .patch(format!("{}/ipc/files/{file_id}/rename", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "name": name }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("rename_file failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["file"].clone())?)
    }

    pub async fn delete_file(&self, user_id: Uuid, file_id: Uuid) -> Result<()> {
        let resp = self.http
            .delete(format!("{}/ipc/files/{file_id}", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("delete_file failed: {s} — {b}");
        }
        Ok(())
    }

    /// Protège/déprotège un fichier (un fichier protégé ne peut pas être supprimé,
    /// et bloque la suppression de tout dossier ancêtre non protégé).
    pub async fn set_file_protected(&self, user_id: Uuid, file_id: Uuid, protected: bool) -> Result<()> {
        let resp = self.http
            .patch(format!("{}/ipc/files/{file_id}/protect", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "protected": protected }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("set_file_protected failed: {s} — {b}");
        }
        Ok(())
    }

    /// Protège/déprotège un dossier.
    pub async fn set_folder_protected(&self, user_id: Uuid, folder_id: Uuid, protected: bool) -> Result<()> {
        let resp = self.http
            .patch(format!("{}/ipc/folders/{folder_id}/protect", self.base_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "protected": protected }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("set_folder_protected failed: {s} — {b}");
        }
        Ok(())
    }
}

// ── Gestion centralisée des NOMS (titre = nom du fichier sans extension) ───────

/// Nom de fichier sans son extension (ex. "Budget 2026.kbcal" → "Budget 2026").
pub fn strip_ext(name: &str) -> String {
    std::path::Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name).to_string()
}

/// Titre d'une entité = nom de son fichier .kb*** sans extension (best-effort).
pub async fn title_of(client: &FilesClient, owner_id: Uuid, file_id: Uuid) -> Option<String> {
    client.get_file_meta(owner_id, file_id).await.ok().map(|i| strip_ext(&i.name))
}

/// Titres de plusieurs entités d'un coup (pour les listes) → { file_id: titre }.
pub async fn titles_of(client: &FilesClient, owner_id: Uuid, file_ids: &[Uuid]) -> HashMap<Uuid, String> {
    client.file_names(owner_id, file_ids).await
        .into_iter().map(|(k, v)| (k, strip_ext(&v))).collect()
}

/// Renomme le fichier .kb*** pour qu'il porte `<title>.<ext>` (titre = nom). Best-effort.
pub async fn set_title(client: &FilesClient, owner_id: Uuid, file_id: Uuid, title: &str, ext: &str) {
    let name = format!("{}.{}", strip_ext(title), ext);
    if let Err(e) = client.rename_file(owner_id, file_id, &name).await {
        tracing::warn!(error = %e, %file_id, "set_title: renommage .kb*** échoué");
    }
}
