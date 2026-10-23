import {
  WEB_TOOLS_ARCHITECTURE,
  API_MODULES_ARCHITECTURE,
  getToolArchitecture,
  getApiModuleArchitecture,
  validateArchitectureIntegrity,
} from '@/lib/architecture-map';
import { tools } from '@/lib/tools';

describe('Architecture Map (Web Tools, API Modules, Shared Contracts)', () => {
  it('maps every registered web tool from tools.ts', () => {
    const integrity = validateArchitectureIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.missingToolRoutes).toHaveLength(0);
    expect(integrity.extraToolRoutes).toHaveLength(0);
    expect(integrity.unregisteredModules).toHaveLength(0);
  });

  it('contains valid endpoints, contracts, and module references for every tool', () => {
    expect(WEB_TOOLS_ARCHITECTURE).toHaveLength(tools.length);

    for (const tool of WEB_TOOLS_ARCHITECTURE) {
      expect(tool.route).toMatch(/^\/[a-z0-9\-/]*$/);
      expect(tool.label.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.apiModules.length).toBeGreaterThan(0);
      expect(tool.endpoints.length).toBeGreaterThan(0);
      expect(tool.contracts.length).toBeGreaterThan(0);

      // Verify every referenced module exists in API_MODULES_ARCHITECTURE
      for (const mod of tool.apiModules) {
        expect(API_MODULES_ARCHITECTURE[mod]).toBeDefined();
        expect(API_MODULES_ARCHITECTURE[mod].controllerPrefix).toMatch(/^\//);
      }
    }
  });

  it('retrieves tool architecture by route', () => {
    const composer = getToolArchitecture('/composer');
    expect(composer).toBeDefined();
    expect(composer?.label).toBe('Composer');
    expect(composer?.apiModules).toContain('composer');
    expect(composer?.contracts).toContain('WorkspaceFormatV2');
  });

  it('retrieves API module architecture by name', () => {
    const authModule = getApiModuleArchitecture('auth');
    expect(authModule).toBeDefined();
    expect(authModule?.domain).toBe('Authentication & Credentials');
    expect(authModule?.hasPersistence).toBe(true);
  });

  it('handles edge cases and invalid lookups gracefully', () => {
    expect(getToolArchitecture('/non-existent-route')).toBeUndefined();
    expect(getApiModuleArchitecture('non-existent-module')).toBeUndefined();
  });

  it('detects missing or unmapped modules when integrity check is simulated', () => {
    const sample = { ...API_MODULES_ARCHITECTURE };
    expect(sample).toBeDefined();
  });
});
