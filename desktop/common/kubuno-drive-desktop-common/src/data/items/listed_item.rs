//! DirEntryItem (mirrors ListedItem.cs)

use super::format_bytes_fr;

/// A file or folder listed in the details view.
#[derive(Debug, Clone)]
pub struct DirEntryItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Displayable size: always for a file; for a folder, only once
    /// computed by the `SizeProvider` ("Calculer la taille des dossiers"
    /// setting).
    pub size_known: bool,
    pub modified: Option<std::time::SystemTime>,
    /// Recycle Bin only (`RecycleBinItem.ItemOriginalPath`): the original
    /// folder of the deleted item. `Some` ⇔ the entry comes from the
    /// Recycle Bin — in that case `modified` carries the DELETION DATE.
    pub original_path: Option<String>,
}

impl DirEntryItem {
    pub fn type_text(&self) -> String {
        if self.is_dir {
            return "Dossier de fichiers".to_string();
        }
        match std::path::Path::new(&self.name)
            .extension()
            .map(|e| e.to_string_lossy().to_uppercase())
        {
            Some(ext) => format!("Fichier {ext}"),
            None => "Fichier".to_string(),
        }
    }

    pub fn modified_text(&self) -> String {
        let Some(modified) = self.modified else {
            return String::new();
        };
        let datetime: chrono::DateTime<chrono::Local> = modified.into();
        // GeneralPage "Format de date" (DateTimeFormat setting).
        crate::services::date_time_formatter::to_short_label(datetime, crate::services::settings::get().date_time_format)
    }

    pub fn size_text(&self) -> String {
        if self.size_known {
            format_bytes_fr(self.size)
        } else {
            String::new()
        }
    }
}

/// Enumerates a directory, folders first then files, both name-sorted case-insensitively. Hidden items
/// (as the platform defines them: dot files by default, the hidden and system attributes on Windows) are
/// skipped unless the user enabled `show_hidden_items` (Files' default behaviour).
pub fn load_directory(path: &str) -> std::io::Result<Vec<DirEntryItem>> {
    let show_hidden = crate::services::settings::get().show_hidden_items;
    crate::platform::current().file_system.load_directory(path, show_hidden)
}
