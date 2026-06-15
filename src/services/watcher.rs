use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::services::scanner;

/// Démarre la surveillance du répertoire de stockage.
/// Détecte les fichiers déposés manuellement sur le disque et les synchronise en DB.
pub async fn start_watcher(storage_base: PathBuf, db: PgPool) {
    let (tx, rx) = std_mpsc::channel::<PathBuf>();
    let storage_base_watch = storage_base.clone();

    let mut watcher: RecommendedWatcher = match notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        },
    ) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!(error = %e, "Impossible de créer le watcher filesystem");
            return;
        }
    };

    if let Err(e) = watcher.watch(&storage_base_watch, RecursiveMode::Recursive) {
        tracing::error!(
            error = %e,
            path  = %storage_base_watch.display(),
            "Impossible de surveiller le répertoire de stockage"
        );
        return;
    }

    tracing::info!(path = %storage_base_watch.display(), "Watcher filesystem démarré");

    // Debounce : owner_id → dernière activité
    let mut pending: HashMap<Uuid, Instant> = HashMap::new();

    loop {
        // Vider tous les événements disponibles dans le canal sync
        loop {
            match rx.try_recv() {
                Ok(path) => {
                    if let Some(owner_id) = extract_owner_id(&storage_base, &path) {
                        pending.insert(owner_id, Instant::now());
                    }
                }
                Err(std_mpsc::TryRecvError::Empty)        => break,
                Err(std_mpsc::TryRecvError::Disconnected) => {
                    tracing::warn!("Watcher canal fermé, arrêt");
                    return;
                }
            }
        }

        // Déclencher les scans pour les owners silencieux depuis > 2s
        let now = Instant::now();
        let ready: Vec<Uuid> = pending
            .iter()
            .filter(|(_, t)| now.duration_since(**t) >= Duration::from_secs(2))
            .map(|(id, _)| *id)
            .collect();

        for owner_id in ready {
            pending.remove(&owner_id);
            let db2   = db.clone();
            let base2 = storage_base.clone();
            tokio::spawn(async move {
                match scanner::scan_owner(&db2, &base2, owner_id).await {
                    Ok(stats) => tracing::info!(
                        owner_id       = %owner_id,
                        folders_added  = stats.folders_added,
                        files_added    = stats.files_added,
                        files_updated  = stats.files_updated,
                        files_removed  = stats.files_removed,
                        "Scan déclenché par inotify terminé"
                    ),
                    Err(e) => tracing::warn!(owner_id = %owner_id, error = %e, "Scan échoué"),
                }
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Extrait l'owner_id depuis un chemin de type `{storage_base}/{owner_id}/...`
fn extract_owner_id(storage_base: &PathBuf, path: &PathBuf) -> Option<Uuid> {
    let rel   = path.strip_prefix(storage_base).ok()?;
    let first = rel.components().next()?;
    let name  = first.as_os_str().to_string_lossy();

    // Ne pas scanner les répertoires système du storage (.uploads, thumbnails...)
    // On laisse passer uniquement les UUID d'owners
    Uuid::parse_str(&name).ok()
}
