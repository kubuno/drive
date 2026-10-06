//! The sample folder (`--sample`): a small fixed tree the app opens for tests, screenshots and
//! demonstrations, the same on every system.
//!
//! It is created on first use, under the sandbox directory when `KUBUNO_SANDBOX_DIR` names one (a sandboxed
//! run never writes outside it), else under the temporary folder. Existing files are left as they are, so
//! what a test changed in it stays until the folder is deleted.

use std::io;
use std::path::{Path, PathBuf};

/// The folder's name.
pub const SAMPLE_FOLDER_NAME: &str = "Kubuno Drive sample";

/// The tree: (path relative to the sample folder, `None` for a folder or the content of a file).
pub const SAMPLE_TREE: &[(&str, Option<&str>)] = &[
    ("Documents", None),
    ("Documents/Budget 2026.csv", Some("poste;montant\nloyer;850\ncourses;420\n")),
    ("Documents/Notes de réunion.md", Some("# Réunion du 6 octobre\n\n- Organisation des dépôts par plateforme\n")),
    ("Photos", None),
    ("Photos/Vacances", None),
    ("Projets", None),
    ("Projets/Kubuno", None),
    ("Projets/Kubuno/README.txt", Some("Kubuno Drive, dossier d'exemple.\n")),
    ("Lisez-moi.txt", Some("Dossier d'exemple de Kubuno Drive (option --sample).\n")),
    (".cache", None),
];

/// Where the sample folder goes: the sandbox, else the temporary folder.
pub fn sample_root() -> PathBuf {
    kubuno_desktop_app_storage::paths::sandbox_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(SAMPLE_FOLDER_NAME)
}

/// Creates the sample folder where needed (see [`sample_root`]) and returns its path.
pub fn ensure_sample_folder() -> io::Result<PathBuf> {
    let root = sample_root();
    create_tree(&root)?;
    Ok(root)
}

/// Creates [`SAMPLE_TREE`] under `root`, keeping what already exists.
pub fn create_tree(root: &Path) -> io::Result<()> {
    std::fs::create_dir_all(root)?;
    for (relative, content) in SAMPLE_TREE {
        let path = relative.split('/').fold(root.to_path_buf(), |p, part| p.join(part));
        match content {
            None => std::fs::create_dir_all(&path)?,
            Some(text) if !path.exists() => std::fs::write(&path, text)?,
            Some(_) => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_sample_name_is_portable() {
        for (relative, _) in SAMPLE_TREE {
            for part in relative.split('/') {
                assert_eq!(
                    kubuno_drive_core::verdict(part, kubuno_drive_core::Profile::Portable),
                    kubuno_drive_core::Verdict::Valid,
                    "{part}"
                );
            }
        }
    }

    #[test]
    fn tree_is_created_and_kept() {
        let root = std::env::temp_dir().join(format!("kubuno-drive-sample-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        create_tree(&root).expect("create");
        std::fs::write(root.join("Lisez-moi.txt"), "changed").expect("write");
        create_tree(&root).expect("create again");
        assert_eq!(std::fs::read_to_string(root.join("Lisez-moi.txt")).expect("read"), "changed");
        assert!(root.join("Projets").join("Kubuno").join("README.txt").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
