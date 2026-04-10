/**
 * Polygon blockchain integration for DID-VC platform
 *
 * Supports:
 * - DID registration on Polygon (via DIDRegistry smart contract)
 * - VC hash anchoring (via VCRegistry smart contract)
 * - On-chain revocation
 * - On-chain verification
 *
 * Falls back to demo mode when contract addresses not configured.
 */
import { ethers } from 'ethers';
import crypto from 'crypto';
import { DID_REGISTRY_ABI, VC_REGISTRY_ABI } from './contractABIs.js';

export interface OnChainDIDInfo {
  didString: string;
  publicKeyHex: string;
  controller: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  txHash?: string;
}

export interface OnChainVCInfo {
  vcId: string;
  vcHash: string;
  issuerDid: string;
  holderDid: string;
  credentialType: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  txHash?: string;
}

export interface VCVerificationResult {
  hashValid: boolean;
  isRevoked: boolean;
  isExpired: boolean;
  exists: boolean;
  onChain: boolean;
}

// Demo mode in-memory stores
const demoDidStore = new Map<string, OnChainDIDInfo>();
const demoVCStore = new Map<string, OnChainVCInfo>();

export class PolygonService {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private network: string;
  private rpcUrl: string;
  private didRegistryAddress: string | null;
  private vcRegistryAddress: string | null;
  private didRegistry: ethers.Contract | null = null;
  private vcRegistry: ethers.Contract | null = null;
  private demoMode: boolean;

  constructor() {
    this.network = process.env.POLYGON_NETWORK || 'amoy';
    this.rpcUrl = this.resolveRpcUrl();
    this.didRegistryAddress = process.env.DID_REGISTRY_ADDRESS || null;
    this.vcRegistryAddress = process.env.VC_REGISTRY_ADDRESS || null;
    this.demoMode = !process.env.POLYGON_PRIVATE_KEY || !this.didRegistryAddress;

    if (!this.demoMode) {
      this.initializeContracts();
    } else {
      console.log('[Polygon] Running in DEMO mode - transactions will be simulated');
    }
  }

  private resolveRpcUrl(): string {
    if (process.env.POLYGON_RPC_URL) return process.env.POLYGON_RPC_URL;
    const urls: Record<string, string> = {
      amoy: 'https://rpc-amoy.polygon.technology',
      mumbai: 'https://rpc-mumbai.maticvigil.com',
      polygon: 'https://polygon-rpc.com',
      mainnet: 'https://polygon-rpc.com',
    };
    return urls[process.env.POLYGON_NETWORK || 'amoy'] || urls.amoy;
  }

  private initializeContracts() {
    try {
      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
      this.signer = new ethers.Wallet(process.env.POLYGON_PRIVATE_KEY!, this.provider);

      if (this.didRegistryAddress) {
        this.didRegistry = new ethers.Contract(this.didRegistryAddress, DID_REGISTRY_ABI, this.signer);
      }
      if (this.vcRegistryAddress) {
        this.vcRegistry = new ethers.Contract(this.vcRegistryAddress, VC_REGISTRY_ABI, this.signer);
      }
      console.log(`[Polygon] Connected to ${this.network} | DID Registry: ${this.didRegistryAddress} | VC Registry: ${this.vcRegistryAddress}`);
    } catch (error) {
      console.error('[Polygon] Failed to initialize contracts, falling back to demo mode:', error);
      this.demoMode = true;
    }
  }

  getNetwork(): string { return this.network; }
  getRpcUrl(): string { return this.rpcUrl; }
  isDemoMode(): boolean { return this.demoMode; }

  /**
   * Get Polygon status info
   */
  async getStatus(): Promise<{
    network: string;
    rpcUrl: string;
    demoMode: boolean;
    didRegistryAddress: string | null;
    vcRegistryAddress: string | null;
    signerAddress: string | null;
    blockNumber?: number;
  }> {
    let blockNumber: number | undefined;
    let signerAddress: string | null = null;

    if (!this.demoMode && this.provider) {
      try {
        blockNumber = await this.provider.getBlockNumber();
        signerAddress = this.signer?.address || null;
      } catch {}
    }

    return {
      network: this.network,
      rpcUrl: this.rpcUrl,
      demoMode: this.demoMode,
      didRegistryAddress: this.didRegistryAddress,
      vcRegistryAddress: this.vcRegistryAddress,
      signerAddress,
      blockNumber,
    };
  }

  /**
   * Register a DID on Polygon blockchain
   */
  async registerDID(did: string, publicKeyHex: string): Promise<{ txHash: string; blockNumber?: number }> {
    if (this.demoMode) {
      const mockTx = `0x${crypto.createHash('sha256').update(`did_reg:${did}:${Date.now()}`).digest('hex')}`;
      demoDidStore.set(did, {
        didString: did,
        publicKeyHex,
        controller: '0x0000000000000000000000000000000000000001',
        active: true,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        txHash: mockTx,
      });
      console.log(`[Polygon DEMO] DID registered: ${did} | Mock TX: ${mockTx}`);
      return { txHash: mockTx };
    }

    if (!this.didRegistry) throw new Error('DID Registry contract not initialized');

    try {
      const tx = await this.didRegistry.registerDID(did, publicKeyHex);
      const receipt = await tx.wait();
      console.log(`[Polygon] DID registered on-chain: ${did} | TX: ${tx.hash}`);
      return { txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (error: any) {
      if (error.message?.includes('DID already registered')) {
        return { txHash: 'already_registered' };
      }
      throw new Error(`Failed to register DID on Polygon: ${error.message}`);
    }
  }

  /**
   * Resolve a DID from Polygon blockchain
   */
  async resolveDIDFromChain(did: string): Promise<OnChainDIDInfo | null> {
    if (this.demoMode) {
      return demoDidStore.get(did) || null;
    }

    if (!this.didRegistry) return null;

    try {
      const [didString, publicKeyHex, controller, active, createdAt, updatedAt] =
        await this.didRegistry.resolveDID(did);
      if (!didString) return null;
      return {
        didString, publicKeyHex, controller, active,
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt),
      };
    } catch { return null; }
  }

  /**
   * Check if a DID is active on Polygon
   */
  async isDIDActive(did: string): Promise<boolean> {
    if (this.demoMode) {
      return demoDidStore.get(did)?.active || false;
    }
    if (!this.didRegistry) return false;
    try { return await this.didRegistry.isDIDActive(did); }
    catch { return false; }
  }

  /**
   * Deactivate a DID on Polygon
   */
  async deactivateDID(did: string): Promise<{ txHash: string }> {
    if (this.demoMode) {
      const entry = demoDidStore.get(did);
      if (entry) { entry.active = false; entry.updatedAt = Math.floor(Date.now() / 1000); }
      return { txHash: `0x${crypto.randomBytes(32).toString('hex')}` };
    }
    if (!this.didRegistry) throw new Error('DID Registry not initialized');
    const tx = await this.didRegistry.deactivateDID(did);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Anchor a Verifiable Credential hash on Polygon
   * Only stores the HASH (not the VC content) for privacy
   */
  async anchorVC(
    vcId: string,
    vcJson: object,
    issuerDid: string,
    holderDid: string,
    credentialType: string,
    expiresAt: Date
  ): Promise<{ txHash: string; vcHash: string; blockNumber?: number }> {
    const vcHash = this.hashVC(vcJson);
    const expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);

    if (this.demoMode) {
      const mockTx = `0x${crypto.createHash('sha256').update(`vc_anchor:${vcId}:${Date.now()}`).digest('hex')}`;
      demoVCStore.set(vcId, {
        vcId, vcHash, issuerDid, holderDid, credentialType,
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: expiresAtTimestamp,
        revoked: false,
        txHash: mockTx,
      });
      console.log(`[Polygon DEMO] VC anchored: ${vcId} | Hash: ${vcHash.slice(0, 20)}... | Mock TX: ${mockTx}`);
      return { txHash: mockTx, vcHash };
    }

    if (!this.vcRegistry) throw new Error('VC Registry contract not initialized');

    try {
      const vcHashBytes = ethers.getBytes(`0x${vcHash}`);
      const tx = await this.vcRegistry.issueVC(
        vcId,
        vcHashBytes,
        issuerDid,
        holderDid,
        credentialType,
        expiresAtTimestamp
      );
      const receipt = await tx.wait();
      console.log(`[Polygon] VC anchored on-chain: ${vcId} | TX: ${tx.hash}`);
      return { txHash: tx.hash, vcHash, blockNumber: receipt.blockNumber };
    } catch (error: any) {
      throw new Error(`Failed to anchor VC on Polygon: ${error.message}`);
    }
  }

  /**
   * Verify a VC against on-chain data
   */
  async verifyVCOnChain(vcId: string, vcJson: object): Promise<VCVerificationResult> {
    const computedHash = this.hashVC(vcJson);

    if (this.demoMode) {
      const record = demoVCStore.get(vcId);
      if (!record) return { hashValid: false, isRevoked: false, isExpired: false, exists: false, onChain: false };
      const now = Math.floor(Date.now() / 1000);
      return {
        hashValid: record.vcHash === computedHash,
        isRevoked: record.revoked,
        isExpired: record.expiresAt > 0 && now > record.expiresAt,
        exists: true,
        onChain: false, // demo mode
      };
    }

    if (!this.vcRegistry) {
      return { hashValid: false, isRevoked: false, isExpired: false, exists: false, onChain: false };
    }

    try {
      const hashBytes = ethers.getBytes(`0x${computedHash}`);
      const [hashValid, isRevoked, isExpired, exists] = await this.vcRegistry.verifyVC(vcId, hashBytes);
      return { hashValid, isRevoked, isExpired, exists, onChain: true };
    } catch (error) {
      console.error('[Polygon] verifyVC error:', error);
      return { hashValid: false, isRevoked: false, isExpired: false, exists: false, onChain: false };
    }
  }

  /**
   * Revoke a VC on Polygon
   */
  async revokeVCOnChain(vcId: string): Promise<{ txHash: string }> {
    if (this.demoMode) {
      const record = demoVCStore.get(vcId);
      if (record) record.revoked = true;
      return { txHash: `0x${crypto.randomBytes(32).toString('hex')}` };
    }

    if (!this.vcRegistry) throw new Error('VC Registry not initialized');
    const tx = await this.vcRegistry.revokeVC(vcId);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Check if a VC is revoked on Polygon
   */
  async isVCRevoked(vcId: string): Promise<boolean> {
    if (this.demoMode) {
      return demoVCStore.get(vcId)?.revoked || false;
    }
    if (!this.vcRegistry) return false;
    try { return await this.vcRegistry.isRevoked(vcId); }
    catch { return false; }
  }

  /**
   * Get VC info from on-chain
   */
  async getVCFromChain(vcId: string): Promise<OnChainVCInfo | null> {
    if (this.demoMode) return demoVCStore.get(vcId) || null;
    if (!this.vcRegistry) return null;
    try {
      const [vcHash, issuerDid, holderDid, credentialType, issuedAt, expiresAt, revoked] =
        await this.vcRegistry.getVC(vcId);
      if (!issuerDid) return null;
      return {
        vcId,
        vcHash: Buffer.from(ethers.getBytes(vcHash)).toString('hex'),
        issuerDid, holderDid, credentialType,
        issuedAt: Number(issuedAt),
        expiresAt: Number(expiresAt),
        revoked,
      };
    } catch { return null; }
  }

  /**
   * Get wallet balance on Polygon
   */
  async getBalance(address: string): Promise<string> {
    if (!this.provider) return '0';
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch { return '0'; }
  }

  /**
   * Compute keccak256-like hash of a VC (without proof field for consistency)
   */
  hashVC(vcJson: object): string {
    const { proof, ...vcWithoutProof } = vcJson as any;
    const canonical = JSON.stringify(vcWithoutProof, Object.keys(vcWithoutProof).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Create a Polygon DID from an Ethereum address
   * Format: did:polygon:{network}:0x...
   */
  createDIDFromAddress(address: string): string {
    return `did:polygon:${this.network}:${address.toLowerCase()}`;
  }
}

// Singleton export
let _instance: PolygonService | null = null;
export function getPolygonService(): PolygonService {
  if (!_instance) _instance = new PolygonService();
  return _instance;
}
