import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { CreateTranscriptDto, AddTranscriptCourseDto } from './dto/create-transcript.dto';

@Injectable()
export class TranscriptsService {
  constructor(private db: DatabaseService) {}

  async create(dto: CreateTranscriptDto, submittedByUserId: string) {
    // If studentUserId not provided, submitter is the student
    const studentUserId = dto.studentUserId || submittedByUserId;

    // Get or create StudentProfile
    let profileRes = await this.db.query<any>(
      `SELECT Id FROM StudentProfiles WHERE UserId = @uid`,
      [{ name: 'uid', type: sql.UniqueIdentifier, value: studentUserId }],
    );

    let profileId: number;
    if (profileRes.recordset[0]) {
      profileId = profileRes.recordset[0].Id;
    } else {
      const newProfile = await this.db.query<any>(
        `INSERT INTO StudentProfiles (UserId) OUTPUT inserted.Id VALUES (@uid)`,
        [{ name: 'uid', type: sql.UniqueIdentifier, value: studentUserId }],
      );
      profileId = newProfile.recordset[0].Id;
    }

    const res = await this.db.query<any>(
      `INSERT INTO Transcripts (StudentProfileId, InstitutionId, ProgramName, TermRange, SubmittedByUserId, Notes, Status)
       OUTPUT inserted.Id
       VALUES (@pid, @instId, @prog, @term, @submittedBy, @notes, 'pending')`,
      [
        { name: 'pid', type: sql.Int, value: profileId },
        { name: 'instId', type: sql.Int, value: dto.institutionId },
        { name: 'prog', type: sql.NVarChar(200), value: dto.programName || null },
        { name: 'term', type: sql.NVarChar(100), value: dto.termRange || null },
        { name: 'submittedBy', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: dto.notes || null },
      ],
    );

    return this.findById(res.recordset[0].Id);
  }

  async findById(id: number) {
    const res = await this.db.query<any>(
      `SELECT t.Id, t.Status, t.ProgramName, t.TermRange, t.Notes, t.SubmittedAt, t.ReviewedAt,
              i.Name AS InstitutionName, i.Code AS InstitutionCode,
              u.FirstName + ' ' + u.LastName AS StudentName, u.Email AS StudentEmail,
              sp.BuStudentId, sp.ProgramCode, sp.EnrollmentStatus,
              rev.FirstName + ' ' + rev.LastName AS ReviewedByName
       FROM Transcripts t
       JOIN StudentProfiles sp ON sp.Id = t.StudentProfileId
       JOIN Users u ON u.Id = sp.UserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       LEFT JOIN Users rev ON rev.Id = t.ReviewedByUserId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Transcript not found');

    const transcript = res.recordset[0];

    // Load courses
    const courses = await this.db.query<any>(
      `SELECT tc.Id, tc.ExternalCode, tc.ExternalTitle, tc.CreditsEarned, tc.CreditsConverted,
              tc.Grade, tc.CreditType, tc.TermYear, tc.TermSeason, tc.Lane, tc.ReviewNotes,
              c.Code AS MappedBuCode, c.Title AS MappedBuTitle, c.Credits AS MappedBuCredits
       FROM TranscriptCourses tc
       LEFT JOIN Courses c ON c.Id = tc.MappedBuCourseId
       WHERE tc.TranscriptId = @id
       ORDER BY tc.TermYear, tc.TermSeason, tc.ExternalCode`,
      [{ name: 'id', type: sql.Int, value: id }],
    );

    return { ...transcript, courses: courses.recordset };
  }

  async findAll(filters: { studentUserId?: string; status?: string; submittedByUserId?: string }) {
    let where = '1=1';
    const inputs: any[] = [];

    if (filters.studentUserId) {
      where += ' AND sp.UserId = @suid';
      inputs.push({ name: 'suid', type: sql.UniqueIdentifier, value: filters.studentUserId });
    }
    if (filters.submittedByUserId) {
      where += ' AND t.SubmittedByUserId = @subBy';
      inputs.push({ name: 'subBy', type: sql.UniqueIdentifier, value: filters.submittedByUserId });
    }
    if (filters.status) {
      where += ' AND t.Status = @status';
      inputs.push({ name: 'status', type: sql.VarChar(20), value: filters.status });
    }

    const res = await this.db.query<any>(
      `SELECT t.Id, t.Status, t.SubmittedAt, t.ReviewedAt,
              i.Name AS InstitutionName,
              u.FirstName + ' ' + u.LastName AS StudentName, u.Email AS StudentEmail,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS CourseCount
       FROM Transcripts t
       JOIN StudentProfiles sp ON sp.Id = t.StudentProfileId
       JOIN Users u ON u.Id = sp.UserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE ${where}
       ORDER BY t.SubmittedAt DESC`,
      inputs,
    );
    return res.recordset;
  }

  async addCourse(transcriptId: number, dto: AddTranscriptCourseDto) {
    // Convert quarter credits if needed
    let converted = dto.creditsEarned;
    if (dto.creditType === 'quarter') {
      converted = Math.floor(dto.creditsEarned * 2.0 / 3.0 * 100) / 100;
    }

    // Check for existing equivalency
    const eqRes = await this.db.query<any>(
      `SELECT e.Id, e.BuCourseId, e.Outcome, e.IsAutoApply,
              c.Code AS BuCode, c.Title AS BuTitle
       FROM Equivalencies e
       JOIN Courses ext ON ext.Id = e.ExternalCourseId
       JOIN Courses c ON c.Id = e.BuCourseId
       JOIN Transcripts t ON t.InstitutionId = ext.InstitutionId
       WHERE t.Id = @tid AND ext.Code = @code AND e.IsAutoApply = 1`,
      [
        { name: 'tid', type: sql.Int, value: transcriptId },
        { name: 'code', type: sql.NVarChar(20), value: dto.externalCode },
      ],
    );

    const eq = eqRes.recordset[0];
    let lane = 'pending';
    let mappedBuCourseId: number | null = null;

    if (eq) {
      mappedBuCourseId = eq.BuCourseId;
      lane = eq.Outcome === 'equivalent' ? 'likely' : 'elective_only';
    }

    const res = await this.db.query<any>(
      `INSERT INTO TranscriptCourses (TranscriptId, ExternalCode, ExternalTitle, CreditsEarned, CreditsConverted, Grade, CreditType, TermYear, TermSeason, MappedBuCourseId, Lane)
       OUTPUT inserted.Id
       VALUES (@tid, @code, @title, @earned, @conv, @grade, @ctype, @year, @season, @buId, @lane)`,
      [
        { name: 'tid', type: sql.Int, value: transcriptId },
        { name: 'code', type: sql.NVarChar(20), value: dto.externalCode },
        { name: 'title', type: sql.NVarChar(300), value: dto.externalTitle },
        { name: 'earned', type: sql.Decimal(5, 2), value: dto.creditsEarned },
        { name: 'conv', type: sql.Decimal(5, 2), value: converted },
        { name: 'grade', type: sql.NVarChar(5), value: dto.grade || null },
        { name: 'ctype', type: sql.VarChar(10), value: dto.creditType || 'semester' },
        { name: 'year', type: sql.Int, value: dto.termYear || null },
        { name: 'season', type: sql.NVarChar(10), value: dto.termSeason || null },
        { name: 'buId', type: sql.Int, value: mappedBuCourseId },
        { name: 'lane', type: sql.VarChar(20), value: lane },
      ],
    );

    const courseId = res.recordset[0].Id;
    return { id: courseId, lane, autoMapped: !!eq, mappedBuCourse: eq ? { code: eq.BuCode, title: eq.BuTitle } : null };
  }

  async updateCourseStatus(transcriptId: number, courseId: number, status: string, reviewedBy: string, notes?: string) {
    await this.db.query(
      `UPDATE TranscriptCourses SET Lane = @lane, ReviewNotes = @notes WHERE Id = @id AND TranscriptId = @tid`,
      [
        { name: 'lane', type: sql.VarChar(20), value: status },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: notes || null },
        { name: 'id', type: sql.Int, value: courseId },
        { name: 'tid', type: sql.Int, value: transcriptId },
      ],
    );
    return { message: 'Course status updated' };
  }

  async updateStatus(id: number, status: string, reviewedBy: string) {
    await this.db.query(
      `UPDATE Transcripts SET Status = @status, ReviewedByUserId = @rev, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [
        { name: 'status', type: sql.VarChar(20), value: status },
        { name: 'rev', type: sql.UniqueIdentifier, value: reviewedBy },
        { name: 'id', type: sql.Int, value: id },
      ],
    );
    return this.findById(id);
  }
}
