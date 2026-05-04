export type GovernanceState =
  | 'Verified'
  | 'Lagging'
  | 'Divergent'
  | 'Unverified'
  | 'Rebuilding';

export interface GraphNode {
  id: string;
  subject: string;
  predicate: string;
  objectValue: string;
  objectType: string;
  confidence: number;
  effectiveConfidence: number;
  governanceState: GovernanceState;
  tenant: string;
  validAt: string;
  createdAt: string;
  lastAccessed: string;
  certificateRef?: string;
  provenance?: ProvenanceEntry[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from';
  certificateRef?: string;
  confidence: number;
  createdAt: string;
}

export interface ProvenanceEntry {
  action: string;
  timestamp: string;
  agent?: string;
  details?: string;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  byGovernanceState: Record<GovernanceState, number>;
  avgConfidence: number;
  tenants: string[];
}

export interface NodeFilter {
  governanceState?: GovernanceState;
  tenant?: string;
  minConfidence?: number;
  limit?: number;
}

export interface QueryRequest {
  subject?: string;
  predicate?: string;
  governanceState?: GovernanceState;
  tenant?: string;
  minConfidence?: number;
  limit?: number;
}
