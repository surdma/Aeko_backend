import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainError } from '../../common/errors/domain.error';
import { ConfigurationService } from '../../configuration/configuration/configuration.service';
import {
  MediaPort,
  type UploadImageInput,
  type UploadAttachmentInput,
  type UploadedMedia,
} from './media.port';

const UPLOAD_TIMEOUT_MILLISECONDS = 15_000;

@Injectable()
export class CloudinaryMediaAdapter extends MediaPort {
  constructor(private readonly configuration: ConfigurationService) {
    super();
  }

  async uploadChatAttachment(
    input: UploadAttachmentInput,
  ): Promise<UploadedMedia> {
    const { cloudName, apiKey, apiSecret } = this.credentials();
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const folder = `aeko/chats/${encodeURIComponent(input.chatId)}`;
    const publicId = createHash('sha256').update(input.bytes).digest('hex');
    const signature = createHash('sha1')
      .update(
        `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`,
      )
      .digest('hex');
    const form = new FormData();
    form.append(
      'file',
      new Blob([Uint8Array.from(input.bytes)], {
        type: input.declaredMimeType,
      }),
      input.filename,
    );
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('folder', folder);
    form.append('public_id', publicId);
    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MILLISECONDS),
        },
      );
      if (!response.ok) providerUnavailable();
      const body = parseProviderJson(await response.text());
      return {
        url: readString(body, 'secure_url'),
        providerId: readString(body, 'public_id'),
      };
    } catch {
      providerUnavailable();
    }
  }

  async uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia> {
    const { cloudName, apiKey, apiSecret } = this.credentials();

    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const folder = `aeko/users/${encodeURIComponent(input.ownerId)}`;
    const publicId = input.purpose;
    const signature = createHash('sha1')
      .update(
        `folder=${folder}&invalidate=true&overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`,
      )
      .digest('hex');
    const form = new FormData();
    const bytes = Uint8Array.from(input.bytes);
    form.append('file', new Blob([bytes], { type: input.mimeType }), 'image');
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('folder', folder);
    form.append('public_id', publicId);
    form.append('overwrite', 'true');
    form.append('invalidate', 'true');

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MILLISECONDS),
        },
      );
      if (!response.ok) providerUnavailable();
      const responseBody = parseProviderJson(await response.text());
      const url = readString(responseBody, 'secure_url');
      const providerId = readString(responseBody, 'public_id');
      if (!isHttpsUrl(url) || providerId !== `${folder}/${publicId}`) {
        providerUnavailable();
      }
      return { url, providerId };
    } catch (error: unknown) {
      if (
        error instanceof DomainError &&
        error.code === 'PROVIDER_UNAVAILABLE'
      ) {
        throw error;
      }
      providerUnavailable();
    }
  }

  async deleteProfileImage(providerId: string): Promise<void> {
    if (
      !providerId.startsWith('aeko/users/') ||
      providerId.includes('..') ||
      providerId.length > 300
    ) {
      providerUnavailable();
    }
    const { cloudName, apiKey, apiSecret } = this.credentials();
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = createHash('sha1')
      .update(
        `invalidate=true&public_id=${providerId}&timestamp=${timestamp}${apiSecret}`,
      )
      .digest('hex');
    const form = new FormData();
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('public_id', providerId);
    form.append('invalidate', 'true');

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MILLISECONDS),
        },
      );
      if (!response.ok) providerUnavailable();
      const responseBody = parseProviderJson(await response.text());
      const result = readString(responseBody, 'result');
      if (result !== 'ok' && result !== 'not found') providerUnavailable();
    } catch (error: unknown) {
      if (
        error instanceof DomainError &&
        error.code === 'PROVIDER_UNAVAILABLE'
      ) {
        throw error;
      }
      providerUnavailable();
    }
  }

  private credentials(): {
    readonly cloudName: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  } {
    const credentials = this.configuration.value.providerCredentials;
    const cloudName = credentials.cloudinaryCloudName;
    const apiKey = credentials.cloudinaryApiKey;
    const apiSecret = credentials.cloudinaryApiSecret;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Media uploads are not configured.',
      );
    }
    return { cloudName, apiKey, apiSecret };
  }
}

const parseProviderJson = (body: string): object => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    providerUnavailable();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    providerUnavailable();
  }
  return parsed;
};

const readString = (value: object, key: string): string => {
  const property: unknown = Reflect.get(value, key);
  if (typeof property !== 'string') providerUnavailable();
  return property;
};

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
};

function providerUnavailable(): never {
  throw new DomainError(
    'PROVIDER_UNAVAILABLE',
    'The media provider is temporarily unavailable.',
  );
}
