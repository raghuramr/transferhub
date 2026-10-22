import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CoursesModule } from './courses/courses.module';
import { TranscriptsModule } from './transcripts/transcripts.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { AiModule } from './ai/ai.module';
import { AuditController } from './common/audit.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    TranscriptsModule,
    EvaluationsModule,
    AiModule,
  ],
  controllers: [AuditController],
})
export class AppModule {}
