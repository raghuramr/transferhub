import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { CreateCourseDto } from './dto/create-course.dto';

@Injectable()
export class CoursesService {
  constructor(private db: DatabaseService) {}

  async findBuCourses(filters: { departmentId?: number; search?: string } = {}) {
    let where = 'c.InstitutionId = (SELECT Id FROM Institutions WHERE Code = \'BU\')';
    const inputs: any[] = [];

    if (filters.departmentId) {
      where += ' AND c.DepartmentId = @dept';
      inputs.push({ name: 'dept', type: sql.Int, value: filters.departmentId });
    }
    if (filters.search) {
      where += ' AND (c.Code LIKE @q OR c.Title LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(100), value: `%${filters.search}%` });
    }

    const res = await this.db.query<any>(
      `SELECT c.Id, c.Code, c.Title, c.Credits, c.CreditType, c.Description,
              d.Name AS DepartmentName, d.Code AS DepartmentCode,
              i.Name AS InstitutionName
       FROM Courses c
       JOIN Institutions i ON i.Id = c.InstitutionId
       LEFT JOIN Departments d ON d.Id = c.DepartmentId
       WHERE ${where} AND c.IsActive = 1
       ORDER BY c.Code`,
      inputs,
    );
    return res.recordset;
  }

  async findById(id: number) {
    const res = await this.db.query<any>(
      `SELECT c.Id, c.Code, c.Title, c.Credits, c.CreditType, c.Description,
              c.DepartmentId, d.Name AS DepartmentName,
              i.Id AS InstitutionId, i.Name AS InstitutionName, i.Code AS InstitutionCode
       FROM Courses c
       JOIN Institutions i ON i.Id = c.InstitutionId
       LEFT JOIN Departments d ON d.Id = c.DepartmentId
       WHERE c.Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Course not found');
    return res.recordset[0];
  }

  async findInstitutions() {
    const res = await this.db.query<any>(
      `SELECT Id, Name, Code, Type, State, Country FROM Institutions WHERE IsActive = 1 ORDER BY Name`,
    );
    return res.recordset;
  }

  async findEquivalencies(buCourseId?: number, externalCourseId?: number) {
    let where = '1=1';
    const inputs: any[] = [];
    if (buCourseId) {
      where += ' AND e.BuCourseId = @buId';
      inputs.push({ name: 'buId', type: sql.Int, value: buCourseId });
    }
    if (externalCourseId) {
      where += ' AND e.ExternalCourseId = @extId';
      inputs.push({ name: 'extId', type: sql.Int, value: externalCourseId });
    }

    const res = await this.db.query<any>(
      `SELECT e.Id, e.Outcome, e.Notes, e.IsAutoApply, e.ConfirmedAt,
              bu.Code AS BuCode, bu.Title AS BuTitle, bu.Credits AS BuCredits,
              ext.Code AS ExtCode, ext.Title AS ExtTitle, ext.Credits AS ExtCredits,
              inst.Name AS InstitutionName, inst.Code AS InstitutionCode,
              u.FirstName + ' ' + u.LastName AS ConfirmedBy
       FROM Equivalencies e
       JOIN Courses bu ON bu.Id = e.BuCourseId
       JOIN Courses ext ON ext.Id = e.ExternalCourseId
       JOIN Institutions inst ON inst.Id = ext.InstitutionId
       LEFT JOIN Users u ON u.Id = e.ConfirmedByUserId
       WHERE ${where}
       ORDER BY inst.Code, ext.Code`,
      inputs,
    );
    return res.recordset;
  }

  async create(dto: CreateCourseDto) {
    const res = await this.db.query<any>(
      `INSERT INTO Courses (InstitutionId, Code, Title, Description, Credits, CreditType, DepartmentId, IsActive)
       OUTPUT inserted.Id
       VALUES (@instId, @code, @title, @desc, @credits, @ctype, @dept, @active)`,
      [
        { name: 'instId', type: sql.Int, value: dto.institutionId },
        { name: 'code', type: sql.NVarChar(20), value: dto.code },
        { name: 'title', type: sql.NVarChar(300), value: dto.title },
        { name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description || null },
        { name: 'credits', type: sql.Decimal(5, 2), value: dto.credits },
        { name: 'ctype', type: sql.VarChar(10), value: dto.creditType || 'semester' },
        { name: 'dept', type: sql.Int, value: dto.departmentId || null },
        { name: 'active', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async getDepartments() {
    const res = await this.db.query<any>(
      `SELECT Id, Name, Code FROM Departments WHERE IsActive = 1 ORDER BY Name`,
    );
    return res.recordset;
  }
}
