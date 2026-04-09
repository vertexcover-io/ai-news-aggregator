export interface Violation {
  invariant: string;
  file: string;
  line?: number;
  message: string;
}

export interface InvariantContext {
  cwd: string;
}

export interface InvariantResult {
  violations: Violation[];
}
