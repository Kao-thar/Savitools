#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(REPO_ROOT, 'apps/api/src/modules/sdkgen/specs');

const FLUXA_UPSTREAM_URLS = [
  'https://raw.githubusercontent.com/robertocarlous/Fluxa/main/docs/openapi.yaml',
  'https://raw.githubusercontent.com/dotunv/Fluxa/main/docs/openapi.yaml',
];

const CROWDPAY_REPO_URL = 'https://github.com/Savitura/crowdpay.git';

function parseYamlContent(content) {
  try {
    const yaml = require('yaml');
    if (yaml && typeof yaml.parse === 'function') {
      return yaml.parse(content);
    }
  } catch {
    // try apps/api workspace
  }

  try {
    const apiReq = createRequire(path.join(REPO_ROOT, 'apps/api/package.json'));
    const yaml = apiReq('yaml');
    if (yaml && typeof yaml.parse === 'function') {
      return yaml.parse(content);
    }
  } catch {
    // try direct path
  }

  try {
    const apiYamlPath = path.join(REPO_ROOT, 'apps/api/node_modules/yaml');
    const yaml = require(apiYamlPath);
    if (yaml && typeof yaml.parse === 'function') {
      return yaml.parse(content);
    }
  } catch {
    // fall through to python3
  }

  try {
    const jsonStr = execFileSync(
      'python3',
      ['-c', 'import yaml, json, sys; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
      { input: content, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(jsonStr);
  } catch (error) {
    throw new Error(`Failed to parse YAML content: ${error.message}`);
  }
}

function parseArgs(argv) {
  const options = {
    check: false,
    dryRun: false,
    fluxaSource: process.env.FLUXA_OPENAPI_PATH || undefined,
    crowdpaySource:
      process.env.CROWDPAY_SWAGGER_PATH || process.env.CROWDPAY_REPO_PATH || undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--fluxa-source' && argv[i + 1]) {
      options.fluxaSource = argv[++i];
    } else if (arg === '--crowdpay-source' && argv[i + 1]) {
      options.crowdpaySource = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/generate-sdk-specs.mjs [options]

Options:
  --check                 Check that committed specs match generated specs without writing
  --dry-run               Log generated specs without writing to disk
  --fluxa-source <path>   Local file or URL to Fluxa openapi.yaml
  --crowdpay-source <path> Local swagger.json file or path to CrowdPay repo
  -h, --help              Show help
`);
      process.exit(0);
    }
  }

  return options;
}

async function fetchWithFallback(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { Accept: 'text/yaml, text/plain, */*' } });
      if (response.ok) {
        return await response.text();
      }
      lastError = new Error(`HTTP ${response.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Failed to fetch from all source URLs');
}

function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

async function generateFluxaSpec(source) {
  let content;
  if (source && fs.existsSync(source)) {
    content = fs.readFileSync(source, 'utf8');
  } else if (source && (source.startsWith('http://') || source.startsWith('https://'))) {
    content = await fetchWithFallback([source]);
  } else {
    content = await fetchWithFallback(FLUXA_UPSTREAM_URLS);
  }

  const parsed = parseYamlContent(content);
  if (!parsed || !parsed.paths) {
    throw new Error('Parsed Fluxa OpenAPI document is invalid or missing paths');
  }

  // Ensure production & local development servers are documented (#405, #428)
  parsed.servers = [
    {
      url: 'https://api.fluxa.io',
      description: 'Production (not hosted publicly yet)',
    },
    {
      url: 'http://localhost:3000',
      description: 'Local development',
    },
  ];

  parsed.paths = sortObjectKeys(parsed.paths);

  // Normalize scalar type nuances between YAML engines (e.g. account_number string vs number in examples)
  const normalizeScalars = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (k === 'account_number' && typeof obj[k] === 'string' && /^\d+$/.test(obj[k])) {
          obj[k] = Number(obj[k]);
        } else if (typeof obj[k] === 'object') {
          normalizeScalars(obj[k]);
        }
      }
    }
  };
  normalizeScalars(parsed);

  return sortObjectKeys(parsed);
}

function generateCrowdPaySpecFromRoutes(routesDir) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-spec-'));
  const defPath = path.join(tmpDir, 'def.json');
  const outPath = path.join(tmpDir, 'out.json');

  const definition = {
    openapi: '3.0.0',
    info: {
      title: 'CrowdPay API',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'https://crowdpay.up.railway.app',
        description: 'Testnet backend',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };

  fs.writeFileSync(defPath, JSON.stringify(definition, null, 2));

  try {
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('.js') && !file.includes('.test.'))
      .map((file) => path.join(routesDir, file));

    if (routeFiles.length === 0) {
      throw new Error(`No route files found in ${routesDir}`);
    }

    execFileSync('npx', ['-y', 'swagger-jsdoc', '-d', defPath, ...routeFiles, '-o', outPath], {
      stdio: 'pipe',
      timeout: 30_000,
    });

    const generated = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    generated.paths = sortObjectKeys(generated.paths || {});
    return sortObjectKeys(generated);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function generateCrowdPaySpec(source) {
  if (source && fs.existsSync(source)) {
    const stat = fs.statSync(source);
    if (stat.isFile()) {
      return sortObjectKeys(JSON.parse(fs.readFileSync(source, 'utf8')));
    }
    const candidateRoutes = path.join(source, 'backend/src/routes');
    if (fs.existsSync(candidateRoutes)) {
      return generateCrowdPaySpecFromRoutes(candidateRoutes);
    }
    const directRoutes = path.join(source, 'src/routes');
    if (fs.existsSync(directRoutes)) {
      return generateCrowdPaySpecFromRoutes(directRoutes);
    }
    if (fs.readdirSync(source).some((f) => f.endsWith('.js'))) {
      return generateCrowdPaySpecFromRoutes(source);
    }
  }

  // Check if a local checkout exists in common paths
  const localCandidates = [
    '/tmp/crowdpay/backend/src/routes',
    path.join(REPO_ROOT, '../crowdpay/backend/src/routes'),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return generateCrowdPaySpecFromRoutes(candidate);
    }
  }

  // Clone shallowly to temp directory
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'crowdpay-clone-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', CROWDPAY_REPO_URL, tmpRepo], {
      stdio: 'pipe',
      timeout: 60_000,
    });
    const routesDir = path.join(tmpRepo, 'backend/src/routes');
    return generateCrowdPaySpecFromRoutes(routesDir);
  } finally {
    try {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('🔄 Generating OpenAPI specs for SDK generator (#428)...');

  console.log('  → Generating Fluxa OpenAPI spec from upstream docs/openapi.yaml...');
  const fluxaSpec = await generateFluxaSpec(options.fluxaSource);
  const fluxaPathCount = Object.keys(fluxaSpec.paths || {}).length;
  console.log(`    ✓ Fluxa spec generated (${fluxaPathCount} paths)`);

  console.log('  → Generating CrowdPay OpenAPI spec from backend routes...');
  const crowdPaySpec = await generateCrowdPaySpec(options.crowdpaySource);
  const crowdPayPathCount = Object.keys(crowdPaySpec.paths || {}).length;
  console.log(`    ✓ CrowdPay spec generated (${crowdPayPathCount} paths)`);

  const fluxaTarget = path.join(SPECS_DIR, 'fluxa.json');
  const crowdpayTarget = path.join(SPECS_DIR, 'crowdpay.json');

  const fluxaJson = JSON.stringify(fluxaSpec, null, 2) + '\n';
  const crowdpayJson = JSON.stringify(crowdPaySpec, null, 2) + '\n';

  if (options.check) {
    let hasError = false;

    const normalizeForCompare = (spec) =>
      JSON.stringify(spec, (key, value) => {
        if (key === 'account_number' && typeof value === 'string' && /^\d+$/.test(value)) {
          return Number(value);
        }
        return value;
      });

    if (!fs.existsSync(fluxaTarget)) {
      console.error(`❌ Missing committed spec: ${fluxaTarget}`);
      hasError = true;
    } else {
      const current = fs.readFileSync(fluxaTarget, 'utf8');
      const currentParsed = JSON.parse(current);
      const currentPaths = Object.keys(currentParsed.paths || {}).length;
      const isMatch =
        normalizeForCompare(currentParsed) === normalizeForCompare(fluxaSpec) ||
        (normalizeForCompare(currentParsed.paths) === normalizeForCompare(fluxaSpec.paths) &&
          currentParsed.openapi === fluxaSpec.openapi);
      if (currentPaths < 2) {
        console.error(
          `❌ Committed fluxa.json only has ${currentPaths} path(s); expected ${fluxaPathCount}`,
        );
        hasError = true;
      } else if (!isMatch) {
        console.error('❌ Committed fluxa.json differs from upstream generator output');
        hasError = true;
      } else {
        console.log(`    ✓ fluxa.json matches upstream (${currentPaths} paths)`);
      }
    }

    if (!fs.existsSync(crowdpayTarget)) {
      console.error(`❌ Missing committed spec: ${crowdpayTarget}`);
      hasError = true;
    } else {
      const current = fs.readFileSync(crowdpayTarget, 'utf8');
      const currentParsed = JSON.parse(current);
      const currentPaths = Object.keys(currentParsed.paths || {}).length;
      const isMatch =
        normalizeForCompare(currentParsed) === normalizeForCompare(crowdPaySpec) ||
        (normalizeForCompare(currentParsed.paths) === normalizeForCompare(crowdPaySpec.paths) &&
          currentParsed.openapi === crowdPaySpec.openapi);
      if (currentPaths < 2) {
        console.error(
          `❌ Committed crowdpay.json only has ${currentPaths} path(s); expected ${crowdPayPathCount}`,
        );
        hasError = true;
      } else if (!isMatch) {
        console.error('❌ Committed crowdpay.json differs from upstream generator output');
        hasError = true;
      } else {
        console.log(`    ✓ crowdpay.json matches upstream (${currentPaths} paths)`);
      }
    }

    if (hasError) {
      console.error('\nRun "npm run specs:generate" to synchronize the bundled SDK specs.');
      process.exit(1);
    }

    console.log('\n✅ All SDK generator specs are current and match real OpenAPI documents.');
    return;
  }

  if (options.dryRun) {
    console.log('\nDry run complete. No files written.');
    return;
  }

  fs.mkdirSync(SPECS_DIR, { recursive: true });
  fs.writeFileSync(fluxaTarget, fluxaJson);
  fs.writeFileSync(crowdpayTarget, crowdpayJson);

  console.log(`\n✅ Specs written successfully:
  - ${fluxaTarget} (${fluxaPathCount} paths)
  - ${crowdpayTarget} (${crowdPayPathCount} paths)
`);
}

main().catch((err) => {
  console.error('\n❌ Fatal error generating SDK specs:', err);
  process.exit(1);
});
