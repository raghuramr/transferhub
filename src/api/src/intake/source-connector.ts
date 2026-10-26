import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { renderIdDocument, renderTranscript } from './document-renderer';

export interface SourceProfile {
  id: number;
  isMock: boolean;
  sourceSystem: string;
  institutionCode: string;
  institutionName: string;
  calendar: string;
  idType: string;
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  phone: string | null;
  country: string | null;
  countryOfOrigin: string | null;
  city: string | null;
  state: string | null;
  programName: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  gpa: number | null;
  graduationYear: number | null;
  creditsCompleted: number | null;
}

export interface SourceCourse {
  courseCode: string;
  courseTitle: string;
  credits: number;
  grade: string;
  term: string | null;
}

export interface SourceDocument {
  docType: string;
  fileName: string;
  mimeType: string;
  /** Empty when the caller asked for a listing only (withBytes: false). */
  bytes: Buffer;
}

export interface SourceRecord {
  profile: SourceProfile;
  courses: SourceCourse[];
  documents: SourceDocument[];
}

/**
 * Where a student's record lives. Today the only implementation reads the
 * StudentSourceProfiles tables (mock registrar data plus partner submissions).
 * A real registrar / exchange connector is added by implementing this interface
 * and registering it in SOURCE_CONNECTORS (intake.module.ts).
 */
export interface SourceConnector {
  readonly name: string;
  find(idNumber: string, email: string, universityCode?: string): Promise<SourceProfile | null>;
  load(profileId: number, opts?: { withBytes?: boolean }): Promise<SourceRecord | null>;
}

export const SOURCE_CONNECTORS = 'SOURCE_CONNECTORS';

/** Same normalisation as the ExternalIdNorm computed column. */
export function normaliseId(v: string): string {
  return String(v ?? '').replace(/[\s-]/g, '').toUpperCase();
}

interface ProfileRow {
  Id: number;
  SourceSystem: string;
  IsMock: boolean;
  InstitutionCode: string;
  InstitutionName: string;
  Calendar: string;
  IdType: string;
  ExternalId: string;
  Email: string;
  FirstName: string;
  LastName: string;
  DateOfBirth: Date | null;
  Phone: string | null;
  Country: string | null;
  CountryOfOrigin: string | null;
  City: string | null;
  State: string | null;
  ProgramName: string | null;
  Degree: string | null;
  FieldOfStudy: string | null;
  GPA: number | null;
  GraduationYear: number | null;
  CreditsCompleted: number | null;
}

const PROFILE_COLUMNS = `Id, SourceSystem, IsMock, InstitutionCode, InstitutionName, Calendar, IdType, ExternalId, Email, FirstName, LastName,
  DateOfBirth, Phone, Country, CountryOfOrigin, City, State, ProgramName, Degree, FieldOfStudy, GPA, GraduationYear, CreditsCompleted`;

function mapProfile(r: ProfileRow): SourceProfile {
  return {
    id: r.Id,
    isMock: !!r.IsMock,
    sourceSystem: r.SourceSystem,
    institutionCode: r.InstitutionCode,
    institutionName: r.InstitutionName,
    calendar: r.Calendar,
    idType: r.IdType,
    externalId: r.ExternalId,
    email: r.Email,
    firstName: r.FirstName,
    lastName: r.LastName,
    dateOfBirth: r.DateOfBirth,
    phone: r.Phone,
    country: r.Country,
    countryOfOrigin: r.CountryOfOrigin,
    city: r.City,
    state: r.State,
    programName: r.ProgramName,
    degree: r.Degree,
    fieldOfStudy: r.FieldOfStudy,
    gpa: r.GPA == null ? null : Number(r.GPA),
    graduationYear: r.GraduationYear,
    creditsCompleted: r.CreditsCompleted == null ? null : Number(r.CreditsCompleted),
  };
}

@Injectable()
export class DbSourceConnector implements SourceConnector {
  readonly name = 'database';

  constructor(private db: DatabaseService) {}

  async find(idNumber: string, email: string, universityCode?: string): Promise<SourceProfile | null> {
    const inputs = [
      { name: 'id', type: sql.NVarChar(100), value: normaliseId(idNumber) },
      { name: 'email', type: sql.NVarChar(254), value: email.trim().toLowerCase() },
    ];
    let where = `IsActive = 1 AND ExternalIdNorm = @id AND LOWER(Email) = @email`;
    if (universityCode?.trim()) {
      where += ` AND UPPER(InstitutionCode) = @uni`;
      inputs.push({ name: 'uni', type: sql.NVarChar(100), value: universityCode.trim().toUpperCase() });
    }
    const res = await this.db.query<ProfileRow>(`SELECT TOP 1 ${PROFILE_COLUMNS} FROM StudentSourceProfiles WHERE ${where} ORDER BY Id`, inputs);
    return res.recordset[0] ? mapProfile(res.recordset[0]) : null;
  }

  async load(profileId: number, opts: { withBytes?: boolean } = {}): Promise<SourceRecord | null> {
    const withBytes = opts.withBytes !== false;
    const pRes = await this.db.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM StudentSourceProfiles WHERE Id = @id AND IsActive = 1`, [
      { name: 'id', type: sql.Int, value: profileId },
    ]);
    if (!pRes.recordset[0]) return null;
    const profile = mapProfile(pRes.recordset[0]);

    const cRes = await this.db.query<{ CourseCode: string; CourseTitle: string; Credits: number; Grade: string; Term: string | null }>(
      `SELECT CourseCode, CourseTitle, Credits, Grade, Term FROM StudentSourceCourses WHERE SourceProfileId = @id ORDER BY SortOrder, Id`,
      [{ name: 'id', type: sql.Int, value: profileId }],
    );
    const courses: SourceCourse[] = cRes.recordset.map((c) => ({
      courseCode: c.CourseCode,
      courseTitle: c.CourseTitle,
      credits: Number(c.Credits),
      grade: c.Grade,
      term: c.Term,
    }));

    const dRes = await this.db.query<{ DocType: string; FileName: string; MimeType: string | null; Content: Buffer | null; Generated: boolean }>(
      `SELECT DocType, FileName, MimeType, ${withBytes ? 'Content' : 'NULL AS Content'}, Generated FROM StudentSourceDocuments WHERE SourceProfileId = @id ORDER BY Id`,
      [{ name: 'id', type: sql.Int, value: profileId }],
    );
    const documents: SourceDocument[] = [];
    for (const d of dRes.recordset) {
      let bytes = Buffer.alloc(0);
      let mimeType = d.MimeType || 'application/pdf';
      if (withBytes) {
        if (d.Content && d.Content.length > 0) {
          bytes = d.Content;
        } else if (d.Generated) {
          bytes = d.DocType === 'transcript' ? await renderTranscript(profile, courses) : await renderIdDocument(profile);
          mimeType = 'application/pdf';
        }
      }
      documents.push({ docType: d.DocType, fileName: d.FileName, mimeType, bytes });
    }
    return { profile, courses, documents };
  }
}
