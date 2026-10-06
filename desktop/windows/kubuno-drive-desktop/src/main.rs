//! Kubuno Drive for Windows (`drive.exe`): the app of desktop/common with the Windows platform registered
//! and the Win32 window as its user interface (`kubuno-drive-desktop-windows`).

// A GUI application: no console window, in Debug too (like a Windows Forms `WinExe`). Its logs,
// `println!`s and panics go to the debugger's Output window or to %LOCALAPPDATA%\Kubuno\logs
// (`kubuno_desktop_controls::host::diagnostics`).
#![windows_subsystem = "windows"]

fn main() {
    let code = kubuno_drive_desktop_common::app::run(
        kubuno_drive_desktop_windows::platform::platform(),
        &kubuno_drive_desktop_windows::WindowsUi,
    );
    std::process::exit(code);
}
