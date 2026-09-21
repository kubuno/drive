use kubuno_db::dialect::Assign;
use kubuno_db::{params, DbPool};
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{FileLock, FileLockInfo},
};

/// Locks a file owned by the user. Re-locking one's own file updates the reason;
/// a file already locked by someone else cannot be re-locked.
pub async fn lock_file(
    db: &DbPool,
    owner_id: Uuid,
    file_id: Uuid,
    reason: Option<String>,
) -> Result<FileLock> {
    let owns: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT id FROM drive.files WHERE id = $1 AND owner_id = $2",
            params![file_id, owner_id],
        )
        .await?;
    if owns.is_none() {
        return Err(FilesError::NotFound("Fichier introuvable".into()));
    }

    if let Some(holder) = locked_holder(db, file_id).await? {
        if holder != owner_id {
            return Err(FilesError::Conflict("Fichier déjà verrouillé par un autre utilisateur".into()));
        }
    }

    let reason = reason.map(|r| r.trim().to_string()).filter(|r| !r.is_empty());

    // Upsert on the file_id primary key: re-locking one's own file refreshes the
    // reason and the timestamp. No RETURNING on MySQL, so the row is reselected.
    let clause = db.backend().upsert(
        "drive.file_locks",
        &["file_id"],
        &[Assign::Incoming("reason"), Assign::Incoming("created_at")],
    );
    let sql = format!(
        "INSERT INTO drive.file_locks (file_id, locked_by, reason, created_at) \
         VALUES ($1, $2, $3, $4){clause}"
    );
    db.execute(&sql, params![file_id, owner_id, reason.as_deref(), chrono::Utc::now()])
        .await?;

    db.fetch_one_as::<FileLock>(
        "SELECT * FROM drive.file_locks WHERE file_id = $1",
        params![file_id],
    )
    .await
    .map_err(Into::into)
}

/// Removes a file's lock. The holder can always unlock; an admin can force-unlock.
pub async fn unlock_file(db: &DbPool, user_id: Uuid, is_admin: bool, file_id: Uuid) -> Result<()> {
    let affected = if is_admin {
        db.execute(
            "DELETE FROM drive.file_locks WHERE file_id = $1",
            params![file_id],
        )
        .await?
    } else {
        db.execute(
            "DELETE FROM drive.file_locks WHERE file_id = $1 AND locked_by = $2",
            params![file_id, user_id],
        )
        .await?
    };
    if affected == 0 {
        return Err(FilesError::NotFound("Aucun verrou à retirer".into()));
    }
    Ok(())
}

/// The user who currently holds a lock on a file, if any.
pub async fn locked_holder(db: &DbPool, file_id: Uuid) -> Result<Option<Uuid>> {
    let by: Option<Uuid> = db
        .fetch_optional_scalar(
            "SELECT locked_by FROM drive.file_locks WHERE file_id = $1",
            params![file_id],
        )
        .await?;
    Ok(by)
}

pub async fn get_lock_info(db: &DbPool, file_id: Uuid) -> Result<Option<FileLockInfo>> {
    let info = db
        .fetch_optional_as::<FileLockInfo>(
            "SELECT l.file_id, l.locked_by, u.display_name AS locked_by_name,
                    l.reason, l.created_at, l.expires_at
             FROM drive.file_locks l
             LEFT JOIN core.users u ON u.id = l.locked_by
             WHERE l.file_id = $1",
            params![file_id],
        )
        .await?;
    Ok(info)
}

/// All locks on the user's own files, for painting padlock badges in one fetch.
pub async fn list_locks(db: &DbPool, owner_id: Uuid) -> Result<Vec<FileLockInfo>> {
    let locks = db
        .fetch_all_as::<FileLockInfo>(
            "SELECT l.file_id, l.locked_by, u.display_name AS locked_by_name,
                    l.reason, l.created_at, l.expires_at
             FROM drive.file_locks l
             JOIN drive.files f ON f.id = l.file_id AND f.owner_id = $1
             LEFT JOIN core.users u ON u.id = l.locked_by",
            params![owner_id],
        )
        .await?;
    Ok(locks)
}
