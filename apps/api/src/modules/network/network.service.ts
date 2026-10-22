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
import { assertPublicHostname } from '../../common/ssfs-guard';
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
const HISTORY_BUCKET_SECONDS = 60;
const DEFAULT_HISTORY_WINDOW_MS = 60 * 60 * 1000;
const SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

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

    this.pollInterval = setInterval(() => this.pollAndStore(), POLL_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  private horizonUrl(network: 'mainnet' | 'testnet'): string {
    const key = network === 'testnet' ? 'TESTNET_HORIZON_URL' : 'MAINNET_HORIZON_URL';
    const defaultUrl =
      network === 'testnet'
        ? 'https://horizon-testnet.stellar.org'
        : 'https://horizon.stellar.org';
    return this.configService.get<string>(key, defaultUrl);
  }

  async pollAndStore(): Promise<void> {
    if (this.pollInProgress) {
      return;
    }
    this.pollInProgress = true;
    try {
      const networks: Array<'mainnet' | 'testnet'> = ['mainnet', 'testnet'];
      for (const network of networks) {
        const horizonBaseUrl = this.horizonUrl(network);
        try {
          const status = await this.fetchCurrentStatus(network);
          await this.sampleRepository.save(
            this.sampleRepository.create({
              network,
              horizonBaseUrl,
              ok: true,
              latencyMs: status.latency,
              error: null,
            }),
          );
          this.metricsService?.setHorizonConnections(network, 1);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Network sample failed for ${network}: ${message}`);
          await this.sampleRepository.save(
            this.sampleRepository.create({
              network,
              horizonBaseUrl,
              ok: false,
              latencyMs: null,
              error: message,
            }),
          );
          this.metricsService?.setHorizonConnections(network, 0);
        }
      }
      await this.prineSamples();
    } finally {
      this.pollInProgress = false;
    }
  }

  private async pruneSamples(): Promise<void> {
    const cutoff = new Date(Date.now() - SAMPLE_RETENTION_MS);
    await this.sampleRepository.delete({ createdAt: LessThan(cutoff) });
  }

  async getNetworkHistory(
    network: 'mainnet' | 'testnet',
    options: { from?: Date; to: Date; bucketSeconds?: number } = {},
  ): Promise<NetworkHistoryResponse> {
    const now = Date.now();
    const to = options.to ?? new Date(now);
    const from = options.from ?? new Date(to.getTime() - DEFAULT_HISTORY_WINDOW_MS);
    const bucketSeconds = options.bucketSeconds ?? HISTORY_BUCKET_SECONDS;

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    if (bucketSeconds < 1) {
      throw new BadRequestException('bucketSeconds must be at least 1');
    }

    const cacheKey = `${network}:${from.getTime()}:${to.getTime()}:${bucketSeconds}`;
    const cached = this.historyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response;
    }

    const samples = await this.sampleRepository.find({
      where: { network, createdAt: Between(from, to) },
      order: { createdAt: 'ASC' },
      take: MAX_HISTORY_SAMPLES,
    });

    const response = this.buildHistoryResponse(network, from, to, bucketSeconds, samples);
    this.cacheHistory(cacheKey, response);
    return response;
  }

  private cacheHistory(key: string, response: NetworkHistoryResponse) {
    if (this.historyCache.size >= MAX_HISTORY_CACHE_ENTRIES) {
      const oldest = this.historyCache.keys().next().value;
      if (oldest !== undefined) {
        this.historyCache.delete(oldest);
      }
    }
    this.historyCache.set(key, {
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
      response,
    });
  }

  private buildHistoryResponse(
    network: 'mainnet' | 'testnet',
    from: Date,
    to: Date,
    bucketSeconds: number,
    samples: NetworkSample[],
  ): NetworkHistoryResponse {
    const bucketMs = bucketSeconds * 1000;
    const buckets = new Map<number, NetworkHistoryBucket>();
    const latencies: number[] = [];
    let ok = 0;
    let errors = 0;

    for (const sample of samples) {
      const time = sample.createdAt instanceof Date ? sample.createdAt.getTime() : new Date(sample.createdAt).getTime();
      const bucketStart = Math.floor(time / bucketMs) * bucketMs;
      const base = buckets.get(bucketStart) ?? {
        timestamp: bucketStart,
        sampledAt: new Date(bucketStart).toISOString(),
        ok: true,
        latencyMs: null,
        sampleCount: 0,
        errorCount: 0,
      };
      base.sampleCount += 1;
      if (sample.ok) {
        ok++;
        if (typeof sample.latencyMs === 'number') {
          latencies.push(sample.latencyMs);
          base.latencyMs =
            base.latencyMs === null
              ? sample.latencyMs
              : Math.round((base.latencyMs + sample.latencyMs) / 2);
        }
      } else {
        errors += 1;
        base.errorCount += 1;
        base.ok = false;
      }
      buckets.set(bucketStart, base);
    }

    const ordered = Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
    latencies.sort((a, b) => a - b);

    const total = samples.length;
    const uptimePercent = total === 0 ? 0 : Math.round((ok / total) * 10000) / 100;
    const outageCount = this.countOutages(ordered);

    return {
      network,
      from: from.toISOString(),
      to: to.toISOString(),
      bucketSeconds,
      summary: {
        uptimePercent,
        p50LatencyMs: this.percentile(latencies, 0.5),
        p95LatencyMs: this.percentile(latencies, 0.95),
        outageCount,
        sampleCount: total,
      },
      samples: ordered,
    };
  }

  private countOutages(brackets: NetworkHistoryBucket[]): number {
    let outages = 0;
    let inOutage = false;
    for (const bucket of brackets) {
      if (!bucket.ok && !inOutage) {
        outages += 1;
        inOutage = true;
      } else if (bucket.ok) {
        inOutage = false;
      }
    }
    return outages;
  }

  private percentile(values: number[], q: number): number | null {
    if (values.length === 0) {
      return null;
    }
    const index = Math.min(values.length - 1, Math.floor(q * values.length));
    return values[index];
  }

  private async fetchCurrentStatus(network: 'mainnet' |'testnet'): Promise<NetworkStatus> {
    const baseUrl = this.horizonUrl(network);
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/ledgers?order=desc&limit=1`);
    if (!response.ok) {
      throw new Error(`Horizon response ${response.status}`);
    }
    const latency = Date.now() - startedAt;
    const data = (await response.json()) as {
      _embedded?: { records?: Array<Record<string, unknown>> };
    };
    const ledger = data._embedded?.records?.[0] ?? {};
    const closeTime = typeof ledger.closed_at === 'string' ? ledger.closed_at : new Date().toISOString();
    const sequence = typeof ledger.sequence === 'number' ? ledger.sequence : 0;
    const closeTimeMs = new Date(closeTime).getTime();
    const secondsSinceClose = Number.isFinite(closeTimeMs)
      ? Math.max(0, Math.round((Date.now() - closeTimeMs) / 1000))
      : 0;
    const baseFee = typeof ledger.base_fee_in_strops === 'string' ? Number(ledger.base_fee_in_strops) : 100;
    const fee = Number.isFinite(baseFee) ? baseFee : 100;
    return {
      timestamp: Date.now(),
      network,
      passphrase: this.passphrases[network],
      ledger: {
        sequence,
        closeTime,
        secondsSinceClose,
        avgCloseTime: 5,
      },
      fees: {
        baseFee: { min: fee, mode: fee, max: fee },
        percentiles: { p10: fee, p50: fee, p90: fee, p99: fee },
      },
      latency,
    };
  }
}
