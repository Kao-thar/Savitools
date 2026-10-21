import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Between, LessThan, Repository } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';
import { assertPublicHostname } from '../../common/ssrf-guard';
import { NetworkSample } from './entities/network-sample.entity';
import { NetworkProfile } from './entities/network-profile.entity';
import {
  NETWORK_PROFILE_SCHEMA_VERSION,
  migrateNetworkProfilePayload,
} from './network-profile-format';

export interface NetworkStatus {
  timestamp: number;
  network: string;
  passphrase: string;
  ledger: {
    sequence: number;
    closeTime: string;
    secondsSinceClose: number;
    avgCloseTime: number;
  };
  fees: {
    baseFee: {
      min: number;
      mode: number;
      max: number;
    };
    percentiles: {
      p10: number;
      p50: number;
      p90: number;
      p99: number;
    };
  };
  latency: number;
}

export interface NetworkHistoryBucket {
  timestamp: number;
  sampledAt: string;
  ok: boolean;
  latencyMs: number | null;
  sampleCount: number;
  errorCount: number;
}

export interface NetworkHistorySummary {
  uptimePercent: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  outageCount: number;
  sampleCount: number;
}

export interface NetworkHistoryResponse {
  network: 'mainnet' | 'testnet';
  from: string;
  to: string;
  bucketSeconds: number;
  summary: NetworkHistorySummary;
  samples: NetworkHistoryBucket[];
}

const MAX_HISTORY_SAMPLES = 20_000;
const HISTORY_CACHE_TTL_MS = 15_000;
const MAX_HISTORY_CACHE_ENTRIES = 100;

@Injectable()
export class NetworkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetworkService.name);
  private pollInterval: NodeJS.Timeout;
  private pollInProgress = false;
  private readonly historyCache = new Map<
    string,
    { expiresAt: number; response: NetworkHistoryResponse }
  >();

  private readonly passphrases = {
    mainnet: StellarSdk.Networks.PUBLIC,
    testnet: StellarSdk.Networks.TESTNET,
  };

  constructor(
    private configService: ConfigService,
    @InjectRepository(NetworkSample)
    private readonly sampleRepository: Repository<NetworkSample>,
    @InjectRepository(NetworkProfile)
    private readonly networkProfileRepository: Repository<NetworkProfile>,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    this.metricsService?.setHorizonConnections('mainnet', 1);
    this.metricsService?.setHorizonConnections('testnet', 1);
  }

  async createNetworkProfile(
    ownerId: string,
    input: {
      name: string;
      horizonUrl: string;
      networkPassphrase: string;
      friendbotUrl?: string;
      isDefault?: boolean;
    },
  ): Promise<NetworkProfile> {
    const horizonUrl = input.horizonUrl.trim().replace(/\/+$/, '');
    await this.assertHorizonPassphrase(horizonUrl, input.networkPassphrase);
    if (input.isDefault) {
      await this.networkProfileRepository.update({ ownerId }, { isDefault: false });
    }
    return this.networkProfileRepository.save(
      this.networkProfileRepository.create({
        ownerId,
        name: input.name,
        horizonUrl,
        networkPassphrase: input.networkPassphrase,
        friendbotUrl: input.friendbotUrl,
        isDefault: input.isDefault ?? false,
      }),
    );
  }

  async listNetworkProfiles(ownerId: string): Promise<NetworkProfile[]> {
    return this.networkProfileRepository.find({
      where: { ownerId },
      order: { isDefault: 'DESC' },
    });
  }

  async getNetworkProfile(ownerId: string, id: string): Promise<NetworkProfile> {
    const profile = await this.networkProfileRepository.findOne({
      where: { id, ownerId },
    });
    if (!profile) {
      throw new NotFoundException('Network profile not found');
    }
    return profile;
  }

  async updateNetworkProfile(
    ownerId: string,
    id: string,
    input: {
      name?: string;
      horizonUrl?: string;
      networkPassphrase?: string;
      friendbotUrl?: string;
      isDefault?: boolean;
    },
  ): Promise<NetworkProfile> {
    const profile = await this.getNetworkProfile(ownerId, id);
    const nextHorizonUrl = input.horizonUrl
      ? input.horizonUrl.trim().replace(/\/+$/, '')
      : profile.horizonUrl;
    const nextPassphrase = input.networkPassphrase ?? profile.networkPassphrase;

    if (input.horizonUrl || input.networkPassphrase) {
      await this.assertHorizonPassphrase(nextHorizonUrl, nextPassphrase);
    }

    if (input.isDefault) {
      await this.networkProfileRepository.update({ ownerId }, { isDefault: false });
    }

    return this.networkProfileRepository.save({
      ...profile,
      name: input.name ?? profile.name,
      horizonUrl: nextHorizonUrl,
      networkPassphrase: nextPassphrase,
      friendbotUrl: input.friendbotUrl !== undefined ? input.friendbotUrl : profile.friendbotUrl,
      isDefault: input.isDefault ?? profile.isDefault,
    });
  }

  async deleteNetworkProfile(ownerId: string, id: string): Promise<void> {
    await this.networkProfileRepository.remove(await this.getNetworkProfile(ownerId, id));
  }

  async setDefaultNetworkProfile(ownerId: string, id: string): Promise<NetworkProfile> {
    const profile = await this.getNetworkProfile(ownerId, id);
    await this.networkProfileRepository.update({ ownerId }, { isDefault: false });
    profile.isDefault = true;
    return this.networkProfileRepository.save(profile);
  }

  async exportNetworkProfile(ownerId: string, id: string): Promise<Record<string, unknown>> {
    const profile = await this.getNetworkProfile(ownerId, id);
    return {
      schemaVersion: NETWORK_PROFILE_SCHEMA_VERSION,
      name: profile.name,
      horizonUrl: profile.horizonUrl,
      networkPassphrase: profile.networkPassphrase,
      friendbotUrl: profile.friendbotUrl ?? undefined,
      isDefault: profile.isDefault,
    };
  }

  async importNetworkProfile(
    ownerId: string,
    input: {
      schemaVersion?: number;
      name?: string;
      horizonUrl: string;
      networkPassphrase: string;
      friendbotUrl?: string;
      isDefault?: boolean;
    },
  ): Promise<NetworkProfile> {
    // Legacy exports have no version and may omit the display name; migrate
    // before the create path validates against Horizon.
    return this.createNetworkProfile(ownerId, migrateNetworkProfilePayload(input));
  }

  async verifyNetworkPassphrase(
    horizonUrl: string,
    expectedPassphrase: string,
  ): Promise<{ match: boolean; actualPassphrase: string }> {
    const actualPassphrase = await this.fetchNetworkPassphrase(
      horizonUrl.trim().replace(/\/+$/, ''),
    );
    return {
      match: actualPassphrase === expectedPassphrase,
      actualPassphrase,
    };
  }

  private async assertHorizonPassphrase(horizonUrl: string, expectedPassphrase: string) {
    const actualPassphrase = await this.fetchNetworkPassphrase(horizonUrl);
    if (actualPassphrase !== expectedPassphrase) {
      this.logger.warn(
        `Horizon passphrase "${actualPassphrase}" does not match expected "${expectedPassphrase}"`,
      );
      throw new BadRequestException(
        `Horizon passphrase "${actualPassphrase}" does not match expected "${expectedPassphrase}"`,
      );
    }
  }

  private async fetchNetworkPassphrase(horizonUrl: string): Promise<string> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(horizonUrl);
    } catch {
      throw new BadRequestException('Invalid Horizon URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Invalid protocol for Horizon URL');
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.2') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.') ||
      hostname.endsWith('.local') ||
      hostname === 'metadata.google.internal'
    ) {
      throw new BadRequestException('Forbidden local or private network address');
    }
    await assertPublicHostname(hostname);

    let currentUrl = horizonUrl;
    let redirects = 0;
    const maxRedirects = 5;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      let response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      while (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          break;
        }
        redirects++;
        if (redirects > maxRedirects) {
          throw new Error('Too many redirects');
        }
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          throw new BadRequestException('Only HTTP and HTTPS protocols are allowed in redirects');
        }
        await assertPublicHostname(nextUrl.hostname);
        currentUrl = nextUrl.toString();
        response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      }

      if (!response.ok) {
        throw new Error(`Horizon request failed with status ${response.status}`);
      }
      const data = (await response.json()) as { network_passphrase?: string };
      if (!data.network_passphrase) {
        throw new Error('Horizon response did not include network_passphrase');
      }
      return data.network_passphrase;
    } finally {
      clearTimeout(timeout);
    }
  }

  async onModuleInit() {
    await this.pollAndStore();

    this.pollInterval = setInterval(() => this.pollAndStore(), 60000);
  }

  async onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  async fetchCurrentStatus(
    network: 'mainnet' | 'testnet' | NetworkProfile,
  ): Promise<NetworkStatus> {
    const networkLabel = typeof network === 'string' ? network : network.name;
    const horizonBaseUrl =
      typeof network === 'string' ? this.horizonUrl(network) : network.horizonUrl;
    const passphrase =
      typeof network === 'string' ? this.passphrases[network] : network.networkPassphrase;
    const server = new StellarSdk.Horizon.Server(horizonBaseUrl);
    const start = Date.now();

    try {
      const [latestLedgersPage, feeStats] = await Promise.all([
        server.ledgers().order('desc').limit(10).call(),
        server.feeStats(),
      ]);

      const latency = Date.now() - start;
      const ledgers = latestLedgersPage.records;
      const latestLedger = ledgers[0];
      const closeTime = new Date(latestLedger.closed_at).getTime();
      const secondsSinceClose = Math.floor((Date.now() - closeTime) / 1000);

      // Calculate average close time over last 10 ledgers
      let avgCloseTime = 0;
      if (ledgers.length > 1) {
        const oldestLedger = ledgers[ledgers.length - 1];
        const oldestTime = new Date(oldestLedger.closed_at).getTime();
        avgCloseTime = (closeTime - oldestTime) / 1000 / (ledgers.length - 1);
      }

      return {
        timestamp: Date.now(),
        network: networkLabel,
        passphrase,
        ledger: {
          sequence: latestLedger.sequence,
          closeTime: latestLedger.closed_at,
          secondsSinceClose,
          avgCloseTime: parseFloat(avgCloseTime.toFixed(2)),
        },
        fees: {
          baseFee: {
            min: parseInt(feeStats.fee_charged.min),
            mode: parseInt(feeStats.fee_charged.mode),
            max: parseInt(feeStats.fee_charged.max),
          },
          percentiles: {
            p10: parseInt(feeStats.fee_charged.p10),
            p50: parseInt(feeStats.fee_charged.p50),
            p90: parseInt(feeStats.fee_charged.p90),
            p99: parseInt(feeStats.fee_charged.p99),
          },
        },
        latency,
      };
    } catch (error) {
      this.logger.error(`Error fetching status for ${networkLabel}`, error);
      throw error;
    }
  }

  async pollAndStore() {
    if (this.pollInProgress) {
      this.logger.warn('Skipping network status poll because one is still running');
      return;
    }

    this.pollInProgress = true;
    try {
      await Promise.allSettled(
        (['mainnet', 'testnet'] as const).map((network) => this.sampleNetwork(network)),
      );
      await this.pruneRetention();
    } catch (error) {
      this.logger.error('Error during network status polling', error);
    } finally {
      this.pollInProgress = false;
    }
  }

  async getHistory(
    network: 'mainnet' | 'testnet',
    from?: string,
    to?: string,
  ): Promise<NetworkHistoryResponse> {
    const range = this.parseHistoryRange(from, to);
    const cacheKey = `${network}:${from ? range.from.getTime() : 'default-from'}:${to ? range.to.getTime() : 'default-to'}`;
    const now = Date.now();
    for (const [key, entry] of this.historyCache) {
      if (entry.expiresAt <= now) this.historyCache.delete(key);
    }
    const cached = this.historyCache.get(cacheKey);
    if (cached) {
      this.historyCache.delete(cacheKey);
      this.historyCache.set(cacheKey, cached);
      return structuredClone(cached.response);
    }

    const samples = await this.sampleRepository.find({
      where: {
        network,
        sampledAt: Between(range.from, range.to),
      },
      order: { sampledAt: 'ASC' },
      take: MAX_HISTORY_SAMPLES + 1,
    });
    if (samples.length > MAX_HISTORY_SAMPLES) {
      throw new BadRequestException(
        `history range contains more than ${MAX_HISTORY_SAMPLES} samples; narrow the date range`,
      );
    }

    const buckets = this.bucketSamples(samples);

    const response: NetworkHistoryResponse = {
      network,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      bucketSeconds: 60,
      summary: this.summarizeBuckets(buckets),
      samples: buckets,
    };

    while (this.historyCache.size >= MAX_HISTORY_CACHE_ENTRIES) {
      const oldestKey = this.historyCache.keys().next().value;
      if (!oldestKey) break;
      this.historyCache.delete(oldestKey);
    }
    this.historyCache.set(cacheKey, {
      expiresAt: now + HISTORY_CACHE_TTL_MS,
      response,
    });
    return structuredClone(response);
  }

  async pruneRetention(now = new Date()) {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    await this.sampleRepository.delete({ sampledAt: LessThan(cutoff) });
  }

  private async sampleNetwork(network: 'mainnet' | 'testnet') {
    const horizonBaseUrl = this.horizonUrl(network);
    const startedAt = Date.now();

    try {
      await this.fetchCurrentStatus(network);
      await this.sampleRepository.save(
        this.sampleRepository.create({
          network,
          horizonBaseUrl,
          ok: true,
          latencyMs: Date.now() - startedAt,
          error: null,
          sampledAt: new Date(),
        }),
      );
    } catch (error) {
      await this.sampleRepository.save(
        this.sampleRepository.create({
          network,
          horizonBaseUrl,
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: this.errorMessage(error),
          sampledAt: new Date(),
        }),
      );
      this.logger.warn(
        `Stored failed network status sample for ${network}: ${this.errorMessage(error)}`,
      );
    }
  }

  private horizonUrl(network: 'mainnet' | 'testnet') {
    return network === 'mainnet'
      ? this.configService.get<string>('STELLAR_HORIZON_MAINNET_URL', 'https://horizon.stellar.org')
      : this.configService.get<string>(
          'STELLAR_HORIZON_URL',
          'https://horizon-testnet.stellar.org',
        );
  }

  private parseHistoryRange(from?: string, to?: string) {
    const now = new Date();
    const parsedTo = to ? new Date(to) : now;
    const parsedFrom = from ? new Date(from) : new Date(parsedTo.getTime() - 60 * 60 * 1000);

    if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime())) {
      throw new BadRequestException('from and to must be valid ISO dates');
    }

    if (parsedFrom > parsedTo) {
      throw new BadRequestException('from must be before to');
    }

    if (parsedTo.getTime() - parsedFrom.getTime() > 90 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('history range cannot exceed 90 days');
    }

    return { from: parsedFrom, to: parsedTo };
  }

  private bucketSamples(samples: NetworkSample[]): NetworkHistoryBucket[] {
    const grouped = new Map<number, NetworkSample[]>();

    for (const sample of samples) {
      const bucket = Math.floor(sample.sampledAt.getTime() / 60000) * 60000;
      const bucketSamples = grouped.get(bucket);
      if (bucketSamples) {
        bucketSamples.push(sample);
      } else {
        grouped.set(bucket, [sample]);
      }
    }

    return [...grouped.entries()].map(([timestamp, bucketSamples]) => {
      const okCount = bucketSamples.filter((sample) => sample.ok).length;
      const latencySamples = bucketSamples
        .map((sample) => sample.latencyMs)
        .filter((latency): latency is number => latency !== null);
      const avgLatency =
        latencySamples.length > 0
          ? Math.round(
              latencySamples.reduce((sum, latency) => sum + latency, 0) / latencySamples.length,
            )
          : null;

      return {
        timestamp,
        sampledAt: new Date(timestamp).toISOString(),
        ok: okCount >= bucketSamples.length / 2,
        latencyMs: avgLatency,
        sampleCount: bucketSamples.length,
        errorCount: bucketSamples.length - okCount,
      };
    });
  }

  private summarizeBuckets(buckets: NetworkHistoryBucket[]): NetworkHistorySummary {
    if (buckets.length === 0) {
      return {
        uptimePercent: 0,
        p50LatencyMs: null,
        p95LatencyMs: null,
        outageCount: 0,
        sampleCount: 0,
      };
    }

    const upBuckets = buckets.filter((bucket) => bucket.ok).length;
    const latencies = buckets
      .map((bucket) => bucket.latencyMs)
      .filter((latency): latency is number => latency !== null)
      .sort((a, b) => a - b);

    return {
      uptimePercent: Number(((upBuckets / buckets.length) * 100).toFixed(2)),
      p50LatencyMs: this.percentile(latencies, 0.5),
      p95LatencyMs: this.percentile(latencies, 0.95),
      outageCount: this.countOutages(buckets),
      sampleCount: buckets.reduce((sum, bucket) => sum + bucket.sampleCount, 0),
    };
  }

  private percentile(values: number[], percentile: number) {
    if (values.length === 0) return null;
    const index = Math.ceil(values.length * percentile) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  private countOutages(buckets: NetworkHistoryBucket[]) {
    let outages = 0;
    let wasDown = false;

    for (const bucket of buckets) {
      if (!bucket.ok && !wasDown) outages += 1;
      wasDown = !bucket.ok;
    }

    return outages;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
