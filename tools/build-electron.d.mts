import type { BuildOptions, BuildResult, Metafile } from 'esbuild';

export declare const ROOT: string;
export declare const DEFAULT_OUTDIR: string;
export declare const ENTRY_POINTS: Readonly<
    Record<'main' | 'preload' | 'pip-preload' | 'settings-preload' | 'smtc-worker' | 'pdf-worker', string>
>;
export declare const SANDBOXED_PRELOADS: readonly string[];
export declare const NODE_TARGET: string;

export interface PackageJsonLike {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

export declare function allowedRuntimePackages(pkg: PackageJsonLike): Set<string>;
export declare function packageNameOf(specifier: string): string;
export declare function checkExternalImports(metafile: Metafile, pkg: PackageJsonLike): string[];
export declare function createBuildOptions(options?: { outdir?: string; root?: string }): BuildOptions & { metafile: true };
export declare function buildElectron(options?: { outdir?: string; root?: string }): Promise<BuildResult<{ metafile: true }>>;
