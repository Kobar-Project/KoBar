// Single definition of the `media-update` payload for the main process and both preloads (T-136).
// Type-only module: it is imported with `import type` and emits no runtime code.
// The renderer project cannot import from here (separate tsconfig), so it declares the same shape once as the global
// `MediaData` / `MediaUpdate` in src/types/global.d.ts; tests/mediaUpdateType.test.ts keeps the two in sync.

export interface MediaTrack {
    title: string;
    artist: string;
    albumArt: string | null;
    isPlaying: boolean;
    sourceAppId?: string;
}

/** Payload of the `media-update` channel; `null` means nothing is playing. */
export type MediaUpdate = MediaTrack | null;
