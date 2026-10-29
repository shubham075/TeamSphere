import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Global, Inject, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const URL_TTL_MS = 12 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** S3-compatible object storage (SeaweedFS in dev, any S3 in production). */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly signingKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
    this.signingKey = createHmac('sha256', env.JWT_ACCESS_SECRET).update('file-urls').digest();
  }

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket "${this.bucket}"`);
      } catch (e) {
        this.logger.error(`Object storage unavailable: ${e}`);
      }
    }
  }

  async put(key: string, body: Readable | Buffer, contentType: string, size: number) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: size }),
    );
  }

  async get(key: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return { body: res.Body as Readable, contentType: res.ContentType, size: res.ContentLength };
  }

  /** Partial read for HTTP Range requests (video/audio seeking). `range` is an HTTP Range header value. */
  async getRange(key: string, range: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    return { body: res.Body as Readable, contentRange: res.ContentRange, size: res.ContentLength };
  }

  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }

  /**
   * Signed, time-limited query string for `<img src>`-style downloads that can't send an Authorization header.
   * Expiry is rounded to the hour so the URL (and browser cache) stays stable for a while.
   */
  sign(resourceId: string): string {
    const exp = Math.ceil((Date.now() + URL_TTL_MS) / HOUR) * HOUR;
    return `exp=${exp}&sig=${this.signature(resourceId, exp)}`;
  }

  verify(resourceId: string, exp: string | undefined, sig: string | undefined): boolean {
    const expiry = Number(exp);
    if (!sig || !Number.isFinite(expiry) || expiry < Date.now()) return false;
    const expected = Buffer.from(this.signature(resourceId, expiry));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private signature(resourceId: string, exp: number) {
    return createHmac('sha256', this.signingKey).update(`${resourceId}.${exp}`).digest('base64url');
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
