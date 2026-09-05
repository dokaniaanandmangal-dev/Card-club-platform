import { formatSignedMinor, parseUnsignedMinor } from './minor-units.js';
import { settlementDigest, validateEpoch, validateIdentity } from './settlement-common.js';

export function computePrimarySettlement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('settlement:invalid_input');
  const tenantId = validateIdentity(input.tenantId, 'tenantId');
  const tableId = validateIdentity(input.tableId, 'tableId');
  const handId = validateIdentity(input.handId, 'handId');
  const epoch = validateEpoch(input.epoch);
  if (!Array.isArray(input.participants) || input.participants.length < 2 || input.participants.length > 64) {
    throw new Error('participants:invalid_count');
  }

  const seen = new Set();
  let net = 0n;
  const allocations = input.participants.map((participant, index) => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      throw new Error(`participant_${index}:invalid`);
    }
    const accountId = validateIdentity(participant.accountId, `participant_${index}.accountId`);
    if (seen.has(accountId)) throw new Error('participants:duplicate_account');
    seen.add(accountId);
    const opening = parseUnsignedMinor(participant.openingMinor, `participant_${index}.openingMinor`);
    const closing = parseUnsignedMinor(participant.closingMinor, `participant_${index}.closingMinor`);
    const delta = closing - opening;
    net += delta;
    return { accountId, deltaMinor: formatSignedMinor(delta) };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));

  if (net !== 0n) throw new Error('settlement:value_not_conserved');
  const digest = settlementDigest({ tenantId, tableId, handId, epoch, allocations });
  return Object.freeze({ tenantId, tableId, handId, epoch, allocations, digest });
}
