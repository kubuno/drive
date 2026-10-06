//! The portable half of `Files.App/ViewModels/ShellViewModel.cs`: where a tab is (`Location`), the layouts
//! (`FolderLayoutModes`), the sort (`OrderFiles`) and the grouping (`GroupOption`). The tab itself, its
//! panes and the pixel metrics of the Windows window stay in `desktop/windows`
//! (`kubuno-drive-desktop-windows`, `view_models/shell_view_model.rs`).

use std::path::PathBuf;

use crate::data::items::DirEntryItem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Location {
    Home,
    Dir(PathBuf),
    Settings,
    /// The Recycle Bin (`Shell:RecycleBinFolder`, `ContentPageTypes.RecycleBin`).
    RecycleBin,
    /// Results of a recursive search (`IsSearchResultPage`,
    /// `ContentPageTypes.SearchResults`): `root` = starting folder.
    SearchResults { query: String, root: String },
}

/// Layout of the file area — port of `FolderLayoutModes` (minus `Adaptive`,
/// which the bar only shows when `LayoutAdaptive.IsExecutable`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ViewMode {
    Details,
    List,
    Cards,
    Columns,
    Grid,
}

impl ViewMode {
    pub const ALL: [ViewMode; 5] =
        [ViewMode::Details, ViewMode::List, ViewMode::Cards, ViewMode::Grid, ViewMode::Columns];

    /// The number of ticks on the size slider: `Maximum` of the Slider in
    /// Toolbar.xaml (Details/List/Columns 5, Cards 4, Grid 12).
    pub fn size_max(self) -> u8 {
        match self {
            ViewMode::Details | ViewMode::List | ViewMode::Columns => 5,
            ViewMode::Cards => 4,
            ViewMode::Grid => 12,
        }
    }

    /// The ticks marked with an icon under the slider, and their icon. The
    /// grid only has four, placed on ticks 1, 2, 8 and 12 — these are the
    /// named values of `GridViewSizeKind` (Small, Medium, Large, ExtraLarge).
    pub fn size_ticks(self) -> &'static [(u8, &'static str)] {
        match self {
            ViewMode::Cards => &[
                (1, "SizeSmall28"),
                (2, "SizeMedium28"),
                (3, "SizeLarge28"),
                (4, "SizeExtraLarge28"),
            ],
            ViewMode::Grid => &[
                (1, "SizeSmall28"),
                (2, "SizeMedium28"),
                (8, "SizeLarge28"),
                (12, "SizeExtraLarge28"),
            ],
            _ => &[
                (1, "SizeCompact28"),
                (2, "SizeSmall28"),
                (3, "SizeMedium28"),
                (4, "SizeLarge28"),
                (5, "SizeExtraLarge28"),
            ],
        }
    }

    pub fn icon(self) -> &'static str {
        match self {
            ViewMode::Details => "LayoutDetails28",
            ViewMode::List => "LayoutList28",
            ViewMode::Cards => "LayoutTiles28",
            ViewMode::Grid => "LayoutGrid28",
            ViewMode::Columns => "LayoutColumns28",
        }
    }

    /// The label's resource key (`Commands.Layout*.Label`).
    pub fn label_key(self) -> &'static str {
        match self {
            ViewMode::Details => "Details",
            ViewMode::List => "List",
            ViewMode::Cards => "Cards",
            ViewMode::Grid => "Grid",
            ViewMode::Columns => "Columns",
        }
    }
}

/// The saved size for the `mode` layout (`LayoutSettingsService`).
pub fn layout_size(mode: ViewMode) -> u8 {
    let s = crate::services::settings::get();
    match mode {
        ViewMode::Details => s.details_view_size,
        ViewMode::List => s.list_view_size,
        ViewMode::Cards => s.cards_view_size,
        ViewMode::Columns => s.columns_view_size,
        ViewMode::Grid => s.grid_view_size,
    }
    .clamp(1, mode.size_max())
}

/// Sortable columns of the details view (port of `SortOption`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SortColumn {
    Name,
    DateModified,
    Type,
    Size,
    /// Recycle Bin only (`SortOption.OriginalFolder`).
    OriginalPath,
    /// Recycle Bin only (`SortOption.DateDeleted`).
    DateDeleted,
}

/// The 4 columns of the Details view: (.resw key, sort column). The
/// Recycle Bin replaces "Date modified / Type" with "Original path / Date
/// deleted" (`ColumnsViewModel`: OriginalPath + DateDeleted visible).
pub fn detail_columns(recycle: bool) -> [(&'static str, SortColumn); 4] {
    if recycle {
        [
            ("Name", SortColumn::Name),
            ("OriginalPath", SortColumn::OriginalPath),
            ("DateDeleted", SortColumn::DateDeleted),
            ("Size", SortColumn::Size),
        ]
    } else {
        [
            ("Name", SortColumn::Name),
            ("DateModifiedLowerCase", SortColumn::DateModified),
            ("Type", SortColumn::Type),
            ("Size", SortColumn::Size),
        ]
    }
}

/// The sort's folders/files grouping (`SortFilesFirst` +
/// `SortDirectoriesAlongsideFiles`): the original's radio trio.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum SortGrouping {
    #[default]
    FoldersFirst,
    FilesFirst,
    Together,
}

impl SortGrouping {
    pub fn of(files_first: bool, alongside: bool) -> Self {
        if alongside {
            Self::Together
        } else if files_first {
            Self::FilesFirst
        } else {
            Self::FoldersFirst
        }
    }
}

/// The comparator from `ShellViewModel.OrderFiles`: folders/files grouping
/// first, then the requested column — and the direction only reverses
/// WITHIN each group.
pub fn sort_entries(
    entries: &mut [DirEntryItem],
    column: SortColumn,
    ascending: bool,
    grouping: SortGrouping,
) {
    entries.sort_by(|a, b| {
        let group = match grouping {
            SortGrouping::FoldersFirst => b.is_dir.cmp(&a.is_dir),
            SortGrouping::FilesFirst => a.is_dir.cmp(&b.is_dir),
            SortGrouping::Together => std::cmp::Ordering::Equal,
        };
        let ordering = group.then_with(|| match column {
            SortColumn::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SortColumn::DateModified | SortColumn::DateDeleted => a.modified.cmp(&b.modified),
            SortColumn::Type => a.type_text().cmp(&b.type_text()),
            SortColumn::Size => a.size.cmp(&b.size),
            SortColumn::OriginalPath => a
                .original_path
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b.original_path.as_deref().unwrap_or("").to_lowercase()),
        });
        if ascending || !ordering.is_ne() {
            ordering
        } else {
            match (a.is_dir, b.is_dir) {
                (true, false) | (false, true) if grouping != SortGrouping::Together => ordering,
                _ => ordering.reverse(),
            }
        }
    });
}

/// Port of `GroupOption` (`Data/Enums/GroupOption.cs`), reduced to the ported
/// options (DateCreated, FileTag, SyncStatus… will come with their columns).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum GroupOption {
    #[default]
    None,
    Name,
    DateModified,
    Type,
    Size,
}

impl GroupOption {
    /// The group key of an item (`GroupingHelper.GetItemGroupKeySelector`):
    /// (group sort rank, header label).
    pub fn key(
        self,
        e: &DirEntryItem,
        unit: crate::services::settings::GroupByDateUnit,
    ) -> (i64, String) {
        let tr = kubuno_drive_desktop_localization::tr;
        match self {
            GroupOption::None => (0, String::new()),
            // The first letter, uppercased.
            GroupOption::Name => {
                let c = e.name.chars().next().unwrap_or(' ').to_uppercase().next().unwrap_or(' ');
                (c as i64, c.to_string())
            }
            GroupOption::DateModified => match e.modified {
                Some(t) => {
                    let (rank, label) =
                        crate::services::date_time_formatter::time_span_label_unit(t, unit);
                    // NEGATIVE rank: most recent first, the original's
                    // ascending grouping order.
                    (-rank, label)
                }
                None => (0, String::new()),
            },
            // Folder → its type; file → its lowercase extension.
            GroupOption::Type => {
                if e.is_dir {
                    (0, e.type_text())
                } else {
                    let ext = std::path::Path::new(&e.name)
                        .extension()
                        .map(|x| x.to_string_lossy().to_lowercase())
                        .unwrap_or_else(|| " ".into());
                    (1, ext)
                }
            }
            // The bands from `GroupingHelper.sizeGroups`; folders keep their
            // own group, like the original (no computed size).
            GroupOption::Size => {
                if e.is_dir {
                    (-1, tr("Folders").to_string())
                } else {
                    let bands: [(u64, &str); 5] = [
                        (5_000_000_000, "ItemSizeText_Huge"),
                        (1_000_000_000, "ItemSizeText_VeryLarge"),
                        (128_000_000, "ItemSizeText_Large"),
                        (1_000_000, "ItemSizeText_Medium"),
                        (16_000, "ItemSizeText_Small"),
                    ];
                    for (i, (size, key)) in bands.iter().enumerate() {
                        if e.size > *size {
                            return ((bands.len() - i) as i64, tr(key).to_string());
                        }
                    }
                    (0, tr("ItemSizeText_Tiny").to_string())
                }
            }
        }
    }
}
