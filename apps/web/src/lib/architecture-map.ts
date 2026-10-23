/**
 * Architecture map defining the relationship between frontend web tools,
 * backend API modules, and shared integration contracts across SaviTools.
 */

import { tools } from './tools';

export interface WebToolArchitecture {
  route: string;
  label: string;
  apiModules: string[];
  endpoints: string[];
  contracts: string[];
  externalDependencies: string[];
  description: string;
}

export interface ApiModuleArchitecture {
  name: string;
  domain: string;
  controllerPrefix: string;
  hasPersistence: boolean;
  externalProtocols: string[];
}

export const API_MODULES_ARCHITECTURE: Record<string, ApiModuleArchitecture> = {
  auth: {
    name: 'auth',
    domain: 'Authentication & Credentials',
    controllerPrefix: '/api/v1/auth',
    hasPersistence: true,
    externalProtocols: ['WebAuthn / Passkeys', 'JWT'],
  },
  composer: {
    name: 'composer',
    domain: 'Transaction Composition',
    controllerPrefix: '/api/v1/composer',
    hasPersistence: true,
    externalProtocols: ['Stellar Horizon', 'Soroban RPC'],
  },
  contracts: {
    name: 'contracts',
    domain: 'Soroban Smart Contracts',
    controllerPrefix: '/api/v1/contracts',
    hasPersistence: true,
    externalProtocols: ['Soroban RPC', 'WASM'],
  },
  federation: {
    name: 'federation',
    domain: 'Stellar Federation & TOML',
    controllerPrefix: '/api/v1/federation',
    hasPersistence: false,
    externalProtocols: ['SEP-0002 (Federation)', 'SEP-0001 (stellar.toml)'],
  },
  inspector: {
    name: 'inspector',
    domain: 'Transaction & Address Inspection',
    controllerPrefix: '/api/v1/inspector',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon', 'XDR'],
  },
  'ledger-close': {
    name: 'ledger-close',
    domain: 'Ledger Timing & Health',
    controllerPrefix: '/api/v1/ledger-close',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon SSE', 'Horizon RPC'],
  },
  'liquidity-pools': {
    name: 'liquidity-pools',
    domain: 'DEX Liquidity Pools',
    controllerPrefix: '/api/v1/liquidity-pools',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon DEX', 'AMM'],
  },
  metrics: {
    name: 'metrics',
    domain: 'Observability & Metrics',
    controllerPrefix: '/metrics',
    hasPersistence: false,
    externalProtocols: ['Prometheus'],
  },
  monitor: {
    name: 'monitor',
    domain: 'Ledger Activity Streaming',
    controllerPrefix: '/api/v1/monitor',
    hasPersistence: true,
    externalProtocols: ['Server-Sent Events (SSE)', 'Socket.IO / WebSockets'],
  },
  multisig: {
    name: 'multisig',
    domain: 'Multisignature Coordination',
    controllerPrefix: '/api/v1/multisig',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon', 'ED25519 Signatures'],
  },
  network: {
    name: 'network',
    domain: 'Network Health & Latency',
    controllerPrefix: '/api/v1/network',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon', 'Soroban RPC'],
  },
  playground: {
    name: 'playground',
    domain: 'Interactive API Explorer',
    controllerPrefix: '/api/v1/playground',
    hasPersistence: false,
    externalProtocols: ['OpenAPI 3.0', 'HTTP Proxy'],
  },
  sandbox: {
    name: 'sandbox',
    domain: 'Testnet Keypair & Friendbot',
    controllerPrefix: '/api/v1/sandbox',
    hasPersistence: false,
    externalProtocols: ['Stellar Friendbot', 'ED25519'],
  },
  sdkgen: {
    name: 'sdkgen',
    domain: 'SDK Client Code Generation',
    controllerPrefix: '/api/v1/sdk',
    hasPersistence: false,
    externalProtocols: ['OpenAPI 3.0'],
  },
  sep10: {
    name: 'sep10',
    domain: 'Stellar Web Authentication',
    controllerPrefix: '/api/v1/sep10',
    hasPersistence: false,
    externalProtocols: ['SEP-0010 (Web Auth)'],
  },
  sep24: {
    name: 'sep24',
    domain: 'Interactive Deposit/Withdrawal',
    controllerPrefix: '/api/v1/sep24',
    hasPersistence: false,
    externalProtocols: ['SEP-0024 (Hosted Transfer)', 'SEP-0006'],
  },
  'sequence-planner': {
    name: 'sequence-planner',
    domain: 'Sequence Number Planning',
    controllerPrefix: '/api/v1/sequence-planner',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon'],
  },
  simulator: {
    name: 'simulator',
    domain: 'Path Payments & DEX Simulation',
    controllerPrefix: '/api/v1/simulator',
    hasPersistence: false,
    externalProtocols: ['Stellar DEX', 'Path Finding API'],
  },
  'soroban-rpc': {
    name: 'soroban-rpc',
    domain: 'Soroban JSON-RPC Gateway',
    controllerPrefix: '/api/v1/soroban-rpc',
    hasPersistence: false,
    externalProtocols: ['Soroban JSON-RPC', 'WASM'],
  },
  'soroban-storage': {
    name: 'soroban-storage',
    domain: 'Contract Storage & State TTL',
    controllerPrefix: '/api/v1/soroban-storage',
    hasPersistence: false,
    externalProtocols: ['Soroban RPC Ledger Keys'],
  },
  stellar: {
    name: 'stellar',
    domain: 'Horizon Gateway & Client Core',
    controllerPrefix: '/api/v1/stellar',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon'],
  },
  'stellar-toml': {
    name: 'stellar-toml',
    domain: 'stellar.toml & SEP Compliance',
    controllerPrefix: '/api/v1/stellar-toml',
    hasPersistence: false,
    externalProtocols: ['SEP-0001 (stellar.toml)'],
  },
  transaction: {
    name: 'transaction',
    domain: 'Transaction Graph & Replay',
    controllerPrefix: '/api/v1/transaction',
    hasPersistence: true,
    externalProtocols: ['Stellar Horizon', 'XDR Encoding'],
  },
  wallet: {
    name: 'wallet',
    domain: 'Wallet Balances & Trustlines',
    controllerPrefix: '/api/v1/wallet',
    hasPersistence: false,
    externalProtocols: ['Stellar Horizon', 'Freighter Extension'],
  },
  webhook: {
    name: 'webhook',
    domain: 'Webhook Delivery & Testing',
    controllerPrefix: '/api/v1/webhooks',
    hasPersistence: true,
    externalProtocols: ['HTTP Webhook Delivery', 'HMAC-SHA256 Signatures'],
  },
  workspace: {
    name: 'workspace',
    domain: 'Workspace Persistence & Schemas',
    controllerPrefix: '/api/v1/workspaces',
    hasPersistence: true,
    externalProtocols: ['PostgreSQL', 'JSON Schema v2'],
  },
};

export const WEB_TOOLS_ARCHITECTURE: WebToolArchitecture[] = [
  {
    route: '/inspector',
    label: 'Inspector',
    apiModules: ['inspector', 'transaction', 'stellar'],
    endpoints: ['/api/v1/inspector/decode', '/api/v1/transaction/analyze'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar Horizon', 'XDR Decoder'],
    description:
      'Decodes transaction hashes, addresses, and raw XDR into human-readable operations and balance impacts.',
  },
  {
    route: '/composer',
    label: 'Composer',
    apiModules: ['composer', 'workspace', 'stellar', 'sequence-planner'],
    endpoints: [
      '/api/v1/composer/workspaces',
      '/api/v1/composer/estimate-fee',
      '/api/v1/workspaces',
    ],
    contracts: ['WorkspaceFormatV2', 'RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar Horizon', 'Soroban RPC'],
    description:
      'Visual builder for multi-operation Stellar transactions with operation templates and guest/authenticated persistence.',
  },
  {
    route: '/sandbox',
    label: 'Sandbox',
    apiModules: ['sandbox', 'wallet', 'stellar'],
    endpoints: ['/api/v1/sandbox/keypair', '/api/v1/sandbox/fund'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar Friendbot', 'ED25519'],
    description:
      'Generates testnet keypairs, provides one-click funding through Friendbot, and inspects balances.',
  },
  {
    route: '/sandbox/assetcontrol',
    label: 'Asset Control',
    apiModules: ['sandbox', 'wallet', 'stellar'],
    endpoints: ['/api/v1/wallet/trustlines', '/api/v1/stellar/asset-flags'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar Horizon'],
    description:
      'Inspects issuer authorization flags, audits trustlines, and builds SetTrustlineFlags, Clawback and SetOptions transactions.',
  },
  {
    route: '/simulator',
    label: 'Simulator',
    apiModules: ['simulator', 'liquidity-pools', 'stellar'],
    endpoints: ['/api/v1/simulator/paths', '/api/v1/simulator/estimate-fee'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar DEX', 'Horizon Strict Send/Receive'],
    description:
      'Finds path payment routes, calculates liquidity depth, and previews fees before sending.',
  },
  {
    route: '/playground',
    label: 'Playground',
    apiModules: ['playground', 'auth', 'sdkgen'],
    endpoints: ['/api/v1/playground/proxy', '/api/v1/playground/schema'],
    contracts: ['OpenApiContract', 'RouteContract'],
    externalDependencies: ['Swagger/OpenAPI Spec'],
    description:
      'Interactive API explorer for testing Fluxa and CrowdPay endpoints with live credential injection.',
  },
  {
    route: '/webhooks',
    label: 'Webhooks',
    apiModules: ['webhook'],
    endpoints: [
      '/api/v1/webhooks/deliveries',
      '/api/v1/webhooks/test-payload',
      '/api/v1/webhooks/verify',
    ],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['HMAC-SHA256 WebCrypto'],
    description:
      'Tests and verifies webhook payloads against developer endpoints with signature generation.',
  },
  {
    route: '/contracts',
    label: 'Contracts',
    apiModules: ['contracts', 'soroban-rpc', 'soroban-storage'],
    endpoints: [
      '/api/v1/contracts/deploy',
      '/api/v1/contracts/inspect',
      '/api/v1/soroban-rpc/simulate',
    ],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Soroban RPC', 'Stellar Expert Explorer'],
    description:
      'Deploys Soroban smart contracts to testnet, inspects methods/ABIs, and monitors contract state.',
  },
  {
    route: '/monitor',
    label: 'Monitor',
    apiModules: ['monitor', 'ledger-close'],
    endpoints: ['/api/v1/monitor/watches', '/api/v1/monitor/stream', '/api/v1/ledger-close/stream'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Server-Sent Events (SSE)', 'Socket.IO'],
    description:
      'Watches accounts and contracts for real-time ledger events and streaming transaction feeds.',
  },
  {
    route: '/inspector/federation',
    label: 'Federation & TOML',
    apiModules: ['federation', 'stellar-toml'],
    endpoints: [
      '/api/v1/federation/resolve',
      '/api/v1/stellar-toml/fetch',
      '/api/v1/stellar-toml/sep-check',
    ],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['SEP-0002 Federation', 'SEP-0001 stellar.toml'],
    description:
      'Resolves federation addresses, fetches and validates stellar.toml files, and checks SEP compliance.',
  },
  {
    route: '/simulator/orderbook',
    label: 'Order Book',
    apiModules: ['simulator', 'liquidity-pools'],
    endpoints: ['/api/v1/simulator/orderbook', '/api/v1/liquidity-pools/list'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar DEX Orderbook Horizon'],
    description:
      'Live order book visualizer with spread analytics and depth charts for asset pairs.',
  },
  {
    route: '/simulator/path-payment-lab',
    label: 'Slippage Lab',
    apiModules: ['simulator'],
    endpoints: ['/api/v1/simulator/slippage-analysis', '/api/v1/simulator/paths'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar DEX Paths'],
    description:
      'Simulates path payment slippage tolerances against adverse rate moves to test execution survival.',
  },
  {
    route: '/multisig',
    label: 'Multisig Simulator',
    apiModules: ['multisig', 'wallet', 'stellar'],
    endpoints: ['/api/v1/multisig/verify', '/api/v1/multisig/signers'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Stellar Horizon Signers'],
    description:
      'Evaluates multi-signature thresholds and identifies outstanding signers needed to authorize transactions.',
  },
  {
    route: '/inspector/graph',
    label: 'Account Graph',
    apiModules: ['transaction', 'inspector'],
    endpoints: ['/api/v1/transaction/graph', '/api/v1/inspector/account-relations'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['D3 Force-Directed Layout', 'Stellar Horizon'],
    description:
      'Interactive force-directed graph visualizer of signer networks, offers, and payment relationships.',
  },
  {
    route: '/contracts/events',
    label: 'Contract Events',
    apiModules: ['contracts', 'soroban-rpc'],
    endpoints: ['/api/v1/contracts/events', '/api/v1/soroban-rpc/getEvents'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Soroban RPC getEvents', 'ScVal XDR Parser'],
    description: 'Decodes, filters, and replays Soroban contract events from raw ScVal XDR.',
  },
  {
    route: '/sdk',
    label: 'SDK Generator',
    apiModules: ['sdkgen', 'playground'],
    endpoints: ['/api/v1/sdk/generate', '/api/v1/playground/schema'],
    contracts: ['OpenApiContract', 'RouteContract'],
    externalDependencies: ['OpenAPI 3.0 Codegen'],
    description:
      'Generates client code in TypeScript, Python, Go, and cURL from OpenAPI endpoint definitions.',
  },
  {
    route: '/network',
    label: 'Network Status',
    apiModules: ['network', 'ledger-close'],
    endpoints: [
      '/api/v1/network/status',
      '/api/v1/ledger-close/stats',
      '/api/v1/network/fee-stats',
    ],
    contracts: ['NetworkProfileFormatV1', 'RouteContract', 'OpenApiContract'],
    externalDependencies: ['Horizon Network Metrics', 'Soroban Health'],
    description:
      'Monitors real-time Stellar network health, ledger close times, and Horizon latency.',
  },
  {
    route: '/rpc',
    label: 'Soroban RPC',
    apiModules: ['soroban-rpc', 'soroban-storage'],
    endpoints: ['/api/v1/soroban-rpc/execute', '/api/v1/soroban-storage/entry'],
    contracts: ['RouteContract', 'OpenApiContract'],
    externalDependencies: ['Soroban JSON-RPC v2'],
    description:
      'Interactive console for calling read-only Soroban RPC methods with schema-aware inputs.',
  },
  {
    route: '/qr-handoff',
    label: 'QR Handoff',
    apiModules: ['transaction', 'wallet'],
    endpoints: ['/api/v1/transaction/xdr-verify'],
    contracts: ['RouteContract'],
    externalDependencies: ['jsQR', 'QRCode', 'CRC-32 Framing'],
    description:
      'Transfers unsigned or partially signed XDR across air gaps using animated, checksummed QR frames.',
  },
];

/**
 * Retrieves the architecture mapping for a specific frontend web tool route.
 */
export function getToolArchitecture(route: string): WebToolArchitecture | undefined {
  return WEB_TOOLS_ARCHITECTURE.find((t) => t.route === route);
}

/**
 * Retrieves architecture details for a backend API module.
 */
export function getApiModuleArchitecture(moduleName: string): ApiModuleArchitecture | undefined {
  return API_MODULES_ARCHITECTURE[moduleName];
}

/**
 * Validates integrity between the web tools registry (`tools.ts`) and the architecture map.
 * Detects missing tools, orphaned routes, or unmapped API modules.
 */
export function validateArchitectureIntegrity(): {
  valid: boolean;
  missingToolRoutes: string[];
  extraToolRoutes: string[];
  referencedModules: string[];
  unregisteredModules: string[];
} {
  const definedRoutes = new Set<string>(tools.map((t) => t.href as string));
  const mappedRoutes = new Set(WEB_TOOLS_ARCHITECTURE.map((t) => t.route));

  const missingToolRoutes = [...definedRoutes].filter((r) => !mappedRoutes.has(r));
  const extraToolRoutes = [...mappedRoutes].filter((r) => !definedRoutes.has(r));

  const allReferencedModules = new Set<string>();
  for (const tool of WEB_TOOLS_ARCHITECTURE) {
    for (const mod of tool.apiModules) {
      allReferencedModules.add(mod);
    }
  }

  const unregisteredModules = [...allReferencedModules].filter((m) => !API_MODULES_ARCHITECTURE[m]);

  return {
    valid:
      missingToolRoutes.length === 0 &&
      extraToolRoutes.length === 0 &&
      unregisteredModules.length === 0,
    missingToolRoutes,
    extraToolRoutes,
    referencedModules: [...allReferencedModules],
    unregisteredModules,
  };
}
