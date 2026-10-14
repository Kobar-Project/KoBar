// PiP window query parsing. URLSearchParams already percent-decodes values, so decoding
// again would throw URIError on titles that contain a literal "%" (e.g. "100% Pure").
export interface PipParams {
    url: string;
    title: string;
    albumArt: string;
}

export function parsePipParams(search: string): PipParams {
    const params = new URLSearchParams(search);
    return {
        url: params.get('url') || '',
        title: params.get('title') || 'PIP Video',
        albumArt: params.get('albumArt') || '',
    };
}
