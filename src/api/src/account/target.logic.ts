/** Pure rules for choosing a transfer target (no DB), unit-tested in scripts/test-target-logic.ts. */

export interface TargetUniversity { id: number; code: string; type: string; isActive: boolean }
export interface TargetProgram { id: number; isActive: boolean; offeredAt: number[] }

/** Community colleges (BSCC / PVTC) are sources, never receiving universities. */
const SOURCE_ONLY_CODES = ['BSCC', 'PVTC'];

export function isSelectableUniversity(u: Pick<TargetUniversity, 'code' | 'type' | 'isActive'>): boolean {
  return !!u.isActive && u.type === 'university' && !SOURCE_ONLY_CODES.includes((u.code ?? '').toUpperCase());
}

export type TargetCheck = { ok: true } | { ok: false; error: string };

export function validateTarget(uni: TargetUniversity | null | undefined, program: TargetProgram | null | undefined, programRequested: boolean): TargetCheck {
  if (!uni) return { ok: false, error: 'That university was not found.' };
  if (!isSelectableUniversity(uni)) return { ok: false, error: 'That institution is not an active receiving university.' };
  if (programRequested) {
    if (!program) return { ok: false, error: 'That program was not found.' };
    if (!program.isActive) return { ok: false, error: 'That program is no longer active.' };
    if (!program.offeredAt.includes(uni.id)) return { ok: false, error: 'That program is not offered by the selected university.' };
  }
  return { ok: true };
}

/** The intended school/college only stays when it belongs to the new target university. */
export function keepIntendedUnit(unitInstitutionId: number | null | undefined, targetInstitutionId: number): boolean {
  return unitInstitutionId != null && unitInstitutionId === targetInstitutionId;
}
