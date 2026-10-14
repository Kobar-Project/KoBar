// R4: the PowerShell scripts of the global paste flow (Windows). Pure and constant: they never contain user data, only the
// request id (an integer chosen by electron/lib/psRequests.cts) and a virtual-key code from the constants below. They are sent
// with psRequest (electron/main/services/native.cts), so every script ends by echoing `id|payload` on one line.

/** Virtual-key codes used by the paste flow. */
export const VK_CONTROL = 0x11;
export const VK_V = 0x56;

function assertInt(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

/** Echoes `id|1` while the key is physically down, `id|0` otherwise (GetAsyncKeyState high bit). */
export function isKeyDownScript(id: number, vk: number): string {
    assertInt('id', id);
    assertInt('vk', vk);
    return `if (([K]::GetAsyncKeyState(${vk}) -band 0x8000) -ne 0) { Write-Output "${id}|1" } else { Write-Output "${id}|0" }\n`;
}

/**
 * Simulated Ctrl+V. Ctrl is balanced with `$isDown`: when the user still holds Ctrl, only V is sent and Ctrl is left alone
 * (so "hold Ctrl, press V again" keeps working); otherwise Ctrl is pressed and released around V. Echoes `id|OK` after
 * the key events were sent, so the caller knows the injection really ran (not just that it was written to stdin).
 */
export function injectPasteScript(id: number): string {
    assertInt('id', id);
    return [
        '$isDown = ([K]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0',
        'if (-not $isDown) { [K]::keybd_event(0x11, 0, 0, 0) }',
        '[K]::keybd_event(0x56, 0, 0, 0)',
        '[K]::keybd_event(0x56, 0, 2, 0)',
        'if (-not $isDown) { [K]::keybd_event(0x11, 0, 2, 0) }',
        `Write-Output "${id}|OK"`,
        '',
    ].join('\n');
}

/** Reply of isKeyDownScript: true = down, false = up, null = no answer (bridge down, timeout, unexpected text). */
export function parseKeyDownReply(reply: string | null): boolean | null {
    if (reply === '1') return true;
    if (reply === '0') return false;
    return null;
}
