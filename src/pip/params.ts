// PiP window query parsing. URLSearchParams already percent-decodes values, so decoding
// again would throw URIError on titles that contain a literal "%" (e.g. "100% Pure").
import { normalizePlatform, type UiPlatform } from '../platform';

export interface PipParams {
    url: string;
    title: string;
    albumArt: string;
}

/** MAC-022: the host platform main puts into the query (`platform=darwin|win32|linux`); null when absent or unknown. */
export function parsePipPlatform(search: string): UiPlatform | null {
    return normalizePlatform(new URLSearchParams(search).get('platform'));
}

export function parsePipParams(search: string): PipParams {
    const params = new URLSearchParams(search);
    return {
        url: params.get('url') || '',
        title: params.get('title') || 'PIP Video',
        albumArt: params.get('albumArt') || '',
    };
}
