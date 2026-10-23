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
import { PagesModule } from './pages/pages.module';
import { FormsModule } from './forms/forms.module';
import { AuditController } from './common/audit.controller';
import { HealthController } from './common/health.controller';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFilePath =
  nodeEnv === 'test' ? ['.env.test', '.env']
  : nodeEnv === 'production' ? ['.env.production', '.env']
  : ['.env'];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    TranscriptsModule,
    EvaluationsModule,
    AiModule,
    PagesModule,
    FormsModule,
  ],
  controllers: [AuditController, HealthController],
})
export class AppModule {}
