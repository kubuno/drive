//! AbstractDateTimeFormatter (mirror of `AbstractDateTimeFormatter.cs`).
//!
//! Common `ToShortLabel`/`ToLongLabel` dispatch on the
//! `GeneralSettingsService.DateTimeFormat` enum, years <= 1601 / >= 9999 guards,
//! `ToTimeSpanLabel` (grouping by date). The locale formatting (dates, times, month names, the native
//! name of the culture) comes from the platform's `Locale` extension point (`crate::platform`; Windows:
//! `GetDateFormatEx`/`GetTimeFormatEx`/`GetLocaleInfoEx`), with a portable fallback.

use chrono::{DateTime, Datelike, Local};

use crate::services::settings::DateTimeFormat;

use super::application_date_time_formatter::application_short_label;

/// `IDateTimeFormatter.ToShortLabel` for the given format.
pub fn to_short_label(dt: DateTime<Local>, format: DateTimeFormat) -> String {
    // AbstractDateTimeFormatter: years <= 1601 or >= 9999 -> " ".
    if dt.year() <= 1601 || dt.year() >= 9999 {
        return " ".into();
    }
    match format {
        DateTimeFormat::Application => application_short_label(dt),
        DateTimeFormat::System => {
            format!("{} {}", locale_date(dt, false), locale_time(dt))
        }
        DateTimeFormat::Universal => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}

/// `IDateTimeFormatter.ToLongLabel`: only the Application formatter
/// specializes it (long date "D" + time "t" + relative label if less than
/// 7 days ago); System and Universal fall back to the short label
/// (`AbstractDateTimeFormatter.ToLongLabel => ToShortLabel`).
pub fn to_long_label(dt: DateTime<Local>, format: DateTimeFormat) -> String {
    if dt.year() <= 1601 || dt.year() >= 9999 {
        return " ".into();
    }
    match format {
        DateTimeFormat::Application => {
            let elapsed = Local::now().signed_duration_since(dt);
            let base = format!("{} {}", locale_date(dt, true), locale_time(dt));
            if elapsed.num_days() < 7 && elapsed.num_seconds() >= 0 {
                format!("{base} {}", application_short_label(dt))
            } else {
                base
            }
        }
        _ => to_short_label(dt, format),
    }
}

/// The locale-formatted date (long = "D", short = the date of "g"): the platform's, else `dd/mm/yyyy`.
pub fn locale_date(dt: DateTime<Local>, long: bool) -> String {
    let locale = &crate::platform::current().locale;
    let formatted = if long { locale.long_date(&dt) } else { locale.short_date(&dt) };
    formatted.unwrap_or_else(|| dt.format("%d/%m/%Y").to_string())
}

/// The locale-formatted short time (the time of "g"): the platform's, else `HH:MM`.
pub fn locale_time(dt: DateTime<Local>) -> String {
    crate::platform::current().locale.short_time(&dt).unwrap_or_else(|| dt.format("%H:%M").to_string())
}

/// The native display name of the current UI culture (`AppLanguageItem.Name`): the platform's, else the
/// culture tag.
pub fn current_language_name() -> String {
    let culture = kubuno_drive_desktop_localization::culture();
    crate::platform::current().locale.language_display_name(culture).unwrap_or_else(|| culture.into())
}

/// Port of `AbstractDateTimeFormatter.ToTimeSpanLabel`, with the grouping
/// unit (`GroupByDateUnit`): the "Today / Yesterday / Earlier
/// this week / …" scale, then, after the fixed labels, Day groups by full
/// date, Month by month, Year by year. Returns (descending rank, label)
/// — the rank orders groups from most recent to oldest
/// (`SortIndexOverride`).
pub fn time_span_label_unit(
    t: std::time::SystemTime,
    unit: crate::services::settings::GroupByDateUnit,
) -> (i64, String) {
    use chrono::{DateTime, Datelike, Local};
    let tr = kubuno_drive_desktop_localization::tr;
    let time: DateTime<Local> = t.into();
    let now = Local::now();
    let week = |d: &DateTime<Local>| d.iso_week().year() * 100 + d.iso_week().week() as i32;
    let days = (now.date_naive() - time.date_naive()).num_days();

    if now.date_naive() < time.date_naive() {
        (1_000_000_006, tr("Future").to_string())
    } else if now.date_naive() == time.date_naive() {
        (1_000_000_005, tr("Today").to_string())
    } else if days == 1 {
        (1_000_000_004, tr("Yesterday").to_string())
    } else if unit == crate::services::settings::GroupByDateUnit::Day {
        // Grouping by day: the full date, calendar rank.
        (
            (time.year() as i64) * 10_000 + (time.month() as i64) * 100 + time.day() as i64,
            to_short_label(time, crate::services::settings::get().date_time_format),
        )
    } else if days <= 7 && week(&now) == week(&time) {
        (1_000_000_003, tr("EarlierThisWeek").to_string())
    } else if days <= 14 && week(&(now - chrono::Duration::days(7))) == week(&time) {
        (1_000_000_002, tr("LastWeek").to_string())
    } else if now.year() == time.year() && now.month() == time.month() {
        (1_000_000_001, tr("EarlierThisMonth").to_string())
    } else if (now.year() * 12 + now.month() as i32) - (time.year() * 12 + time.month() as i32) == 1
    {
        (1_000_000_000, tr("LastMonth").to_string())
    } else if unit == crate::services::settings::GroupByDateUnit::Month {
        // Grouping by month: "month year", calendar rank.
        (
            (time.year() as i64) * 10_000 + (time.month() as i64) * 100,
            format!("{} {}", month_name(time.month()), time.year()),
        )
    } else if now.year() == time.year() {
        (10_000_001, tr("EarlierThisYear").to_string())
    } else if now.year() - time.year() == 1 {
        (10_000_000, tr("LastYear").to_string())
    } else {
        (
            time.year() as i64,
            tr("YearN").replace("{0}", &time.year().to_string()),
        )
    }
}

/// The month name in the UI language: the platform's (chrono only knows English), else chrono's English
/// name.
fn month_name(month: u32) -> String {
    if let Some(name) = crate::platform::current().locale.month_name(month) {
        return name;
    }
    chrono::NaiveDate::from_ymd_opt(2000, month, 15)
        .map(|d| d.format("%B").to_string())
        .unwrap_or_else(|| month.to_string())
}
