export declare const FIXED_PUBLIC_FILES: string[];
export declare const PRIVATE_DEV_FILES: string[];
export declare const FORBIDDEN_PATTERNS: RegExp[];
export declare const EXTRACT_SCHEMA: string;
export declare const PRIVATE_SCHEMAS: string[];
export declare function isPrivateSchema(schema: unknown): boolean;
export declare function listPublicDataFiles(dataDir: string): string[];
