//! Client HTTP vers l'IPC interne du module `files` + gestion centralisée des NOMS
//! (un fichier .kb*** = source de vérité du nom ; titre = nom sans extension).
//!
//! Ce module est compilé **sans** le reste du serveur `files` (dépendances légères
//! uniquement : reqwest/serde/uuid/base64). Les modules ÉDITEURS (office, notes,
//! paintsharp, flow…) en dépendent pour déléguer TOUT le stockage au module `files` :
//! ils ne touchent jamais `kubuno-storage` ni le disque directement.
//!
//! ## Routage par le relais du core (`/internal/ipc`)
//!
//! Le client ne parle PLUS au module `files` en direct. Sous `derive_module_secrets`
//! chaque module n'a que son propre secret dérivé, donc un appel module→module direct
//! est rejeté (401). Toute requête passe par le CORE : le client poste vers
//! `{core_url}/internal/ipc/drive/<rest>`, le core authentifie le secret de l'APPELANT,
//! ré-injecte celui de `drive` et relaie vers `{drive}/ipc/<rest>` (query-string et corps
//! préservés). Le `core_url` passé à [`FilesClient::new`] est donc l'URL du CORE (plus
//! celle du module `files`), et le secret reste celui de l'appelant. Marche dans les deux
//! modes (secret dérivé ou secret maître partagé), le core ré-injectant de façon transparente.

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

/// One entry returned by the canonical-path resolver (`resolve_browse`).
/// `path` is itself canonical (`[storage]/...`) so callers can keep navigating.
#[derive(Debug, Clone, Deserialize)]
pub struct ResolveEntry {
    pub name:       String,
    pub path:       String,
    pub is_dir:     bool,
    pub size_bytes: Option<i64>,
    pub mime_type:  Option<String>,
}

/// Client HTTP vers l'IPC interne du module `files`, ROUTÉ PAR LE CORE.
/// Chaque requête part vers `{core_url}/internal/ipc/drive/<rest>` avec le secret de
/// l'appelant ; le core l'authentifie, ré-injecte celui de `drive` et relaie.
#[derive(Clone)]
pub struct FilesClient {
    http:     Client,
    /// URL du CORE (pas du module `files`) — le core relaie vers `drive`.
    core_url: String,
    secret:   String,
}

impl FilesClient {
    /// `core_url` = URL du CORE (le relais `/internal/ipc` y vit) ; `secret` = le secret
    /// interne de l'APPELANT (le core ré-injecte celui de `drive`).
    pub fn new(core_url: String, secret: String) -> Self {
        FilesClient { http: Client::new(), core_url, secret }
    }

    pub async fn ensure_folder_path(&self, user_id: Uuid, path: &str, protect: bool, icon: Option<&str>) -> Result<FolderInfo> {
        self.ensure_folder_path_ex(user_id, path, protect, false, icon).await
    }

    /// Variante avec `hidden` : les segments du chemin dont le nom commence par '.'
    /// sont marqués cachés (exclus du navigateur). Pour les dossiers d'assets internes.
    pub async fn ensure_folder_path_ex(&self, user_id: Uuid, path: &str, protect: bool, hidden: bool, icon: Option<&str>) -> Result<FolderInfo> {
        let resp = self.http
            .post(format!("{}/internal/ipc/drive/folders/ensure-path", self.core_url))
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
            .post(format!("{}/internal/ipc/drive/files/with-content", self.core_url))
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
            .get(format!("{}/internal/ipc/drive/files/{user_id}/{file_id}/content", self.core_url))
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
            .put(format!("{}/internal/ipc/drive/files/{file_id}/content", self.core_url))
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
            .get(format!("{}/internal/ipc/drive/files/{user_id}/{file_id}", self.core_url))
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
            .post(format!("{}/internal/ipc/drive/files/names", self.core_url))
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
            .patch(format!("{}/internal/ipc/drive/files/{file_id}/rename", self.core_url))
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
            .delete(format!("{}/internal/ipc/drive/files/{file_id}", self.core_url))
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
            .patch(format!("{}/internal/ipc/drive/files/{file_id}/protect", self.core_url))
            .header("X-Internal-Secret", &self.secret)
            .json(&serde_json::json!({ "user_id": user_id, "protected": protected }))
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("set_file_protected failed: {s} — {b}");
        }
        Ok(())
    }

    /// Liste un répertoire par chemin canonique `[stockage]/chemin` (Drive local OU
    /// montage distant — drive route en interne). Les `path` retournés sont canoniques.
    pub async fn resolve_browse(&self, user_id: Uuid, path: &str) -> Result<Vec<ResolveEntry>> {
        let resp = self.http
            .get(format!("{}/internal/ipc/drive/resolve/{user_id}/browse", self.core_url))
            .query(&[("path", path)])
            .header("X-Internal-Secret", &self.secret)
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("resolve_browse failed: {s} — {b}");
        }
        let body: serde_json::Value = resp.json().await?;
        Ok(serde_json::from_value(body["items"].clone())?)
    }

    /// Lit un fichier par chemin canonique `[stockage]/chemin` → octets bruts.
    pub async fn resolve_file(&self, user_id: Uuid, path: &str) -> Result<Bytes> {
        let resp = self.http
            .get(format!("{}/internal/ipc/drive/resolve/{user_id}/file", self.core_url))
            .query(&[("path", path)])
            .header("X-Internal-Secret", &self.secret)
            .send().await?;
        if !resp.status().is_success() {
            let s = resp.status(); let b = resp.text().await.unwrap_or_default();
            anyhow::bail!("resolve_file failed: {s} — {b}");
        }
        Ok(resp.bytes().await?)
    }

    /// Protège/déprotège un dossier.
    pub async fn set_folder_protected(&self, user_id: Uuid, folder_id: Uuid, protected: bool) -> Result<()> {
        let resp = self.http
            .patch(format!("{}/internal/ipc/drive/folders/{folder_id}/protect", self.core_url))
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
