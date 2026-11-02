// CNL (owner report: "after a screenshot a light-blue frame stayed around the whole screen"): pin targeting completes on the next
// blur of the main window and pins whatever is in the foreground then. A screenshot hides the main window, so with targeting
// still armed the desktop itself (Progman / WorkerW, full screen) was pinned and got the cyan pin border. The pin script now
// refuses the desktop shell, the taskbars and KoBar's own windows. Pure, no Electron import (tests/pinTarget.test.ts).

/** Window classes that are never pinned: the desktop (Progman / WorkerW) and the taskbars. */
export const PIN_EXCLUDED_CLASSES = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'] as const;

/** Keeps only decimal window handles (they are interpolated into a PowerShell script). */
export function sanitizeHandles(handles: readonly string[]): string[] {
    return handles.filter((h) => /^[1-9][0-9]{0,19}$/.test(h));
}

/**
 * The PowerShell request that toggles TopMost on the foreground window. Replies `<id>|PINNED:<hwnd>`, `<id>|UNPINNED:<hwnd>`
 * or `<id>|SKIPPED:<hwnd>` (desktop shell, taskbar, one of `ownHandles`, or no foreground window).
 */
export function buildPinTargetScript(id: number, ownHandles: readonly string[]): string {
    const own = sanitizeHandles(ownHandles).join(',');
    const excluded = PIN_EXCLUDED_CLASSES.map((c) => `'${c}'`).join(',');
    return `
                    if (-not ('KoBarPinWin' -as [type])) {
                        Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class KoBarPinWin { [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max); public static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); } }'
                    }
                    $hwnd = [K]::GetForegroundWindow()
                    $own = @(${own})
                    $cls = if ($hwnd -ne [IntPtr]::Zero) { [KoBarPinWin]::ClassOf($hwnd) } else { '' }
                    if ($hwnd -eq [IntPtr]::Zero -or @(${excluded}) -contains $cls -or $own -contains $hwnd.ToInt64()) {
                        Write-Output "${id}|SKIPPED:$hwnd"
                    } else {
                        $GWL_EXSTYLE = -20
                        $WS_EX_TOPMOST = 0x0008
                        $HWND_TOPMOST = -1
                        $HWND_NOTOPMOST = -2

                        $exStyle = [K]::GetWindowLong($hwnd, $GWL_EXSTYLE)
                        if (($exStyle -band $WS_EX_TOPMOST) -eq $WS_EX_TOPMOST) {
                            # Already TopMost, so UNPIN it
                            [K]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, 3)
                            Write-Output "${id}|UNPINNED:$hwnd"
                        } else {
                            # Not TopMost, so PIN it
                            [K]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, 3)
                            Write-Output "${id}|PINNED:$hwnd"
                        }
                    }
                    `;
}
