-- Indexes for three reads that had none to use.

-- The activity feed filters audit_events by entity and pages by createdAt DESC, and runs
-- a count() over the same predicate on every page load. Only (entity, entityId) and
-- (createdAt) existed, so the count scanned the table — the one that grows with every
-- non-GET request.
CREATE INDEX "audit_events_entity_createdAt_idx" ON "audit_events"("entity", "createdAt");

-- The notification bell: WHERE userId = $1 ORDER BY createdAt DESC LIMIT n.
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- Interior handover looks up a fit-out's installments by interiorProjectId.
CREATE INDEX "sale_payments_interiorProjectId_idx" ON "sale_payments"("interiorProjectId");
