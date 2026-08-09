/**
 * Anchoring, minting, and verification are owned by the `chain` domain
 * (programme order 9). Content routes depend only on this typed port; the real
 * adapter lands with that domain, so the installed adapter reports the
 * capability as unavailable rather than pretending to succeed.
 */

export interface AnchorRequest {
  readonly postId: string;
  readonly ownerId: string;
  readonly contentHash: string;
}

export interface AnchorReceipt {
  readonly transactionHash: string;
  readonly anchoredAt: string;
}

export interface MintRequest {
  readonly postId: string;
  readonly ownerId: string;
  readonly metadataUri: string;
}

export interface MintReceipt {
  readonly tokenId: string;
  readonly transactionHash: string;
}

export interface VerificationResult {
  readonly anchored: boolean;
  readonly transactionHash: string | null;
  readonly anchoredAt: string | null;
}

export abstract class ContentChainPort {
  abstract anchor(request: AnchorRequest): Promise<AnchorReceipt>;
  abstract mint(request: MintRequest): Promise<MintReceipt>;
  abstract verify(postId: string): Promise<VerificationResult>;
}
