import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';

@Injectable()
export class EvaluationsService {
  constructor(private db: DatabaseService) {}

  async getQueue(facultyUserId?: string) {
    let where = 'tc.Lane IN (\'pending\', \'needs_syllabus\')';
    const inputs: any[] = [];
    if (facultyUserId) {
      where += ' AND (e.FacultyUserId = @fid OR e.FacultyUserId IS NULL)';
      inputs.push({ name: 'fid', type: sql.UniqueIdentifier, value: facultyUserId });
    }

    const res = await this.db.query<any>(
      `SELECT tc.Id AS CourseId, tc.ExternalCode, tc.ExternalTitle, tc.CreditsConverted, tc.Lane,
              t.Id AS TranscriptId, t.Status AS TranscriptStatus,
              i.Name AS InstitutionName,
              u.FirstName + ' ' + u.LastName AS StudentName,
              (SELECT COUNT(*) FROM AIMatchCandidates WHERE TranscriptCourseId = tc.Id) AS AiCandidatesCount
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN StudentProfiles sp ON sp.Id = t.StudentProfileId
       JOIN Users u ON u.Id = sp.UserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id AND e.FinalDecision IS NULL
       WHERE ${where}
       ORDER BY t.SubmittedAt ASC`,
      inputs,
    );
    return res.recordset;
  }

  async getAiCandidates(transcriptCourseId: number) {
    const res = await this.db.query<any>(
      `SELECT amc.Id, amc.Rank, amc.ConfidenceScore, amc.Rationale,
              c.Code AS BuCode, c.Title AS BuTitle, c.Credits AS BuCredits,
              d.Name AS DepartmentName
       FROM AIMatchCandidates amc
       JOIN Courses c ON c.Id = amc.BuCourseId
       LEFT JOIN Departments d ON d.Id = c.DepartmentId
       WHERE amc.TranscriptCourseId = @id
       ORDER BY amc.Rank`,
      [{ name: 'id', type: sql.Int, value: transcriptCourseId }],
    );
    return res.recordset;
  }

  async createEvaluation(dto: CreateEvaluationDto, facultyUserId: string) {
    // Check course exists
    const courseRes = await this.db.query<any>(
      `SELECT tc.Id, tc.TranscriptId, tc.CreditsConverted FROM TranscriptCourses tc WHERE tc.Id = @id`,
      [{ name: 'id', type: sql.Int, value: dto.transcriptCourseId }],
    );
    if (!courseRes.recordset[0]) throw new NotFoundException('Transcript course not found');

    const course = courseRes.recordset[0];
    const creditsGranted = dto.creditsGranted ?? course.CreditsConverted;

    // Insert evaluation
    const res = await this.db.query<any>(
      `INSERT INTO Evaluations (TranscriptCourseId, BuCourseId, FacultyUserId, Outcome, Rationale, CreditsGranted)
       OUTPUT inserted.Id
       VALUES (@tcId, @buId, @faculty, @outcome, @rationale, @credits)`,
      [
        { name: 'tcId', type: sql.Int, value: dto.transcriptCourseId },
        { name: 'buId', type: sql.Int, value: dto.recommendedBuCourseId },
        { name: 'faculty', type: sql.UniqueIdentifier, value: facultyUserId },
        { name: 'outcome', type: sql.VarChar(20), value: dto.outcome },
        { name: 'rationale', type: sql.NVarChar(sql.MAX), value: dto.rationale || null },
        { name: 'credits', type: sql.Decimal(5, 2), value: creditsGranted },
      ],
    );

    // Update transcript course lane
    const lane = dto.outcome === 'equivalent' ? 'applied' :
                 dto.outcome === 'elective' ? 'elective_only' :
                 'not_eligible';

    await this.db.query(
      `UPDATE TranscriptCourses SET Lane = @lane, MappedBuCourseId = @buId WHERE Id = @id`,
      [
        { name: 'lane', type: sql.VarChar(20), value: lane },
        { name: 'buId', type: sql.Int, value: dto.recommendedBuCourseId },
        { name: 'id', type: sql.Int, value: dto.transcriptCourseId },
      ],
    );

    // If confirmed as equivalent, update Equivalencies for auto-apply on future transcripts
    if (dto.outcome === 'equivalent' || dto.outcome === 'elective') {
      // Get external course code & institution from transcript
      const extRes = await this.db.query<any>(
        `SELECT tc.ExternalCode, t.InstitutionId
         FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId
         WHERE tc.Id = @id`,
        [{ name: 'id', type: sql.Int, value: dto.transcriptCourseId }],
      );

      if (extRes.recordset[0]) {
        const { ExternalCode, InstitutionId } = extRes.recordset[0];

        // Find or create external course record
        let extCourseRes = await this.db.query<any>(
          `SELECT Id FROM Courses WHERE Code = @code AND InstitutionId = @instId`,
          [
            { name: 'code', type: sql.NVarChar(20), value: ExternalCode },
            { name: 'instId', type: sql.Int, value: InstitutionId },
          ],
        );

        let extCourseId: number;
        if (extCourseRes.recordset[0]) {
          extCourseId = extCourseRes.recordset[0].Id;
        } else {
          const inserted = await this.db.query<any>(
            `INSERT INTO Courses (InstitutionId, Code, Title, Credits) OUTPUT inserted.Id VALUES (@instId, @code, @title, 0)`,
            [
              { name: 'instId', type: sql.Int, value: InstitutionId },
              { name: 'code', type: sql.NVarChar(20), value: ExternalCode },
              { name: 'title', type: sql.NVarChar(300), value: courseRes.recordset[0].ExternalTitle || ExternalCode },
            ],
          );
          extCourseId = inserted.recordset[0].Id;
        }

        // Upsert equivalency
        await this.db.query(
          `MERGE Equivalencies AS target
           USING (SELECT @extId AS ExtId, @buId AS BuId) AS src
           ON target.ExternalCourseId = src.ExtId AND target.BuCourseId = src.BuId
           WHEN MATCHED THEN UPDATE SET Outcome = @outcome, IsAutoApply = 1, ConfirmedByUserId = @faculty, ConfirmedAt = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (ExternalCourseId, BuCourseId, Outcome, IsAutoApply, ConfirmedByUserId) VALUES (@extId, @buId, @outcome, 1, @faculty);`,
          [
            { name: 'extId', type: sql.Int, value: extCourseId },
            { name: 'buId', type: sql.Int, value: dto.recommendedBuCourseId },
            { name: 'outcome', type: sql.VarChar(20), value: dto.outcome },
            { name: 'faculty', type: sql.UniqueIdentifier, value: facultyUserId },
          ],
        );
      }
    }

    return { id: res.recordset[0].Id, lane };
  }

  async finalizeEvaluation(evaluationId: number, approved: boolean, adminUserId: string, notes?: string) {
    const evalRes = await this.db.query<any>(
      `SELECT Id, TranscriptCourseId, Outcome FROM Evaluations WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: evaluationId }],
    );
    if (!evalRes.recordset[0]) throw new NotFoundException('Evaluation not found');

    await this.db.query(
      `UPDATE Evaluations SET FinalDecision = @decision, AdminUserId = @admin, AdminNotes = @notes, FinalizedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [
        { name: 'decision', type: sql.VarChar(20), value: approved ? 'approved' : 'rejected' },
        { name: 'admin', type: sql.UniqueIdentifier, value: adminUserId },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: notes || null },
        { name: 'id', type: sql.Int, value: evaluationId },
      ],
    );

    return { message: approved ? 'Evaluation approved' : 'Evaluation rejected' };
  }
}
