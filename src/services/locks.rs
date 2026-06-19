use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{FilesError, Result},
    models::{FileLock, FileLockInfo},
};

/// Locks a file owned by the user. Re-locking one's own file updates the reason;
/// a file already locked by someone else cannot be re-locked.
pub async fn lock_file(
    db: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
    reason: Option<String>,
) -> Result<FileLock> {
    let owns: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM drive.files WHERE id = $1 AND owner_id = $2")
            .bind(file_id)
            .bind(owner_id)
            .fetch_optional(db)
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
    let lock = sqlx::query_as::<_, FileLock>(
        "INSERT INTO drive.file_locks (file_id, locked_by, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (file_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
         RETURNING *",
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(&reason)
    .fetch_one(db)
    .await?;
    Ok(lock)
}

/// Removes a file's lock. The holder can always unlock; an admin can force-unlock.
pub async fn unlock_file(db: &PgPool, user_id: Uuid, is_admin: bool, file_id: Uuid) -> Result<()> {
    let res = if is_admin {
        sqlx::query("DELETE FROM drive.file_locks WHERE file_id = $1")
            .bind(file_id)
            .execute(db)
            .await?
    } else {
        sqlx::query("DELETE FROM drive.file_locks WHERE file_id = $1 AND locked_by = $2")
            .bind(file_id)
            .bind(user_id)
            .execute(db)
            .await?
    };
    if res.rows_affected() == 0 {
        return Err(FilesError::NotFound("Aucun verrou à retirer".into()));
    }
    Ok(())
}

/// The user who currently holds a lock on a file, if any.
pub async fn locked_holder(db: &PgPool, file_id: Uuid) -> Result<Option<Uuid>> {
    let by: Option<Uuid> =
        sqlx::query_scalar("SELECT locked_by FROM drive.file_locks WHERE file_id = $1")
            .bind(file_id)
            .fetch_optional(db)
            .await?;
    Ok(by)
}

pub async fn get_lock_info(db: &PgPool, file_id: Uuid) -> Result<Option<FileLockInfo>> {
    let info = sqlx::query_as::<_, FileLockInfo>(
        "SELECT l.file_id, l.locked_by, u.display_name AS locked_by_name,
                l.reason, l.created_at, l.expires_at
         FROM drive.file_locks l
         LEFT JOIN core.users u ON u.id = l.locked_by
         WHERE l.file_id = $1",
    )
    .bind(file_id)
    .fetch_optional(db)
    .await?;
    Ok(info)
}

/// All locks on the user's own files, for painting padlock badges in one fetch.
pub async fn list_locks(db: &PgPool, owner_id: Uuid) -> Result<Vec<FileLockInfo>> {
    let locks = sqlx::query_as::<_, FileLockInfo>(
        "SELECT l.file_id, l.locked_by, u.display_name AS locked_by_name,
                l.reason, l.created_at, l.expires_at
         FROM drive.file_locks l
         JOIN drive.files f ON f.id = l.file_id AND f.owner_id = $1
         LEFT JOIN core.users u ON u.id = l.locked_by",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    Ok(locks)
}
