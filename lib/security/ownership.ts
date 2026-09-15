/**
 * Ownership validation helpers — architecture.md §11
 *
 * Rule: every service function that accepts an entity id must look it up
 * scoped by `user_id` (`WHERE id = $1 AND user_id = $2`), never by id alone.
 * This file centralises the pattern so route handlers never need to remember it.
 *
 * RLS is defense-in-depth underneath this layer, not a replacement.
 */

export function ownershipWhere(userId: string) {
  return { user_id: userId };
}

/**
 * Validate that a fetched row belongs to the user.
 * Returns true if row exists and user_id matches, otherwise false.
 * Callers should map false → 404 (not 403) to avoid leaking existence.
 */
export function isOwned(row: { user_id: string } | null, userId: string): boolean {
  return !!row && row.user_id === userId;
}
