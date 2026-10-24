import {
  Controller, Post, Body, UseGuards, Get,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ImportService } from './import.service';
import { ImportPayloadDto } from './dto/import-payload.dto';

@Controller('import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class ImportController {
  constructor(private importService: ImportService) {}

  /** Returns the expected JSON schemas for each importable entity type */
  @Get('format')
  getFormat() {
    return {
      types: ['universities', 'programs', 'courses'],
      schemas: {
        universities: {
          description: 'Import universities / institutions',
          example: {
            type: 'universities',
            data: [
              {
                code: 'MIT',
                name: 'Massachusetts Institute of Technology',
                type: 'University',
                country: 'USA',
                state: 'MA',
                city: 'Cambridge',
                website: 'https://www.mit.edu',
              },
            ],
          },
          requiredFields: ['code', 'name'],
          optionalFields: ['type', 'country', 'state', 'city', 'website'],
        },
        programs: {
          description: 'Import academic programs (university must already exist)',
          example: {
            type: 'programs',
            data: [
              {
                name: 'Computer Science',
                code: 'CS',
                universityCode: 'MIT',
                description: 'Bachelor of Science in Computer Science',
              },
            ],
          },
          requiredFields: ['name', 'code', 'universityCode'],
          optionalFields: ['description'],
        },
        courses: {
          description: 'Import courses with optional topics (university and program must already exist)',
          example: {
            type: 'courses',
            data: [
              {
                code: 'CS101',
                name: 'Introduction to Computer Science',
                credits: 3,
                universityCode: 'MIT',
                programCode: 'CS',
                description: 'Fundamentals of programming and computational thinking',
                topics: [
                  { title: 'Variables and Data Types', description: 'Understanding basic data types' },
                  { title: 'Control Flow', description: 'Loops, conditionals and functions' },
                ],
              },
            ],
          },
          requiredFields: ['code', 'name', 'credits', 'universityCode'],
          optionalFields: ['programCode', 'description', 'topics'],
        },
      },
    };
  }

  /** Preview import without saving — returns what would be created/updated */
  @Post('preview')
  async preview(@Body() dto: ImportPayloadDto) {
    return this.importService.preview(dto);
  }

  /** Execute the import (super_admin only) */
  @Post()
  async execute(@Body() dto: ImportPayloadDto) {
    return this.importService.execute(dto);
  }
}
