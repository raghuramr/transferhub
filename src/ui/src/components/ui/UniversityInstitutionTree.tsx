import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface University {
  id: number;
  name: string;
}

interface Institution {
  id: number;
  name: string;
  universityId: number;
}

/**
 * Tree widget for the Visibility Scope section of UserManagement.tsx.
 *
 * Each University is a top-level checkable row (bound to `universityIds`).
 * Expanding it shows its child Institutions (AcademicUnits), each
 * independently checkable (bound to `academicUnitIds`).
 *
 * Semantics (see CLAUDE.md / the task that introduced this component):
 * - Checking a University adds its id to `universityIds` and, as a
 *   convenience default, also checks (adds) all of its currently-known
 *   child Institutions into `academicUnitIds`.
 * - Checking/unchecking an individual Institution only ever touches
 *   `academicUnitIds` — it never changes `universityIds`.
 * - Unchecking a University removes only its own id from `universityIds`;
 *   it does NOT cascade-remove its child Institutions from
 *   `academicUnitIds` (non-destructive by design).
 * - `universityIds`/`academicUnitIds` remain two independent arrays, as
 *   required by the existing `PUT /users/:id/scope` contract.
 */
export function UniversityInstitutionTree({
  universities,
  institutions,
  universityIds,
  academicUnitIds,
  onChange,
}: {
  universities: University[];
  institutions: Institution[];
  universityIds: number[];
  academicUnitIds: number[];
  onChange: (next: { universityIds: number[]; academicUnitIds: number[] }) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (universityId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(universityId)) next.delete(universityId);
      else next.add(universityId);
      return next;
    });
  };

  const institutionsByUniversity = (universityId: number) =>
    institutions.filter((i) => i.universityId === universityId);

  const toggleUniversity = (universityId: number) => {
    const isChecked = universityIds.includes(universityId);
    if (isChecked) {
      // Uncheck: remove just the university id. Leave any
      // individually-checked child institutions as-is (non-destructive).
      onChange({
        universityIds: universityIds.filter((id) => id !== universityId),
        academicUnitIds,
      });
    } else {
      // Check: add the university id, and default-check all of its
      // currently-known child institutions too (convenience starting
      // point the admin can then individually restrict).
      const childIds = institutionsByUniversity(universityId).map((i) => i.id);
      const mergedAcademicUnitIds = Array.from(new Set([...academicUnitIds, ...childIds]));
      onChange({
        universityIds: [...universityIds, universityId],
        academicUnitIds: mergedAcademicUnitIds,
      });
    }
  };

  const toggleInstitution = (institutionId: number) => {
    const isChecked = academicUnitIds.includes(institutionId);
    onChange({
      universityIds,
      academicUnitIds: isChecked
        ? academicUnitIds.filter((id) => id !== institutionId)
        : [...academicUnitIds, institutionId],
    });
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Universities &amp; Institutions</label>
      <div className="border border-gray-300 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-50">
        {universities.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-400">None available</div>
        )}
        {universities.map((u) => {
          const children = institutionsByUniversity(u.id);
          const isExpanded = expanded.has(u.id);
          const isUniChecked = universityIds.includes(u.id);
          return (
            <div key={u.id}>
              <div className="flex items-center gap-1 px-2 py-2 text-sm hover:bg-gray-50">
                <button
                  type="button"
                  onClick={() => toggleExpanded(u.id)}
                  disabled={children.length === 0}
                  className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={isUniChecked}
                    onChange={() => toggleUniversity(u.id)}
                    className="rounded border-gray-300 text-brand-800 focus:ring-brand-500"
                  />
                  <span className={isUniChecked ? 'font-medium text-gray-900' : 'text-gray-700'}>{u.name}</span>
                  {children.length > 0 && (
                    <span className="text-xs text-gray-400">({children.length})</span>
                  )}
                </label>
              </div>
              {isExpanded && children.length > 0 && (
                <div className={isUniChecked ? '' : 'opacity-70'}>
                  {children.map((inst) => (
                    <label
                      key={inst.id}
                      className="flex items-center gap-2 pl-9 pr-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={academicUnitIds.includes(inst.id)}
                        onChange={() => toggleInstitution(inst.id)}
                        className="rounded border-gray-300 text-brand-800 focus:ring-brand-500"
                      />
                      {inst.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {universityIds.length === 0 && academicUnitIds.length === 0
          ? 'Unrestricted (sees everything)'
          : `Universities: ${universityIds.length} selected · Institutions: ${academicUnitIds.length} selected`}
      </p>
    </div>
  );
}
