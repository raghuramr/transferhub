import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AiModule } from '../ai/ai.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { AnthropicDocumentReader, PausedDocumentReader } from './document-reader';
import { RulesDocumentReader } from './rules-document-reader';
import { AzureDocumentIntelligenceReader } from './azure-document-reader';

@Module({
  imports: [AuthModule, UploadsModule, AiModule],
  providers: [DocumentsService, AnthropicDocumentReader, PausedDocumentReader, RulesDocumentReader, AzureDocumentIntelligenceReader],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
