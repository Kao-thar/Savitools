'use client';

import {
  fetchAssetMetadata,
  fetchFederationDiagnostics,
  fetchSepSupport,
  fetchStellarToml,
  previewTransferLink,
  resolveFederation,
  validateHomeDomain,
  type FederationResolveResult,
  type FederationDiagnosticsReport,
  type HomeDomainValidationResult,
  type SepResult,
  type TomlResult,
  type TransferLinkResult,
  type TomlCurrency,
} from '@/lib/api';
import {
  BookmarkPlus,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Loader2,
  Search,
  RefreshCw,
  Shield,
  Stethoscope,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorState } from './state-display';

type InputType = 'publicKey' | 'federation' | 'domain';

interface SavedCounterparty {
  input: string;
  name: string;
}

const COUNTERPARTY_STORAGE_KEY = 'savitools:federation:counterparties';

function loadSavedCounterparties(): SavedCounterparty[] {
  try {
    const saved = window.localStorage.getItem(COUNTERPARTY_STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCounterparty =>
        typeof item?.input === 'string' && typeof item?.name === 'string',
    );
  } catch {
    return [];
  }
}

function detectInputType(value: string): InputType | null {
  const v = value.trim();
  if (/^G[A-Z2-7]{55}$/.test(v)) return 'publicKey';
  if (/^[^\s*]+[*][^\s*]+\.[^\s*]+$/.test(v)) return 'federation';
  if (
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(
      v,
    )
  )
    return 'domain';
  return null;
}

function stripProtocol(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

function DiagnosticsPanel({
  domain,
  copied,
  copy,
}: {
  domain: string;
  copied: string | null;
  copy: (text: string, id: string) => void;
}) {
  const [report, setReport] = useState<FederationDiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchFederationDiagnostics(domain));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnostics failed');
    } finally {
      setLoading(false);
    }
  };

  const serialized = report ? JSON.stringify(report, null, 2) : '';
  return (
    <CollapsiblePanel title="Server Diagnostics" icon={<Stethoscope className="h-4 w-4" />}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
      >
        {loading ? 'Running…' : 'Run diagnostics'}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {report && (
        <div className="mt-3 space-y-2">
          <p className="text-xs">
            {report.ok ? 'Healthy' : 'Failing'} · {report.totalLatencyMs}ms
          </p>
          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{serialized}</pre>
          <CopyButton text={serialized} id="diagnostics-report" copied={copied} copy={copy} />
        </div>
      )}
    </CollapsiblePanel>
  );
}

function CopyButton({
  text,
  id,
  copied,
  copy,
}: {
  text: string;
  id: string;
  copied: string | null;
  copy: (t: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => copy(text, id)}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied === id ? (
        <CheckCircle className="h-3 w-3 text-green-400 inline" />
      ) : (
        <Copy className="h-3 w-3 inline" />
      )}
    </button>
  );
}

function Field({
  label,
  value,
  copyId,
  copied,
  copy,
}: {
  label: string;
  value: string | null | undefined;
  copyId?: string;
  copied?: string | null;
  copy?: (t: string, id: string) => void;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[160px_1fr] gap-x-3 py-1 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-xs break-all">
        {value}
        {copyId && copy && (
          <CopyButton text={value} id={copyId} copied={copied ?? null} copy={copy} />
        )}
      </span>
    </div>
  );
}

function CollapsiblePanel({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/20 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {badge}
      </button>
      {open && <div className="px-4 pb-4 border-t border-border pt-3">{children}</div>}
    </div>
  );
}

function SepBadge({ status }: { status: 'green' | 'yellow' | 'red' | 'none' | 'timeout' }) {
  if (status === 'green')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 rounded px-1.5 py-0.5">
        <CheckCircle className="h-3 w-3" /> Verified
      </span>
    );
  if (status === 'yellow')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 rounded px-1.5 py-0.5">
        <AlertTriangle className="h-3 w-3" /> Declared
      </span>
    );
  if (status === 'timeout')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-400/10 rounded px-1.5 py-0.5">
        <Clock className="h-3 w-3" /> Timed out
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 rounded px-1.5 py-0.5">
      <XCircle className="h-3 w-3" /> Not supported
    </span>
  );
}

function FederationPanel({
  data,
  copied,
  copy,
}: {
  data: FederationResolveResult;
  copied: string | null;
  copy: (t: string, id: string) => void;
}) {
  return (
    <CollapsiblePanel
      title="Federation"
      icon={<Globe className="h-4 w-4 text-blue-400 shrink-0" />}
      defaultOpen
    >
      <div className="space-y-0.5">
        <Field
          label="Stellar address"
          value={data.stellarAddress}
          copyId="fed-stellar"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Federation address"
          value={data.federationAddress}
          copyId="fed-addr"
          copied={copied}
          copy={copy}
        />
        <Field label="Memo" value={data.memo} copyId="fed-memo" copied={copied} copy={copy} />
        <Field label="Memo type" value={data.memoType} />
        <Field label="Home domain" value={data.homeDomain} />
      </div>
      {!data.stellarAddress && !data.federationAddress && (
        <p className="text-xs text-muted-foreground mt-2">
          Domain resolved — no federation record returned for this domain.
        </p>
      )}
    </CollapsiblePanel>
  );
}

function TomlPanel({
  data,
  copied,
  copy,
}: {
  data: TomlResult;
  copied: string | null;
  copy: (t: string, id: string) => void;
}) {
  return (
    <CollapsiblePanel
      title="stellar.toml"
      icon={<FileText className="h-4 w-4 text-orange-400 shrink-0" />}
      defaultOpen
      badge={
        <span className="text-xs text-muted-foreground font-normal">{data.fetchLatencyMs}ms</span>
      }
    >
      {data.validationWarnings.length > 0 && (
        <div className="mb-3 space-y-1">
          {data.validationWarnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 rounded p-2"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        <Field label="Version" value={data.version} />
        <Field
          label="Network passphrase"
          value={data.networkPassphrase}
          copyId="toml-net"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Federation server"
          value={data.federationServer}
          copyId="toml-fed"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Transfer server"
          value={data.transferServer}
          copyId="toml-ts"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Transfer server (SEP-24)"
          value={data.transferServerSep0024}
          copyId="toml-ts24"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Web auth endpoint"
          value={data.webAuthEndpoint}
          copyId="toml-wa"
          copied={copied}
          copy={copy}
        />
        <Field
          label="Direct payment server"
          value={data.directPaymentServer}
          copyId="toml-dp"
          copied={copied}
          copy={copy}
        />
      </div>

      {data.accounts.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Accounts ({data.accounts.length})
          </h4>
          <div className="space-y-2">
            {data.accounts.map((a, i) => (
              <div key={i} className="rounded bg-muted/30 p-2 text-xs font-mono">
                <div className="break-all">{a.PUBLIC_KEY}</div>
                {a.NAME && <div className="text-muted-foreground mt-0.5">Name: {a.NAME}</div>}
                {a.HOME_DOMAIN && (
                  <div className="text-muted-foreground">Domain: {a.HOME_DOMAIN}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.currencies.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Currencies ({data.currencies.length})
          </h4>
          <div className="space-y-2">
            {data.currencies.map((c, i) => (
              <div key={i} className="rounded bg-muted/30 p-2 text-xs font-mono">
                <div>
                  {c.code}
                  <span className="text-muted-foreground ml-2">{c.issuer}</span>
                </div>
                {c.name && <div className="text-muted-foreground mt-0.5">{c.name}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.validators.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Validators ({data.validators.length})
          </h4>
          <div className="space-y-2">
            {data.validators.map((v, i) => (
              <div key={i} className="rounded bg-muted/30 p-2 text-xs font-mono">
                <div className="break-all">{v.PUBLIC_KEY}</div>
                {v.NAME && <div className="text-muted-foreground mt-0.5">{v.NAME}</div>}
                {v.HOST && <div className="text-muted-foreground">{v.HOST}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.documentation && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">Documentation</h4>
          <div className="space-y-0.5">
            {data.documentation.PRINCIPALS_NAME && (
              <Field label="Principals" value={data.documentation.PRINCIPALS_NAME} />
            )}
            {data.documentation.PRINCIPAL_EMAIL && (
              <Field label="Email" value={data.documentation.PRINCIPAL_EMAIL} />
            )}
            {data.documentation.PROJECT_URL && (
              <Field label="Project URL" value={data.documentation.PROJECT_URL} />
            )}
            {data.documentation.OFFICIAL_CHAT && (
              <Field label="Chat" value={data.documentation.OFFICIAL_CHAT} />
            )}
          </div>
        </div>
      )}
    </CollapsiblePanel>
  );
}

function LinkPreviewPanel({
  domain,
  copied,
  copy,
}: {
  domain: string;
  copied: string | null;
  copy: (t: string, id: string) => void;
}) {
  const [sep, setSep] = useState<'6' | '24' | '31'>('24');
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [callback, setCallback] = useState('');
  const [account, setAccount] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferLinkResult | null>(null);

  const build = async () => {
    setBuilding(true);
    setError(null);
    setResult(null);
    try {
      const preview = await previewTransferLink({
        domain,
        sep,
        asset: asset.trim(),
        amount: amount.trim(),
        memo: memo.trim() || undefined,
        callback: callback.trim() || undefined,
        account: account.trim() || undefined,
      });
      setResult(preview);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to build request link.');
    } finally {
      setBuilding(false);
    }
  };

  return (
    <CollapsiblePanel
      title="Request Link Preview"
      icon={<Link2 className="h-4 w-4 text-sky-400 shrink-0" />}
      badge={<span className="text-xs text-muted-foreground font-normal">SEP-6 / 24 / 31</span>}
    >
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">SEP</span>
          <select
            value={sep}
            onChange={(e) => setSep(e.target.value as '6' | '24' | '31')}
            className="rounded border border-border bg-background px-2 py-1.5 font-mono"
          >
            <option value="6">SEP-6</option>
            <option value="24">SEP-24</option>
            <option value="31">SEP-31</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Asset code</span>
          <input
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            placeholder="USDC"
            className="rounded border border-border bg-background px-2 py-1.5 font-mono"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Amount (decimal string)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100.50"
            className="rounded border border-border bg-background px-2 py-1.5 font-mono"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Memo (optional)</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1.5 font-mono"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-muted-foreground">Callback URL (optional, https)</span>
          <input
            value={callback}
            onChange={(e) => setCallback(e.target.value)}
            placeholder="https://wallet.example/callback"
            className="rounded border border-border bg-background px-2 py-1.5 font-mono"
            spellCheck={false}
          />
        </label>
        {sep !== '31' && (
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-muted-foreground">Account (G…)</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1.5 font-mono"
              spellCheck={false}
            />
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={() => void build()}
        disabled={building || !asset.trim() || !amount.trim()}
        className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-2"
      >
        {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Preview link'}
      </button>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 rounded p-2 mt-3">
          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <div className="rounded bg-muted/30 p-2">
            <div className="grid grid-cols-[120px_1fr] gap-x-3 py-0.5 text-xs">
              <span className="text-muted-foreground">SEP</span>
              <span className="font-mono text-xs">{result.sep}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-x-3 py-0.5">
              <span className="text-muted-foreground">Endpoint</span>
              <span className="font-mono text-xs break-all">{result.endpoint}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-x-3 py-0.5">
              <span className="text-muted-foreground">Request URL</span>
              <span className="font-mono text-xs break-all">
                {result.url}
                <CopyButton text={result.url} id="link-preview-url" copied={copied} copy={copy} />
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 rounded p-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{result.warning}</span>
          </div>
        </div>
      )}
    </CollapsiblePanel>
  );
}

function SepPanel({ data }: { data: SepResult }) {
  return (
    <CollapsiblePanel
      title="SEP Support"
      icon={<Shield className="h-4 w-4 text-violet-400 shrink-0" />}
      defaultOpen
      badge={
        <span className="text-xs text-muted-foreground font-normal">
          {data.seps.filter((s) => s.probeStatus === 'green').length}/{data.seps.length} verified
        </span>
      }
    >
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">SEP</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Endpoint</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.seps.map((sep) => (
              <tr key={sep.number} className="hover:bg-muted/10">
                <td className="px-3 py-2 font-mono">{sep.number}</td>
                <td className="px-3 py-2">{sep.name}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground break-all max-w-[200px] truncate">
                  {sep.endpoint ? (
                    <a
                      href={sep.endpoint}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {sep.endpoint}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <SepBadge status={sep.probeStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsiblePanel>
  );
}

function AssetMetadataLookup() {
  const [domain, setDomain] = useState('');
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<HomeDomainValidationResult | null>(null);
  const [metadata, setMetadata] = useState<TomlCurrency | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setValidation(null);
    setMetadata(null);
    try {
      const result = await validateHomeDomain(domain.trim(), issuer.trim());
      setValidation(result);
      if (result.valid) {
        setMetadata(await fetchAssetMetadata(domain.trim(), code.trim(), issuer.trim()));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Asset metadata lookup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">Asset metadata and home-domain check</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Reads public asset details from stellar.toml and checks the issuer is declared by that
        domain.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          aria-label="Asset home domain"
          required
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Home domain (example.com)"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          aria-label="Asset code"
          required
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Asset code (USDC)"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          aria-label="Asset issuer"
          required
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="Issuer public key (G…)"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono sm:col-span-2"
        />
        <button
          type="submit"
          disabled={loading || !domain.trim() || !code.trim() || !issuer.trim()}
          className="justify-self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40 sm:col-span-2"
        >
          {loading ? 'Checking…' : 'Check asset'}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {validation && (
        <p
          role="status"
          className={`mt-3 text-sm ${validation.valid ? 'text-green-400' : 'text-amber-400'}`}
        >
          {validation.valid
            ? `Issuer is declared for ${validation.domain}.`
            : `Home-domain check failed: ${validation.reason === 'issuer_not_declared' ? 'issuer is not listed in ACCOUNTS.' : 'issuer HOME_DOMAIN does not match.'}`}
        </p>
      )}
      {metadata && (
        <dl className="mt-3 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Asset</dt>
          <dd>
            {metadata.code} · {metadata.issuer}
          </dd>
          {metadata.name && (
            <>
              <dt className="text-muted-foreground">Name</dt>
              <dd>{metadata.name}</dd>
            </>
          )}
          {metadata.desc && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd>{metadata.desc}</dd>
            </>
          )}
          {metadata.display_decimals !== undefined && (
            <>
              <dt className="text-muted-foreground">Display decimals</dt>
              <dd>{metadata.display_decimals}</dd>
            </>
          )}
          {metadata.conditions && (
            <>
              <dt className="text-muted-foreground">Conditions</dt>
              <dd>{metadata.conditions}</dd>
            </>
          )}
          {metadata.anchor_asset && (
            <>
              <dt className="text-muted-foreground">Anchor asset</dt>
              <dd>{metadata.anchor_asset}</dd>
            </>
          )}
          {metadata.image && (
            <>
              <dt className="text-muted-foreground">Image URL</dt>
              <dd className="break-all">{metadata.image}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

export function FederationTool() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('query') ?? '';
  const initialLookupStarted = useRef(false);
  const { copied, copy } = useCopy();
  const [input, setInput] = useState(initialQuery);
  const [counterpartyName, setCounterpartyName] = useState('');
  const [savedCounterparties, setSavedCounterparties] =
    useState<SavedCounterparty[]>(loadSavedCounterparties);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fedData, setFedData] = useState<FederationResolveResult | null>(null);
  const [tomlData, setTomlData] = useState<TomlResult | null>(null);
  const [sepData, setSepData] = useState<SepResult | null>(null);

  const detectedType = input.trim() ? detectInputType(input.trim()) : null;

  const runLookup = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) return;

    const type = detectInputType(v);
    if (!type) {
      setError(
        'Unrecognised input. Enter a public key (G…), a federation address (user*domain), or a domain.',
      );
      return;
    }

    setLoading(true);
    setError(null);
    setFedData(null);
    setTomlData(null);
    setSepData(null);

    try {
      const cleanDomain =
        type === 'domain' ? stripProtocol(v) : type === 'federation' ? v.split('*')[1] : null;

      const fedPromise = resolveFederation(v);
      const tomlPromise = cleanDomain ? fetchStellarToml(cleanDomain) : null;
      const sepPromise = cleanDomain ? fetchSepSupport(cleanDomain) : null;

      const results = await Promise.allSettled([fedPromise, tomlPromise, sepPromise]);

      const fedResult = results[0];
      if (fedResult.status === 'fulfilled') {
        setFedData(fedResult.value);

        const domain = fedResult.value.homeDomain;
        if (domain && !cleanDomain) {
          const extraResults = await Promise.allSettled([
            fetchStellarToml(domain),
            fetchSepSupport(domain),
          ]);
          if (extraResults[0].status === 'fulfilled') setTomlData(extraResults[0].value);
          if (extraResults[1].status === 'fulfilled') setSepData(extraResults[1].value);
        }
      } else {
        setError(
          fedResult.reason instanceof Error
            ? fedResult.reason.message
            : 'Federation lookup failed.',
        );
        setLoading(false);
        return;
      }

      if (tomlPromise && results[1].status === 'fulfilled' && results[1].value)
        setTomlData(results[1].value);
      if (sepPromise && results[2].status === 'fulfilled' && results[2].value)
        setSepData(results[2].value);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      // Bound counterparties to 50 entries to prevent quota exhaustion
      const bounded = savedCounterparties.slice(0, 50);
      window.localStorage.setItem(COUNTERPARTY_STORAGE_KEY, JSON.stringify(bounded));
    } catch {
      // Gracefully ignore storage quota or restriction errors
    }
  }, [savedCounterparties]);

  useEffect(() => {
    if (initialLookupStarted.current) return;
    initialLookupStarted.current = true;
    if (initialQuery) void runLookup(initialQuery);
  }, [initialQuery, runLookup]);

  const saveCounterparty = () => {
    const value = input.trim();
    if (!value) return;
    const name = counterpartyName.trim() || value;
    setSavedCounterparties((current) =>
      [{ input: value, name }, ...current.filter((contact) => contact.input !== value)].slice(
        0,
        50,
      ),
    );
    setCounterpartyName('');
  };

  const inspectCounterparty = (contact: SavedCounterparty) => {
    setInput(contact.input);
    router.replace(`/inspector/federation?query=${encodeURIComponent(contact.input)}`, {
      scroll: false,
    });
    void runLookup(contact.input);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.replace(`/inspector/federation?query=${encodeURIComponent(input.trim())}`, {
      scroll: false,
    });
    void runLookup(input);
  };

  const inputTypeLabel = input.trim()
    ? ({
        publicKey: 'Public key (G…)',
        federation: 'Federation address',
        domain: 'Domain',
      }[detectedType!] ?? 'Unknown')
    : '';

  const hasResults = fedData || tomlData || sepData;

  return (
    <div>
      <AssetMetadataLookup />
      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="Public key (G…), federation address (user*domain), or domain"
            className="w-full rounded-md border border-border bg-background pl-9 pr-4 py-2 text-sm font-mono"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Inspect'}
        </button>
      </form>

      {savedCounterparties.length > 0 && (
        <section aria-label="Saved counterparties" className="mb-6 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">Address book</h2>
          <div className="divide-y divide-border rounded-md border border-border">
            {savedCounterparties.map((contact) => (
              <div key={contact.input} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => inspectCounterparty(contact)}
                  className="min-w-0 flex-1 text-left"
                  title={`Resolve ${contact.input}`}
                >
                  <span className="block truncate text-xs font-medium">{contact.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {contact.input}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => inspectCounterparty(contact)}
                  aria-label={`Refresh ${contact.name}`}
                  title="Refresh resolution"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSavedCounterparties((current) =>
                      current.filter((saved) => saved.input !== contact.input),
                    )
                  }
                  aria-label={`Remove ${contact.name}`}
                  title="Remove from address book"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {input.trim() && inputTypeLabel && !loading && (
        <p className="text-xs text-muted-foreground mb-4 -mt-3">
          Detected: <span className="text-foreground">{inputTypeLabel}</span>
        </p>
      )}

      {error && (
        <ErrorState
          title="Lookup failed"
          message={error}
          onRetry={() => {
            setError(null);
            void runLookup(input);
          }}
          retryLabel="Retry lookup"
        />
      )}

      {!loading && !error && !hasResults && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/60 mb-4 text-muted-foreground">
            <Globe className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Nothing to inspect yet</h3>
          <p className="text-xs text-muted-foreground max-w-sm mb-5">
            Enter a Stellar public key, federation address, or domain to resolve and inspect its
            stellar.toml and SEP compliance.
          </p>
          <ul className="text-[11px] text-muted-foreground/80 max-w-md space-y-1 list-disc list-inside text-left">
            <li>Public key: 56-character key starting with G</li>
            <li>Federation: alice*stellar.org format</li>
            <li>Domain: stellar.org — fetches stellar.toml and probes endpoints</li>
          </ul>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Resolving…</span>
        </div>
      )}

      {!loading && !error && hasResults && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs text-muted-foreground">
              Save this counterparty
              <input
                value={counterpartyName}
                onChange={(event) => setCounterpartyName(event.target.value)}
                placeholder="Name (optional)"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={saveCounterparty}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save counterparty
            </button>
          </div>
          {fedData && <FederationPanel data={fedData} copied={copied} copy={copy} />}
          {tomlData && <TomlPanel data={tomlData} copied={copied} copy={copy} />}
          {sepData && <SepPanel data={sepData} />}
          {tomlData && (
            <DiagnosticsPanel
              domain={
                tomlData.federationServer
                  ? new URL(tomlData.federationServer).hostname
                  : (input.trim().split('*')[1] ?? stripProtocol(input.trim()))
              }
              copied={copied}
              copy={copy}
            />
          )}
          {tomlData && (
            <LinkPreviewPanel
              domain={
                tomlData.federationServer
                  ? new URL(tomlData.federationServer).hostname
                  : (input.trim().split('*')[1] ?? stripProtocol(input.trim()))
              }
              copied={copied}
              copy={copy}
            />
          )}
        </div>
      )}
    </div>
  );
}
