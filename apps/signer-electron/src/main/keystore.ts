import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HDNodeWallet, Wallet } from 'ethers';

const KEYSTORE_FILE = 'keystore.json';

export class KeystoreService {
  private readonly keystorePath: string;
  private wallet: Wallet | HDNodeWallet | null = null;
  private cachedPassword: string | null = null;

  constructor(baseDir: string) {
    this.keystorePath = join(baseDir, KEYSTORE_FILE);
  }

  hasKeystore(): boolean {
    return existsSync(this.keystorePath);
  }

  isUnlocked(): boolean {
    return this.wallet !== null;
  }

  getWallet(): Wallet | HDNodeWallet | null {
    return this.wallet;
  }

  hasCachedPassword(): boolean {
    return this.cachedPassword !== null;
  }

  async importPrivateKey(privateKey: string, password: string): Promise<void> {
    const normalized = privateKey.trim();
    const wallet = new Wallet(normalized);
    const encryptedJson = await wallet.encrypt(password);
    writeFileSync(this.keystorePath, encryptedJson, 'utf8');
    this.wallet = wallet;
    this.cachedPassword = password;
  }

  async unlock(password: string): Promise<void> {
    if (!this.hasKeystore()) {
      throw new Error('Keystore file not found.');
    }

    const encrypted = readFileSync(this.keystorePath, 'utf8');
    const wallet = await Wallet.fromEncryptedJson(encrypted, password);
    this.wallet = wallet;
    this.cachedPassword = password;
  }

  lock(): void {
    this.wallet = null;
    this.cachedPassword = null;
  }
}
