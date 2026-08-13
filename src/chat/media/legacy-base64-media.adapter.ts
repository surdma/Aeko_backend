import { DomainError } from '../../common/errors/domain.error';
const MAX_LEGACY_BYTES = 1024 * 1024;
export class LegacyBase64MediaAdapter {
  decode(value: string): Uint8Array {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match)
      throw new DomainError(
        'VALIDATION_FAILED',
        'Invalid legacy media payload',
      );
    const bytes = Uint8Array.from(Buffer.from(match[2] ?? '', 'base64'));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LEGACY_BYTES)
      throw new DomainError(
        'VALIDATION_FAILED',
        'Legacy media payload is too large',
      );
    return bytes;
  }
}
