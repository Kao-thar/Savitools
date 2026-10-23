import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertPublicHostname, MAX_SAFE_REDIRECTS } from '../../common/ssrf-guard';
import { BoundedTtlMap } from '../../common/bounded-ttl-map';
import * as smolToml from 'smol-toml';
import { isStellarPublicKey } from '../../common/stellar-address';
import { redactValue } from '../../common/redaction';

const FETCH_TIMEOUT = 15_000;
export const DEFAULT_FEDERATION_PROBE_TIMEOUT_MS = 3_000;
export const DEFAULT_FEDERATION_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_SEP24_POLL_TIMEOUT_MS = 120_000;
export const DEFAULT_SEP24_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_FEDERATION_TOML_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_FEDERATION_TOML_CACHE_MAX_ENTRIES = 200;

// ─── SEP-24 interactive flow debugger (Savitura/Savitools#SEP24) ────────────
/** Maximum stellar.toml response size accepted before parsing. */
export const TOML_MAX_BYTES = 512 * 1024;
/** Maximum nesting depth of the parsed document. */
export const TOML_MAX_DEPTH = 64;
/** Hard cap on keys produced by a single document. */
export const TOML_MAX_KEYS = 10_000;

function isFederationAddress(input: string): boolean {
  return /^[^\s*]+[*][^\s*]+\.[^\s*]+$/.test(input);
}

function isDomain(input: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(
    input,
  );
}

function stripProtocol(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function normalizeDomain(domain: string): string {
  return stripProtocol(domain.trim()).replace(/\.$/, '').toLowerCase();
}

function normalizeHomeDomain(domain: string): string {
  const normalized = domain.trim().replace(/\.$/, '').toLowerCase();
  if (!isDomain(normalized)) {
    throw new BadRequestException(`Invalid domain: ${domain}`);
  }
  return normalized;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'RequestTimeoutError';
  }
}

export interface FederationResolveResult {
  stellarAddress: string | null;
  federationAddress: string | null;
  memo: string | null;
  memoType: string | null;
  homeDomain: string | null;
}

export interface TomlAccount {
  PUBLIC_KEY: string;
  NAME?: string;
  HOME_DOMAIN?: string;
  DESCRIPTION?: string;
}

export interface TomlCurrency {
  code: string;
  issuer: string;
  display_decimals?: number;
  name?: string;
  desc?: string;
  conditions?: string;
  image?: string;
  anchor_asset_type?: string;
  anchor_asset?: string;
  redemption_instructions?: string;
  collateral_addresses?: string;
  regulated?: boolean;
  approval_server?: string;
  approval_criteria?: string;
}

export interface TomlValidator {
  PUBLIC_KEY: string;
  NAME?: string;
  HOST?: string;
  HISTORY_URL?: string;
}

export interface TomlDocumentation {
  PRINCIPALS_NAME?: string;
  PRINCIPAL_EMAIL?: string;
  PROJECT_URL?: string;
  OFFICIAL_CHAT?: string;
  OTHER_INFO?: string;
}

export interface TomlResult {
  version: string | null;
  networkPassphrase: string | null;
  federationServer: string | null;
  transferServer: string | null;
  transferServerSep0024: string | null;
  webAuthEndpoint: string | null;
  directPaymentServer: string | null;
  accounts: TomlAccount[];
  currencies: TomlCurrency[];
  validators: TomlValidator[];
  documentation: TomlDocumentation | null;
  fetchLatencyMs: number;
  validationWarnings: string[];
}

export interface HomeDomainValidationResult {
  valid: boolean;
  domain: string;
  issuer: string;
  reason: 'issuer_not_declared' | 'home_domain_mismatch' | null;
}

export interface SepInfo {
  number: number;
  name: string;
  supported: boolean;
  endpoint: string | null;
  probeStatus: 'green' | 'yellow' | 'red' | 'none' | 'timeout';
}

export interface SepResult {
  seps: SepInfo[];
  /** Additive TOML state so an unavailable or malformed document is not hidden. */
  tomlStatus?: 'available' | 'unavailable' | 'malformed';
}

// ─── SEP-24 interactive flow debugger (Savitura/Savitools#SEP24) ────────────

export type Sep24FlowType = 'deposit' | 'withdraw';

export type Sep24TimelineStage =
  | 'discovery'
  | 'authentication'
  | 'interactive-url'
  | 'redirect'
  | 'callback'
  | 'status-poll'
  | 'terminal';

export type Sep24DiagnosticKind =
  | 'non-json'
  | 'anchor-error'
  | 'expired-token'
  | 'unknown-state'
  | 'unsafe-url'
  | 'ssrf'
  | 'timeout'
  | 'cancelled'
  | 'http'
  | 'schema';

export interface Sep24TimelineEntry {
  stage: Sep24TimelineStage;
  at: string;
  latencyMs?: number;
  request?: { method: string; url: string };
  response?: { status: number; body?: unknown };
  message?: string;
  diagnostic?: Sep24DiagnosticKind;
  redirectChain?: string[];
}

export interface Sep24DebuggerParams {
  domain: string;
  flow: Sep24FlowType;
  asset: string;
  account: string;
  amount?: string;
  memo?: string;
  callback?: string;
  /** SEP-10 JWT from a prior auth handoff, if available. */
  jwt?: string;
  /** Caller-supplied cancellation signal. */
  signal?: AbortSignal;
  /** Overrides for tests; default to config values. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface Sep24DebuggerResult {
  domain: string;
  flow: Sep24FlowType;
  asset: string;
  transferServerSep0024: string;
  webAuthEndpoint: string | null;
  interactiveUrl: string | null;
  interactiveUrlOrigin: string | null;
  originChanged: boolean;
  transactionId: string | null;
  finalStatus: string | null;
  terminal: boolean;
  cancelled: boolean;
  timedOut: boolean;
  moreInfoUrl: string | null;
  requiredFields: Record<string, unknown> | null;
  message: string | null;
  diagnostics: Sep24DiagnosticKind[];
  timeline: Sep24TimelineEntry[];
}

/** SEP-24 transaction states that end polling. */
const SEP24_TERMINAL_STATES = new Set([
  'completed',
  'refunded',
  'expired',
  'error',
  'no_market',
  'too_small',
  'too_large',
  'pending_user_transfer_complete',
]);

/** Reject non-https and non-public hosts before navigation. */
async function assertSafeNavigationUrl(urlStr: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new BadRequestException(`Unsafe navigation URL: ${urlStr}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException(
      `Unsafe navigation scheme '${parsed.protocol}': only https:// is allowed`,
    );
  }
  await assertPublicHostname(parsed.hostname);
  return parsed;
}

interface CachedToml {
  parsed: Record<string, unknown>;
  fetchLatencyMs: number;
}

interface CachedToml {
  parsed: Record<string, unknown>;
  fetchLatencyMs: number;
}

// ─── Transfer request links (Savitura/Savitools#217) ────────────────────────

export type TransferRequestSep = '6' | '24' | '31';

export interface TransferLinkParams {
  sep: TransferRequestSep;
  asset: string;
  amount: string;
  memo?: string;
  callback?: string;
  account?: string;
  type?: 'deposit' | 'withdraw';
}

export interface TransferLinkResult {
  sep: TransferRequestSep;
  endpoint: string;
  url: string;
  asset: string;
  amount: string;
  warning: string;
}

/** Decimal string only — never routed through Number to avoid float conversion. */
const DECIMAL_STRING_RE = /^\d+(\.\d+)?$/;
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/i;

// ─── Server diagnostics (Savitura/Savitools#341) ────────────────────────────

export type DiagnosticStageName = 'toml' | 'http' | 'forward-lookup' | 'reverse-lookup';

export type DiagnosticFailureKind =
  'dns' | 'toml' | 'tls' | 'http' | 'timeout' | 'schema' | 'ssrf' | 'redirects';

/** One probed step of the diagnostic run. */
export interface DiagnosticStage {
  stage: DiagnosticStageName;
  ok: boolean;
  latencyMs?: number;
  error?: DiagnosticFailureKind;
  details: Record<string, unknown>;
  redirectChain?: string[];
}

/** Redacted, copy-safe diagnostic report. */
export interface FederationDiagnosticsReport {
  domain: string;
  checkedAt: string;
  ok: boolean;
  totalLatencyMs: number;
  serverUrl?: string;
  serverStatus?: number | null;
  forwardStatus?: number | null;
  reverseStatus?: number | null;
  stages: DiagnosticStage[];
  failures: DiagnosticFailureKind[];
}

/** Map any thrown error from the fetch path onto a failure kind. */
function classifyError(error: unknown): DiagnosticFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestTimeoutError || /timed out/i.test(message)) return 'timeout';
  if (/non-public address/i.test(message)) return 'ssrf';
  if (/Could not resolve host/i.test(message)) return 'dns';
  if (/Unsupported protocol/i.test(message)) return 'tls';
  if (
    error instanceof BadGatewayException ||
    /Too many redirects|redirect loop|redirect/i.test(message)
  ) {
    return 'redirects';
  }
  if (error instanceof NotFoundException) return 'toml';
  // The bounded TOML parser reports malformed/oversized documents as 400s.
  if (
    error instanceof BadRequestException &&
    /Malformed TOML|TOML document|stellar\.toml/i.test(message)
  ) {
    return 'toml';
  }
  return 'http';
}

/** Append query parameters, preserving any existing path on the server URL. */
function appendQuery(serverUrl: string, params: Record<string, string>): string {
  const url = new URL(serverUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Strip query strings from a URL so reports stay copy-safe. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}

/** Redact request URLs in-place before the report leaves the service. */
function redactReport(report: FederationDiagnosticsReport): FederationDiagnosticsReport {
  return {
    ...report,
    stages: report.stages.map((stage) => ({
      ...stage,
      details: Object.fromEntries(
        Object.entries(stage.details).map(([key, value]) =>
          typeof value === 'string' && /^https?:\/\//.test(value) && key !== 'serverUrl'
            ? [key, redactUrl(value)]
            : [key, value],
        ),
      ),
    })),
  };
}

/** Deterministic probe user for diagnostics — never a real account. */
function probeQuery(domain: string): string {
  return `savitools-diagnostic*${domain}`;
}

const REQUIRED_TOML_FIELDS = ['ACCOUNTS'] as const;

/**
 * Bounded TOML parsing for remote stellar.toml content (Savitura/Savitools#220).
 *
 * smol-toml is a maintained parser without prototype-pollution or
 * uncontrolled-recursion behavior; the guards here cap input size, nesting
 * depth, and allocation before any parsed data is returned.
 */
function measureDepth(value: unknown, depth = 0): number {
  if (depth > TOML_MAX_DEPTH) return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, measureDepth(item, depth + 1));
    return max;
  }
  if (value && typeof value === 'object') {
    let max = depth;
    for (const item of Object.values(value)) max = Math.max(max, measureDepth(item, depth + 1));
    return max;
  }
  return depth;
}

function countKeys(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countKeys(item), 0);
  }
  let count = 0;
  for (const item of Object.values(value)) count += 1 + countKeys(item);
  return count;
}

function parseBoundedToml(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw, 'utf8') > TOML_MAX_BYTES) {
    throw new PayloadTooLargeException(
      `stellar.toml exceeds the maximum accepted size of ${TOML_MAX_BYTES} bytes`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = smolToml.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown parse error';
    throw new BadRequestException(`Malformed TOML document: ${msg}`);
  }

  const depth = measureDepth(parsed);
  if (depth >= TOML_MAX_DEPTH) {
    throw new BadRequestException(
      `TOML document nesting depth exceeds the limit of ${TOML_MAX_DEPTH}`,
    );
  }

  if (countKeys(parsed) > TOML_MAX_KEYS) {
    throw new BadRequestException(`TOML document exceeds the maximum of ${TOML_MAX_KEYS} keys`);
  }

  return parsed;
}

@Injectable()
export class FederationService {
  private readonly logger = new Logger(FederationService.name);
  /**
   * Process-local stellar.toml cache. `BoundedTtlMap` owns both the entry bound
   * and the TTL, so this class no longer hand-rolls an LRU trim next to an
   * `expiresAt` field (Savitura/Savitools#291). The in-flight map is a
   * de-duplicator, not a cache: entries leave it in the same request.
   */
  private readonly tomlCache: BoundedTtlMap<string, CachedToml>;
  private readonly tomlInFlight = new Map<string, Promise<CachedToml>>();

  constructor(private readonly configService?: ConfigService) {
    this.tomlCache = new BoundedTtlMap({
      maxEntries: this.tomlCacheMaxEntries,
      ttlMs: this.tomlCacheTtlMs,
    });
  }

  private get probeTimeoutMs(): number {
    return positiveInteger(
      this.configService?.get('FEDERATION_PROBE_TIMEOUT_MS'),
      DEFAULT_FEDERATION_PROBE_TIMEOUT_MS,
    );
  }

  private get requestTimeoutMs(): number {
    return positiveInteger(
      this.configService?.get('FEDERATION_REQUEST_TIMEOUT_MS'),
      DEFAULT_FEDERATION_REQUEST_TIMEOUT_MS,
    );
  }

  private get sep24PollTimeoutMs(): number {
    return positiveInteger(
      this.configService?.get('SEP24_POLL_TIMEOUT_MS'),
      DEFAULT_SEP24_POLL_TIMEOUT_MS,
    );
  }

  private get sep24PollIntervalMs(): number {
    return positiveInteger(
      this.configService?.get('SEP24_POLL_INTERVAL_MS'),
      DEFAULT_SEP24_POLL_INTERVAL_MS,
    );
  }

  private get tomlCacheTtlMs(): number {
    return positiveInteger(
      this.configService?.get('FEDERATION_TOML_CACHE_TTL_MS'),
      DEFAULT_FEDERATION_TOML_CACHE_TTL_MS,
    );
  }

  private get tomlCacheMaxEntries(): number {
    return positiveInteger(
      this.configService?.get('FEDERATION_TOML_CACHE_MAX_ENTRIES'),
      DEFAULT_FEDERATION_TOML_CACHE_MAX_ENTRIES,
    );
  }

  private async fetchWithTimeout(
    urlStr: string,
    timeout = FETCH_TIMEOUT,
    parentSignal?: AbortSignal,
    redirectChain: string[] = [],
  ): Promise<Response> {
    let target = new URL(urlStr);
    redirectChain.push(target.toString());

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new BadRequestException(`Unsupported protocol: ${target.protocol}`);
    }

    await assertPublicHostname(target.hostname);

    const controller = new AbortController();
    let timedOut = false;
    let rejectAbort!: (reason: Error) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    }, timeout);
    const abortForParent = () => {
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    };
    parentSignal?.addEventListener('abort', abortForParent, { once: true });
    if (parentSignal?.aborted) abortForParent();

    const requestInit = {
      signal: controller.signal,
      headers: { Accept: '*/*' },
      redirect: 'manual' as const,
    };
    try {
      let response = await Promise.race([fetch(target.toString(), requestInit), abortPromise]);
      let hops = 0;

      while (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has('location')
      ) {
        if (++hops > MAX_SAFE_REDIRECTS) {
          throw new BadGatewayException('Too many redirects');
        }
        target = new URL(response.headers.get('location')!, target);
        redirectChain.push(target.toString());
        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
          throw new BadRequestException(`Unsupported protocol in redirect: ${target.protocol}`);
        }
        await assertPublicHostname(target.hostname);
        response = await Promise.race([fetch(target.toString(), requestInit), abortPromise]);
      }
      return response;
    } catch (error) {
      if (timedOut || parentSignal?.aborted) throw new RequestTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortForParent);
    }
  }

  private extractHomeDomain(federationRecord: Record<string, unknown>): string | null {
    const domain = federationRecord.home_domain;
    if (typeof domain === 'string') return domain;
    return null;
  }

  private async awaitWithinDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new RequestTimeoutError());
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  // ─── GET /federation/resolve ────────────────────────────────────────────

  async resolveFederation(address: string): Promise<FederationResolveResult> {
    const input = address.trim();

    if (isStellarPublicKey(input)) {
      return this.reverseLookup(input);
    }

    if (isFederationAddress(input)) {
      return this.nameLookup(input);
    }

    const stripped = stripProtocol(input);
    if (isDomain(stripped)) {
      return this.domainLookup(stripped);
    }

    throw new BadRequestException(
      'Input must be a Stellar public key (G…), a federation address (user*domain), or a domain.',
    );
  }

  private async reverseLookup(publicKey: string): Promise<FederationResolveResult> {
    try {
      const url = `https://federation.stellar.org/federation?q=${encodeURIComponent(publicKey)}&type=id`;
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) {
        throw new NotFoundException(`No federation record found for public key ${publicKey}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        stellarAddress: publicKey,
        federationAddress: (data.stellar_address as string) ?? null,
        memo: (data.memo as string) ?? null,
        memoType: (data.memo_type as string) ?? null,
        homeDomain: this.extractHomeDomain(data),
      };
    } catch (err: unknown) {
      if (err instanceof NotFoundException) throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Federation reverse lookup failed: ${msg}`);
    }
  }

  private async nameLookup(federationAddress: string): Promise<FederationResolveResult> {
    try {
      const url = `https://federation.stellar.org/federation?q=${encodeURIComponent(federationAddress)}&type=name`;
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) {
        throw new NotFoundException(`No federation record found for ${federationAddress}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        stellarAddress: (data.stellar_address as string) ?? null,
        federationAddress,
        memo: (data.memo as string) ?? null,
        memoType: (data.memo_type as string) ?? null,
        homeDomain: this.extractHomeDomain(data),
      };
    } catch (err: unknown) {
      if (err instanceof NotFoundException) throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Federation name lookup failed: ${msg}`);
    }
  }

  private async domainLookup(domain: string): Promise<FederationResolveResult> {
    const tomlData = await this.fetchToml(domain);
    if (!tomlData.FEDERATION_SERVER) {
      throw new NotFoundException(
        `Domain ${domain} does not declare a FEDERATION_SERVER in its stellar.toml`,
      );
    }

    return {
      stellarAddress: null,
      federationAddress: null,
      memo: null,
      memoType: null,
      homeDomain: domain,
    };
  }

  // ─── GET /federation/toml ───────────────────────────────────────────────

  async getToml(domain: string): Promise<TomlResult> {
    const cleanDomain = normalizeDomain(domain);
    if (!isDomain(cleanDomain)) {
      throw new BadRequestException(`Invalid domain: ${domain}`);
    }

    let toml: CachedToml;
    try {
      toml = await this.fetchTomlRecord(cleanDomain);
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof PayloadTooLargeException
      )
        throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Failed to fetch stellar.toml for ${cleanDomain}: ${msg}`);
    }
    const parsed = toml.parsed;

    const validationWarnings: string[] = [];
    for (const field of REQUIRED_TOML_FIELDS) {
      if (!parsed[field]) {
        validationWarnings.push(`Missing required SEP-1 field: ${field}`);
      }
    }

    return {
      version: (parsed.VERSION as string) ?? null,
      networkPassphrase: (parsed.NETWORK_PASSPHRASE as string) ?? null,
      federationServer: (parsed.FEDERATION_SERVER as string) ?? null,
      transferServer: (parsed.TRANSFER_SERVER as string) ?? null,
      transferServerSep0024: (parsed.TRANSFER_SERVER_SEP0024 as string) ?? null,
      webAuthEndpoint: (parsed.WEB_AUTH_ENDPOINT as string) ?? null,
      directPaymentServer: (parsed.DIRECT_PAYMENT_SERVER as string) ?? null,
      accounts: Array.isArray(parsed.ACCOUNTS)
        ? (parsed.ACCOUNTS as Array<string | Record<string, unknown>>).map((a) =>
            typeof a === 'string'
              ? { PUBLIC_KEY: a }
              : {
                  PUBLIC_KEY: String(a.PUBLIC_KEY ?? ''),
                  NAME: a.NAME ? String(a.NAME) : undefined,
                  HOME_DOMAIN: a.HOME_DOMAIN ? String(a.HOME_DOMAIN) : undefined,
                  DESCRIPTION: a.DESCRIPTION ? String(a.DESCRIPTION) : undefined,
                },
          )
        : [],
      currencies: Array.isArray(parsed.CURRENCIES)
        ? (parsed.CURRENCIES as Record<string, unknown>[]).map((c) => ({
            code: String(c.CODE ?? ''),
            issuer: String(c.ISSUER ?? ''),
            display_decimals: c.DISPLAY_DECIMALS ? Number(c.DISPLAY_DECIMALS) : undefined,
            name: c.NAME ? String(c.NAME) : undefined,
            desc: c.DESC ? String(c.DESC) : undefined,
            conditions: c.CONDITIONS ? String(c.CONDITIONS) : undefined,
            image: c.IMAGE ? String(c.IMAGE) : undefined,
            anchor_asset_type: c.ANCHOR_ASSET_TYPE ? String(c.ANCHOR_ASSET_TYPE) : undefined,
            anchor_asset: c.ANCHOR_ASSET ? String(c.ANCHOR_ASSET) : undefined,
            redemption_instructions: c.REDEMPTION_INSTRUCTIONS
              ? String(c.REDEMPTION_INSTRUCTIONS)
              : undefined,
            collateral_addresses: c.COLLATERAL_ADDRESSES
              ? String(c.COLLATERAL_ADDRESSES)
              : undefined,
            regulated: c.REGULATED ? Boolean(c.REGULATED) : undefined,
            approval_server: c.APPROVAL_SERVER ? String(c.APPROVAL_SERVER) : undefined,
            approval_criteria: c.APPROVAL_CRITERIA ? String(c.APPROVAL_CRITERIA) : undefined,
          }))
        : [],
      validators: Array.isArray(parsed.VALIDATORS)
        ? (parsed.VALIDATORS as Record<string, unknown>[]).map((v) => ({
            PUBLIC_KEY: String(v.PUBLIC_KEY ?? ''),
            NAME: v.NAME ? String(v.NAME) : undefined,
            HOST: v.HOST ? String(v.HOST) : undefined,
            HISTORY_URL: v.HISTORY_URL ? String(v.HISTORY_URL) : undefined,
          }))
        : [],
      documentation: parsed.DOCUMENTATION
        ? {
            PRINCIPALS_NAME: (parsed.DOCUMENTATION as Record<string, unknown>).PRINCIPALS_NAME
              ? String((parsed.DOCUMENTATION as Record<string, unknown>).PRINCIPALS_NAME)
              : undefined,
            PRINCIPAL_EMAIL: (parsed.DOCUMENTATION as Record<string, unknown>).PRINCIPAL_EMAIL
              ? String((parsed.DOCUMENTATION as Record<string, unknown>).PRINCIPAL_EMAIL)
              : undefined,
            PROJECT_URL: (parsed.DOCUMENTATION as Record<string, unknown>).PROJECT_URL
              ? String((parsed.DOCUMENTATION as Record<string, unknown>).PROJECT_URL)
              : undefined,
            OFFICIAL_CHAT: (parsed.DOCUMENTATION as Record<string, unknown>).OFFICIAL_CHAT
              ? String((parsed.DOCUMENTATION as Record<string, unknown>).OFFICIAL_CHAT)
              : undefined,
            OTHER_INFO: (parsed.DOCUMENTATION as Record<string, unknown>).OTHER_INFO
              ? String((parsed.DOCUMENTATION as Record<string, unknown>).OTHER_INFO)
              : undefined,
          }
        : null,
      fetchLatencyMs: toml.fetchLatencyMs,
      validationWarnings,
    };
  }

  async validateHomeDomain(domain: string, issuer: string): Promise<HomeDomainValidationResult> {
    const cleanDomain = normalizeHomeDomain(domain);
    if (!isStellarPublicKey(issuer)) {
      throw new BadRequestException('issuer must be a Stellar public key');
    }

    const toml = await this.fetchToml(cleanDomain);
    const accounts = Array.isArray(toml.ACCOUNTS)
      ? (toml.ACCOUNTS as Array<string | Record<string, unknown>>)
      : [];
    const account = accounts.find((item) =>
      typeof item === 'string' ? item === issuer : item.PUBLIC_KEY === issuer,
    );
    if (!account) {
      return { valid: false, domain: cleanDomain, issuer, reason: 'issuer_not_declared' };
    }
    const declaredHomeDomain = typeof account === 'string' ? undefined : account.HOME_DOMAIN;
    if (
      typeof declaredHomeDomain === 'string' &&
      normalizeDomain(declaredHomeDomain) !== cleanDomain
    ) {
      return { valid: false, domain: cleanDomain, issuer, reason: 'home_domain_mismatch' };
    }
    return { valid: true, domain: cleanDomain, issuer, reason: null };
  }

  async getAssetMetadata(domain: string, code: string, issuer: string): Promise<TomlCurrency> {
    const cleanDomain = normalizeHomeDomain(domain);
    if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
      throw new BadRequestException('code must be a 1-12 character alphanumeric asset code');
    }
    if (!isStellarPublicKey(issuer)) {
      throw new BadRequestException('issuer must be a Stellar public key');
    }

    const toml = await this.fetchToml(cleanDomain);
    const currencies = Array.isArray(toml.CURRENCIES)
      ? (toml.CURRENCIES as Record<string, unknown>[])
      : [];
    const currency = currencies.find((item) => item.CODE === code && item.ISSUER === issuer);
    if (!currency) {
      throw new NotFoundException(`Asset ${code}:${issuer} is not declared by ${cleanDomain}`);
    }

    const validation = await this.validateHomeDomain(cleanDomain, issuer);
    if (!validation.valid) {
      throw new BadRequestException(
        `Issuer ${issuer} is not verified for home domain ${cleanDomain}: ${validation.reason}`,
      );
    }
    return {
      code: String(currency.CODE),
      issuer: String(currency.ISSUER),
      display_decimals:
        currency.DISPLAY_DECIMALS == null ? undefined : Number(currency.DISPLAY_DECIMALS),
      name: typeof currency.NAME === 'string' ? currency.NAME : undefined,
      desc: typeof currency.DESC === 'string' ? currency.DESC : undefined,
      conditions: typeof currency.CONDITIONS === 'string' ? currency.CONDITIONS : undefined,
      image: typeof currency.IMAGE === 'string' ? currency.IMAGE : undefined,
      anchor_asset_type:
        typeof currency.ANCHOR_ASSET_TYPE === 'string' ? currency.ANCHOR_ASSET_TYPE : undefined,
      anchor_asset: typeof currency.ANCHOR_ASSET === 'string' ? currency.ANCHOR_ASSET : undefined,
      redemption_instructions:
        typeof currency.REDEMPTION_INSTRUCTIONS === 'string'
          ? currency.REDEMPTION_INSTRUCTIONS
          : undefined,
      collateral_addresses:
        typeof currency.COLLATERAL_ADDRESSES === 'string'
          ? currency.COLLATERAL_ADDRESSES
          : undefined,
      regulated: typeof currency.REGULATED === 'boolean' ? currency.REGULATED : undefined,
      approval_server:
        typeof currency.APPROVAL_SERVER === 'string' ? currency.APPROVAL_SERVER : undefined,
      approval_criteria:
        typeof currency.APPROVAL_CRITERIA === 'string' ? currency.APPROVAL_CRITERIA : undefined,
    };
  }

  // ─── GET /federation/sep ────────────────────────────────────────────────

  async getSepSupport(domain: string): Promise<SepResult> {
    const cleanDomain = normalizeDomain(domain);
    if (!isDomain(cleanDomain)) {
      throw new BadRequestException(`Invalid domain: ${domain}`);
    }

    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), this.requestTimeoutMs);
    let tomlData: Record<string, unknown>;
    try {
      // A request deadline must not cancel the shared TOML flight, because
      // other callers may still be awaiting the same cache miss.
      tomlData = await this.awaitWithinDeadline(
        this.fetchToml(cleanDomain),
        deadlineController.signal,
      );
    } catch (error) {
      clearTimeout(deadlineTimer);
      const malformed =
        error instanceof BadRequestException && /Malformed TOML|TOML document/.test(error.message);
      return {
        seps: [
          {
            number: 1,
            name: 'stellar.toml',
            supported: false,
            endpoint: null,
            probeStatus: 'red',
          },
          {
            number: 6,
            name: 'Anchor API',
            supported: false,
            endpoint: null,
            probeStatus: 'red',
          },
          {
            number: 10,
            name: 'Stellar Web Authentication',
            supported: false,
            endpoint: null,
            probeStatus: 'red',
          },
          {
            number: 24,
            name: 'Interactive Anchor API',
            supported: false,
            endpoint: null,
            probeStatus: 'red',
          },
          {
            number: 31,
            name: 'Direct Payments',
            supported: false,
            endpoint: null,
            probeStatus: 'red',
          },
        ],
        tomlStatus: malformed ? 'malformed' : 'unavailable',
      };
    }

    const sep1: SepInfo = {
      number: 1,
      name: 'stellar.toml',
      supported: true,
      endpoint: `https://${cleanDomain}/.well-known/stellar.toml`,
      probeStatus: 'green',
    };

    const transferServer = tomlData.TRANSFER_SERVER as string | undefined;
    const sep6 = transferServer
      ? this.probeEndpoint(transferServer, '/info', deadlineController.signal).then(
          (probeStatus): SepInfo => ({
            number: 6,
            name: 'Anchor API',
            supported: true,
            endpoint: transferServer,
            probeStatus,
          }),
        )
      : Promise.resolve<SepInfo>({
          number: 6,
          name: 'Anchor API',
          supported: false,
          endpoint: null,
          probeStatus: 'red',
        });

    const webAuthEndpoint = tomlData.WEB_AUTH_ENDPOINT as string | undefined;
    const sep10 = webAuthEndpoint
      ? this.probeEndpoint(webAuthEndpoint, '/web_auth', deadlineController.signal).then(
          (probeStatus): SepInfo => ({
            number: 10,
            name: 'Stellar Web Authentication',
            supported: true,
            endpoint: webAuthEndpoint,
            probeStatus,
          }),
        )
      : Promise.resolve<SepInfo>({
          number: 10,
          name: 'Stellar Web Authentication',
          supported: false,
          endpoint: null,
          probeStatus: 'red',
        });

    const transferServerSep0024 = tomlData.TRANSFER_SERVER_SEP0024 as string | undefined;
    const sep24: SepInfo = transferServerSep0024
      ? {
          number: 24,
          name: 'Interactive Anchor API',
          supported: true,
          endpoint: transferServerSep0024,
          probeStatus: 'green',
        }
      : {
          number: 24,
          name: 'Interactive Anchor API',
          supported: false,
          endpoint: null,
          probeStatus: 'red',
        };

    const directPaymentServer = tomlData.DIRECT_PAYMENT_SERVER as string | undefined;
    const sep31: SepInfo = directPaymentServer
      ? {
          number: 31,
          name: 'Direct Payments',
          supported: true,
          endpoint: directPaymentServer,
          probeStatus: 'green',
        }
      : {
          number: 31,
          name: 'Direct Payments',
          supported: false,
          endpoint: null,
          probeStatus: 'red',
        };

    try {
      const [resolvedSep6, resolvedSep10] = await Promise.all([sep6, sep10]);
      return { seps: [sep1, resolvedSep6, resolvedSep10, sep24, sep31], tomlStatus: 'available' };
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  // ─── GET /federation/link-preview (Savitura/Savitools#217) ───────────────

  /**
   * Build a standards-aware anchor transfer request link from stellar.toml.
   * The returned URL is copy-only: SaviTools never signs or submits it.
   */
  async buildTransferRequestLink(
    domain: string,
    params: TransferLinkParams,
  ): Promise<TransferLinkResult> {
    const cleanDomain = normalizeDomain(domain);
    if (!isDomain(cleanDomain)) {
      throw new BadRequestException(`Invalid domain: ${domain}`);
    }

    // Amounts and memos stay strings end-to-end — no floating-point conversion.
    if (!DECIMAL_STRING_RE.test(params.amount)) {
      throw new BadRequestException('amount must be a non-negative decimal string (e.g. "100.50")');
    }

    if (params.callback && !HTTPS_URL_RE.test(params.callback)) {
      throw new BadRequestException('callback must be a well-formed https:// URL');
    }

    if (params.sep !== '31' && !params.account) {
      throw new BadRequestException(
        `account (Stellar public key G…) is required for SEP-${params.sep} request links`,
      );
    }
    if (params.account && !isStellarPublicKey(params.account)) {
      throw new BadRequestException('account must be a Stellar public key (G…)');
    }

    const tomlData = await this.fetchToml(cleanDomain);

    const endpointBySep: Record<TransferRequestSep, string | undefined> = {
      '6': (tomlData.TRANSFER_SERVER as string | undefined) ?? undefined,
      '24': (tomlData.TRANSFER_SERVER_SEP0024 as string | undefined) ?? undefined,
      '31': (tomlData.DIRECT_PAYMENT_SERVER as string | undefined) ?? undefined,
    };
    const endpoint = endpointBySep[params.sep];
    if (!endpoint) {
      throw new BadRequestException(
        `Domain ${cleanDomain} does not declare a ` +
          `${params.sep === '6' ? 'TRANSFER_SERVER' : params.sep === '24' ? 'TRANSFER_SERVER_SEP0024' : 'DIRECT_PAYMENT_SERVER'} ` +
          `endpoint in its stellar.toml, so SEP-${params.sep} request links are unavailable`,
      );
    }

    const currencies = Array.isArray(tomlData.CURRENCIES)
      ? (tomlData.CURRENCIES as Record<string, unknown>[])
      : [];
    const supportedCodes = new Set(currencies.map((c) => String(c.CODE ?? '').toUpperCase()));
    if (!supportedCodes.has(params.asset.toUpperCase())) {
      throw new BadRequestException(
        `Asset '${params.asset}' is not supported by ${cleanDomain}. Supported assets: ` +
          `${[...supportedCodes].join(', ') || '(none declared)'}`,
      );
    }

    const base = endpoint.replace(/\/$/, '');
    let url: string;
    switch (params.sep) {
      case '6': {
        const flow = params.type === 'withdraw' ? 'withdraw' : 'deposit';
        const query = new URLSearchParams({
          type: flow,
          asset_code: params.asset,
          account: params.account as string,
          amount: params.amount,
        });
        if (params.memo !== undefined) {
          query.set('memo', params.memo);
          query.set('memo_type', 'text');
        }
        if (params.callback) query.set('callback', params.callback);
        url = `${base}/transactions?${query.toString()}`;
        break;
      }
      case '24': {
        const query = new URLSearchParams({
          asset_code: params.asset,
          amount: params.amount,
          account: params.account as string,
        });
        if (params.memo !== undefined) query.set('memo', params.memo);
        if (params.callback) query.set('callback', params.callback);
        url = `${base}/?${query.toString()}`;
        break;
      }
      case '31': {
        const query = new URLSearchParams({
          asset_code: params.asset,
          amount: params.amount,
        });
        if (params.account) query.set('account', params.account);
        if (params.callback) query.set('destination', params.callback);
        if (params.memo !== undefined) query.set('memo', params.memo);
        url = `${base}/?${query.toString()}`;
        break;
      }
    }

    return {
      sep: params.sep,
      endpoint: base,
      url,
      asset: params.asset,
      amount: params.amount,
      warning:
        'Preview only: SaviTools will not sign or submit this request. Open the link yourself after reviewing the anchor.',
    };
  }

  // ─── GET /federation/diagnostics (Savitura/Savitools#341) ───────────────

  /**
   * End-to-end federation server diagnostic: discover the server from
   * stellar.toml, run both lookup directions, and classify every failure by
   * stage (dns, toml, tls, http, timeout, schema, ssrf, redirects).
   * The report is redacted: request URLs keep only their origin + path.
   */
  async getServerDiagnostics(domain: string): Promise<FederationDiagnosticsReport> {
    const cleanDomain = normalizeDomain(domain);
    if (!isDomain(cleanDomain)) {
      throw new BadRequestException(`Invalid domain: ${domain}`);
    }

    const startedAt = Date.now();
    const stages: DiagnosticStage[] = [];

    // ─── Stage 1: stellar.toml discovery ─────────────────────────────────
    const tomlStage: DiagnosticStage = {
      stage: 'toml',
      ok: false,
      details: {},
    };
    stages.push(tomlStage);

    let tomlData: Record<string, unknown>;
    try {
      const tomlRecord = await this.fetchTomlRecord(cleanDomain);
      tomlData = tomlRecord.parsed;
      tomlStage.ok = true;
      tomlStage.latencyMs = tomlRecord.fetchLatencyMs;
      tomlStage.details.tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;
    } catch (error) {
      tomlStage.error = classifyError(error);
      tomlStage.details.message =
        error instanceof Error ? error.message : 'stellar.toml could not be fetched';
      return redactReport({
        domain: cleanDomain,
        checkedAt: new Date().toISOString(),
        totalLatencyMs: Date.now() - startedAt,
        stages,
        ok: false,
        failures: [tomlStage.error ?? 'http'],
      });
    }

    const federationServer =
      typeof tomlData.FEDERATION_SERVER === 'string' ? tomlData.FEDERATION_SERVER : null;
    if (!federationServer) {
      tomlStage.ok = false;
      tomlStage.error = 'schema';
      tomlStage.details.message = 'stellar.toml does not declare a FEDERATION_SERVER';
      return redactReport({
        domain: cleanDomain,
        checkedAt: new Date().toISOString(),
        totalLatencyMs: Date.now() - startedAt,
        stages,
        ok: false,
        failures: ['schema'],
      });
    }
    tomlStage.details.federationServer = federationServer;

    // ─── Stage 2: server reachability + redirect chain ──────────────────
    const reachStage: DiagnosticStage = {
      stage: 'http',
      ok: false,
      latencyMs: 0,
      details: { serverUrl: federationServer },
      redirectChain: [],
    };
    stages.push(reachStage);

    let serverStatus: number | null = null;
    const reachRedirects: string[] = [];
    try {
      const res = await this.fetchWithTimeout(
        appendQuery(federationServer, { q: probeQuery(cleanDomain), type: 'name' }),
        this.probeTimeoutMs,
        undefined,
        reachRedirects,
      );
      serverStatus = res.status;
      reachStage.ok = res.ok;
      reachStage.latencyMs = Date.now() - startedAt - (tomlStage.latencyMs ?? 0);
      reachStage.details.statusCode = res.status;
      reachStage.redirectChain = reachRedirects.length > 0 ? reachRedirects : undefined;
      if (!res.ok) {
        reachStage.error = 'http';
        reachStage.details.message = `Federation server responded with HTTP ${res.status}`;
      }
    } catch (error) {
      reachStage.error = classifyError(error);
      reachStage.redirectChain = reachRedirects.length > 0 ? reachRedirects : undefined;
      reachStage.details.message =
        error instanceof Error ? error.message : 'Federation server request failed';
      return redactReport({
        domain: cleanDomain,
        checkedAt: new Date().toISOString(),
        totalLatencyMs: Date.now() - startedAt,
        stages,
        ok: false,
        failures: [reachStage.error ?? 'http'],
      });
    }

    // ─── Stage 3: forward lookup (name → account) ────────────────────────
    const testAddress = `savitools-probe*${cleanDomain}`;
    const forwardStage: DiagnosticStage = {
      stage: 'forward-lookup',
      ok: false,
      latencyMs: 0,
      details: {
        requestUrl: redactUrl(appendQuery(federationServer, { q: testAddress, type: 'name' })),
      },
    };
    stages.push(forwardStage);

    let forwardStatus: number | null = null;
    try {
      const res = await this.fetchWithTimeout(
        appendQuery(federationServer, { q: testAddress, type: 'name' }),
        this.requestTimeoutMs,
      );
      forwardStatus = res.status;
      forwardStage.latencyMs = Date.now() - startedAt;
      forwardStage.details.statusCode = res.status;
      if (res.ok) {
        // The synthetic user should not resolve; drain the body defensively
        // because the mock/server response shape is unknown here.
        forwardStage.ok = true;
        forwardStage.details.message =
          'Unexpected 2xx for the synthetic probe user (should be 404); treating as non-blocking';
      } else {
        // A 404 for an unknown user is compliant behaviour for SEP-2.
        if (res.status === 404) {
          forwardStage.ok = true;
          forwardStage.details.message = 'Unknown user returned 404 (SEP-2 compliant)';
        } else {
          forwardStage.error = 'http';
          forwardStage.details.message = `Forward lookup returned HTTP ${res.status}`;
        }
      }
    } catch (error) {
      forwardStage.error = classifyError(error);
      forwardStage.details.message =
        error instanceof Error ? error.message : 'Forward lookup failed';
    }

    // ─── Stage 4: reverse lookup (account → name) ────────────────────────
    // A synthetic forward probe never resolves to a real account, so the
    // reverse direction is probed with an ACCOUNTS entry from stellar.toml.
    const accountEntry = Array.isArray(tomlData.ACCOUNTS)
      ? (tomlData.ACCOUNTS as Record<string, unknown>[]).find(
          (a) => typeof a.PUBLIC_KEY === 'string' && isStellarPublicKey(String(a.PUBLIC_KEY)),
        )
      : undefined;
    const reverseKey = accountEntry ? String(accountEntry.PUBLIC_KEY) : null;

    const reverseStage: DiagnosticStage = {
      stage: 'reverse-lookup',
      ok: false,
      latencyMs: 0,
      details: {},
    };
    stages.push(reverseStage);

    let reverseStatus: number | null = null;
    if (!reverseKey) {
      reverseStage.ok = true;
      reverseStage.details.message =
        'Skipped: no ACCOUNTS entry in stellar.toml to probe the reverse direction';
    } else {
      reverseStage.details.requestUrl = redactUrl(
        appendQuery(federationServer, { q: reverseKey, type: 'id' }),
      );
      try {
        const res = await this.fetchWithTimeout(
          appendQuery(federationServer, { q: reverseKey, type: 'id' }),
          this.requestTimeoutMs,
        );
        reverseStatus = res.status;
        reverseStage.latencyMs = Date.now() - startedAt;
        reverseStage.details.statusCode = res.status;
        if (res.ok) {
          const record = (await res.json()) as Record<string, unknown>;
          if (typeof record.stellar_address === 'string') {
            reverseStage.ok = true;
            reverseStage.details.stellarAddress = record.stellar_address;
          } else {
            reverseStage.error = 'schema';
            reverseStage.details.message = 'Response missing stellar_address field';
          }
        } else {
          reverseStage.error = 'http';
          reverseStage.details.message = `Reverse lookup returned HTTP ${res.status}`;
        }
      } catch (error) {
        reverseStage.error = classifyError(error);
        reverseStage.details.message =
          error instanceof Error ? error.message : 'Reverse lookup failed';
      }
    }

    const failures = stages
      .filter((s) => !s.ok && s.error)
      .map((s) => s.error) as DiagnosticFailureKind[];

    return redactReport({
      domain: cleanDomain,
      checkedAt: new Date().toISOString(),
      totalLatencyMs: Date.now() - startedAt,
      stages,
      ok: failures.length === 0,
      failures: [...new Set(failures)],
      serverUrl: federationServer,
      serverStatus,
      forwardStatus,
      reverseStatus,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async fetchToml(domain: string): Promise<Record<string, unknown>> {
    return (await this.fetchTomlRecord(domain)).parsed;
  }

  private async fetchTomlRecord(domain: string): Promise<CachedToml> {
    const key = normalizeDomain(domain);
    // A read refreshes recency, and an expired document is never served.
    const cached = this.tomlCache.get(key);
    if (cached) return cached;

    const inFlight = this.tomlInFlight.get(key);
    if (inFlight) return inFlight;

    const request = this.fetchAndCacheToml(key);
    this.tomlInFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.tomlInFlight.delete(key);
    }
  }

  private async fetchAndCacheToml(domain: string): Promise<CachedToml> {
    const start = Date.now();
    const url = `https://${domain}/.well-known/stellar.toml`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) {
      throw new NotFoundException(`stellar.toml not found at ${url} (HTTP ${res.status})`);
    }
    const raw = await res.text();
    const cached: CachedToml = {
      parsed: parseBoundedToml(raw),
      fetchLatencyMs: Date.now() - start,
    };
    this.tomlCache.set(domain, cached);
    return cached;
  }

  private async probeEndpoint(
    baseUrl: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<'green' | 'yellow' | 'timeout'> {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${path}`;
      const res = await this.fetchWithTimeout(url, this.probeTimeoutMs, signal);
      return res.ok ? 'green' : 'yellow';
    } catch (error) {
      if (error instanceof RequestTimeoutError || signal?.aborted) return 'timeout';
      return 'yellow';
    }
  }

  // ─── SEP-24 interactive flow debugger ───────────────────────────────────

  /**
   * Walk a full SEP-24 interactive deposit/withdrawal session on testnet and
   * record a redacted request/response timeline suitable for support export.
   *
   * The debugger never signs or submits transactions: it discovers the
   * transfer server, reuses a SEP-10 JWT if provided, creates the interactive
   * transaction, validates the returned URL before navigation, and polls
   * transaction status until a terminal state, cancellation, or timeout.
   */
  async debugSep24InteractiveFlow(params: Sep24DebuggerParams): Promise<Sep24DebuggerResult> {
    const cleanDomain = normalizeDomain(params.domain);
    if (!isDomain(cleanDomain)) {
      throw new BadRequestException(`Invalid domain: ${params.domain}`);
    }
    if (params.flow !== 'deposit' && params.flow !== 'withdraw') {
      throw new BadRequestException(`flow must be 'deposit' or 'withdraw'`);
    }
    if (!isStellarPublicKey(params.account)) {
      throw new BadRequestException('account must be a Stellar public key (G…)');
    }
    if (params.amount !== undefined && !DECIMAL_STRING_RE.test(params.amount)) {
      throw new BadRequestException('amount must be a non-negative decimal string (e.g. "100.50")');
    }
    if (params.callback && !HTTPS_URL_RE.test(params.callback)) {
      throw new BadRequestException('callback must be a well-formed https:// URL');
    }

    const timeline: Sep24TimelineEntry[] = [];
    const diagnostics = new Set<Sep24DiagnosticKind>();
    const push = (entry: Sep24TimelineEntry) => {
      timeline.push(entry);
      if (entry.diagnostic) diagnostics.add(entry.diagnostic);
    };

    const pollTimeoutMs = params.pollTimeoutMs ?? this.sep24PollTimeoutMs;
    const pollIntervalMs = params.pollIntervalMs ?? this.sep24PollIntervalMs;
    const signal = params.signal;
    const isCancelled = () => signal?.aborted === true;

    // ─── Stage 1: discovery ─────────────────────────────────────────────
    const discoveryStart = Date.now();
    let tomlData: Record<string, unknown>;
    try {
      tomlData = await this.fetchToml(cleanDomain);
    } catch (error) {
      push({
        stage: 'discovery',
        at: new Date().toISOString(),
        latencyMs: Date.now() - discoveryStart,
        diagnostic: 'http',
        message: error instanceof Error ? error.message : 'stellar.toml discovery failed',
      });
      throw new BadRequestException(
        `SEP-24 discovery failed for ${cleanDomain}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    const transferServerSep0024 =
      typeof tomlData.TRANSFER_SERVER_SEP0024 === 'string'
        ? tomlData.TRANSFER_SERVER_SEP0024
        : null;
    const webAuthEndpoint =
      typeof tomlData.WEB_AUTH_ENDPOINT === 'string' ? tomlData.WEB_AUTH_ENDPOINT : null;

    if (!transferServerSep0024) {
      push({
        stage: 'discovery',
        at: new Date().toISOString(),
        latencyMs: Date.now() - discoveryStart,
        diagnostic: 'schema',
        message: 'stellar.toml does not declare TRANSFER_SERVER_SEP0024',
      });
      throw new BadRequestException(
        `Domain ${cleanDomain} does not declare TRANSFER_SERVER_SEP0024`,
      );
    }

    push({
      stage: 'discovery',
      at: new Date().toISOString(),
      latencyMs: Date.now() - discoveryStart,
      response: { status: 200, body: { transferServerSep0024, webAuthEndpoint } },
      message: 'Discovered SEP-24 transfer server',
    });

    // ─── Stage 2: authentication handoff ────────────────────────────────
    const authStart = Date.now();
    const jwt = params.jwt;
    if (!jwt) {
      push({
        stage: 'authentication',
        at: new Date().toISOString(),
        latencyMs: Date.now() - authStart,
        diagnostic: 'expired-token',
        message:
          'No SEP-10 JWT supplied; the interactive flow will likely be rejected. ' +
          'Run the SEP-10 debugger first and pass its token.',
      });
    } else {
      push({
        stage: 'authentication',
        at: new Date().toISOString(),
        latencyMs: Date.now() - authStart,
        message: 'Reused SEP-10 JWT from prior authentication handoff',
      });
    }

    // ─── Stage 3: interactive URL creation ──────────────────────────────
    const interactiveStart = Date.now();
    const interactiveEndpoint = `${transferServerSep0024.replace(/\/$/, '')}/transactions/${params.flow}/interactive`;
    const body: Record<string, string> = {
      asset_code: params.asset,
      account: params.account,
    };
    if (params.amount !== undefined) body.amount = params.amount;
    if (params.memo !== undefined) body.memo = params.memo;
    if (params.callback) body.callback = params.callback;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    let interactiveResponse: Response;
    try {
      interactiveResponse = await this.fetchWithTimeout(
        interactiveEndpoint,
        this.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      const timedOut = error instanceof RequestTimeoutError;
      push({
        stage: 'interactive-url',
        at: new Date().toISOString(),
        latencyMs: Date.now() - interactiveStart,
        request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
        diagnostic: timedOut ? 'timeout' : 'http',
        message: error instanceof Error ? error.message : 'Interactive request failed',
      });
      throw new BadGatewayException(
        `SEP-24 interactive request failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    // The interactive endpoint is POST-only, but fetchWithTimeout uses GET
    // semantics; re-issue with the correct method and body.
    try {
      interactiveResponse = await this.postJsonWithTimeout(
        interactiveEndpoint,
        body,
        headers,
        this.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      const timedOut = error instanceof RequestTimeoutError;
      push({
        stage: 'interactive-url',
        at: new Date().toISOString(),
        latencyMs: Date.now() - interactiveStart,
        request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
        diagnostic: timedOut ? 'timeout' : 'http',
        message: error instanceof Error ? error.message : 'Interactive request failed',
      });
      throw new BadGatewayException(
        `SEP-24 interactive request failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    const interactiveStatus = interactiveResponse.status;
    const interactiveRaw = await interactiveResponse.text();
    let interactiveJson: Record<string, unknown> | null = null;
    try {
      interactiveJson = JSON.parse(interactiveRaw) as Record<string, unknown>;
    } catch {
      push({
        stage: 'interactive-url',
        at: new Date().toISOString(),
        latencyMs: Date.now() - interactiveStart,
        request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
        response: { status: interactiveStatus, body: interactiveRaw.slice(0, 512) },
        diagnostic: 'non-json',
        message: 'Anchor returned a non-JSON response to the interactive request',
      });
      throw new BadGatewayException('SEP-24 interactive endpoint returned a non-JSON response');
    }

    if (!interactiveResponse.ok) {
      const anchorError =
        typeof interactiveJson.error === 'string'
          ? interactiveJson.error
          : `HTTP ${interactiveStatus}`;
      const expired = /token|jwt|auth|expired/i.test(anchorError);
      push({
        stage: 'interactive-url',
        at: new Date().toISOString(),
        latencyMs: Date.now() - interactiveStart,
        request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
        response: { status: interactiveStatus, body: redactValue(interactiveJson) },
        diagnostic: expired ? 'expired-token' : 'anchor-error',
        message: `Anchor rejected the interactive request: ${anchorError}`,
      });
      throw new BadGatewayException(`SEP-24 anchor error: ${anchorError}`);
    }

    const interactiveUrl = typeof interactiveJson.url === 'string' ? interactiveJson.url : null;
    const transactionId = typeof interactiveJson.id === 'string' ? interactiveJson.id : null;

    if (!interactiveUrl) {
      push({
        stage: 'interactive-url',
        at: new Date().toISOString(),
        latencyMs: Date.now() - interactiveStart,
        request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
        response: { status: interactiveStatus, body: redactValue(interactiveJson) },
        diagnostic: 'schema',
        message: 'Interactive response is missing the required "url" field',
      });
      throw new BadGatewayException(
        'SEP-24 interactive response is missing the required "url" field',
      );
    }

    // ─── Stage 4: redirect/callback observation ─────────────────────────
    const redirectStart = Date.now();
    let interactiveOrigin: string | null = null;
    let originChanged = false;
    try {
      const parsed = await assertSafeNavigationUrl(interactiveUrl);
      interactiveOrigin = parsed.origin;
      const anchorOrigin = new URL(transferServerSep0024).origin;
      originChanged = parsed.origin !== anchorOrigin;
      push({
        stage: 'redirect',
        at: new Date().toISOString(),
        latencyMs: Date.now() - redirectStart,
        request: { method: 'GET', url: redactUrl(interactiveUrl) },
        message: originChanged
          ? `Interactive URL origin ${parsed.origin} differs from anchor origin ${anchorOrigin}`
          : 'Interactive URL origin matches anchor origin',
      });
    } catch (error) {
      const unsafe = error instanceof BadRequestException;
      push({
        stage: 'redirect',
        at: new Date().toISOString(),
        latencyMs: Date.now() - redirectStart,
        request: { method: 'GET', url: redactUrl(interactiveUrl) },
        diagnostic: unsafe ? 'unsafe-url' : 'ssrf',
        message: error instanceof Error ? error.message : 'Interactive URL rejected',
      });
      throw error;
    }

    push({
      stage: 'interactive-url',
      at: new Date().toISOString(),
      latencyMs: Date.now() - interactiveStart,
      request: { method: 'POST', url: redactUrl(interactiveEndpoint) },
      response: { status: interactiveStatus, body: redactValue(interactiveJson) },
      message: 'Interactive transaction created; open the URL in a sandbox tab',
    });

    // ─── Stage 5: status polling ────────────────────────────────────────
    const pollStart = Date.now();
    const statusEndpoint = `${transferServerSep0024.replace(/\/$/, '')}/transaction`;
    let finalStatus: string | null = null;
    let terminal = false;
    let cancelled = false;
    let timedOut = false;
    let moreInfoUrl: string | null = null;
    let requiredFields: Record<string, unknown> | null = null;
    let message: string | null = null;

    if (!transactionId) {
      push({
        stage: 'status-poll',
        at: new Date().toISOString(),
        diagnostic: 'schema',
        message: 'Interactive response did not include a transaction id; polling skipped',
      });
    } else {
      while (!terminal && !cancelled && !timedOut) {
        if (isCancelled()) {
          cancelled = true;
          push({
            stage: 'status-poll',
            at: new Date().toISOString(),
            diagnostic: 'cancelled',
            message: 'Polling cancelled by caller',
          });
          break;
        }
        if (Date.now() - pollStart >= pollTimeoutMs) {
          timedOut = true;
          push({
            stage: 'status-poll',
            at: new Date().toISOString(),
            diagnostic: 'timeout',
            message: `Polling timed out after ${pollTimeoutMs}ms`,
          });
          break;
        }

        const pollUrl = appendQuery(statusEndpoint, { id: transactionId });
        const pollHeaders: Record<string, string> = { Accept: 'application/json' };
        if (jwt) pollHeaders.Authorization = `Bearer ${jwt}`;

        const pollAttemptStart = Date.now();
        try {
          const res = await this.getJsonWithTimeout(
            pollUrl,
            pollHeaders,
            this.requestTimeoutMs,
            signal,
          );
          const raw = await res.text();
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            push({
              stage: 'status-poll',
              at: new Date().toISOString(),
              latencyMs: Date.now() - pollAttemptStart,
              request: { method: 'GET', url: redactUrl(pollUrl) },
              response: { status: res.status, body: raw.slice(0, 512) },
              diagnostic: 'non-json',
              message: 'Anchor returned a non-JSON status response',
            });
            break;
          }

          if (!res.ok) {
            const anchorError =
              typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`;
            const expired = /token|jwt|auth|expired/i.test(anchorError);
            push({
              stage: 'status-poll',
              at: new Date().toISOString(),
              latencyMs: Date.now() - pollAttemptStart,
              request: { method: 'GET', url: redactUrl(pollUrl) },
              response: { status: res.status, body: redactValue(parsed) },
              diagnostic: expired ? 'expired-token' : 'anchor-error',
              message: `Anchor status error: ${anchorError}`,
            });
            break;
          }

          const parsedAny = parsed as Record<string, any>;
          const status =
            typeof parsedAny?.transaction?.status === 'string'
              ? (parsedAny.transaction.status as string)
              : typeof parsedAny?.status === 'string'
                ? (parsedAny.status as string)
                : null;
          const tx = (parsedAny?.transaction as Record<string, unknown>) ?? parsedAny;
          moreInfoUrl = typeof tx.more_info_url === 'string' ? tx.more_info_url : moreInfoUrl;
          requiredFields =
            tx.required_info_updates && typeof tx.required_info_updates === 'object'
              ? (redactValue(tx.required_info_updates) as Record<string, unknown>)
              : requiredFields;
          message = typeof tx.message === 'string' ? tx.message : message;

          if (!status) {
            push({
              stage: 'status-poll',
              at: new Date().toISOString(),
              latencyMs: Date.now() - pollAttemptStart,
              request: { method: 'GET', url: redactUrl(pollUrl) },
              response: { status: res.status, body: redactValue(parsed) },
              diagnostic: 'unknown-state',
              message: 'Status response did not include a recognized status field',
            });
            break;
          }

          finalStatus = status;
          terminal = SEP24_TERMINAL_STATES.has(status);
          push({
            stage: 'status-poll',
            at: new Date().toISOString(),
            latencyMs: Date.now() - pollAttemptStart,
            request: { method: 'GET', url: redactUrl(pollUrl) },
            response: { status: res.status, body: redactValue(parsed) },
            message: `Transaction status: ${status}`,
          });
        } catch (error) {
          const timedOutAttempt = error instanceof RequestTimeoutError;
          push({
            stage: 'status-poll',
            at: new Date().toISOString(),
            latencyMs: Date.now() - pollAttemptStart,
            request: { method: 'GET', url: redactUrl(pollUrl) },
            diagnostic: timedOutAttempt ? 'timeout' : 'http',
            message: error instanceof Error ? error.message : 'Status poll failed',
          });
          break;
        }

        if (!terminal && !cancelled && !timedOut) {
          await this.sleep(pollIntervalMs, signal);
        }
      }
    }

    if (terminal) {
      push({
        stage: 'terminal',
        at: new Date().toISOString(),
        message: `Reached terminal state: ${finalStatus}`,
      });
    }

    return {
      domain: cleanDomain,
      flow: params.flow,
      asset: params.asset,
      transferServerSep0024,
      webAuthEndpoint,
      interactiveUrl,
      interactiveUrlOrigin: interactiveOrigin,
      originChanged,
      transactionId,
      finalStatus,
      terminal,
      cancelled,
      timedOut,
      moreInfoUrl,
      requiredFields,
      message,
      diagnostics: [...diagnostics],
      timeline,
    };
  }

  private async postJsonWithTimeout(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string>,
    timeout: number,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new BadRequestException(`Unsupported protocol: ${target.protocol}`);
    }
    await assertPublicHostname(target.hostname);

    const controller = new AbortController();
    let timedOut = false;
    let rejectAbort!: (reason: Error) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    }, timeout);
    const abortForParent = () => {
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    };
    parentSignal?.addEventListener('abort', abortForParent, { once: true });
    if (parentSignal?.aborted) abortForParent();

    try {
      return await Promise.race([
        fetch(target.toString(), {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify(body),
          redirect: 'manual',
        }),
        abortPromise,
      ]);
    } catch (error) {
      if (timedOut || parentSignal?.aborted) throw new RequestTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortForParent);
    }
  }

  private async getJsonWithTimeout(
    url: string,
    headers: Record<string, string>,
    timeout: number,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new BadRequestException(`Unsupported protocol: ${target.protocol}`);
    }
    await assertPublicHostname(target.hostname);

    const controller = new AbortController();
    let timedOut = false;
    let rejectAbort!: (reason: Error) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    }, timeout);
    const abortForParent = () => {
      controller.abort();
      rejectAbort(new RequestTimeoutError());
    };
    parentSignal?.addEventListener('abort', abortForParent, { once: true });
    if (parentSignal?.aborted) abortForParent();

    try {
      return await Promise.race([
        fetch(target.toString(), {
          method: 'GET',
          signal: controller.signal,
          headers,
          redirect: 'manual',
        }),
        abortPromise,
      ]);
    } catch (error) {
      if (timedOut || parentSignal?.aborted) throw new RequestTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortForParent);
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
