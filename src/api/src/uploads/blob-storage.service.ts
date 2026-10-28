import { Injectable, Logger } from '@nestjs/common';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';

export type StorageProvider = 'blob' | 'local';

const LOCAL_ROOT = path.join(process.cwd(), 'storage');

/**
 * Thin wrapper over Azure Blob Storage with a local-disk fallback used only
 * when AZURE_STORAGE_CONNECTION_STRING is unset (local dev). Everything is
 * async/streamed so a large upload never blocks the event loop.
 */
@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly service: BlobServiceClient | null;
  private readonly containers = new Map<string, Promise<ContainerClient>>();

  readonly privateContainer = process.env.AZURE_STORAGE_CONTAINER_PRIVATE || 'student-documents';
  readonly publicContainer = process.env.AZURE_STORAGE_CONTAINER_PUBLIC || 'public-assets';

  constructor() {
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    this.service = conn ? BlobServiceClient.fromConnectionString(conn) : null;
    if (!this.service) {
      this.logger.warn('AZURE_STORAGE_CONNECTION_STRING not set - uploads fall back to local disk (not for production)');
    }
  }

  get provider(): StorageProvider {
    return this.service ? 'blob' : 'local';
  }

  private container(name: string): Promise<ContainerClient> {
    let c = this.containers.get(name);
    if (!c) {
      const client = this.service!.getContainerClient(name);
      // The public container allows anonymous read of individual blobs (never listing), so logos/banners are loaded
      // straight from Storage. If the account forbids public access, fall back to a private container (served via the API).
      c = (name === this.publicContainer
        ? client.createIfNotExists({ access: 'blob' }).catch((e) => {
            this.logger.warn(`Could not create public container with blob access (${e?.code || e?.message}); creating it private`);
            return client.createIfNotExists();
          })
        : client.createIfNotExists()
      ).then(() => client);
      c.catch(() => this.containers.delete(name));
      this.containers.set(name, c);
    }
    return c;
  }

  private publicReadable: Promise<boolean> | null = null;
  private publicCheckedAt = 0;

  /** True when the public container allows anonymous blob reads; tries to switch an existing private container to blob access first. */
  private async ensurePublicAccess(): Promise<boolean> {
    try {
      const c = await this.container(this.publicContainer);
      let access = (await c.getAccessPolicy()).blobPublicAccess;
      if (access !== 'blob' && access !== 'container') {
        try {
          await c.setAccessPolicy('blob');
          access = (await c.getAccessPolicy()).blobPublicAccess;
        } catch (e) {
          this.logger.warn(`Public container is private and could not be opened for blob reads (${(e as { code?: string })?.code}); images are served via the API`);
        }
      }
      return access === 'blob' || access === 'container';
    } catch {
      return false;
    }
  }

  /**
   * Direct URL of a public blob (served by Azure Storage / a CDN, not the API), or null when it is not available:
   * local-disk mode, or the public container is not anonymously readable. `PUBLIC_ASSET_BASE_URL` (e.g. a CDN or custom
   * domain in front of the public container) overrides the storage account URL.
   */
  async publicUrl(blobName: string): Promise<string | null> {
    if (!this.service) return null;
    const override = process.env.PUBLIC_ASSET_BASE_URL?.replace(/\/+$/, '');
    if (!this.publicReadable || (this.publicCheckedAt && !(await this.publicReadable) && Date.now() - this.publicCheckedAt > 60_000)) {
      this.publicCheckedAt = Date.now();
      this.publicReadable = this.ensurePublicAccess();
    }
    if (!(await this.publicReadable)) return null;
    if (override) return `${override}/${encodeURIComponent(blobName)}`;
    const client = (await this.container(this.publicContainer)).getBlobClient(blobName);
    return client.url;
  }

  /** Diagnostics for the super-admin storage check: where files go and whether public images can load straight from Storage. */
  async status() {
    const base = { provider: this.provider, privateContainer: this.privateContainer, publicContainer: this.publicContainer, assetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || null };
    if (!this.service) return { ...base, connected: false, publicReadable: false, publicUrlExample: null, problem: 'AZURE_STORAGE_CONNECTION_STRING is not set: uploads go to the server disk, which is wiped on every deploy/restart.' };
    try {
      await this.ensurePublicAccess();
      const publicAccess = (await (await this.container(this.publicContainer)).getAccessPolicy()).blobPublicAccess ?? null;
      await this.container(this.privateContainer);
      const example = await this.publicUrl('example.webp');
      return { ...base, connected: true, publicAccess, publicReadable: publicAccess === 'blob' || publicAccess === 'container', publicUrlExample: example,
        problem: example ? null : 'The public container is private. Enable "Allow Blob anonymous access" on the storage account (Configuration), then set the container access level to Blob.' };
    } catch (e) {
      return { ...base, connected: false, publicReadable: false, publicUrlExample: null, problem: `Could not reach Storage: ${(e as { code?: string; message?: string })?.code || (e as Error)?.message}` };
    }
  }

  async put(container: string, blobName: string, data: Buffer, contentType?: string | null): Promise<void> {
    if (this.service) {
      const client = (await this.container(container)).getBlockBlobClient(blobName);
      await client.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' } });
      return;
    }
    const full = path.join(LOCAL_ROOT, container, blobName);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, data);
  }

  /** Returns a readable stream, or null if the object does not exist. */
  async get(provider: StorageProvider, container: string, blobName: string): Promise<Readable | null> {
    if (provider === 'blob') {
      if (!this.service) return null;
      const client = (await this.container(container)).getBlobClient(blobName);
      if (!(await client.exists())) return null;
      const res = await client.download();
      return (res.readableStreamBody as Readable) ?? null;
    }
    const full = path.isAbsolute(blobName) ? blobName : path.join(LOCAL_ROOT, container, blobName);
    return fs.existsSync(full) ? fs.createReadStream(full) : null;
  }

  /** Best-effort delete of a stored object. Missing objects are not an error. */
  async remove(provider: StorageProvider, container: string, blobName: string): Promise<void> {
    if (provider === 'blob') {
      if (!this.service) return;
      await (await this.container(container)).getBlobClient(blobName).deleteIfExists();
      return;
    }
    const full = path.isAbsolute(blobName) ? blobName : path.join(LOCAL_ROOT, container, blobName);
    await fs.promises.rm(full, { force: true });
  }
}
