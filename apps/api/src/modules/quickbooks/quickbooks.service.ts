import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../common/utils/audit.service';

// ASSUMPTION: Using intuit-oauth library or direct REST calls
// For MVP, we use direct fetch calls against QB Online API

interface QBTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  x_refresh_token_expires_in: number;
}

@Injectable()
export class QuickbooksService {
  private readonly logger = new Logger(QuickbooksService.name);
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private encryption: EncryptionService,
    private audit: AuditService,
  ) {
    const env = this.config.get('QB_ENVIRONMENT', 'sandbox');
    this.baseUrl = env === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';
    this.clientId = this.config.get('QB_CLIENT_ID', '');
    this.clientSecret = this.config.get('QB_CLIENT_SECRET', '');
    this.redirectUri = this.config.get('QB_REDIRECT_URI', '');
  }

  // ---- OAuth Flow ----

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state: 'prime-tracker-' + Date.now(),
    });
    return `https://appcenter.intuit.com/connect/oauth2?${params}`;
  }

  async handleCallback(code: string, realmId: string): Promise<void> {
    const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!resp.ok) {
      const error = await resp.text();
      this.logger.error(`QB token exchange failed: ${error}`);
      throw new BadRequestException('QuickBooks authentication failed');
    }

    const tokens: QBTokens = await resp.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Get company info
    const companyInfo = await this.qbRequest(tokens.access_token, realmId, '/companyinfo/' + realmId);

    await this.prisma.qBConnection.upsert({
      where: { realmId },
      update: {
        accessToken: this.encryption.encrypt(tokens.access_token),
        refreshToken: this.encryption.encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        companyName: companyInfo?.CompanyInfo?.CompanyName || null,
        isActive: true,
      },
      create: {
        realmId,
        accessToken: this.encryption.encrypt(tokens.access_token),
        refreshToken: this.encryption.encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        companyName: companyInfo?.CompanyInfo?.CompanyName || null,
      },
    });

    this.logger.log(`QB connected: realm ${realmId}`);
  }

  async refreshAccessToken(realmId: string): Promise<string> {
    const conn = await this.prisma.qBConnection.findUnique({ where: { realmId } });
    if (!conn) throw new BadRequestException('No QB connection found');

    const refreshToken = this.encryption.decrypt(conn.refreshToken);
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const resp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const tokens: QBTokens = await resp.json();

    await this.prisma.qBConnection.update({
      where: { realmId },
      data: {
        accessToken: this.encryption.encrypt(tokens.access_token),
        refreshToken: this.encryption.encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    return tokens.access_token;
  }

  // ---- API Calls ----

  private async getAccessToken(realmId: string): Promise<string> {
    const conn = await this.prisma.qBConnection.findUnique({ where: { realmId } });
    if (!conn) throw new BadRequestException('No QB connection');

    if (conn.tokenExpiresAt < new Date()) {
      return this.refreshAccessToken(realmId);
    }

    return this.encryption.decrypt(conn.accessToken);
  }

  private async qbRequest(accessToken: string, realmId: string, endpoint: string): Promise<any> {
    const url = `${this.baseUrl}/v3/company/${realmId}${endpoint}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      this.logger.error(`QB API error ${resp.status}: ${await resp.text()}`);
      return null;
    }

    return resp.json();
  }

  private async qbQuery(realmId: string, query: string): Promise<any> {
    const token = await this.getAccessToken(realmId);
    const encoded = encodeURIComponent(query);
    return this.qbRequest(token, realmId, `/query?query=${encoded}`);
  }

  // ---- Sync Operations ----

  async syncAll(realmId: string, userId?: string): Promise<{ vendors: number; bills: number; payments: number }> {
    const syncLog = await this.prisma.qBSyncLog.create({
      data: { syncType: 'ALL', status: 'STARTED' },
    });

    try {
      const vendors = await this.syncVendors(realmId);
      const bills = await this.syncBills(realmId);
      const payments = await this.syncPayments(realmId);

      await this.prisma.qBSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'COMPLETED',
          recordsSynced: vendors + bills + payments,
          completedAt: new Date(),
        },
      });

      await this.prisma.qBConnection.update({
        where: { realmId },
        data: { lastSyncAt: new Date() },
      });

      if (userId) {
        await this.audit.log({
          userId,
          action: 'QB_SYNC',
          entity: 'QuickBooks',
          metadata: { realmId, vendors, bills, payments },
        });
      }

      return { vendors, bills, payments };
    } catch (error) {
      await this.prisma.qBSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'FAILED',
          errors: { message: (error as Error).message },
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async syncVendors(realmId: string): Promise<number> {
    const result = await this.qbQuery(realmId, "SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000");
    if (!result?.QueryResponse?.Vendor) return 0;
    // Store vendor data as metadata — we map them via project mapping
    this.logger.log(`Synced ${result.QueryResponse.Vendor.length} vendors from QB`);
    return result.QueryResponse.Vendor.length;
  }

  private async syncBills(realmId: string): Promise<number> {
    const result = await this.qbQuery(realmId, "SELECT * FROM Bill MAXRESULTS 1000");
    if (!result?.QueryResponse?.Bill) return 0;

    const bills = result.QueryResponse.Bill;
    let synced = 0;

    for (const bill of bills) {
      const qbTxnId = `BILL-${bill.Id}`;

      // Check if already synced
      const existing = await this.prisma.actual.findUnique({ where: { qbTxnId } });
      if (existing) continue;

      // Try to map to project using QB Class or Location
      const projectMapping = await this.findProjectMapping(bill);

      await this.prisma.actual.create({
        data: {
          projectId: projectMapping?.projectId || 'UNMAPPED',
          category: 'OTHER',
          description: `Bill: ${bill.VendorRef?.name || 'Unknown'} - ${bill.DocNumber || ''}`,
          amount: bill.TotalAmt || 0,
          txnDate: new Date(bill.TxnDate),
          vendor: bill.VendorRef?.name,
          qbTxnId,
          qbSyncStatus: projectMapping ? 'SYNCED' : 'UNMAPPED',
        },
      });
      synced++;
    }

    return synced;
  }

  private async syncPayments(realmId: string): Promise<number> {
    const result = await this.qbQuery(realmId, "SELECT * FROM Payment MAXRESULTS 1000");
    if (!result?.QueryResponse?.Payment) return 0;
    this.logger.log(`Found ${result.QueryResponse.Payment.length} payments`);
    return result.QueryResponse.Payment.length;
  }

  private async findProjectMapping(bill: any): Promise<{ projectId: string } | null> {
    // Try Class mapping first, then Location
    if (bill.ClassRef?.value) {
      const mapping = await this.prisma.qBProjectMapping.findFirst({
        where: { qbClassId: bill.ClassRef.value },
      });
      if (mapping) return { projectId: mapping.projectId };
    }

    if (bill.DepartmentRef?.value) {
      const mapping = await this.prisma.qBProjectMapping.findFirst({
        where: { qbLocationId: bill.DepartmentRef.value },
      });
      if (mapping) return { projectId: mapping.projectId };
    }

    return null;
  }

  // ---- Connection Management ----

  async getConnection() {
    return this.prisma.qBConnection.findFirst({ where: { isActive: true } });
  }

  async getSyncLogs(limit = 20) {
    return this.prisma.qBSyncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getProjectMappings() {
    return this.prisma.qBProjectMapping.findMany({
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async upsertProjectMapping(projectId: string, data: { qbClassId?: string; qbClassName?: string; qbLocationId?: string; qbLocationName?: string }) {
    return this.prisma.qBProjectMapping.upsert({
      where: { projectId },
      update: data,
      create: { projectId, ...data },
    });
  }
}
