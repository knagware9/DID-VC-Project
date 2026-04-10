/**
 * Browser Wallet Service - Local credential storage
 * Stores credentials securely in browser storage
 */
export interface VerifiableCredential { '@context': string[]; id?: string; type: string[]; issuer: string | { id: string }; issuanceDate: string; expirationDate?: string; credentialSubject: Record<string, any>; [key: string]: any; }

export interface WalletCredential {
  id: string;
  credential: VerifiableCredential;
  storedAt: string;
  issuer: string;
  type: string[];
  tags?: string[];
}

export interface WalletInfo {
  address: string;
  createdAt: string;
  credentialCount: number;
}

class BrowserWallet {
  private storageKey = 'did_vc_wallet';
  private addressKey = 'did_vc_wallet_address';
  private credentials: Map<string, WalletCredential> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Initialize or get wallet address
   */
  getAddress(): string {
    let address = localStorage.getItem(this.addressKey);
    if (!address) {
      // Generate a unique wallet address
      address = this.generateAddress();
      localStorage.setItem(this.addressKey, address);
    }
    return address;
  }

  /**
   * Generate a unique wallet address
   */
  private generateAddress(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `wallet_${timestamp}_${random}`;
  }

  /**
   * Store a credential in the wallet
   */
  async storeCredential(credential: VerifiableCredential): Promise<string> {
    const credentialId = credential.id || `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const walletCredential: WalletCredential = {
      id: credentialId,
      credential,
      storedAt: new Date().toISOString(),
      issuer: typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id,
      type: credential.type || [],
    };

    this.credentials.set(credentialId, walletCredential);
    this.saveToStorage();

    return credentialId;
  }

  /**
   * Get a credential by ID
   */
  async getCredential(credentialId: string): Promise<WalletCredential | null> {
    return this.credentials.get(credentialId) || null;
  }

  /**
   * Get all credentials
   */
  async getAllCredentials(): Promise<WalletCredential[]> {
    return Array.from(this.credentials.values());
  }

  /**
   * Get credentials by issuer
   */
  async getCredentialsByIssuer(issuerDid: string): Promise<WalletCredential[]> {
    return Array.from(this.credentials.values()).filter(
      (wc) => wc.issuer === issuerDid
    );
  }

  /**
   * Get credentials by type
   */
  async getCredentialsByType(type: string): Promise<WalletCredential[]> {
    return Array.from(this.credentials.values()).filter(
      (wc) => wc.type.includes(type)
    );
  }

  /**
   * Remove a credential from wallet
   */
  async removeCredential(credentialId: string): Promise<boolean> {
    const deleted = this.credentials.delete(credentialId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Add tags to a credential
   */
  async tagCredential(credentialId: string, tags: string[]): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    if (!credential) {
      return false;
    }

    credential.tags = [...new Set([...(credential.tags || []), ...tags])];
    this.saveToStorage();
    return true;
  }

  /**
   * Get credentials by tags
   */
  async getCredentialsByTags(tags: string[]): Promise<WalletCredential[]> {
    return Array.from(this.credentials.values()).filter((wc) => {
      if (!wc.tags || wc.tags.length === 0) return false;
      return tags.some((tag) => wc.tags!.includes(tag));
    });
  }

  /**
   * Get wallet info
   */
  getWalletInfo(): WalletInfo {
    const address = this.getAddress();
    const createdAt = localStorage.getItem(`${this.addressKey}_created`) || new Date().toISOString();
    if (!localStorage.getItem(`${this.addressKey}_created`)) {
      localStorage.setItem(`${this.addressKey}_created`, createdAt);
    }

    return {
      address,
      createdAt,
      credentialCount: this.credentials.size,
    };
  }

  /**
   * Export wallet (for backup)
   */
  async exportWallet(): Promise<string> {
    const walletData = {
      address: this.getAddress(),
      credentials: Array.from(this.credentials.values()),
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(walletData, null, 2);
  }

  /**
   * Import wallet (from backup)
   */
  async importWallet(jsonData: string): Promise<boolean> {
    try {
      const walletData = JSON.parse(jsonData);
      if (walletData.credentials && Array.isArray(walletData.credentials)) {
        // Merge imported credentials
        walletData.credentials.forEach((wc: WalletCredential) => {
          this.credentials.set(wc.id, wc);
        });
        this.saveToStorage();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to import wallet:', error);
      return false;
    }
  }

  /**
   * Clear all credentials
   */
  async clearWallet(): Promise<void> {
    this.credentials.clear();
    this.saveToStorage();
  }

  /**
   * Search credentials
   */
  async searchCredentials(query: string): Promise<WalletCredential[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.credentials.values()).filter((wc) => {
      const credentialStr = JSON.stringify(wc.credential).toLowerCase();
      return (
        credentialStr.includes(lowerQuery) ||
        wc.id.toLowerCase().includes(lowerQuery) ||
        wc.issuer.toLowerCase().includes(lowerQuery) ||
        wc.type.some((t) => t.toLowerCase().includes(lowerQuery))
      );
    });
  }

  /**
   * Save credentials to localStorage
   */
  private saveToStorage(): void {
    try {
      const credentialsArray = Array.from(this.credentials.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(credentialsArray));
    } catch (error) {
      console.error('Failed to save wallet to storage:', error);
      // If localStorage is full, try to use IndexedDB as fallback
      this.saveToIndexedDB();
    }
  }

  /**
   * Load credentials from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const credentialsArray = JSON.parse(stored);
        this.credentials = new Map(credentialsArray);
      }
    } catch (error) {
      console.error('Failed to load wallet from storage:', error);
      this.loadFromIndexedDB();
    }
  }

  /**
   * Fallback: Save to IndexedDB
   */
  private async saveToIndexedDB(): Promise<void> {
    // IndexedDB implementation can be added if needed
    console.warn('IndexedDB fallback not implemented');
  }

  /**
   * Fallback: Load from IndexedDB
   */
  private async loadFromIndexedDB(): Promise<void> {
    // IndexedDB implementation can be added if needed
    console.warn('IndexedDB fallback not implemented');
  }
}

// Export singleton instance
export const browserWallet = new BrowserWallet();

