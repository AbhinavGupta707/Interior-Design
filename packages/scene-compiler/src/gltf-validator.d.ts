declare module "gltf-validator" {
  export interface ValidatorMessage {
    readonly code: string;
    readonly message: string;
    readonly pointer?: string;
    readonly severity: number;
  }

  export interface ValidatorReport {
    readonly issues: {
      readonly messages: readonly ValidatorMessage[];
      readonly numErrors: number;
      readonly numHints: number;
      readonly numInfos: number;
      readonly numWarnings: number;
      readonly truncated: boolean;
    };
  }

  export interface ValidationOptions {
    readonly format?: "glb" | "gltf";
    readonly maxIssues?: number;
    readonly uri?: string;
    readonly writeTimestamp?: boolean;
  }

  export function validateBytes(
    data: Uint8Array,
    options?: ValidationOptions,
  ): Promise<ValidatorReport>;
  export function version(): string;
}
