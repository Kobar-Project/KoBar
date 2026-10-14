// Minimal bridge exposed by electron/pip-preload.cts to the PiP window only.
export {};

declare global {
    interface Window {
        pipApi?: {
            close: () => void;
            move: (dx: number, dy: number) => void;
            onMediaUpdate: (callback: (data: MediaUpdate) => void) => () => void;
        };
    }
}
