import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';

/** AppSettings keys that hold the AI provider configuration (global). */
const K = {
  chatProvider: 'ai.chat_provider',
  anthropicKey: 'ai.anthropic_api_key',
  azEndpoint: 'ai.azure_openai_endpoint',
  azKey: 'ai.azure_openai_api_key',
  azDeployment: 'ai.azure_openai_deployment',
  azApiVersion: 'ai.azure_openai_api_version',
  docProvider: 'ai.doc_provider',
  docEndpoint: 'ai.azure_doc_endpoint',
  docKey: 'ai.azure_doc_api_key',
} as const;

export type ChatProvider = 'anthropic' | 'azure_openai';
export type DocProvider = 'none' | 'azure_document_intelligence';

/** Full config including secrets — server-side only, never returned to the browser. */
export interface AiProviderConfig {
  chatProvider: ChatProvider;
  anthropicKey: string | null;
  azureOpenAiEndpoint: string | null;
  azureOpenAiKey: string | null;
  azureOpenAiDeployment: string | null;
  azureOpenAiApiVersion: string;
  docProvider: DocProvider;
  azureDocEndpoint: string | null;
  azureDocKey: string | null;
}

/** Safe view for the settings screen — booleans instead of the secrets themselves. */
export interface AiProviderPublic {
  ready: boolean;
  chatProvider: ChatProvider;
  anthropicKeySet: boolean;
  azureOpenAiEndpoint: string | null;
  azureOpenAiKeySet: boolean;
  azureOpenAiDeployment: string | null;
  azureOpenAiApiVersion: string;
  docProvider: DocProvider;
  azureDocEndpoint: string | null;
  azureDocKeySet: boolean;
}

export interface SaveAiProvidersInput {
  chatProvider?: ChatProvider;
  anthropicKey?: string;
  azureOpenAiEndpoint?: string;
  azureOpenAiKey?: string;
  azureOpenAiDeployment?: string;
  azureOpenAiApiVersion?: string;
  docProvider?: DocProvider;
  azureDocEndpoint?: string;
  azureDocKey?: string;
}

const DEFAULT_API_VERSION = '2024-06-01';

@Injectable()
export class AiProvidersService {
  private cache: { at: number; cfg: AiProviderConfig } | null = null;

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  private clearCache() { this.cache = null; }

  /** Full config (with secrets) for server-side use. Cached 15s. Env vars are the fallback for keys. */
  async getConfig(): Promise<AiProviderConfig> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.cfg;
    const m = await this.readAll();
    const cfg: AiProviderConfig = {
      chatProvider: (m.get(K.chatProvider) as ChatProvider) || 'anthropic',
      anthropicKey: m.get(K.anthropicKey) || process.env.ANTHROPIC_API_KEY || null,
      azureOpenAiEndpoint: m.get(K.azEndpoint) || null,
      azureOpenAiKey: m.get(K.azKey) || null,
      azureOpenAiDeployment: m.get(K.azDeployment) || null,
      azureOpenAiApiVersion: m.get(K.azApiVersion) || DEFAULT_API_VERSION,
      docProvider: (m.get(K.docProvider) as DocProvider) || 'none',
      azureDocEndpoint: m.get(K.docEndpoint) || null,
      azureDocKey: m.get(K.docKey) || null,
    };
    this.cache = { at: now, cfg };
    return cfg;
  }

  /** Masked view for the settings screen. */
  async getPublic(): Promise<AiProviderPublic> {
    const ready = await this.schema.has('AppSettings');
    const c = await this.getConfig();
    const notPlaceholder = (k: string | null) => !!k && !k.startsWith('REPLACE_WITH');
    return {
      ready,
      chatProvider: c.chatProvider,
      anthropicKeySet: notPlaceholder(c.anthropicKey),
      azureOpenAiEndpoint: c.azureOpenAiEndpoint,
      azureOpenAiKeySet: notPlaceholder(c.azureOpenAiKey),
      azureOpenAiDeployment: c.azureOpenAiDeployment,
      azureOpenAiApiVersion: c.azureOpenAiApiVersion,
      docProvider: c.docProvider,
      azureDocEndpoint: c.azureDocEndpoint,
      azureDocKeySet: notPlaceholder(c.azureDocKey),
    };
  }

  /** Save only the provided fields. '' clears a value; omitted keeps it. */
  async save(input: SaveAiProvidersInput, byEmail: string): Promise<AiProviderPublic> {
    if (!(await this.schema.has('AppSettings'))) {
      throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    }
    const pairs: [string, string | undefined][] = [
      [K.chatProvider, input.chatProvider],
      [K.anthropicKey, input.anthropicKey],
      [K.azEndpoint, input.azureOpenAiEndpoint],
      [K.azKey, input.azureOpenAiKey],
      [K.azDeployment, input.azureOpenAiDeployment],
      [K.azApiVersion, input.azureOpenAiApiVersion],
      [K.docProvider, input.docProvider],
      [K.docEndpoint, input.azureDocEndpoint],
      [K.docKey, input.azureDocKey],
    ];
    for (const [key, val] of pairs) {
      if (val === undefined) continue; // keep as-is
      await this.db.query(
        `MERGE AppSettings AS t
         USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
        [
          { name: 'k', type: sql.VarChar(100), value: key },
          { name: 'v', type: sql.NVarChar(1000), value: val === '' ? null : val.trim() },
          { name: 'by', type: sql.NVarChar(254), value: byEmail },
        ],
      );
    }
    this.clearCache();
    return this.getPublic();
  }

  private async readAll(): Promise<Map<string, string | null>> {
    const empty = new Map<string, string | null>();
    if (!(await this.schema.has('AppSettings'))) return empty;
    try {
      const keys = Object.values(K);
      const res = await this.db.query<{ SettingKey: string; SettingValue: string | null }>(
        `SELECT SettingKey, SettingValue FROM AppSettings WHERE SettingKey IN (${keys.map((_, i) => `@k${i}`).join(', ')})`,
        keys.map((k, i) => ({ name: `k${i}`, type: sql.VarChar(100), value: k })),
      );
      return new Map(res.recordset.map((r) => [r.SettingKey, r.SettingValue]));
    } catch {
      return empty;
    }
  }
}
