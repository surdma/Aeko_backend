export type CapabilityKind =
  'rest' | 'socket' | 'job' | 'model' | 'provider' | 'inactive';

export type MigrationStatus =
  'legacy' | 'planned' | 'implemented' | 'verified' | 'inactive';

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
}

export interface CapabilityBase {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly source: SourceLocation;
  readonly owner: string;
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
  readonly status: MigrationStatus;
}

export interface RestCapability extends CapabilityBase {
  readonly kind: 'rest';
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly mountPath: string;
  readonly routePath: string;
  readonly effectivePath: string;
  readonly middleware: readonly string[];
  readonly declarationOrder: number;
  readonly shadowed: boolean;
}

export interface SocketCapability extends CapabilityBase {
  readonly kind: 'socket';
  readonly namespace: '/' | '/livestream';
  readonly direction: 'inbound' | 'outbound';
  readonly event: string;
}

export interface JobCapability extends CapabilityBase {
  readonly kind: 'job';
  readonly name: string;
  readonly schedule: string;
}

export interface ModelCapability extends CapabilityBase {
  readonly kind: 'model';
  readonly declarationKind: 'model' | 'enum';
  readonly name: string;
}

export interface ProviderCapability extends CapabilityBase {
  readonly kind: 'provider';
  readonly provider: string;
  readonly importPath: string;
}

export interface InactiveCapability extends CapabilityBase {
  readonly kind: 'inactive';
  readonly reason: 'route-module-not-mounted';
}

export type Capability =
  | RestCapability
  | SocketCapability
  | JobCapability
  | ModelCapability
  | ProviderCapability
  | InactiveCapability;

export interface Correction {
  readonly id: string;
  readonly capabilityIds: readonly string[];
  readonly category: 'security' | 'correctness' | 'runtime';
  readonly legacyEvidence: readonly SourceLocation[];
  readonly legacyBehavior: string;
  readonly replacementBehavior: string;
  readonly reason: string;
  readonly status: 'approved' | 'implemented' | 'verified';
}

export interface UnresolvedDiagnostic {
  readonly category: 'mount' | 'route' | 'socket' | 'job' | 'correction';
  readonly source: SourceLocation;
  readonly expression: string;
  readonly reason: string;
}

export interface DuplicateRouteDiagnostic {
  readonly method: RestCapability['method'];
  readonly effectivePath: string;
  readonly capabilityIds: readonly string[];
}

export interface CapabilityInventory {
  readonly schemaVersion: 1;
  readonly sourceRoot: string;
  readonly sources: {
    readonly server: 'server.js';
    readonly prismaSchema: 'prisma/schema.prisma';
    readonly mountedRouterModules: readonly string[];
    readonly socketFiles: readonly string[];
    readonly jobFiles: readonly string[];
  };
  readonly capabilities: readonly Capability[];
  readonly corrections: readonly Correction[];
  readonly diagnostics: {
    readonly unresolved: readonly UnresolvedDiagnostic[];
    readonly duplicateRoutes: readonly DuplicateRouteDiagnostic[];
  };
}
