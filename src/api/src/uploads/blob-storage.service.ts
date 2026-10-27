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
      c = client.createIfNotExists().then(() => client);
      c.catch(() => this.containers.delete(name));
      this.containers.set(name, c);
    }
    return c;
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
