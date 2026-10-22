import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';

interface CourseMatchResult {
  buCourseId: number;
  buCode: string;
  buTitle: string;
  rank: number;
  confidenceScore: number;
  rationale: string;
}

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

  async matchCourse(transcriptCourseId: number, requestedByUserId: string): Promise<CourseMatchResult[]> {
    // Load transcript course details
    const courseRes = await this.db.query<any>(
      `SELECT tc.Id, tc.ExternalCode, tc.ExternalTitle, tc.CreditsConverted, tc.CreditType,
              i.Name AS InstitutionName, i.State AS InstitutionState
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE tc.Id = @id`,
      [{ name: 'id', type: sql.Int, value: transcriptCourseId }],
    );

    if (!courseRes.recordset[0]) {
      throw new Error('Transcript course not found');
    }

    const extCourse = courseRes.recordset[0];

    // Load BU courses for context
    const buRes = await this.db.query<any>(
      `SELECT c.Id, c.Code, c.Title, c.Credits, c.Description, d.Name AS Dept
       FROM Courses c
       JOIN Institutions i ON i.Id = c.InstitutionId
       LEFT JOIN Departments d ON d.Id = c.DepartmentId
       WHERE i.Code = 'BU' AND c.IsActive = 1
       ORDER BY c.Code`,
    );

    const buCourses = buRes.recordset;

    const systemPrompt = `You are an expert academic advisor at Boston University (BU) specializing in transfer credit evaluation.
Your job is to analyze an external course and identify the top 3 most likely BU equivalent courses.
You must return ONLY a valid JSON array with exactly 3 elements, no markdown, no explanation outside the JSON.`;

    const userPrompt = `Evaluate this external course and identify the top 3 BU course equivalents.

EXTERNAL COURSE:
- Institution: ${extCourse.InstitutionName} (${extCourse.InstitutionState})
- Course Code: ${extCourse.ExternalCode}
- Course Title: ${extCourse.ExternalTitle}
- Credits: ${extCourse.CreditsConverted} (${extCourse.CreditType})

BU COURSE CATALOG (${buCourses.length} courses):
${buCourses.map(c => `[ID:${c.Id}] ${c.Code} - ${c.Title} (${c.Credits} cr) | Dept: ${c.Dept || 'N/A'} | ${c.Description ? c.Description.substring(0, 100) : 'No description'}`).join('\n')}

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

    this.logger.log(`Calling Claude API for course matching: ${extCourse.ExternalCode}`);

    const message = await this.client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    let candidates: CourseMatchResult[];

    try {
      candidates = JSON.parse(responseText);
    } catch (e) {
      this.logger.error(`Failed to parse AI response: ${responseText}`);
      throw new Error('AI returned invalid response');
    }

    // Store candidates in database
    for (const candidate of candidates) {
      await this.db.query(
        `MERGE AIMatchCandidates AS target
         USING (SELECT @tcId, @buId) AS src(TcId, BuId)
         ON target.TranscriptCourseId = src.TcId AND target.BuCourseId = src.BuId
         WHEN MATCHED THEN UPDATE SET Rank = @rank, ConfidenceScore = @score, Rationale = @rationale, GeneratedAt = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (TranscriptCourseId, BuCourseId, Rank, ConfidenceScore, Rationale, RequestedByUserId)
                           VALUES (@tcId, @buId, @rank, @score, @rationale, @reqBy);`,
        [
          { name: 'tcId', type: sql.Int, value: transcriptCourseId },
          { name: 'buId', type: sql.Int, value: candidate.buCourseId },
          { name: 'rank', type: sql.Int, value: candidate.rank },
          { name: 'score', type: sql.Decimal(3, 2), value: candidate.confidenceScore },
          { name: 'rationale', type: sql.NVarChar(sql.MAX), value: candidate.rationale },
          { name: 'reqBy', type: sql.UniqueIdentifier, value: requestedByUserId },
        ],
      ).catch(err => this.logger.error(`Failed to store candidate ${candidate.buCourseId}: ${err.message}`));
    }

    // Update lane to indicate AI candidates are available
    await this.db.query(
      `UPDATE TranscriptCourses SET Lane = 'pending' WHERE Id = @id AND Lane = 'pending'`,
      [{ name: 'id', type: sql.Int, value: transcriptCourseId }],
    );

    return candidates;
  }

  async generateSummary(transcriptId: number): Promise<string> {
    const res = await this.db.query<any>(
      `SELECT t.Id, t.Status,
              u.FirstName + ' ' + u.LastName AS StudentName,
              i.Name AS InstitutionName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS TotalCourses,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'applied') AS Applied,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'pending') AS Pending,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'not_eligible') AS NotEligible,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'elective_only') AS Elective
       FROM Transcripts t
       JOIN StudentProfiles sp ON sp.Id = t.StudentProfileId
       JOIN Users u ON u.Id = sp.UserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.Int, value: transcriptId }],
    );

    if (!res.recordset[0]) throw new Error('Transcript not found');
    const data = res.recordset[0];

    const message = await this.client.messages.create({
      model: 'claude-haiku-4-5',
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
