; Auto-uninstall any previously installed version before installing this one,
; so the user never has to manually uninstall the old build first.
;
; electron-builder's assisted installer already replaces the same-scope install,
; but installs left over from older builds (different scope / install dir) can
; pile up. customInit runs at the very start of install and clears both the
; per-user (HKCU) and per-machine (HKLM) registrations for this app's GUID.

!macro customInit
  !insertmacro removePreviousInstall HKCU
  !insertmacro removePreviousInstall HKLM
!macroend

!macro removePreviousInstall ROOT
  ClearErrors
  ReadRegStr $R8 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R9 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${if} $R8 != ""
    DetailPrint "Removing previously installed version..."
    ${if} $R9 != ""
      ; run the old uninstaller silently and in place, then wait for it to finish
      ExecWait '"$R8" /S _?=$R9'
    ${else}
      ExecWait '"$R8" /S'
    ${endif}
    Delete "$R8"
  ${endif}
!macroend

!macro customInstall
  ; Every completed installer run must return the app to the first-run setup gate.
  ; The app consumes this marker on its first launch and preserves serverFolder,
  ; allowing existing users to use the prominent "already set up" recovery action.
  ; Electron app.getPath("userData") resolves from package name:
  ; %APPDATA%\tiktok-bridge-ui
  CreateDirectory "$APPDATA\tiktok-bridge-ui"
  FileOpen $R0 "$APPDATA\tiktok-bridge-ui\require-initial-setup.flag" w
  FileWrite $R0 "installed"
  FileClose $R0
!macroend
