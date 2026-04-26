!macro customInstall
  ; Bridge起動用のショートカットを作る（Start Menu）
  CreateShortCut "$SMPROGRAMS\MyGamePack Bridge UI\MyGamePack Bridge (Start).lnk" \
    "$SYSDIR\cmd.exe" \
    '/c ""$INSTDIR\resources\bridge\start_all.bat""' \
    "$INSTDIR\MyGamePack Bridge UI.exe" 0
!macroend