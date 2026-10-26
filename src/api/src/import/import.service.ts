import { BadRequestException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { IntakeService } from '../intake/intake.service';
import type { ImportPayloadDto } from './dto/import-payload.dto';

export type EntityType = 'universities' | 'programs' | 'courses' | 'students';
export const ENTITY_ORDER: EntityType[] = ['universities', 'programs', 'courses', 'students'];

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
  /** `${UNIVERSITYCODE}|${normalised external id}` -> how many rows of this submission carry it. */
  studentKeys: Map<string, number>;
}

/** Who a row is being applied on behalf of (used to label where a student profile came from). */
export interface ApplyContext {
  partnerId?: number | null;
  sourceSystem?: string | null;
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
  students: [
    'universityCode', 'universityName', 'externalId', 'idType', 'email', 'firstName', 'lastName', 'dateOfBirth', 'phone',
    'country', 'countryOfOrigin', 'city', 'state', 'programName', 'degree', 'fieldOfStudy', 'gpa', 'graduationYear',
    'creditsCompleted', 'calendar', 'courses', 'documents', 'invite',
  ],
};

export const ID_TYPES = ['student_id', 'passport', 'national_id', 'other'];
export const MAX_DOC_BYTES = 2 * 1024 * 1024;
const DOC_TYPES_OK = /^[a-z0-9_]{1,40}$/;
const DOC_MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

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
    students: {
      description:
        'A student profile held at your university. It is staged for review; once imported the student can claim it (by ID + email, or from an invitation email) and the profile, courses and documents become theirs. No account is created until the student confirms.',
      requiredFields: ['universityCode', 'externalId', 'email', 'firstName', 'lastName'],
      optionalFields: [
        'idType (student_id | passport | national_id | other, default student_id)', 'universityName', 'dateOfBirth (YYYY-MM-DD)', 'phone', 'country',
        'countryOfOrigin', 'city', 'state', 'programName', 'degree', 'fieldOfStudy', 'gpa (0-4.33)', 'graduationYear', 'creditsCompleted',
        'calendar (semester | quarter | trimester)', 'courses [{code, title, credits, grade, term}]',
        'documents [{docType, fileName, contentBase64}] (pdf/png/jpg, max 2 MB each)', 'invite (true = email the student a link to claim the profile)',
      ],
      example: {
        universityCode: 'MIT', externalId: 'MIT-2041877', idType: 'student_id', email: 'priya.rao@example.com', firstName: 'Priya', lastName: 'Rao',
        dateOfBirth: '2003-04-18', country: 'United States', programName: 'Computer Science', degree: 'BS', gpa: 3.6, graduationYear: 2027, creditsCompleted: 62,
        courses: [{ code: '6.0001', title: 'Introduction to Computer Science and Programming', credits: 3, grade: 'A-', term: 'Fall 2024' }],
        documents: [{ docType: 'transcript', fileName: 'transcript.pdf', contentBase64: '<base64 of the PDF>' }],
        invite: false,
      },
    },
  },
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const key = (v: string) => v.trim().toLowerCase();
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
/** Same normalisation as the persisted StudentSourceProfiles.ExternalIdNorm column. */
export const normExternalId = (v: string) => v.replace(/ /g, '').replace(/-/g, '').toUpperCase();
const studentKey = (code: string, externalId: string) => `${key(code)}|${normExternalId(externalId)}`;
const isDateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const truthy = (v: unknown) => v === true || v === 1 || /^(true|yes|1)$/i.test(String(v ?? ''));
/** Decoded size of a base64 string without decoding it. */
const base64Bytes = (b64: string) => {
  const clean = b64.replace(/\s+/g, '');
  return Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
};
const docExt = (fileName: string) => (fileName.split('.').pop() ?? '').toLowerCase();

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
  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private intake: IntakeService,
  ) {}

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
    } else if (type === 'students') {
      action = await this.checkStudent(raw, opts, errors, warnings, need, opt, scope);
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

  private async checkStudent(
    raw: Raw,
    opts: CheckOptions,
    errors: string[],
    warnings: string[],
    need: (field: string, v: string, max: number) => void,
    opt: (field: string, v: string, max: number) => void,
    scope: (code: string) => void,
  ): Promise<RowCheck['action']> {
    const code = str(raw.universityCode) || opts.scopeCode || '';
    const externalId = str(raw.externalId);
    const email = str(raw.email);
    need('universityCode', code, 20);
    need('externalId', externalId, 100);
    need('email', email, 254);
    need('firstName', str(raw.firstName), 100);
    need('lastName', str(raw.lastName), 100);
    scope(code);
    if (email && !isEmail(email)) errors.push('email is not a valid email address');
    if (raw.idType && !ID_TYPES.includes(str(raw.idType))) errors.push(`idType must be one of ${ID_TYPES.join(', ')}`);
    opt('universityName', str(raw.universityName), 200);
    opt('phone', str(raw.phone), 30);
    opt('country', str(raw.country), 100);
    opt('countryOfOrigin', str(raw.countryOfOrigin), 100);
    opt('city', str(raw.city), 100);
    opt('state', str(raw.state), 100);
    opt('programName', str(raw.programName), 200);
    opt('degree', str(raw.degree), 50);
    opt('fieldOfStudy', str(raw.fieldOfStudy), 200);

    const dob = str(raw.dateOfBirth);
    if (dob) {
      if (!isDateOnly(dob)) errors.push('dateOfBirth must be a real date written YYYY-MM-DD');
      else if (dob < '1900-01-01' || Date.parse(`${dob}T00:00:00Z`) > Date.now()) errors.push('dateOfBirth is outside a plausible range');
    }
    if (raw.gpa !== undefined && raw.gpa !== null && raw.gpa !== '') {
      const g = Number(raw.gpa);
      if (!Number.isFinite(g) || g < 0 || g > 4.33) errors.push('gpa must be a number between 0 and 4.33');
    }
    if (raw.graduationYear !== undefined && raw.graduationYear !== null && raw.graduationYear !== '') {
      const y = Number(raw.graduationYear);
      if (!Number.isInteger(y) || y < 1950 || y > 2100) errors.push('graduationYear must be a year between 1950 and 2100');
    }
    if (raw.creditsCompleted !== undefined && raw.creditsCompleted !== null && raw.creditsCompleted !== '') {
      const c = Number(raw.creditsCompleted);
      if (!Number.isFinite(c) || c < 0 || c > 400) errors.push('creditsCompleted must be a number between 0 and 400');
    }
    if (raw.calendar && !['semester', 'quarter', 'trimester'].includes(str(raw.calendar))) errors.push('calendar must be semester, quarter or trimester');

    // Courses
    if (raw.courses !== undefined && !Array.isArray(raw.courses)) errors.push('courses must be a list');
    const courses = Array.isArray(raw.courses) ? (raw.courses as Raw[]) : [];
    if (courses.length > 200) errors.push('a student may have at most 200 courses');
    courses.slice(0, 200).forEach((c, i) => {
      const n = `course ${i + 1}`;
      if (!c || typeof c !== 'object') return void errors.push(`${n} must be an object`);
      if (!str(c.code)) errors.push(`${n} needs a code`);
      else if (str(c.code).length > 50) errors.push(`${n} code is longer than 50 characters`);
      if (!str(c.title)) errors.push(`${n} needs a title`);
      else if (str(c.title).length > 300) errors.push(`${n} title is longer than 300 characters`);
      const cr = Number(c.credits);
      if (c.credits === undefined || c.credits === null || c.credits === '' || !Number.isFinite(cr) || cr <= 0 || cr > 30) errors.push(`${n} credits must be a number above 0 and up to 30`);
      if (!str(c.grade)) errors.push(`${n} needs a grade`);
      else if (str(c.grade).length > 10) errors.push(`${n} grade is longer than 10 characters`);
      if (str(c.term).length > 50) errors.push(`${n} term is longer than 50 characters`);
    });
    if (Array.isArray(raw.courses) && courses.length === 0) warnings.push('No courses listed - the student will have nothing to submit for evaluation');
    if (raw.courses === undefined) warnings.push('No courses listed - the student will have nothing to submit for evaluation');

    // Documents
    if (raw.documents !== undefined && !Array.isArray(raw.documents)) errors.push('documents must be a list');
    const docs = Array.isArray(raw.documents) ? (raw.documents as Raw[]) : [];
    if (docs.length > 10) errors.push('a student may have at most 10 documents');
    docs.slice(0, 10).forEach((d, i) => {
      const n = `document ${i + 1}`;
      if (!d || typeof d !== 'object') return void errors.push(`${n} must be an object`);
      const type = str(d.docType);
      const fileName = str(d.fileName);
      const b64 = typeof d.contentBase64 === 'string' ? d.contentBase64 : '';
      if (!DOC_TYPES_OK.test(type)) errors.push(`${n} docType must be 1-40 characters of a-z, 0-9 and _`);
      if (!fileName) errors.push(`${n} needs a fileName`);
      else if (fileName.length > 300) errors.push(`${n} fileName is longer than 300 characters`);
      else if (!DOC_MIME[docExt(fileName)]) errors.push(`${n} must be a .pdf, .png or .jpg file`);
      if (!b64) errors.push(`${n} needs contentBase64`);
      else if (b64.startsWith('(stored')) {
        /* placeholder shown to reviewers for an already-stored file; restored on save */
      } else if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) errors.push(`${n} contentBase64 is not valid base64`);
      else if (base64Bytes(b64) > MAX_DOC_BYTES) errors.push(`${n} is larger than ${MAX_DOC_BYTES / 1024 / 1024} MB`);
      else if (base64Bytes(b64) < 8) errors.push(`${n} is empty`);
      else {
        const head = Buffer.from(b64.replace(/\s+/g, '').slice(0, 16), 'base64');
        const ext = docExt(fileName);
        const okMagic =
          (ext === 'pdf' && head.subarray(0, 4).toString('latin1') === '%PDF') ||
          (ext === 'png' && head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') ||
          ((ext === 'jpg' || ext === 'jpeg') && head[0] === 0xff && head[1] === 0xd8);
        if (!okMagic) errors.push(`${n} does not look like a real ${ext.toUpperCase()} file`);
      }
    });

    if (raw.invite !== undefined && typeof raw.invite !== 'boolean' && !/^(true|false|yes|no|1|0)$/i.test(String(raw.invite))) {
      errors.push('invite must be true or false');
    }

    if (code && externalId) {
      const dup = opts.pending?.studentKeys.get(studentKey(code, externalId)) ?? 0;
      if (dup > 1) errors.push(`externalId "${externalId}" appears ${dup} times in this submission - send each student once`);
      if (!(await this.schema.has('StudentSourceProfiles'))) {
        errors.push('Student profiles are not available yet (the database migration for them has not been applied)');
      } else {
        const r = await this.db.query<{ Id: number }>(
          `SELECT Id FROM StudentSourceProfiles WHERE InstitutionCode = @c AND ExternalIdNorm = @n`,
          [
            { name: 'c', type: sql.VarChar(20), value: code.toUpperCase() },
            { name: 'n', type: sql.NVarChar(100), value: normExternalId(externalId) },
          ],
        );
        if (r.recordset[0]) return 'update';
      }
    }
    return 'create';
  }

  /** Builds the dependency hints for a set of rows (what the same submission itself provides). */
  pendingRefs(rows: { type: EntityType; payload: Raw }[]): PendingRefs {
    const refs: PendingRefs = { universities: new Set(), programs: new Set(), studentKeys: new Map() };
    for (const r of rows) {
      if (r.type === 'students' && str(r.payload.externalId)) {
        const k = studentKey(str(r.payload.universityCode), str(r.payload.externalId));
        refs.studentKeys.set(k, (refs.studentKeys.get(k) ?? 0) + 1);
      }
      if (r.type === 'universities' && str(r.payload.code)) refs.universities.add(key(str(r.payload.code)));
      if (r.type === 'programs' && str(r.payload.name)) {
        refs.programs.add(`${key(str(r.payload.universityCode))}|${key(str(r.payload.name))}`);
      }
    }
    return refs;
  }

  // ── applying ──────────────────────────────────────────────────

  /** Writes one row to the live tables. Throws a readable Error if it cannot. */
  async applyRow(type: EntityType, raw: Raw, lookups: Lookups, scopeCode?: string, ctx: ApplyContext = {}): Promise<ApplyResult> {
    if (type === 'universities') return this.applyUniversity(raw, lookups);
    if (type === 'programs') return this.applyProgram(raw, lookups, scopeCode);
    if (type === 'students') return this.applyStudent(raw, lookups, scopeCode, ctx);
    return this.applyCourse(raw, lookups, scopeCode);
  }

  /**
   * Stores a student profile in the source-profile table the intake pipeline reads. It never creates a user:
   * the student claims the profile later (ID + email lookup or the emailed invitation) and confirms it first.
   */
  private async applyStudent(raw: Raw, lookups: Lookups, scopeCode: string | undefined, ctx: ApplyContext): Promise<ApplyResult> {
    if (!(await this.schema.has('StudentSourceProfiles'))) {
      throw new Error('Student profiles need the intake database migration (019) to be applied first');
    }
    const code = (str(raw.universityCode) || scopeCode || '').toUpperCase();
    const externalId = str(raw.externalId);
    const norm = normExternalId(externalId);
    const inst = await lookups.institution(code);
    let instName = str(raw.universityName);
    if (!instName && inst) {
      const n = await this.db.query<{ Name: string; Calendar: string }>(`SELECT Name, Calendar FROM Institutions WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: inst.id }]);
      instName = n.recordset[0]?.Name ?? '';
    }
    if (!instName) instName = code;

    const found = await this.db.query<{ Id: number }>(`SELECT Id FROM StudentSourceProfiles WHERE InstitutionCode = @c AND ExternalIdNorm = @n`, [
      { name: 'c', type: sql.VarChar(20), value: code },
      { name: 'n', type: sql.NVarChar(100), value: normExternalId(externalId) },
    ]);
    const opt = (v: unknown) => str(v) || null;
    const numOrNull = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    const inputs = [
      { name: 'src', type: sql.NVarChar(100), value: (ctx.sourceSystem || 'Partner import').slice(0, 100) },
      { name: 'pid', type: sql.Int, value: ctx.partnerId ?? null },
      { name: 'code', type: sql.VarChar(20), value: code },
      { name: 'iname', type: sql.NVarChar(200), value: instName.slice(0, 200) },
      { name: 'cal', type: sql.VarChar(10), value: opt(raw.calendar) },
      { name: 'idt', type: sql.VarChar(20), value: str(raw.idType) || 'student_id' },
      { name: 'eid', type: sql.NVarChar(100), value: externalId },
      { name: 'email', type: sql.NVarChar(254), value: str(raw.email).toLowerCase() },
      { name: 'fn', type: sql.NVarChar(100), value: str(raw.firstName) },
      { name: 'ln', type: sql.NVarChar(100), value: str(raw.lastName) },
      { name: 'dob', type: sql.Date, value: opt(raw.dateOfBirth) ? new Date(`${str(raw.dateOfBirth)}T00:00:00Z`) : null },
      { name: 'ph', type: sql.NVarChar(30), value: opt(raw.phone) },
      { name: 'ctry', type: sql.NVarChar(100), value: opt(raw.country) },
      { name: 'orig', type: sql.NVarChar(100), value: opt(raw.countryOfOrigin) },
      { name: 'city', type: sql.NVarChar(100), value: opt(raw.city) },
      { name: 'st', type: sql.NVarChar(100), value: opt(raw.state) },
      { name: 'prog', type: sql.NVarChar(200), value: opt(raw.programName) },
      { name: 'deg', type: sql.NVarChar(50), value: opt(raw.degree) },
      { name: 'fos', type: sql.NVarChar(200), value: opt(raw.fieldOfStudy) },
      { name: 'gpa', type: sql.Decimal(3, 2), value: numOrNull(raw.gpa) },
      { name: 'gy', type: sql.Int, value: numOrNull(raw.graduationYear) },
      { name: 'cc', type: sql.Decimal(6, 2), value: numOrNull(raw.creditsCompleted) },
    ];

    let id: number;
    let outcome: ApplyResult['outcome'];
    if (found.recordset[0]) {
      id = found.recordset[0].Id;
      await this.db.query(
        `UPDATE StudentSourceProfiles SET SourceSystem = @src, PartnerId = COALESCE(@pid, PartnerId), InstitutionName = @iname,
                Calendar = COALESCE(@cal, Calendar), IdType = @idt, ExternalId = @eid, Email = @email, FirstName = @fn, LastName = @ln,
                DateOfBirth = COALESCE(@dob, DateOfBirth), Phone = COALESCE(@ph, Phone), Country = COALESCE(@ctry, Country),
                CountryOfOrigin = COALESCE(@orig, CountryOfOrigin), City = COALESCE(@city, City), State = COALESCE(@st, State),
                ProgramName = COALESCE(@prog, ProgramName), Degree = COALESCE(@deg, Degree), FieldOfStudy = COALESCE(@fos, FieldOfStudy),
                GPA = COALESCE(@gpa, GPA), GraduationYear = COALESCE(@gy, GraduationYear), CreditsCompleted = COALESCE(@cc, CreditsCompleted),
                IsActive = 1, UpdatedAt = SYSUTCDATETIME()
         WHERE Id = ${id}`,
        inputs,
      );
      outcome = 'updated';
    } else {
      const res = await this.db.query<{ Id: number }>(
        `INSERT INTO StudentSourceProfiles (SourceSystem, IsMock, PartnerId, InstitutionCode, InstitutionName, Calendar, IdType, ExternalId, Email,
                FirstName, LastName, DateOfBirth, Phone, Country, CountryOfOrigin, City, State, ProgramName, Degree, FieldOfStudy, GPA,
                GraduationYear, CreditsCompleted, IsActive)
         OUTPUT inserted.Id
         VALUES (@src, 0, @pid, @code, @iname, COALESCE(@cal, 'semester'), @idt, @eid, @email, @fn, @ln, @dob, @ph, @ctry, @orig, @city, @st,
                @prog, @deg, @fos, @gpa, @gy, @cc, 1)`,
        inputs,
      );
      id = res.recordset[0].Id;
      outcome = 'created';
    }

    // Courses replace the previous list when the row carries one; a row without "courses" leaves them alone.
    let courseCount = 0;
    if (Array.isArray(raw.courses)) {
      await this.db.query(`DELETE FROM StudentSourceCourses WHERE SourceProfileId = ${id}`);
      for (const [i, c] of (raw.courses as Raw[]).entries()) {
        await this.db.query(
          `INSERT INTO StudentSourceCourses (SourceProfileId, CourseCode, CourseTitle, Credits, Grade, Term, SortOrder) VALUES (${id}, @code, @title, @cr, @gr, @term, @o)`,
          [
            { name: 'code', type: sql.NVarChar(50), value: str(c.code) },
            { name: 'title', type: sql.NVarChar(300), value: str(c.title) },
            { name: 'cr', type: sql.Decimal(5, 2), value: Number(c.credits) },
            { name: 'gr', type: sql.NVarChar(10), value: str(c.grade) },
            { name: 'term', type: sql.NVarChar(50), value: opt(c.term) },
            { name: 'o', type: sql.Int, value: i },
          ],
        );
        courseCount++;
      }
    }

    // Documents: same docType + file name replaces the earlier copy.
    let docCount = 0;
    for (const d of Array.isArray(raw.documents) ? (raw.documents as Raw[]) : []) {
      const content = Buffer.from(String(d.contentBase64).replace(/\s+/g, ''), 'base64');
      const fileName = str(d.fileName);
      await this.db.query(
        `UPDATE StudentSourceDocuments SET MimeType = @mime, Content = @content, Generated = 0
         WHERE SourceProfileId = ${id} AND DocType = @type AND FileName = @fn;
         IF @@ROWCOUNT = 0
           INSERT INTO StudentSourceDocuments (SourceProfileId, DocType, FileName, MimeType, Content, Generated) VALUES (${id}, @type, @fn, @mime, @content, 0);`,
        [
          { name: 'type', type: sql.VarChar(40), value: str(d.docType) },
          { name: 'fn', type: sql.NVarChar(300), value: fileName },
          { name: 'mime', type: sql.NVarChar(100), value: DOC_MIME[docExt(fileName)] },
          { name: 'content', type: sql.VarBinary(sql.MAX), value: content },
        ],
      );
      docCount++;
    }

    let invited = '';
    if (truthy(raw.invite)) {
      try {
        const r = await this.intake.sendInvite(id, 'partner_invite');
        invited = r.sent ? ', invitation emailed to the student' : ', invitation was not sent';
      } catch (e) {
        invited = `, invitation could not be sent (${(e as Error).message.slice(0, 120)})`;
      }
    }
    const extra = `${courseCount ? `, ${courseCount} course(s)` : ''}${docCount ? `, ${docCount} document(s)` : ''}`;
    return {
      outcome,
      message: `${outcome === 'created' ? 'Created' : 'Updated'} student profile ${externalId} (${code})${extra} - profile ready to claim${invited}`,
    };
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
        errors.push(`${this.describeRow(dto.type, item).trim() || 'row'}: ${c.messages.join('; ')}`);
        continue;
      }
      try {
        const r = await this.applyRow(dto.type, item, lookups);
        if (r.outcome === 'created') created++;
        else updated++;
      } catch (e) {
        errors.push(`${this.describeRow(dto.type, item).trim() || 'row'}: ${(e as Error).message}`);
      }
    }
    return { type: dto.type, created, updated, errors };
  }

  /** Short identifier shown in tables and reports. */
  describeRow(type: EntityType, raw: Raw): string {
    if (type === 'universities') return `${str(raw.code)} - ${str(raw.name)}`;
    if (type === 'programs') return `${str(raw.universityCode)} / ${str(raw.name)}`;
    if (type === 'students') return `${str(raw.universityCode)} ${str(raw.externalId)} - ${str(raw.firstName)} ${str(raw.lastName)}`.trim();
    return `${str(raw.universityCode)} ${str(raw.code)} - ${str(raw.name) || str(raw.title)}`;
  }
}
