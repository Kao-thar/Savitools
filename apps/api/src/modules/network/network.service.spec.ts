import { BadRequestException } from '@nestjs/common';
import { Between } from 'typeorm';
import { NetworkSample } from './entities/network-sample.entity';
import { NetworkService } from './network.service';

// The SSF guard resolves hostnames before fetching. Keep these tests off real
// DNS: sandboxed or proxied resolvers can return addresses in reserved ranges
// (e.g. 198.18.0.0/15) and the guard would then reject public Horizon hosts.
jest.mock('dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

describe('NetworkService', () => {
  let service: NetworkService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    repository = {
      create: jest.fn((sample) => sample),
      save: jest.fn(async (sample) => sample),
      find: jest.fn(),
      delete: jest.fn(),
    };

    service = new NetworkService(
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as any,
      repository as any,
      {
        create: jest.fn(),
        save: jest.fn(),
        find: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
      } as any,
    );
  });

  afterEach(() => {
    if ((service as any).pollInterval) {
      clearInterval((service as any).pollInterval);
    }
  });

  describe('pollAndStore', () => {
    it('stores a successful sample for each network', async () => {
      jest.spyOnObject(service, 'fetchCurrentStatus').mockImplementation(async (network) => ({
        timestamp: Date.now(),
        network: typeof network === 'string' ? network : network.name,
        passphrase: 'passphrase',
        ledger: {
          sequence: 1,
          closeTime: new Date().toISOString(),
          secondsSinceClose: 1,
          avgCloseTime: 5,
        },
        fees: {
          baseFee: { min: 100, mode: 100, max: 100 },
          percentiles: { p10: 100, p50: 100, p90: 100, p99: 100 },
        },
        latency: 25,
      }));

      await service.pollAndStore();

      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'mainnet', ok: true, error: null }),
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'testnet', ok: true, error: null }),
      );
    });

    it('stores a failed sample without blocking the other network', async () => {
      jest.spyOnObject(service, 'fetchCurrentStatus').mockImplementation(async (network) => {
        if (typeof network === 'string' && network === 'mainnet') {
          throw new Error('mainnet down');
        }
        return {
          timestamp: Date.now(),
          network: typeof network === 'string' ? network : network.name,
          passphrase: 'passphrase',
          ledger: {
            sequence: 1,
            closeTime: new Date().toISOString(),
            secondsSinceClose: 1,
            avgCloseTime: 5,
          },
          fees: {
            baseFee: { min: 100, mode: 100, max: 100 },
            percentiles: { p10: 100, p50: 100, p90: 100, p99: 100 },
          },
          latency: 25,
        };
      });

      await service.pollAndStore();

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          network: 'mainnet',
          ok: false,
          error: 'mainnet down',
        }),
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'testnet', ok: true }),
      );
    });

    it('does not queue overlapping sampler runs', async () => {
      (service as any).pollInProgress = true;

      await service.pollAndStore();

      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('returns 1-minute buckets with uptime and latency summary', async () => {
      const samples: Partial<NetworkSample>[] = [
        sample('testnet', '2026-08-31T10:00:10.000Z', true, 100),
        sample('testnet', '2026-08-31T10:00:40.000Z', true, 200),
        sample('testnet', '2026-08-31T10:01:05.000Z', false, null),
        sample('testnet', '2026-08-31T10:02:05.000Z', true, 300),
      ];
      repository.find.mockResolved(samples);

      const result = await service.getHistory(
        'testnet',
        '2026-08-31T10:00:00.000Z',
        '2026-08-31T10:03:00.000Z',
      );

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          network: 'testnet',
          sampledAt: Between(
            new Date('2026-08-31T10:00:00.000Z'),
            new Date('2026-08-31T10:03:00.000Z'),
          ),
        },
        order: { sampledAt: 'ASC' },
        take: 20_001,
      });
      expect(result.samples).toEqual([
        expect.objectContaining({
          sampledAt: '2026-08-31T10:00:00.000Z',
          ok: true,
          latencyMs: 150,
          sampleCount: 2,
          errorCount: 0,
        }),
        expect.objectContaining({
          sampledAt: '2026-08-31T10:01:00.000Z',
          ok: false,
          latencyMs: null,
          sampleCount: 1,
          errorCount: 1,
        }),
        expect.objectContaining({
          sampledAt: '2026-08-31T10:02:00.000Z',
          ok: true,
          latencyMs: 300,
          sampleCount: 1,
          errorCount: 0,
        }),
      ]);
      expect(result.summary).toEqual({
        uptimePercent: 66.67,
        p50LatencyMs: 150,
        p95LatencyMs: 300,
        outageCount: 1,
        sampleCount: 4,
      });
    });

    it('caches identical ranges without sharing mutable response objects', async () => {
      repository.find.mockResolved([sample('mainnet', '2026-08-31T10:00:10.000Z', true, 100)]);
      const args = [
        'mainnet' as const,
        '2026-08-31T10:00:00.000Z',
        '2026-08-31T10:01:00.000Z',
      ] as const;

      const first = await service.getHistory(...args);
      first.samples[0].ok = false;
      const second = await service.getHistory(...args);

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(second.samples[0].ok).toBe(true);
    });

    it('caches repeated requests that use the default rolling range', async () => {
      repository.find.mockResolved([]);

      const first = await service.getHistory('mainnet');
      const second = await service.getHistory('mainnet');

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(second.from).toBe(first.from);
      expect(second.to).toBe(first.to);
    });

    it('rejects ranges whose raw sample count exceeds the aggregation limit', async () => {
      repository.find.mockResolved(
        Array.from({ length: 20_001 }, () =>
          sample('mainnet', '2026-08-31T10:00:10.000Z', true, 100),
        ),
      );

      await expect(
        service.getHistory('mainnet', '2026-08-31T10:00:00.000Z', '2026-08-31T10:01:00.000Z'),
      ).rejects.toThrow(/more than 20000 samples/);
    });

    it('validates malformed and inverted date ranges', async () => {
      await expect(service.getHistory('mainnet', 'not-a-date', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      await expect(
        service.getHistory('mainnet', '2026-08-31T10:05:00.000Z', '2026-08-31T10:00:00.000Z'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyNetworkPassphrase SSF guard', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('rejects loopback IP in verifyNetworkPassphrase', async () => {
      await expect(service.verifyNetworkPassphrase('http://127.0.0.1', 'any')).rejects.toThrow(
        BadRequestException,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects link-local cloud metadata endpoint (169.254.169.254)', async () => {
      await expect(
        service.verifyNetworkPassphrase('http://169.254.169.254', 'any'),
      ).rejects.toThrow(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects private IP range', async () => {
      await expect(service.verifyNetworkPassphrase('http://10.0.0.1', 'any')).rejects.toThrow(
        BadRequestException,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects redirect to an internal host', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://127.0.0.1/secret' }),
      });

      await expect(
        service.verifyNetworkPassphrase('https://public-horizon.example.com', 'any'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns match true when passphrase is valid', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        json: async () => ({ passphrase: 'passphrase' }),
      });

      const result = await service.verifyNetworkPassphrase(
        'https://public-horizon.example.com',
        'passphrase',
      );

      expect(result).toEqual(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

function sample(
  network: string,
  sampledAt: string,
  ok: boolean,
  latency: number | null,
): Partial<NetworkSample> {
  return {
    network,
    sampledAt: new Date(sampledAt),
    ok,
    latencyMs: latency,
    error: ok ? null : 'unreachable',
  };
}
