import * as fs from 'fs';
import * as path from 'path';
import { REQUIRED_SPECS } from './sdkgen.service';

/**
 * `/sdkgen/generate` reads its specs from `path.join(__dirname, 'specs', ...)`,
 * so the JSON files have to travel with the compiled output. These assertions
 * fail if a spec is renamed/removed or the nest build stops copying the specs
 * directory into `dist`.
 */
describe('sdkgen specs are part of the build output', () => {
  const apiRoot = path.join(__dirname, '..', '..', '..');

  it.each(REQUIRED_SPECS)('ships %s.json next to the service', (spec) => {
    expect(fs.existsSync(path.join(__dirname, 'specs', `${spec}.json`))).toBe(true);
  });

  it('declares the specs directory as a nest build asset', () => {
    const nestCli = JSON.parse(fs.readFileSync(path.join(apiRoot, 'nest-cli.json'), 'utf8')) as {
      compilerOptions?: { assets?: unknown };
    };

    expect(JSON.stringify(nestCli.compilerOptions?.assets ?? [])).toContain('modules/sdkgen/specs');
  });

  it('contains the real full OpenAPI paths rather than single-endpoint stubs (#428)', () => {
    const fluxaRaw = fs.readFileSync(path.join(__dirname, 'specs', 'fluxa.json'), 'utf8');
    const fluxa = JSON.parse(fluxaRaw);
    const fluxaPaths = Object.keys(fluxa.paths || {});
    expect(fluxaPaths.length).toBeGreaterThanOrEqual(50);
    expect(fluxaPaths).toContain('/v1/transfers');
    expect(fluxaPaths).toContain('/v1/wallets');

    const crowdpayRaw = fs.readFileSync(path.join(__dirname, 'specs', 'crowdpay.json'), 'utf8');
    const crowdpay = JSON.parse(crowdpayRaw);
    const crowdpayPaths = Object.keys(crowdpay.paths || {});
    expect(crowdpayPaths.length).toBeGreaterThanOrEqual(80);
    expect(crowdpayPaths).toContain('/api/campaigns');
    expect(crowdpayPaths).toContain('/api/auth/login');
  });
});
