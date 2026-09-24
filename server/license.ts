import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';
import { cpus, hostname, networkInterfaces, platform } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Embedded license public key (safe to distribute with app)
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlWl7NY86GnYGcnI9f1TIvI+/BSn2xDRc0yIyuDywWNw=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  machineId: string;
  expiry: string; // ISO string or '9999-12-31T23:59:59.999Z' for lifetime
  plan: 'pro' | 'enterprise' | 'lifetime';
  issuedAt: string;
}

export interface LicenseStatus {
  machineId: string;
  licensed: boolean;
  expiry?: string;
  plan?: string;
  trialUsed: number;
  trialLimit: number;
  trialRemaining: number;
}

/**
 * Generates a clean, deterministic hardware machine code: FD-XXXX-XXXX-XXXX
 */
export function getMachineId(): string {
  const parts: string[] = [
    platform(),
    cpus()[0]?.model || 'generic-cpu',
    cpus().length.toString(),
    hostname(),
  ];

  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          parts.push(net.mac);
        }
      }
    }
  } catch {
    // fallback
  }

  const hash = createHash('sha256').update(parts.join('::')).digest('hex').toUpperCase();
  return `FD-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

/**
 * Signs payload with private key to create commercial license key
 */
export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const privKey = createPrivateKey(privateKeyPem);
  const dataToSign = `${payload.machineId}|${payload.expiry}|${payload.plan}|${payload.issuedAt}`;
  const signature = sign(null, Buffer.from(dataToSign, 'utf8'), privKey).toString('base64url');
  
  const token = {
    ...payload,
    sig: signature
  };
  return `FD1_${Buffer.from(JSON.stringify(token), 'utf8').toString('base64url')}`;
}

/**
 * Verifies if a given license key is valid for this machine
 */
export function verifyLicense(licenseKey: string, currentMachineId: string): { valid: boolean; payload?: LicensePayload; error?: string } {
  try {
    if (!licenseKey.startsWith('FD1_')) {
      return { valid: false, error: '卡密格式无效（必须以 FD1_ 开头）' };
    }
    const raw = Buffer.from(licenseKey.slice(4), 'base64url').toString('utf8');
    const token = JSON.parse(raw);
    const { machineId, expiry, plan, issuedAt, sig } = token;

    if (!machineId || !expiry || !plan || !issuedAt || !sig) {
      return { valid: false, error: '卡密数据损坏' };
    }

    if (machineId !== currentMachineId && machineId !== 'FD-UNIVERSAL') {
      return { valid: false, error: '卡密与当前设备机器码不匹配，请勿跨设备使用' };
    }

    if (Date.now() > Date.parse(expiry)) {
      return { valid: false, error: '卡密已到期，请联系客服续费' };
    }

    const dataToVerify = `${machineId}|${expiry}|${plan}|${issuedAt}`;
    const pubKey = createPublicKey(LICENSE_PUBLIC_KEY);
    const isValidSig = verify(null, Buffer.from(dataToVerify, 'utf8'), pubKey, Buffer.from(sig, 'base64url'));

    if (!isValidSig) {
      return { valid: false, error: '卡密数字签名无效，请确认卡密来源' };
    }

    return {
      valid: true,
      payload: { machineId, expiry, plan, issuedAt }
    };
  } catch (e) {
    return { valid: false, error: '卡密解析失败' };
  }
}

/**
 * License & Trial Manager
 */
export class LicenseManager {
  private file: string;
  private currentMachineId: string;
  private licenseKey?: string;
  private activePayload?: LicensePayload;
  private trialUsed = 0;
  private trialLimit = 20;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'flowdesk-license.json');
    this.currentMachineId = getMachineId();
  }

  async init(): Promise<void> {
    try {
      const content = await readFile(this.file, 'utf8');
      const data = JSON.parse(content);
      this.trialUsed = typeof data.trialUsed === 'number' ? data.trialUsed : 0;
      if (typeof data.licenseKey === 'string') {
        const check = verifyLicense(data.licenseKey, this.currentMachineId);
        if (check.valid && check.payload) {
          this.licenseKey = data.licenseKey;
          this.activePayload = check.payload;
        }
      }
    } catch {
      // file does not exist yet
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    try {
      await writeFile(
        this.file,
        JSON.stringify({
          machineId: this.currentMachineId,
          licenseKey: this.licenseKey,
          trialUsed: this.trialUsed,
          updatedAt: new Date().toISOString()
        }, null, 2),
        'utf8'
      );
    } catch {
      // ignore
    }
  }

  getStatus(): LicenseStatus {
    const isLicensed = Boolean(
      this.activePayload &&
      (this.activePayload.machineId === this.currentMachineId || this.activePayload.machineId === 'FD-UNIVERSAL') &&
      Date.now() < Date.parse(this.activePayload.expiry)
    );

    return {
      machineId: this.currentMachineId,
      licensed: isLicensed,
      expiry: this.activePayload?.expiry,
      plan: this.activePayload?.plan,
      trialUsed: this.trialUsed,
      trialLimit: this.trialLimit,
      trialRemaining: Math.max(0, this.trialLimit - this.trialUsed),
    };
  }

  async activate(key: string): Promise<{ ok: boolean; status: LicenseStatus; message: string }> {
    const cleanKey = key.trim();
    const result = verifyLicense(cleanKey, this.currentMachineId);
    if (!result.valid || !result.payload) {
      throw new Error(result.error || '激活失败，卡密无效');
    }

    this.licenseKey = cleanKey;
    this.activePayload = result.payload;
    await this.persist();

    return {
      ok: true,
      status: this.getStatus(),
      message: `🎉 激活成功！有效期至 ${new Date(result.payload.expiry).toLocaleDateString()}`
    };
  }

  /**
   * Called before generating replies or executing automated actions.
   * If not licensed and trial is exhausted, throws an error.
   */
  consumeQuota(): void {
    const status = this.getStatus();
    if (status.licensed) {
      return; // unlimited for licensed users
    }

    if (this.trialUsed >= this.trialLimit) {
      throw new Error(`免费试用额度已用尽（已试用 ${this.trialLimit} 次）。机器码: ${this.currentMachineId}，请联系官方获取卡密激活！`);
    }

    this.trialUsed++;
    void this.persist();
  }
}
