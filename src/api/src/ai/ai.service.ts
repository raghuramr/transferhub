import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';

export interface CourseMatchResult {
  buCourseId: number;
  buCode: string;
  buTitle: string;
  rank: number;
  confidenceScore: number;
  rationale: string;
}

interface ExternalCourseRow {
  EvalId: string;
  TcId: string;
  CourseCode: string;
  CourseTitle: string;
  OriginalCredits: number | null;
  NormalisedCredits: number | null;
  InstitutionName: string;
  Calendar: string | null;
}

interface BuCourseRow {
  Id: number;
  Code: string;
  Title: string;
  Credits: number;
  ProgramArea: string | null;
  Description: string | null;
}

interface TranscriptSummaryRow {
  Id: string;
  Status: string;
  StudentName: string;
  InstitutionName: string;
  TotalCourses: number;
  Applied: number;
  Pending: number;
  NotEligible: number;
  Elective: number;
}

const AUTO_LIKELY_THRESHOLD = 0.75;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic;

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async matchCourse(evaluationId: string, requestedByUserId: string): Promise<CourseMatchResult[]> {
    const evalRes = await this.db.query<ExternalCourseRow>(
      `SELECT e.Id AS EvalId, tc.Id AS TcId, tc.CourseCode, tc.CourseTitle,
              tc.OriginalCredits, tc.NormalisedCredits,
              i.Name AS InstitutionName, i.Calendar
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t        ON t.Id = tc.TranscriptId
       JOIN Institutions i       ON i.Id = t.InstitutionId
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    if (!evalRes.recordset[0]) throw new NotFoundException('Evaluation not found');
    const extCourse = evalRes.recordset[0];

    const buRes = await this.db.query<BuCourseRow>(
      `SELECT c.Id, c.Code, c.Title, c.Credits, c.ProgramArea, c.Description
       FROM Courses c
       JOIN Institutions i ON i.Id = c.InstitutionId
       WHERE i.Code = 'BU' AND c.IsActive = 1
       ORDER BY c.Code`,
    );
    const buCourses = buRes.recordset;

    const systemPrompt = `You are an expert academic advisor at Boston University (BU) specializing in transfer credit evaluation.
Your job is to analyze an external course and identify the top 3 most likely BU equivalent courses.
You must return ONLY a valid JSON array with exactly 3 elements, no markdown, no explanation outside the JSON.`;

    const userPrompt = `Evaluate this external course and identify the top 3 BU course equivalents.

EXTERNAL COURSE:
- Institution: ${extCourse.InstitutionName} (${extCourse.Calendar} calendar)
- Course Code: ${extCourse.CourseCode}
- Course Title: ${extCourse.CourseTitle}
- Credits: ${extCourse.NormalisedCredits ?? extCourse.OriginalCredits}

BU COURSE CATALOG (${buCourses.length} courses):
${buCourses.map((c) => `[ID:${c.Id}] ${c.Code} - ${c.Title} (${c.Credits} cr) | ${c.ProgramArea || 'N/A'} | ${c.Description ? c.Description.substring(0, 100) : 'No description'}`).join('\n')}

Return a JSON array of exactly 3 objects with this structure:
[
  {
    "buCourseId": <integer id from catalog>,
    "buCode": "<course code>",
    "buTitle": "<course title>",
    "rank": <1, 2, or 3>,
    "confidenceScore": <0.0 to 1.0>,
    "rationale": "<2-3 sentence explanation of why this is a match>"
  }
]

Rank by confidence (highest first). If fewer than 3 good matches exist, still return 3 with lower confidence scores for the weaker candidates.`;

    this.logger.log(`Calling Claude API for course matching: ${extCourse.CourseCode}`);

    const message = await this.client.messages.create({
      model: this.config.get<string>('ANTHROPIC_MODEL', 'claude-opus-4-5'),
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    let candidates: CourseMatchResult[];

    try {
      // Model output parsed as JSON — deliberately dynamic until validated below.
      candidates = JSON.parse(responseText) as CourseMatchResult[];
    } catch (e) {
      this.logger.error(`Failed to parse AI response: ${responseText}`);
      throw new Error('AI returned invalid response');
    }

    // Replace any previous candidates for this evaluation.
    await this.db.query(`DELETE FROM AIMatchCandidates WHERE EvaluationId = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: evaluationId },
    ]);

    for (const candidate of candidates) {
      await this.db.query(
        `INSERT INTO AIMatchCandidates (EvaluationId, Rank, BUCourseId, Score, Rationale)
         VALUES (@evalId, @rank, @buId, @score, @rationale)`,
        [
          { name: 'evalId', type: sql.UniqueIdentifier, value: evaluationId },
          { name: 'rank', type: sql.Int, value: candidate.rank },
          { name: 'buId', type: sql.Int, value: candidate.buCourseId },
          { name: 'score', type: sql.Decimal(5, 4), value: candidate.confidenceScore },
          { name: 'rationale', type: sql.NVarChar(sql.MAX), value: candidate.rationale },
        ],
      ).catch((err: Error) => this.logger.error(`Failed to store candidate ${candidate.buCourseId}: ${err.message}`));
    }

    const top = [...candidates].sort((a, b) => a.rank - b.rank)[0];
    if (top) {
      await this.db.query(
        `UPDATE Evaluations
         SET AISuggestionRaw = @raw, AISuggestedCourseId = @courseId,
             AIConfidence = @conf, AIRationale = @rationale,
             Status = CASE WHEN Status = 'queued' THEN 'in_progress' ELSE Status END,
             UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id`,
        [
          { name: 'raw', type: sql.NVarChar(sql.MAX), value: JSON.stringify(candidates) },
          { name: 'courseId', type: sql.Int, value: top.buCourseId },
          { name: 'conf', type: sql.Decimal(5, 4), value: top.confidenceScore },
          { name: 'rationale', type: sql.NVarChar(sql.MAX), value: top.rationale },
          { name: 'id', type: sql.UniqueIdentifier, value: evaluationId },
        ],
      );

      // Confident top match -> surface it as "likely" on the student's transcript view.
      if (top.confidenceScore >= AUTO_LIKELY_THRESHOLD) {
        await this.db.query(
          `UPDATE TranscriptCourses SET Lane = 'likely', UpdatedAt = SYSUTCDATETIME()
           WHERE Id = @id AND Lane = 'needs_syllabus'`,
          [{ name: 'id', type: sql.UniqueIdentifier, value: extCourse.TcId }],
        );
      }
    }

    return candidates;
  }

  async generateSummary(transcriptId: string): Promise<string> {
    const res = await this.db.query<TranscriptSummaryRow>(
      `SELECT t.Id, t.Status,
              u.FirstName + ' ' + u.LastName AS StudentName,
              i.Name AS InstitutionName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS TotalCourses,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'applied') AS Applied,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane IN ('pending','needs_syllabus','likely')) AS Pending,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'not_eligible') AS NotEligible,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'elective_only') AS Elective
       FROM Transcripts t
       JOIN Users u        ON u.Id = t.StudentUserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    if (!res.recordset[0]) throw new NotFoundException('Transcript not found');
    const data = res.recordset[0];

    const message = await this.client.messages.create({
      model: this.config.get<string>('ANTHROPIC_MODEL_SUMMARY', 'claude-haiku-4-5'),
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write a brief 2-3 sentence professional summary for a transcript evaluation report.
Student: ${data.StudentName}, from ${data.InstitutionName}.
Total courses: ${data.TotalCourses}, Applied: ${data.Applied}, Pending: ${data.Pending}, Elective only: ${data.Elective}, Not eligible: ${data.NotEligible}.
Status: ${data.Status}. Be concise and factual.`,
      }],
    });

    return message.content[0].type === 'text' ? message.content[0].text : '';
  }
}
