// Writes that must happen together. Services build statements with the
// repositories and hand them to a Transaction, so they depend on this
// interface rather than on Cloudflare D1 (dependency inversion).

// One prepared write (or read), built by a repository.
export type Statement = D1PreparedStatement;

export interface Transaction {
  // Runs the statements in order, all or nothing.
  run(statements: Statement[]): Promise<unknown>;
}

// D1's batch() is atomic: every statement succeeds, or none is applied.
export class D1Transaction implements Transaction {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  run(statements: Statement[]): Promise<unknown> { return this.db.batch(statements); }
}
