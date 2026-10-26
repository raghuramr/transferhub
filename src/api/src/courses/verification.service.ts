import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';

interface Row {
  Id: number;
  CourseId: number;
  Reason: string;
  Status: string;
  CreatedAt: Date;
  ResolvedAt: Date | null;
  ResolutionNote: string | null;
  CourseCode: string;
  CourseTitle: string;
  InstitutionCode: string;
  RaisedByName: string;
  RaisedBy: string;
  ResolvedByName: string | null;
}

/**
 * Faculty (or admins) can raise a course for verification - e.g. the credits or
 * description look wrong. Raising flags the course "Check" in the catalogue;
 * an admin then marks it verified ("Yes") or dismisses the request.
 */
@Injectable()
export class VerificationService {
  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
  ) {}

  private async ready() {
    if (!(await this.schema.has('CourseVerificationRequests'))) {
      throw new ServiceUnavailableException('Verification requests need migration 018 to be applied');
    }
  }

  async list(viewer: { id: string; role: string }, filters: { status?: string; mine?: boolean }) {
    if (!(await this.schema.has('CourseVerificationRequests'))) return [];
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (filters.mine || viewer.role === 'faculty') {
      where += ' AND v.RaisedBy = @me';
      inputs.push({ name: 'me', type: sql.UniqueIdentifier, value: viewer.id });
    }
    if (filters.status) {
      where += ' AND v.Status = @status';
      inputs.push({ name: 'status', type: sql.VarChar(20), value: filters.status });
    }
    const res = await this.db.query<Row>(
      `SELECT v.Id, v.CourseId, v.Reason, v.Status, v.CreatedAt, v.ResolvedAt, v.ResolutionNote, v.RaisedBy,
              c.Code AS CourseCode, c.Title AS CourseTitle, i.Code AS InstitutionCode,
              ru.FirstName + ' ' + ru.LastName AS RaisedByName,
              du.FirstName + ' ' + du.LastName AS ResolvedByName
       FROM CourseVerificationRequests v
       JOIN Courses c ON c.Id = v.CourseId
       JOIN Institutions i ON i.Id = c.InstitutionId
       JOIN Users ru ON ru.Id = v.RaisedBy
       LEFT JOIN Users du ON du.Id = v.ResolvedBy
       WHERE ${where}
       ORDER BY CASE v.Status WHEN 'open' THEN 0 ELSE 1 END, v.CreatedAt DESC`,
      inputs,
    );
    return res.recordset.map((r) => ({
      id: r.Id,
      courseId: r.CourseId,
      courseCode: r.CourseCode,
      courseTitle: r.CourseTitle,
      institutionCode: r.InstitutionCode,
      reason: r.Reason,
      status: r.Status,
      raisedBy: r.RaisedByName,
      createdAt: r.CreatedAt,
      resolvedAt: r.ResolvedAt,
      resolvedBy: r.ResolvedByName,
      resolutionNote: r.ResolutionNote,
    }));
  }

  async raise(userId: string, courseId: number, reason: string) {
    await this.ready();
    const course = await this.db.query(`SELECT Id FROM Courses WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: courseId }]);
    if (!course.recordset[0]) throw new NotFoundException('Course not found');
    const open = await this.db.query(`SELECT 1 AS X FROM CourseVerificationRequests WHERE CourseId = @c AND RaisedBy = @u AND Status = 'open'`, [
      { name: 'c', type: sql.Int, value: courseId },
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
    ]);
    if (open.recordset[0]) throw new BadRequestException('You already have an open verification request for this course');
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO CourseVerificationRequests (CourseId, RaisedBy, Reason) OUTPUT inserted.Id VALUES (@c, @u, @r)`,
      [
        { name: 'c', type: sql.Int, value: courseId },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
        { name: 'r', type: sql.NVarChar(1000), value: reason.trim() },
      ],
    );
    await this.db.query(`UPDATE Courses SET Verified = 'Check' WHERE Id = @c`, [{ name: 'c', type: sql.Int, value: courseId }]);
    return { id: res.recordset[0].Id };
  }

  async resolve(id: number, adminId: string, status: 'verified' | 'rejected', note?: string) {
    await this.ready();
    const cur = await this.db.query<{ CourseId: number; Status: string }>(`SELECT CourseId, Status FROM CourseVerificationRequests WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    const row = cur.recordset[0];
    if (!row) throw new NotFoundException('Request not found');
    if (row.Status !== 'open') throw new BadRequestException('This request has already been resolved');
    await this.db.query(
      `UPDATE CourseVerificationRequests SET Status = @s, ResolvedBy = @by, ResolvedAt = SYSUTCDATETIME(), ResolutionNote = @n WHERE Id = @id`,
      [
        { name: 's', type: sql.VarChar(20), value: status },
        { name: 'by', type: sql.UniqueIdentifier, value: adminId },
        { name: 'n', type: sql.NVarChar(1000), value: note?.trim() || null },
        { name: 'id', type: sql.Int, value: id },
      ],
    );
    // The course goes back to "Yes" once nothing about it is still open.
    const stillOpen = await this.db.query(`SELECT 1 AS X FROM CourseVerificationRequests WHERE CourseId = @c AND Status = 'open'`, [
      { name: 'c', type: sql.Int, value: row.CourseId },
    ]);
    if (status === 'verified' || !stillOpen.recordset[0]) {
      await this.db.query(`UPDATE Courses SET Verified = 'Yes' WHERE Id = @c`, [{ name: 'c', type: sql.Int, value: row.CourseId }]);
    }
    return { id, status };
  }
}
