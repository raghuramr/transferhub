import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  universitiesApi,
  institutionsApi,
  coursesApi,
  courseTopicsApi,
  usersApi,
} from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import type { Role, CourseTopic } from '../../types';

export interface MasterDataItem {
  id: number;
  label: string;
  sublabel?: string;
}

// ── Raw shapes returned by the master-data list endpoints ──────────
// (minimal — only the fields this cascade actually reads).
interface RawUniversity {
  id: number;
  name: string;
  code: string;
}

interface RawInstitution {
  id: number;
  name: string;
  code: string;
}

interface RawProgram {
  id: number;
  name: string;
  degree?: string;
  area?: string;
}

export interface RawExternalCourse {
  id: number;
  code: string;
  title: string;
  credits: number;
  programId?: number | null;
  institutionName?: string;
  institutionCode?: string;
}

interface CreatedRow {
  id: number;
}

interface MasterDataSelectProps {
  label: string;
  placeholder?: string;
  items: MasterDataItem[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown instead of the search box when the select has no parent chosen yet. */
  disabledHint?: string;
  /** Whether the logged-in role is allowed to POST a new row at this level (checked against the endpoint's own @Roles guard). */
  canCreate?: boolean;
  /** Minimal "name only" create — resolves to the new row's id, or throws/rejects on failure. */
  onCreate?: (name: string) => Promise<number>;
  creating?: boolean;
}

/**
 * Generic searchable single-select building block for the master-data
 * cascade (University -> Institution -> Program -> Course -> Topic).
 * Type-to-filter over `items`, plus an inline "+ Add new" row at the
 * bottom that only appears when `canCreate` is true — so a role that
 * can't POST to the underlying endpoint never sees a button that would
 * just 403.
 */
export function MasterDataSelect({
  label,
  placeholder = 'Search…',
  items,
  selectedId,
  onSelect,
  disabled,
  loading,
  disabledHint,
  canCreate,
  onCreate,
  creating,
}: MasterDataSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAddingNew(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = query.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  const handleCreate = async () => {
    if (!onCreate || !newName.trim()) return;
    setCreateError('');
    try {
      const id = await onCreate(newName.trim());
      onSelect(id);
      setNewName('');
      setAddingNew(false);
      setOpen(false);
      setQuery('');
    } catch {
      setCreateError('Could not create — please try again.');
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 border rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-brand-500 ${
          disabled ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed' : 'border-gray-300 bg-white'
        }`}
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {disabled
            ? disabledHint ?? 'Select the previous field first'
            : loading
              ? 'Loading…'
              : selected
                ? selected.label
                : placeholder}
        </span>
        <ChevronDown size={16} className="text-gray-400 shrink-0" />
      </button>

      {selected && !disabled && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="absolute right-8 top-9 text-gray-300 hover:text-gray-500"
          aria-label={`Clear ${label}`}
        >
          <X size={14} />
        </button>
      )}

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-100 p-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Type to search ${label.toLowerCase()}…`}
                className="w-full pl-8 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <ul>
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-brand-50 ${
                    item.id === selectedId ? 'bg-brand-50 text-brand-900 font-medium' : 'text-gray-700'
                  }`}
                >
                  {item.label}
                  {item.sublabel && <span className="block text-xs text-gray-400">{item.sublabel}</span>}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">No matches.</li>
            )}
          </ul>

          {canCreate && onCreate && (
            <div className="border-t border-gray-100 p-2">
              {!addingNew ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddingNew(true);
                    setNewName(query);
                  }}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 rounded"
                >
                  <Plus size={14} /> Add new {label.toLowerCase()}
                </button>
              ) : (
                <div className="p-1 space-y-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={`New ${label.toLowerCase()} name`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreate();
                      }
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {createError && <p className="text-xs text-red-600">{createError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAddingNew(false);
                        setCreateError('');
                      }}
                      className="flex-1 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={creating || !newName.trim()}
                      onClick={handleCreate}
                      className="flex-1 py-1.5 bg-brand-800 text-white rounded text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
                    >
                      {creating ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Role -> create-permission map ──────────────────────────────────
// Mirrors each endpoint's own @Roles() guard exactly, so "+ Add new" is
// only ever shown for a level the logged-in role can actually POST to:
//   - Universities  POST /universities        -> admin, super_admin
//   - Institutions  POST /institutions        -> admin, super_admin
//   - Courses       POST /courses             -> admin, super_admin
//   - Topics        POST /courses/:id/topics  -> admin, super_admin, faculty
//   - Programs      (no create endpoint exists at all — never offered)
const CAN_CREATE_UNIVERSITY: Role[] = ['admin', 'super_admin'];
const CAN_CREATE_INSTITUTION: Role[] = ['admin', 'super_admin'];
const CAN_CREATE_COURSE: Role[] = ['admin', 'super_admin'];
const CAN_CREATE_TOPIC: Role[] = ['admin', 'super_admin', 'faculty'];

export interface MasterDataSelection {
  universityId: number | null;
  institutionId: number | null;
  programId: number | null;
  courseId: number | null;
  topicId: number | null;
}

export const EMPTY_MASTER_DATA_SELECTION: MasterDataSelection = {
  universityId: null,
  institutionId: null,
  programId: null,
  courseId: null,
  topicId: null,
};

/**
 * Looks up the logged-in user's scope (`GET /users/:id/scope`) and reports
 * which University/Institution ids they're restricted to. Per the scope
 * convention used everywhere else in the app, no scope rows = unrestricted
 * (null = don't restrict/pre-select).
 */
function useScopeDefaults() {
  const { user } = useAuthStore();
  const { data } = useQuery({
    queryKey: ['my-scope', user?.id],
    queryFn: () => usersApi.getScope(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const scope = data?.data as { universityIds?: number[]; academicUnitIds?: number[] } | undefined;
  return {
    universityIds: scope?.universityIds?.length ? scope.universityIds : null,
    academicUnitIds: scope?.academicUnitIds?.length ? scope.academicUnitIds : null,
  };
}

interface CascadeProps {
  value: MasterDataSelection;
  onChange: (next: MasterDataSelection) => void;
  /** Hide the Topic level entirely (e.g. when the consuming form has no use for it). */
  includeTopic?: boolean;
  /**
   * How far down the chain to render — lets a form use this component for
   * just the "which external institution" part (University/Institution/
   * Program) while picking Course (and optionally Topic) per-row itself,
   * via the `useCourseCatalog`/`useTopicCatalog` hooks below.
   */
  through?: 'institution' | 'program' | 'course' | 'topic';
  /** Apply the logged-in user's scope as a hard filter on University/Institution options, not just a default. */
  restrictToScope?: boolean;
}

/** Course options for a given University (by id) + optional Program filter — shared by the main cascade and any per-row Course picker (e.g. one row per transcript course). */
export function useCourseCatalog(universityId: number | null, programId?: number | null) {
  const universitiesQuery = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const universityCode = ((universitiesQuery.data?.data as RawUniversity[]) ?? []).find((u) => u.id === universityId)?.code;
  const coursesQuery = useQuery({
    queryKey: ['md-courses', universityId, programId],
    queryFn: () => coursesApi.listExternal(universityCode),
    enabled: !!universityId && !!universityCode,
  });
  const raw: RawExternalCourse[] = (coursesQuery.data?.data as RawExternalCourse[]) ?? [];
  const courses: MasterDataItem[] = raw
    .filter((c) => !programId || c.programId === programId)
    .map((c) => ({ id: c.id, label: `${c.code} — ${c.title}`, sublabel: `${c.credits} credits` }));
  return { courses, raw, isLoading: coursesQuery.isLoading };
}

/** Topic options for a given Course — read-only informational reference, never required. */
export function useTopicCatalog(courseId: number | null) {
  const topicsQuery = useQuery({
    queryKey: ['md-topics', courseId],
    queryFn: () => courseTopicsApi.list(courseId!),
    enabled: !!courseId,
  });
  const topics: MasterDataItem[] = ((topicsQuery.data?.data as CourseTopic[]) ?? []).map((t) => ({ id: t.id, label: t.title }));
  return { topics, isLoading: topicsQuery.isLoading };
}

/**
 * The full University -> Institution -> Program -> Course -> Topic
 * cascading-select chain, built from the generic `MasterDataSelect`.
 * Each level depends on the previous one's id (disabled/empty until its
 * parent is chosen), except University which is the root. Defaults to
 * the logged-in user's scope-visibility when they have scope rows.
 */
export function MasterDataCascade({ value, onChange, includeTopic = true, through = 'topic', restrictToScope = false }: CascadeProps) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const role = user?.role;
  const scope = useScopeDefaults();
  const appliedScopeDefault = useRef(false);
  const showProgram = through === 'program' || through === 'course' || through === 'topic';
  const showCourse = through === 'course' || through === 'topic';
  const showTopic = includeTopic && through === 'topic';

  const universitiesQuery = useQuery({
    queryKey: ['md-universities'],
    queryFn: () => universitiesApi.list({ isActive: true }),
  });
  let universities: MasterDataItem[] = ((universitiesQuery.data?.data as RawUniversity[]) ?? []).map((u) => ({
    id: u.id,
    label: u.name,
    sublabel: u.code,
  }));
  if (scope.universityIds && restrictToScope) {
    universities = universities.filter((u) => scope.universityIds!.includes(u.id));
  }

  // Default-select from scope once, the first time universities load.
  useEffect(() => {
    if (appliedScopeDefault.current) return;
    if (!scope.universityIds || value.universityId) return;
    if (universities.length === 0) return;
    appliedScopeDefault.current = true;
    onChange({ ...EMPTY_MASTER_DATA_SELECTION, universityId: scope.universityIds[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.universityIds, universities.length]);

  const institutionsQuery = useQuery({
    queryKey: ['md-institutions', value.universityId],
    queryFn: () => institutionsApi.list({ universityId: value.universityId!, isActive: true }),
    enabled: !!value.universityId,
  });
  let institutions: MasterDataItem[] = ((institutionsQuery.data?.data as RawInstitution[]) ?? []).map((i) => ({
    id: i.id,
    label: i.name,
    sublabel: i.code,
  }));
  if (scope.academicUnitIds && restrictToScope) {
    institutions = institutions.filter((i) => scope.academicUnitIds!.includes(i.id));
  }

  const appliedInstitutionDefault = useRef(false);
  useEffect(() => {
    if (appliedInstitutionDefault.current) return;
    if (!scope.academicUnitIds || value.institutionId) return;
    if (institutions.length === 0) return;
    const match = institutions.find((i) => scope.academicUnitIds!.includes(i.id));
    if (!match) return;
    appliedInstitutionDefault.current = true;
    onChange({ ...value, institutionId: match.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.academicUnitIds, institutions.length, value.universityId]);

  // Programs and Courses hang off the University level in this schema
  // (Courses.InstitutionId / Programs.InstitutionId both reference the SQL
  // `Institutions` table, i.e. what this UI calls "University" — see
  // courses.service.ts findExternalCourses/findPrograms). The AcademicUnit
  // ("Institution") level is informational/scoping only here, so it does
  // not gate Program/Course the way University does.
  const programsQuery = useQuery({
    queryKey: ['md-programs', value.universityId],
    queryFn: () => coursesApi.programs(value.universityId!),
    enabled: showProgram && !!value.universityId,
  });
  const programs: MasterDataItem[] = ((programsQuery.data?.data as RawProgram[]) ?? []).map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: [p.degree, p.area].filter(Boolean).join(' · ') || undefined,
  }));

  // Courses are keyed by University code in this API (not id) — resolve it
  // from the University list we already have.
  const selectedUniversityRaw = ((universitiesQuery.data?.data as RawUniversity[]) ?? []).find(
    (u) => u.id === value.universityId,
  );
  const coursesQuery = useQuery({
    queryKey: ['md-courses', value.universityId, value.programId],
    queryFn: () => coursesApi.listExternal(selectedUniversityRaw?.code),
    enabled: showCourse && !!value.universityId && !!selectedUniversityRaw,
  });
  const courses: MasterDataItem[] = ((coursesQuery.data?.data as RawExternalCourse[]) ?? [])
    .filter((c) => !value.programId || c.programId === value.programId)
    .map((c) => ({ id: c.id, label: `${c.code} — ${c.title}`, sublabel: `${c.credits} credits` }));

  const topicsQuery = useQuery({
    queryKey: ['md-topics', value.courseId],
    queryFn: () => courseTopicsApi.list(value.courseId!),
    enabled: showTopic && !!value.courseId,
  });
  const topics: MasterDataItem[] = ((topicsQuery.data?.data as CourseTopic[]) ?? []).map((t) => ({
    id: t.id,
    label: t.title,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MasterDataSelect
        label="University"
        placeholder="Select a university…"
        items={universities}
        selectedId={value.universityId}
        loading={universitiesQuery.isLoading}
        onSelect={(id) => onChange({ ...EMPTY_MASTER_DATA_SELECTION, universityId: id })}
        canCreate={!!role && CAN_CREATE_UNIVERSITY.includes(role)}
        onCreate={async (name) => {
          const res = await universitiesApi.create({ name, code: name.slice(0, 10).toUpperCase().replace(/\s+/g, '') });
          await qc.invalidateQueries({ queryKey: ['md-universities'] });
          return (res.data as CreatedRow).id;
        }}
      />

      <MasterDataSelect
        label="Institution"
        placeholder="Select an institution…"
        items={institutions}
        selectedId={value.institutionId}
        disabled={!value.universityId}
        loading={institutionsQuery.isLoading}
        onSelect={(id) => onChange({ ...value, institutionId: id })}
        canCreate={!!role && CAN_CREATE_INSTITUTION.includes(role)}
        onCreate={async (name) => {
          const res = await institutionsApi.create({ name, universityId: value.universityId });
          await qc.invalidateQueries({ queryKey: ['md-institutions', value.universityId] });
          return (res.data as CreatedRow).id;
        }}
      />

      {showProgram && (
        <MasterDataSelect
          label="Program"
          placeholder="Select a program… (optional)"
          items={programs}
          selectedId={value.programId}
          disabled={!value.universityId}
          loading={programsQuery.isLoading}
          onSelect={(id) => onChange({ ...value, programId: id, courseId: null, topicId: null })}
          canCreate={false}
        />
      )}

      {showCourse && (
        <MasterDataSelect
          label="Course"
          placeholder="Select a course…"
          items={courses}
          selectedId={value.courseId}
          disabled={!value.universityId}
          loading={coursesQuery.isLoading}
          onSelect={(id) => onChange({ ...value, courseId: id, topicId: null })}
          canCreate={!!role && CAN_CREATE_COURSE.includes(role)}
          onCreate={async (name) => {
            const [code, ...rest] = name.split(' ');
            const title = rest.join(' ') || name;
            const res = await coursesApi.create({
              institutionId: value.universityId,
              programId: value.programId ?? undefined,
              code: code || name,
              title,
              credits: 4,
            });
            await qc.invalidateQueries({ queryKey: ['md-courses', value.universityId, value.programId] });
            return (res.data as CreatedRow).id;
          }}
        />
      )}

      {showTopic && (
        <MasterDataSelect
          label="Topic"
          placeholder="Select a topic… (optional)"
          items={topics}
          selectedId={value.topicId}
          disabled={!value.courseId}
          loading={topicsQuery.isLoading}
          onSelect={(id) => onChange({ ...value, topicId: id })}
          canCreate={!!role && CAN_CREATE_TOPIC.includes(role)}
          onCreate={async (title) => {
            const res = await courseTopicsApi.create(value.courseId!, { title });
            await qc.invalidateQueries({ queryKey: ['md-topics', value.courseId] });
            return (res.data as CreatedRow).id;
          }}
        />
      )}
    </div>
  );
}
