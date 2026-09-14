import type { Queryable } from '../db/client.js';

/**
 * Append-only audit trail for privileged and security-relevant actions
 * (spec §52, §88). Written in the service context so a user cannot suppress
 * a record of what they did.
 */
export interface AuditEntry {
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAudit(tx: Queryable, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ipAddress ?? null,
    ],
  );
}
