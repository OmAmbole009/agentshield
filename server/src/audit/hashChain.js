const crypto = require('node:crypto');

/**
 * Computes a deterministic SHA-256 hash for an audit entry chained with the previous entry's hash.
 */
function computeAuditHash({ id, timestamp, requestId, eventType, decision, reasonCode, payloadSummary, previousHash }) {
  const content = [
    id,
    timestamp,
    requestId,
    eventType,
    decision || '',
    reasonCode || '',
    payloadSummary || '',
    previousHash
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Validates the cryptographic integrity of the entire audit log hash chain.
 * Walks entries in chronological order and recalculates each hash.
 *
 * @param {Array<Object>} auditEntries - Array of rows ordered by rowid ASC
 * @returns {Object} { isChainValid, totalVerified, brokenAtIndex, brokenRecordId, details }
 */
function verifyHashChain(auditEntries) {
  if (!auditEntries || auditEntries.length === 0) {
    return {
      isChainValid: true,
      totalVerified: 0,
      details: 'Audit log is empty.'
    };
  }

  // Genesis record verification
  let expectedPrevHash = auditEntries[0].previous_hash;

  for (let i = 0; i < auditEntries.length; i++) {
    const entry = auditEntries[i];

    // Check if the chained previous hash matches the preceding entry's current hash
    if (i > 0 && entry.previous_hash !== expectedPrevHash) {
      return {
        isChainValid: false,
        totalVerified: i,
        brokenAtIndex: i,
        brokenRecordId: entry.id,
        details: `Previous hash mismatch at record ${entry.id}. Expected ${expectedPrevHash}, found ${entry.previous_hash}. Chain has been modified or severed.`
      };
    }

    // Recompute current hash
    const recomputedHash = computeAuditHash({
      id: entry.id,
      timestamp: entry.timestamp,
      requestId: entry.request_id,
      eventType: entry.event_type,
      decision: entry.decision,
      reasonCode: entry.reason_code,
      payloadSummary: entry.payload_summary,
      previousHash: entry.previous_hash
    });

    if (i > 0 && recomputedHash !== entry.current_hash) {
      return {
        isChainValid: false,
        totalVerified: i,
        brokenAtIndex: i,
        brokenRecordId: entry.id,
        details: `Cryptographic hash violation at record ${entry.id}. Data inside record has been tampered with.`
      };
    }

    expectedPrevHash = entry.current_hash;
  }

  return {
    isChainValid: true,
    totalVerified: auditEntries.length,
    latestHash: expectedPrevHash,
    details: `All ${auditEntries.length} audit trail blocks successfully verified against SHA-256 cryptographic chain.`
  };
}

module.exports = {
  computeAuditHash,
  verifyHashChain
};
