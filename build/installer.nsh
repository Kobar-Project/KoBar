; "Open with KoBar" for .txt files (NSIS only; the Store build declares the same thing in build/appx/extensions.xml).
;
; This deliberately does NOT use electron-builder's `fileAssociations`: that registers KoBar as the default handler of the
; extension. Here KoBar is only ADDED to the "Open with" list:
;   - Software\Classes\Applications\KoBar.exe              (the "Choose another app" entry, SupportedTypes = .txt)
;   - Software\Classes\.txt\OpenWithProgids : KoBar.TextFile (one value, the default value of .txt is never written)
;   - Software\Classes\KoBar.TextFile                      (the ProgId those two point at)
; SHCTX is HKCU for a per-user install and HKLM for an all-users install. The uninstaller removes exactly these entries and
; never deletes the .txt key itself, which belongs to Windows and to the user's other apps.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".txt" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHCTX "Software\Classes\KoBar.TextFile" "" "Text Document"
  WriteRegStr SHCTX "Software\Classes\KoBar.TextFile\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\KoBar.TextFile\shell\open" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Classes\KoBar.TextFile\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHCTX "Software\Classes\.txt\OpenWithProgids" "KoBar.TextFile" ""

  ; SHCNE_ASSOCCHANGED: tell Explorer the associations changed so the "Open with" list refreshes.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\Classes\.txt\OpenWithProgids" "KoBar.TextFile"
  DeleteRegKey SHCTX "Software\Classes\KoBar.TextFile"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
