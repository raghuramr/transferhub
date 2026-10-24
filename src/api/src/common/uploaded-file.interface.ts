/**
 * Minimal shape of the file object multer's `FileInterceptor` attaches via
 * `@UploadedFile()`. We don't have `@types/multer` installed (only
 * `@nestjs/platform-express`), so `Express.Multer.File` isn't available —
 * this covers exactly the fields this codebase actually reads off it.
 */
export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}
