import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';

/** AppSettings keys that hold the AI provider configuration (global). */
const K = {
  chatProvider: 'ai.chat_provider',
  anthropicKey: 'ai.anthropic_api_key',
  azEndpoint: 'ai.azure_openai_endpoint',
  anthropicBaseUrl: 'ai.anthropic_base_url',
  azKey: 'ai.azure_openai_api_key',
  azDeployment: 'ai.azure_openai_deployment',
  azApiVersion: 'ai.azure_openai_api_version',
  docProvider: 'ai.doc_provider',
  docEndpoint: 'ai.azure_doc_endpoint',
  docKey: 'ai.azure_doc_api_key',
} as const;

/** 'none' = no cloud chat provider (the built-in rules engine only); `custom:<id>` = a provider the admin added (OpenAI-compatible API). */
export type ChatProvider = 'none' | 'anthropic' | 'azure_openai' | `custom:${string}`;
export type DocProvider = 'none' | 'azure_document_intelligence';

/** An admin-added chat provider speaking the OpenAI "chat completions" API (OpenAI, Azure AI Foundry /openai/v1, OpenRouter, vLLM, Ollama...). */
export interface CustomProvider {
  id: string;
  name: string;
  /** e.g. https://api.openai.com/v1 - "/chat/completions" is appended. */
  baseUrl: string;
  model: string;
  apiKey: string | null;
  /** bearer = "Authorization: Bearer <key>", api-key = "api-key: <key>" (Azure style). */
  authStyle: 'bearer' | 'api-key';
}

/** Full config including secrets — server-side only, never returned to the browser. */
export interface AiProviderConfig {
  chatProvider: ChatProvider;
  anthropicKey: string | null;
  anthropicBaseUrl: string | null;
  customProviders: CustomProvider[];
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
  anthropicBaseUrl: string | null;
  customProviders: { id: string; name: string; baseUrl: string; model: string; authStyle: 'bearer' | 'api-key'; keySet: boolean }[];
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
  anthropicBaseUrl?: string;
  azureOpenAiEndpoint?: string;
  azureOpenAiKey?: string;
  azureOpenAiDeployment?: string;
  azureOpenAiApiVersion?: string;
  docProvider?: DocProvider;
  azureDocEndpoint?: string;
  azureDocKey?: string;
}

const DEFAULT_API_VERSION = '2024-06-01';
const CUSTOM_PREFIX = 'ai.custom.';
const CHUNK = 900; // AppSettings.SettingValue is NVARCHAR(1000)
const CUSTOM_KEY_RE = /^ai\.custom\.([a-z0-9]+)(?:~(\d+))?$/;

const placeholder = (k: string | null) => !k || k.startsWith('REPLACE_WITH');

/** Is this chat provider complete enough to call right now? */
export function isChatReady(c: AiProviderConfig, which: ChatProvider = c.chatProvider): boolean {
  if (which === 'none') return false;
  if (which === 'azure_openai') return !!(c.azureOpenAiEndpoint && c.azureOpenAiKey && c.azureOpenAiDeployment);
  if (which === 'anthropic') return !placeholder(c.anthropicKey);
  const cp = c.customProviders.find((x) => `custom:${x.id}` === which);
  return !!(cp && cp.baseUrl && cp.model);
}

export function chatProviderLabel(c: AiProviderConfig, which: ChatProvider = c.chatProvider): string {
  if (which === 'none') return 'No cloud provider';
  if (which === 'azure_openai') return 'Azure OpenAI';
  if (which === 'anthropic') return 'Anthropic';
  return c.customProviders.find((x) => `custom:${x.id}` === which)?.name ?? 'Custom provider';
}

/** https only, no loopback / private / link-local hosts: the server will call this URL, so it must not reach internal services. */
export function assertSafeProviderUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new BadRequestException('The URL is not valid.'); }
  if (u.protocol !== 'https:') throw new BadRequestException('The URL must start with https://');
  const h = u.hostname.toLowerCase();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  const blockedV4 = ipv4 && (() => { const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]; return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); })();
  if (blockedV4 || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]' || h.startsWith('[')) {
    throw new BadRequestException('Private, local and IP-literal addresses are not allowed. Use the provider\'s public https hostname.');
  }
  return u.toString().replace(/\/+$/, '');
}

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
      anthropicBaseUrl: m.get(K.anthropicBaseUrl) || null,
      customProviders: await this.readCustom(),
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
      anthropicBaseUrl: c.anthropicBaseUrl,
      customProviders: c.customProviders.map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl, model: x.model, authStyle: x.authStyle, keySet: !!x.apiKey })),
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
    if (input.chatProvider && input.chatProvider.startsWith('custom:')) {
      const id = input.chatProvider.slice(7);
      if (!(await this.readCustom()).some((x) => x.id === id)) throw new BadRequestException('That provider no longer exists.');
    } else if (input.chatProvider && !['none', 'anthropic', 'azure_openai'].includes(input.chatProvider)) {
      throw new BadRequestException('Unknown provider.');
    }
    const pairs: [string, string | undefined][] = [
      [K.chatProvider, input.chatProvider],
      [K.anthropicKey, input.anthropicKey],
      [K.anthropicBaseUrl, input.anthropicBaseUrl ? assertSafeProviderUrl(input.anthropicBaseUrl) : input.anthropicBaseUrl],
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

  // ── custom (admin-added) chat providers ──

  private async readCustom(): Promise<CustomProvider[]> {
    if (!(await this.schema.has('AppSettings'))) return [];
    try {
      const r = await this.db.query<{ SettingKey: string; SettingValue: string | null }>(`SELECT SettingKey, SettingValue FROM AppSettings WHERE SettingKey LIKE 'ai.custom.%'`);
      const parts = new Map<string, string[]>();
      for (const row of r.recordset) {
        const m = CUSTOM_KEY_RE.exec(row.SettingKey);
        if (!m) continue;
        const arr = parts.get(m[1]) ?? [];
        arr[m[2] ? Number(m[2]) : 0] = row.SettingValue ?? '';
        parts.set(m[1], arr);
      }
      const out: CustomProvider[] = [];
      for (const [id, arr] of parts) {
        try {
          const o = JSON.parse(Array.from(arr, (x) => x ?? '').join('')) as Omit<CustomProvider, 'id'>;
          if (o && typeof o === 'object') out.push({ ...o, id, apiKey: o.apiKey || null, authStyle: o.authStyle === 'api-key' ? 'api-key' : 'bearer' });
        } catch { /* unreadable: skipped */ }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private async writeCustom(id: string, body: Omit<CustomProvider, 'id'>, by: string) {
    const json = JSON.stringify(body);
    const names: string[] = [];
    for (let i = 0; i * CHUNK < json.length; i++) {
      const name = i === 0 ? `${CUSTOM_PREFIX}${id}` : `${CUSTOM_PREFIX}${id}~${i}`;
      names.push(name);
      await this.db.query(
        `MERGE AppSettings AS t USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
        [{ name: 'k', type: sql.VarChar(100), value: name }, { name: 'v', type: sql.NVarChar(1000), value: json.slice(i * CHUNK, (i + 1) * CHUNK) }, { name: 'by', type: sql.NVarChar(254), value: by }],
      );
    }
    await this.db.query(
      `DELETE FROM AppSettings WHERE SettingKey LIKE @p AND SettingKey NOT IN (${names.map((_, i) => `@n${i}`).join(', ')})`,
      [{ name: 'p', type: sql.VarChar(100), value: `${CUSTOM_PREFIX}${id}~%` }, ...names.map((n, i) => ({ name: `n${i}`, type: sql.VarChar(100), value: n }))],
    );
  }

  /** Create (no id) or update a custom provider. A blank apiKey keeps the saved one on update. */
  async saveCustom(input: { id?: string; name: string; baseUrl: string; model: string; apiKey?: string; authStyle?: 'bearer' | 'api-key' }, by: string): Promise<AiProviderPublic> {
    if (!(await this.schema.has('AppSettings'))) throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    const name = input.name.trim();
    const model = input.model.trim();
    if (!name) throw new BadRequestException('Give the provider a name.');
    if (!model) throw new BadRequestException('Enter the model name to call.');
    const baseUrl = assertSafeProviderUrl(input.baseUrl);
    const existing = await this.readCustom();
    const before = input.id ? existing.find((x) => x.id === input.id) : undefined;
    if (input.id && !before) throw new NotFoundException('No such provider');
    if (!before && existing.length >= 10) throw new BadRequestException('At most 10 custom providers.');
    const id = before?.id ?? randomBytes(5).toString('hex');
    await this.writeCustom(id, { name: name.slice(0, 80), baseUrl, model: model.slice(0, 120), apiKey: input.apiKey?.trim() || before?.apiKey || null, authStyle: input.authStyle === 'api-key' ? 'api-key' : 'bearer' }, by);
    this.clearCache();
    return this.getPublic();
  }

  async removeCustom(id: string, by: string): Promise<AiProviderPublic> {
    const before = (await this.readCustom()).find((x) => x.id === id);
    if (!before) throw new NotFoundException('No such provider');
    await this.db.query(`DELETE FROM AppSettings WHERE SettingKey = @k OR SettingKey LIKE @p`, [
      { name: 'k', type: sql.VarChar(100), value: `${CUSTOM_PREFIX}${id}` },
      { name: 'p', type: sql.VarChar(100), value: `${CUSTOM_PREFIX}${id}~%` },
    ]);
    this.clearCache();
    if ((await this.getConfig()).chatProvider === `custom:${id}`) await this.save({ chatProvider: 'none' }, by);
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
