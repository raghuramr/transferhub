import { BadRequestException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import type { ImportPayloadDto } from './dto/import-payload.dto';

export type EntityType = 'universities' | 'programs' | 'courses';
export const ENTITY_ORDER: EntityType[] = ['universities', 'programs', 'courses'];

export interface RowCheck {
  status: 'valid' | 'warning' | 'error';
  messages: string[];
  action: 'create' | 'update' | 'skip';
}

export interface ApplyResult {
  outcome: 'created' | 'updated';
  message: string;
}

/** What else is arriving in the same submission, so a row may depend on it. */
export interface PendingRefs {
  universities: Set<string>;
  programs: Set<string>; // `${UNIVERSITYCODE}|${program name lower}`
}

export interface CheckOptions {
  /** A partner may only submit data for its own university code. */
  scopeCode?: string;
  pending?: PendingRefs;
}

type Raw = Record<string, unknown>;

const KNOWN_FIELDS: Record<EntityType, string[]> = {
  universities: ['code', 'name', 'type', 'calendar', 'website'],
  programs: ['universityCode', 'name', 'area', 'degree', 'school', 'description', 'website'],
  courses: [
    'universityCode', 'code', 'name', 'title', 'credits', 'programName', 'department', 'level',
    'requirementType', 'description', 'learningOutcomes', 'source', 'topics',
  ],
};

export const FORMAT_DOC = {
  types: ENTITY_ORDER,
  notes: [
    'Send universities first or together with the programs/courses that depend on them; order inside one submission does not matter.',
    'Codes are matched case-insensitively. A row whose code already exists updates that record; otherwise it creates a new one.',
    'Nothing is written to the live catalogue until a TransferHub administrator reviews and imports the rows.',
  ],
  schemas: {
    universities: {
      description: 'A university or college.',
      requiredFields: ['code', 'name'],
      optionalFields: ['type (university | community_college)', 'calendar (semester | quarter)', 'website'],
      example: { code: 'MIT', name: 'Massachusetts Institute of Technology', type: 'university', calendar: 'semester', website: 'https://catalog.mit.edu' },
    },
    programs: {
      description: 'A degree program offered by a university.',
      requiredFields: ['universityCode', 'name'],
      optionalFields: ['area', 'degree (max 10 chars, e.g. BS)', 'school', 'description', 'website'],
      example: { universityCode: 'MIT', name: 'Computer Science', area: 'Computer Science', degree: 'BS', school: 'School of Engineering' },
    },
    courses: {
      description: 'A course, with optional syllabus topics (used by the AI matcher).',
      requiredFields: ['universityCode', 'code', 'name', 'credits'],
      optionalFields: ['programName', 'department', 'level (intro | lower | upper)', 'requirementType', 'description', 'learningOutcomes', 'source', 'topics'],
      example: {
        universityCode: 'MIT', code: '6.0001', name: 'Introduction to Computer Science and Programming', credits: 3,
        programName: 'Computer Science', level: 'intro', description: 'Fundamentals of programming.',
        topics: [{ title: 'Variables and data types', description: 'Basic types', referenceLinks: [{ label: 'Syllabus', url: 'https://example.edu/syllabus.pdf' }] }],
      },
    },
  },
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const key = (v: string) => v.trim().toLowerCase();
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

/** Per-run lookup cache so validating/applying thousands of rows does not mean thousands of queries. */
class Lookups {
  private inst = new Map<string, { id: number } | null>();
  private programs = new Map<number, Map<string, number>>();
  private courses = new Map<number, Map<string, number>>();

  constructor(private db: DatabaseService) {}

  async institution(code: string): Promise<{ id: number } | null> {
    const k = key(code);
    if (!this.inst.has(k)) {
      const r = await this.db.query<{ Id: number }>(`SELECT Id FROM Institutions WHERE Code = @c`, [
        { name: 'c', type: sql.VarChar(20), value: code.trim() },
      ]);
      this.inst.set(k, r.recordset[0] ? { id: r.recordset[0].Id } : null);
    }
    return this.inst.get(k) ?? null;
  }
  setInstitution(code: string, id: number) {
    this.inst.set(key(code), { id });
  }

  async programId(instId: number, name: string): Promise<number | null> {
    let m = this.programs.get(instId);
    if (!m) {
      const r = await this.db.query<{ Id: number; Name: string }>(`SELECT Id, Name FROM Programs WHERE InstitutionId = @i`, [
        { name: 'i', type: sql.Int, value: instId },
      ]);
      m = new Map(r.recordset.map((p) => [key(p.Name), p.Id]));
      this.programs.set(instId, m);
    }
    return m.get(key(name)) ?? null;
  }
  setProgram(instId: number, name: string, id: number) {
    this.programs.get(instId)?.set(key(name), id);
  }

  async courseId(instId: number, code: string): Promise<number | null> {
    let m = this.courses.get(instId);
    if (!m) {
      const r = await this.db.query<{ Id: number; Code: string }>(`SELECT Id, Code FROM Courses WHERE InstitutionId = @i`, [
        { name: 'i', type: sql.Int, value: instId },
      ]);
      m = new Map(r.recordset.map((c) => [key(c.Code), c.Id]));
      this.courses.set(instId, m);
    }
    return m.get(key(code)) ?? null;
  }
  setCourse(instId: number, code: string, id: number) {
    this.courses.get(instId)?.set(key(code), id);
  }
}

@Injectable()
export class ImportService {
  constructor(private db: DatabaseService) {}

  newLookups() {
    return new Lookups(this.db);
  }

  // ── validation ────────────────────────────────────────────────

  /** Checks one row and says what importing it would do. Never writes. */
  async checkRow(type: EntityType, raw: Raw, lookups: Lookups, opts: CheckOptions = {}): Promise<RowCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unknown = Object.keys(raw).filter((k) => !KNOWN_FIELDS[type].includes(k));
    if (unknown.length) warnings.push(`Ignored unknown field(s): ${unknown.join(', ')}`);

    const need = (field: string, v: string, max: number) => {
      if (!v) errors.push(`${field} is required`);
      else if (v.length > max) errors.push(`${field} is longer than ${max} characters`);
    };
    const opt = (field: string, v: string, max: number) => {
      if (v && v.length > max) errors.push(`${field} is longer than ${max} characters`);
    };
    const scope = (code: string) => {
      if (opts.scopeCode && code && key(code) !== key(opts.scopeCode)) {
        errors.push(`universityCode "${code}" is outside your allowed university (${opts.scopeCode})`);
      }
    };

    let action: RowCheck['action'] = 'create';

    if (type === 'universities') {
      const code = str(raw.code);
      need('code', code, 20);
      need('name', str(raw.name), 200);
      scope(code);
      if (raw.type && !['university', 'community_college'].includes(str(raw.type))) errors.push('type must be university or community_college');
      if (raw.calendar && !['semester', 'quarter'].includes(str(raw.calendar))) errors.push('calendar must be semester or quarter');
      if (raw.website && !isUrl(str(raw.website))) warnings.push('website is not a valid http(s) URL');
      opt('website', str(raw.website), 500);
      if (code && (await lookups.institution(code))) action = 'update';
    } else if (type === 'programs') {
      const code = str(raw.universityCode) || opts.scopeCode || '';
      const name = str(raw.name);
      need('universityCode', code, 20);
      need('name', name, 200);
      opt('area', str(raw.area), 100);
      opt('degree', str(raw.degree), 10);
      opt('school', str(raw.school), 200);
      scope(code);
      if (code) {
        const inst = await lookups.institution(code);
        if (!inst) {
          if (opts.pending?.universities.has(key(code))) warnings.push(`University "${code}" will exist once its row in this submission is imported`);
          else errors.push(`University "${code}" does not exist and is not part of this submission`);
        } else if (name && (await lookups.programId(inst.id, name))) action = 'update';
      }
    } else {
      const code = str(raw.universityCode) || opts.scopeCode || '';
      const ccode = str(raw.code);
      const title = str(raw.name) || str(raw.title);
      need('universityCode', code, 20);
      need('code', ccode, 30);
      need('name', title, 300);
      opt('department', str(raw.department), 100);
      opt('requirementType', str(raw.requirementType), 100);
      opt('source', str(raw.source), 500);
      scope(code);
      const credits = Number(raw.credits);
      if (raw.credits === undefined || raw.credits === null || raw.credits === '') errors.push('credits is required');
      else if (!Number.isFinite(credits) || credits <= 0 || credits > 30) errors.push('credits must be a number between 0 and 30');
      if (raw.level && !['intro', 'lower', 'upper'].includes(str(raw.level))) errors.push('level must be intro, lower or upper');
      if (raw.topics !== undefined && !Array.isArray(raw.topics)) errors.push('topics must be a list');
      if (Array.isArray(raw.topics)) {
        if (raw.topics.length > 200) errors.push('a course may have at most 200 topics');
        raw.topics.forEach((t: Raw, i: number) => {
          if (!t || !str(t.title)) errors.push(`topic ${i + 1} needs a title`);
          else if (str(t.title).length > 200) errors.push(`topic ${i + 1} title is longer than 200 characters`);
          const links = t?.referenceLinks;
          if (links !== undefined && (!Array.isArray(links) || links.some((l: Raw) => !l || !isUrl(str(l.url)) || !str(l.label)))) {
            errors.push(`topic ${i + 1} referenceLinks must be a list of {label, url} with http(s) URLs`);
          }
        });
      }
      if (code) {
        const inst = await lookups.institution(code);
        if (!inst) {
          if (opts.pending?.universities.has(key(code))) warnings.push(`University "${code}" will exist once its row in this submission is imported`);
          else errors.push(`University "${code}" does not exist and is not part of this submission`);
        } else {
          if (ccode && (await lookups.courseId(inst.id, ccode))) action = 'update';
          const pname = str(raw.programName);
          if (pname && !(await lookups.programId(inst.id, pname)) && !opts.pending?.programs.has(`${key(code)}|${key(pname)}`)) {
            warnings.push(`Program "${pname}" not found - the course will have no program link`);
          }
        }
      }
    }

    if (errors.length) return { status: 'error', messages: [...errors, ...warnings], action: 'skip' };
    return { status: warnings.length ? 'warning' : 'valid', messages: warnings, action };
  }

  /** Builds the dependency hints for a set of rows (what the same submission itself provides). */
  pendingRefs(rows: { type: EntityType; payload: Raw }[]): PendingRefs {
    const refs: PendingRefs = { universities: new Set(), programs: new Set() };
    for (const r of rows) {
      if (r.type === 'universities' && str(r.payload.code)) refs.universities.add(key(str(r.payload.code)));
      if (r.type === 'programs' && str(r.payload.name)) {
        refs.programs.add(`${key(str(r.payload.universityCode))}|${key(str(r.payload.name))}`);
      }
    }
    return refs;
  }

  // ── applying ──────────────────────────────────────────────────

  /** Writes one row to the live tables. Throws a readable Error if it cannot. */
  async applyRow(type: EntityType, raw: Raw, lookups: Lookups, scopeCode?: string): Promise<ApplyResult> {
    if (type === 'universities') return this.applyUniversity(raw, lookups);
    if (type === 'programs') return this.applyProgram(raw, lookups, scopeCode);
    return this.applyCourse(raw, lookups, scopeCode);
  }

  private async applyUniversity(raw: Raw, lookups: Lookups): Promise<ApplyResult> {
    const code = str(raw.code);
    const existing = await lookups.institution(code);
    const inputs = [
      { name: 'name', type: sql.NVarChar(200), value: str(raw.name) },
      { name: 'type', type: sql.VarChar(30), value: str(raw.type) || null },
      { name: 'cal', type: sql.VarChar(10), value: str(raw.calendar) || null },
      { name: 'src', type: sql.NVarChar(500), value: str(raw.website) || null },
      { name: 'code', type: sql.VarChar(20), value: code },
    ];
    if (existing) {
      await this.db.query(
        `UPDATE Institutions SET Name = @name, Type = COALESCE(@type, Type), Calendar = COALESCE(@cal, Calendar), Source = COALESCE(@src, Source)
         WHERE Id = ${existing.id}`,
        inputs,
      );
      return { outcome: 'updated', message: `Updated university ${code}` };
    }
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO Institutions (Code, Name, Type, Calendar, Source, IsBU, IsActive)
       OUTPUT inserted.Id
       VALUES (@code, @name, COALESCE(@type, 'university'), COALESCE(@cal, 'semester'), @src, 0, 1)`,
      inputs,
    );
    lookups.setInstitution(code, res.recordset[0].Id);
    return { outcome: 'created', message: `Created university ${code}` };
  }

  private async applyProgram(raw: Raw, lookups: Lookups, scopeCode?: string): Promise<ApplyResult> {
    const code = str(raw.universityCode) || scopeCode || '';
    const inst = await lookups.institution(code);
    if (!inst) throw new Error(`University "${code}" does not exist yet - import its row first`);
    const name = str(raw.name);
    const existingId = await lookups.programId(inst.id, name);
    const inputs = [
      { name: 'area', type: sql.NVarChar(100), value: str(raw.area) || null },
      { name: 'name', type: sql.NVarChar(200), value: name },
      { name: 'degree', type: sql.VarChar(10), value: str(raw.degree) || null },
      { name: 'school', type: sql.NVarChar(200), value: str(raw.school) || null },
      { name: 'notes', type: sql.NVarChar(sql.MAX), value: str(raw.description) || null },
      { name: 'src', type: sql.NVarChar(500), value: str(raw.website) || null },
      { name: 'inst', type: sql.Int, value: inst.id },
    ];
    let id: number;
    let outcome: ApplyResult['outcome'];
    if (existingId) {
      id = existingId;
      await this.db.query(
        `UPDATE Programs SET Area = COALESCE(@area, Area), Degree = COALESCE(@degree, Degree), School = COALESCE(@school, School),
                Notes = COALESCE(@notes, Notes), Source = COALESCE(@src, Source), UpdatedAt = SYSUTCDATETIME()
         WHERE Id = ${id}`,
        inputs,
      );
      outcome = 'updated';
    } else {
      const res = await this.db.query<{ Id: number }>(
        `INSERT INTO Programs (InstitutionId, Area, Name, Degree, School, Notes, Source, IsActive)
         OUTPUT inserted.Id
         VALUES (@inst, LEFT(COALESCE(@area, @name), 100), @name, @degree, @school, @notes, @src, 1)`,
        inputs,
      );
      id = res.recordset[0].Id;
      lookups.setProgram(inst.id, name, id);
      outcome = 'created';
    }
    // The owning university must also be in ProgramUniversities (that is how "who offers this program" is read).
    await this.db.query(
      `IF NOT EXISTS (SELECT 1 FROM ProgramUniversities WHERE ProgramId = @p AND InstitutionId = @i)
         INSERT INTO ProgramUniversities (ProgramId, InstitutionId) VALUES (@p, @i)`,
      [
        { name: 'p', type: sql.Int, value: id },
        { name: 'i', type: sql.Int, value: inst.id },
      ],
    );
    return { outcome, message: `${outcome === 'created' ? 'Created' : 'Updated'} program ${name} (${code})` };
  }

  private async applyCourse(raw: Raw, lookups: Lookups, scopeCode?: string): Promise<ApplyResult> {
    const ucode = str(raw.universityCode) || scopeCode || '';
    const inst = await lookups.institution(ucode);
    if (!inst) throw new Error(`University "${ucode}" does not exist yet - import its row first`);
    const code = str(raw.code);
    const title = str(raw.name) || str(raw.title);
    const pname = str(raw.programName);
    const programId = pname ? await lookups.programId(inst.id, pname) : null;
    const existingId = await lookups.courseId(inst.id, code);

    const inputs = [
      { name: 'title', type: sql.NVarChar(300), value: title },
      { name: 'credits', type: sql.Decimal(5, 2), value: Number(raw.credits) },
      { name: 'desc', type: sql.NVarChar(sql.MAX), value: str(raw.description) || null },
      { name: 'area', type: sql.NVarChar(100), value: str(raw.department) || null },
      { name: 'prog', type: sql.Int, value: programId },
      { name: 'level', type: sql.VarChar(20), value: str(raw.level) || null },
      { name: 'req', type: sql.NVarChar(100), value: str(raw.requirementType) || null },
      { name: 'outc', type: sql.NVarChar(sql.MAX), value: str(raw.learningOutcomes) || null },
      { name: 'src', type: sql.NVarChar(500), value: str(raw.source) || null },
      { name: 'inst', type: sql.Int, value: inst.id },
      { name: 'code', type: sql.NVarChar(30), value: code },
    ];
    let courseId: number;
    let outcome: ApplyResult['outcome'];
    if (existingId) {
      courseId = existingId;
      await this.db.query(
        `UPDATE Courses SET Title = @title, Credits = @credits, Description = COALESCE(@desc, Description),
                ProgramArea = COALESCE(@area, ProgramArea), ProgramId = COALESCE(@prog, ProgramId), Level = COALESCE(@level, Level),
                RequirementType = COALESCE(@req, RequirementType), LearningOutcomes = COALESCE(@outc, LearningOutcomes),
                Source = COALESCE(@src, Source), UpdatedAt = SYSUTCDATETIME()
         WHERE Id = ${courseId}`,
        inputs,
      );
      outcome = 'updated';
    } else {
      // Partner-supplied credit values are unverified until someone at this university checks them.
      const res = await this.db.query<{ Id: number }>(
        `INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, ProgramId, RequirementType, Credits, Description, LearningOutcomes, Level, Verified, Source, IsActive)
         OUTPUT inserted.Id
         VALUES (@inst, @code, @title, @area, @prog, @req, @credits, @desc, @outc, @level, 'Check', @src, 1)`,
        inputs,
      );
      courseId = res.recordset[0].Id;
      lookups.setCourse(inst.id, code, courseId);
      outcome = 'created';
    }

    if (programId) {
      await this.db.query(
        `IF NOT EXISTS (SELECT 1 FROM ProgramCourses WHERE ProgramId = @p AND CourseId = @c)
           INSERT INTO ProgramCourses (ProgramId, CourseId) VALUES (@p, @c)`,
        [
          { name: 'p', type: sql.Int, value: programId },
          { name: 'c', type: sql.Int, value: courseId },
        ],
      );
    }

    let topicsAdded = 0;
    const topics = Array.isArray(raw.topics) ? (raw.topics as Raw[]) : [];
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      const links = Array.isArray(t.referenceLinks) && t.referenceLinks.length ? JSON.stringify(t.referenceLinks) : null;
      const added = await this.db.query(
        `IF NOT EXISTS (SELECT 1 FROM CourseTopics WHERE CourseId = @c AND Title = @t)
           INSERT INTO CourseTopics (CourseId, Title, Description, SortOrder, ReferenceLinksJson) VALUES (@c, @t, @d, @s, @r)`,
        [
          { name: 'c', type: sql.Int, value: courseId },
          { name: 't', type: sql.NVarChar(200), value: str(t.title) },
          { name: 'd', type: sql.NVarChar(sql.MAX), value: str(t.description) || null },
          { name: 's', type: sql.Int, value: i },
          { name: 'r', type: sql.NVarChar(sql.MAX), value: links },
        ],
      );
      topicsAdded += added.rowsAffected[0] ?? 0;
    }
    const extra = topicsAdded ? `, ${topicsAdded} topic(s) added` : '';
    const warn = pname && !programId ? ' (program not found - no program link)' : '';
    return { outcome, message: `${outcome === 'created' ? 'Created' : 'Updated'} course ${code}${extra}${warn}` };
  }

  // ── direct (paste-and-go) import, kept for super admins ───────

  async preview(dto: ImportPayloadDto) {
    const lookups = this.newLookups();
    const rows = (dto.data as Raw[]).map((payload) => ({ type: dto.type as EntityType, payload }));
    const pending = this.pendingRefs(rows);
    const preview = [];
    for (const item of dto.data as Raw[]) {
      const c = await this.checkRow(dto.type, item, lookups, { pending });
      preview.push({ item, action: c.action, status: c.status, messages: c.messages });
    }
    return { type: dto.type, preview };
  }

  async execute(dto: ImportPayloadDto) {
    if (!ENTITY_ORDER.includes(dto.type)) throw new BadRequestException('Unknown import type');
    const lookups = this.newLookups();
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const item of dto.data as Raw[]) {
      const c = await this.checkRow(dto.type, item, lookups);
      if (c.status === 'error') {
        errors.push(`${str(item.code) || str(item.name) || 'row'}: ${c.messages.join('; ')}`);
        continue;
      }
      try {
        const r = await this.applyRow(dto.type, item, lookups);
        if (r.outcome === 'created') created++;
        else updated++;
      } catch (e) {
        errors.push(`${str(item.code) || str(item.name) || 'row'}: ${(e as Error).message}`);
      }
    }
    return { type: dto.type, created, updated, errors };
  }

  /** Short identifier shown in tables and reports. */
  describeRow(type: EntityType, raw: Raw): string {
    if (type === 'universities') return `${str(raw.code)} - ${str(raw.name)}`;
    if (type === 'programs') return `${str(raw.universityCode)} / ${str(raw.name)}`;
    return `${str(raw.universityCode)} ${str(raw.code)} - ${str(raw.name) || str(raw.title)}`;
  }
}
