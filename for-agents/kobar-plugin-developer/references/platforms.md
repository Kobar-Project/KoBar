# Platform notes: Windows and macOS

KoBar's main platform is Windows (Microsoft Store and installer). A macOS build is being prepared; the notes marked **macOS**
describe that build and apply from the first macOS release. There is no Linux release.

## Detecting the platform

```javascript
const platform = window.api.getPlatform?.() ?? 'win32'; // 'win32' | 'darwin' | 'linux'
const isMac = window.useAppStore.getState().isMac;        // same answer, from the store
```

The host also sets `<html data-platform="win32 | darwin | linux">` (since the macOS work; feature-check it).
Use the platform for behaviour, never for styling tricks. Show users the right shortcut names: Ctrl on Windows, ⌘ on macOS.

## What differs

| Area | Windows | macOS |
|---|---|---|
| Pin a window on top (`enterPinTargetingMode` …) | Works | **Unsupported.** The host reports "nothing pinned" at once and shows one notice. The Settings window marks the official Pin Window plugin as not supported on macOS. |
| Media (`sendMediaCommand`, `onMediaUpdate`) | System media session (SMTC) and media keys | AppleScript to Music or Spotify; needs the **Automation** permission. On both platforms only while a KoPlayer plugin is enabled or PiP is open. |
| `getActiveVideoUrls`, `onVideoUrlsUpdate` | YouTube URLs from desktop browsers | Always `[]` |
| `getSmtcSource` | Source app id | `''` |
| Screen capture (`startScreenshotCapture`) | Works | Needs the **Screen Recording** permission; resolves `error: 'permission_denied'` until it is granted and KoBar restarted. |
| `takeScreenshot` | Opens the snipping tool (`ms-screenclip:`) | Interactive `screencapture -i -c` |
| Global paste | Works | Needs the **Accessibility** permission; without it `onClipboardPasteError` gets `{ error: 'accessibility_required' }`. Shortcut is Cmd+V. |
| Clipboard listener | Polls every 500 ms | Polls every 1000 ms; content that password managers mark as concealed is never announced. |
| `launchFile` | Absolute paths, `.lnk`, folders, URLs | Also confirms before opening scripts/automation files and refuses files inside KoBar's own data folders. |
| `openExternal` / URL schemes | Allow-list, confirmation for unknown schemes, dangerous Windows handlers refused | Same rules on every OS: the automation handlers `shortcuts:` and `applescript:` are refused, and remote-session, file-share and system handlers (`ssh:`, `smb:`, `afp:`, `x-apple.systempreferences:` …) always ask. |
| Secrets (`setSecret`) | DPAPI | Keychain |
| Scrollbars (`custom-scrollbar`) | Styled | Native overlay scrollbars; the class has no effect |
| Translucent material / blur | Stronger blur | Lighter blur (the host adjusts its own tokens) |
| Plugin ZIPs made with Finder "Compress" | — | `__MACOSX/`, `._*`, `.DS_Store` are ignored at install |

## Permissions on macOS

Some APIs depend on permissions the user grants in System Settings > Privacy & Security: Accessibility (global paste),
Screen Recording (captures) and Automation (media control). Until the user grants them the calls fail softly, as listed
above. A granted Screen Recording permission takes effect only after KoBar restarts. Tell the user what to enable instead of
retrying in a loop.

A per-plugin `platforms` manifest field is planned but **not implemented**. Today a plugin that cannot work on a platform must
detect it at runtime and explain that to the user.
