// Pure validator for the optional manifest.json `bar` block (Canlı bar presentation). Used at install time (main
// process) and when the renderer registers a manifest. Invalid parts are dropped with a warning; a bad `bar` block
// never makes an install or a load fail.
import { BAR_TILE_TEMPLATES, type BarItemSize, type ManifestBarBlock, type TileTemplate } from './barPresentation.js';

export interface BarManifestResult {
    /** The cleaned block (only known, valid fields), or undefined when nothing valid is left. */
    bar: ManifestBarBlock | undefined;
    warnings: string[];
}

/** The declarative tile fields (everything of TileDeclaration except `render`). */
export interface CleanTile {
    template?: TileTemplate;
    sensitive?: boolean;
    live?: boolean;
    pinnable?: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function isTileTemplate(v: unknown): v is TileTemplate {
    return typeof v === 'string' && (BAR_TILE_TEMPLATES as readonly string[]).includes(v);
}

export function isBarItemSize(v: unknown): v is BarItemSize {
    return v === 'icon' || v === 'tile';
}

const TILE_FLAGS = ['sensitive', 'live', 'pinnable'] as const;

/** Keeps only the known, valid declarative tile fields of `input`; every dropped value adds a warning. */
export function cleanTileFields(input: Record<string, unknown>, warnings: string[], where: string): CleanTile {
    const tile: CleanTile = {};
    if (input.template !== undefined) {
        if (isTileTemplate(input.template)) tile.template = input.template;
        else warnings.push(`${where}.template "${String(input.template)}" is not a known template; the label template is used.`);
    }
    for (const flag of TILE_FLAGS) {
        if (input[flag] === undefined) continue;
        if (typeof input[flag] === 'boolean') tile[flag] = input[flag] as boolean;
        else warnings.push(`${where}.${flag} must be true or false; ignored.`);
    }
    return tile;
}

export function sanitizeBarBlock(input: unknown): BarManifestResult {
    const warnings: string[] = [];
    if (input === undefined || input === null) return { bar: undefined, warnings };
    if (!isRecord(input)) {
        warnings.push('manifest "bar" must be an object; ignored.');
        return { bar: undefined, warnings };
    }
    const bar: ManifestBarBlock = {};
    if (input.tile !== undefined) {
        if (!isRecord(input.tile)) warnings.push('manifest "bar.tile" must be an object; ignored.');
        else {
            const tile = cleanTileFields(input.tile, warnings, 'bar.tile');
            if (Object.keys(tile).length > 0) bar.tile = tile;
        }
    }
    if (input.defaultSize !== undefined) {
        if (isBarItemSize(input.defaultSize)) bar.defaultSize = input.defaultSize;
        else warnings.push('manifest "bar.defaultSize" must be "icon" or "tile"; ignored.');
    }
    // At most a few unknown-key warnings: a huge `bar` object must not produce an unbounded warning list.
    const unknown = Object.keys(input).filter((key) => key !== 'tile' && key !== 'defaultSize');
    for (const key of unknown.slice(0, 10)) warnings.push(`manifest "bar.${key}" is not a known field; ignored.`);
    if (unknown.length > 10) warnings.push(`manifest "bar" has ${unknown.length - 10} more unknown fields; ignored.`);
    return { bar: bar.tile || bar.defaultSize ? bar : undefined, warnings };
}
