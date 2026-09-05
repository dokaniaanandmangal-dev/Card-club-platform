import { formatSignedMinor, parseUnsignedMinor } from './minor-units.js';
import { settlementDigest, validateEpoch, validateIdentity } from './settlement-common.js';

// Deliberately independent economic computation: total opening/closing is checked
// separately, then sorted account records are differenced in a second pass.
export function computeShadowSettlement(input) {
  if (Object.prototype.toString.call(input) !== '[object Object]') throw new Error('shadow:invalid_input');
  const tenantId = validateIdentity(input.tenantId, 'tenantId');
  const tableId = validateIdentity(input.tableId, 'tableId');
  const handId = validateIdentity(input.handId, 'handId');
  const epoch = validateEpoch(input.epoch);
  if (!Array.isArray(input.participants) || input.participants.length < 2 || input.participants.length > 64) {
    throw new Error('participants:invalid_count');
  }

  const rows = [];
  const unique = new Set();
  let openingTotal = 0n;
  let closingTotal = 0n;

  for (let i = 0; i < input.participants.length; i += 1) {
    const participant = input.participants[i];
    if (Object.prototype.toString.call(participant) !== '[object Object]') throw new Error(`participant_${i}:invalid`);
    const accountId = validateIdentity(participant.accountId, `participant_${i}.accountId`);
    if (unique.has(accountId)) throw new Error('participants:duplicate_account');
    unique.add(accountId);
    const opening = parseUnsignedMinor(participant.openingMinor, `participant_${i}.openingMinor`);
    const closing = parseUnsignedMinor(participant.closingMinor, `participant_${i}.closingMinor`);
    openingTotal += opening;
    closingTotal += closing;
    rows.push({ accountId, opening, closing });
  }

  if (openingTotal !== closingTotal) throw new Error('settlement:value_not_conserved');
  rows.sort((left, right) => left.accountId.localeCompare(right.accountId));
  const allocations = [];
  for (const row of rows) {
    allocations.push({ accountId: row.accountId, deltaMinor: formatSignedMinor(row.closing - row.opening) });
  }

  const digest = settlementDigest({ tenantId, tableId, handId, epoch, allocations });
  return Object.freeze({ tenantId, tableId, handId, epoch, allocations, digest });
}
