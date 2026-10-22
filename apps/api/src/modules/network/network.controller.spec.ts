import { UnauthorizedException } from '@common/nestjs';
const GUARDS_METADATA = '__guards__';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';

const profile = {
  id: 'np-1',
  ownerId: 'user-1',
  name: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test DF Network ; September 2015',
  friendbotUrl: 'https://friendbot.stellar.org',
  isDefault: true,
};

function makeService() {
  return {
    listNetworkProfiles: jest.fn(),
    getNetworkProfile: jest.fn(),
    createNetworkProfile: jest.fn(),
    updateNetworkProfile: jest.fn(),
    deleteNetworkProfile: jest.fn(),
    setDefaultNetworkProfile: jest.fn(),
    exportNetworkProfile: jest.fn(),
    importNetworkProfile: jest.fn(),
    verifyNetworkPassphrase: jest.fn(),
    getProfileConnectivityHistory: jest.fn(),
    getProfileLatencyTrends: jest.fn(),
  };
}

function guardNames(handler: (...args: never[])=> unknown): string[] {
  return (
    (Reflect.getMetadata(GUARDS_METADATA, handler) as Array<{ name: string }> | undefined)?.map(
      (guard) => guard.name,
    ) ?? []
  );
}

describe('NetworkController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: NetworkController;

  beforeEach(() => {
    service = makeService();
    controller = new NetworkController(service as unknown as NetworkService);
  });

  describe('authentication', () => {
    it('guards every profile route with JwtAuthGuard', () => {
      const profileHandlers = [
        'listProfiles',
        'createProfile',
        'updateProfile',
        'deleteProfile',
        'verifyPassphrase',
        'setDefaultProfile',
        'exportProfile',
        'importProfile',
        'getProfileConnectivityHistory',
        'getProfileLatencyTrends',
      ] as const;

      for (const name of profileHandlers) {
        expect(guardNames(controller[name] as (...args: never[]) => unknown)).toContain(
          'JwtAuthGuard',
        );
      }
    });

    it('leaves the public network status routes unguarded', () => {
      expect(guardNames(controller.getStatus as (...args: never[]) => unknown)).not.toContain(
        'JwtAuthGuard',
      );
      expect(guardNames(controller.getHistory as (...args: never[]) => unknown)).not.toContain(
        'JwtAuthGuard',
      );
    });

    it('rejects a profile request without a token with 401', () => {
      const guard = new JwtAuthGuard(
        { verify: jest.fn() } as never,
        { getOrThrow: jest.fn() } as never,
      );
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {}, cookies: {} }) }),
      } as never;

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('rejects a profile request with an invalid token with 401', () => {
      const guard = new JwtAuthGuard(
        {
          verify: jest.fn(() => {
            throw new Error('jwt malformed');
          }),
        } as never,
        { getOrThrow: jest.fn(() => 'secret') } as never,
      );
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: 'Bearer broken' }, cookies: {} }),
        }),
      } as never;

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('authenticates a request that carries a valid bearer token', () => {
      const guard = new JwtAuthGuard(
        { verify: jest.fn(() => ({ sub: 'user-1', email: 'user@example.com' })) } as never,
        { getOrThrow: jest.fn(() => 'secret') } as never,
      );
      const request: {
        headers: Record<string, string>;
        cookies: Record<string, string>;
        user?: unknown;
      } = {
        headers: { authorization: 'Bearer valid-token' },
        cookies: {},
      };
      const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;

      expect(guard.canActivate(context)).toBe(true);
      expect(request.user).toEqual({ id: 'user-1', email: 'user@example.com' });
    });
  });

  describe('authenticated profile paths', () => {
    it('lists the profiles owned by the authenticated user', () => {
      service.listNetworkProfiles.mockResolvedValue([profile]);

      await expect(controller.listProfiles({ id: 'user-1' })).resolvesToEqual([profile]);
      expect(service.listNetworkProfiles).toHaveBeenCalledWith('user-1');
    });

    it('creates a profile for the authenticated user from the validated DTO', async () => {
      const dto = {
        name: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: 'Test DF Network ; September 2015',
      };
      service.createNetworkProfile.mockResolvedValue({ ...profile, ...dto });

      await expect(controller.createProfile({ id: 'user-1' }, dto)).resolvesToMatchObject({
        id: 'np-1',
        name: 'testnet',
      });
      expect(service.createNetworkProfile).toHaveBeenCalledWith('user-1', dto);
    });

    it('updates a profile scoped to the authenticated user', async () => {
      service.updateNetworkProfile.mockResolvedValue({ ...profile, name: 'renamed' });

      await expect(
        controller.updateProfile('np-1', { id: 'user-1' }, { name: 'renamed' }),
      ).resolvesToMatchObject({ name: 'renamed' });
      expect(service.updateNetworkProfile).toHaveBeenCalledWith('user-1', 'np-1', {
        name: 'renamed',
      });
    });

    it('deletes a profile scoped to the authenticated user and reports success', async () => {
      service.deleteNetworkProfile.mockResolvedValue(undefined);

      await expect(controller.deleteProfile('np-1', { id: 'user-1' })).resolvesToEqual({
        success: true,
      });
      expect(service.deleteNetworkProfile).toHaveBeenCalledWith('user-1', 'np-1');
    });

    it('marks a profile as default for the authenticated user', async () => {
      service.setDefaultNetworkProfile.mockResolvedValue(profile);

      await expect(controller.setDefaultProfile('np-1', { id: 'user-1' })).resolvesToEqual(profile);
      expect(service.setDefaultNetworkProfile).toHaveBeenCalledWith('user-1', 'np-1');
    });

    it('exports a profile scoped to the authenticated user', async () => {
      service.exportNetworkProfile.mockResolvedValue({ name: 'testnet' });

      await expect(controller.exportProfile('np-1', { id: 'user-1' })).resolvesToEqual({
        name: 'testnet',
      });
      expect(service.exportNetworkProfile).toHaveBeenCalledWith('user-1', 'np-1');
    });

    it('imports a profile for the authenticated user', async () => {
      const dto = {
        name: 'imported',
        horizonUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      };
      service.importNetworkProfile.mockResolvedValue({ ...profile, ...dto });

      await expect(controller.importProfile({ id: 'user-1' }, dto)).resolvesToMatchObject({
        name: 'imported',
      });
      expect(service.importNetworkProfile).toHaveBeenCalledWith('user-1', dto);
    });

    it('verifies a passphrase and defaults a missing expectation to the empty string', async () => {
      service.verifyNetworkPassphrase.mockResolvedValue({ match: false, actualPassphrase: 'X' });

      await controller.verifyPassphrase({ horizonUrl: 'https://horizon.stellar.org' });

      expect(service.verifyNetworkPassphrase).toHaveBeenCalledWith(
        'https://horizon.stellar.org',
        '',
      );
    });
  });

  describe('profile connectivity history and latency trends', () => {
    it('returns connectivity history scoped to the authenticated user', async () => {
      const history = {
        profileId: 'np-1',
        samples: [
          { timestamp: '2024-01-01T00:00:00.000Z', online: true, latencyMs: 120 },
        ],
      };
      service.getProfileConnectivityHistory.mockResolvedValue(history);

      await expect(
        controller.getProfileConnectivityHistory('np-1', { id: 'user-1' }, { limit: 10 }),
      ).resolvesToEqual(history);
      expect(service.getProfileConnectivityHistory).toHaveBeenCalledWith(
        'user-1',
        'np-1',
        { limit: 10 },
      );
    });

    it('returns latency trends scoped to the authenticated user', async () => {
      const trends = {
        profileId: 'np-1',
        averageLatencyMs: 120,
        p95LatencyMs: 150,
        sampleCount: 1,
      };
      service.getProfileLatencyTrends.mockResolvedValue(trends);

      await expect(
        controller.getProfileLatencyTrends('np-1', { id: 'user-1' }, { windowMinutes: 60 }),
      ).resolvesToEqual(trends);
      expect(service.getProfileLatencyTrends).toHaveBeenCalledWith(
        'user-1',
        'np-1',
        { windowMinutes: 60 },
      );
    });

    it('propagates a not-found error for a profile the user does not own', async () => {
      const error = new Error('Network profile not found');
      service.getProfileConnectivityHistory.mockRejectedValue(error);

      await expect(
        controller.getProfileConnectivityHistory('np-1', { id: 'user-2' }, {}),
      ).rejects.toBe(error);
    });
  });

  describe('dead profile surface', () => {
    it('drops the caller-less select endpoint', () => {
      expect(
        (controller as unknown as Record<string, unknown>).selectProfile,
      ).toBeUndefined();
      expect(
        Object.getOwnPropertyNames(NetworkController.prototype).filter((name) =>
          name.toLowerCase().includes('select'),
        ),
      ).toEqual([]);
    });

    it('drops the unused fetchCurrentStatusForProfile service helper', () => {
      expect(
        Object.getOwnPropertyNames(NetworkService.prototype).filter((name) =>
          name.toLowerCase().includes('statusforprofile'),
        ),
      ).toEqual([]);
    });
  });
});
