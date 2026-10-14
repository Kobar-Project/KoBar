export interface DistArgs {
    flavor: 'store' | 'direct';
    builderArgs: string[];
}

export interface DistStep {
    command: string;
    args: string[];
    shell: boolean;
}

export interface DistPlanInputs {
    nodePath: string;
    npmCliPath: string | null;
    builderCliPath: string;
    configPath: string;
    env: Record<string, string | undefined>;
}

export declare function parseDistArgs(argv: string[]): DistArgs;
export declare function planDist(args: DistArgs, inputs: DistPlanInputs): { env: Record<string, string | undefined>; steps: DistStep[] };
