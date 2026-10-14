export type DistFlavor = 'store' | 'direct';

export interface BuilderConfigInputs {
    env: Record<string, string | undefined>;
    readSettings: () => unknown;
    readSecrets: () => unknown;
}

export interface FuseConfig {
    runAsNode: boolean;
    enableNodeOptionsEnvironmentVariable: boolean;
    enableNodeCliInspectArguments: boolean;
    enableEmbeddedAsarIntegrityValidation: boolean;
    onlyLoadAppFromAsar: boolean;
    resetAdHocDarwinSignature: boolean;
}

export interface BuilderConfig {
    appId: string;
    extraMetadata: { kobarFlavor: DistFlavor; kobarAutoUpdate: boolean; version?: string };
    publish: { provider: string; owner: string; repo: string }[];
    asar: boolean;
    directories: { output: string; buildResources: string };
    files: string[];
    electronFuses: FuseConfig & Record<string, unknown>;
    win: { target: string[] };
    nsis: Record<string, unknown>;
    mac: Record<string, unknown>;
    appx?: {
        applicationId: string;
        identityName: string;
        publisher: string;
        publisherDisplayName: string;
        displayName: string;
        backgroundColor: string;
        capabilities: string[];
        addAutoLaunchExtension: boolean;
    };
}

export declare const APP_ID: string;
export declare const FLAVORS: readonly DistFlavor[];
export declare const ELECTRON_FUSES: Readonly<FuseConfig>;
export declare function createBuilderConfig(inputs: BuilderConfigInputs): BuilderConfig;
