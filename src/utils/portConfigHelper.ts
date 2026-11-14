import type { ProjectItem, ProjectPortConfig, SolutionFileItem } from '../types/minirider';

export interface ResolvedProjectPortInfo {
  defaultUrl: string;
  defaultPort: number | null;
  allUrls: string[];
  source: 'launchSettings.json' | 'appsettings.Development.json' | 'appsettings.json' | 'fallback';
  hasKestrelHttpConfig: boolean;
  env: Record<string, string>;
}

export function parseJsonLenient(raw?: string): any {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

function flattenFiles(items: SolutionFileItem[] = []): SolutionFileItem[] {
  const out: SolutionFileItem[] = [];
  for (const item of items) {
    if (item.isDirectory && item.children) {
      out.push(...flattenFiles(item.children));
    } else if (!item.isDirectory) {
      out.push(item);
    }
  }
  return out;
}

export function extractPortFromUrl(url?: string | null): number | null {
  if (!url) return null;
  const first = url.split(';')[0]?.trim();
  if (!first) return null;
  const m = first.match(/:(\d{2,5})(?:\/|$|\s)/);
  if (m) {
    const port = parseInt(m[1], 10);
    if (!Number.isNaN(port) && port > 0 && port <= 65535) {
      return port;
    }
  }
  if (/^https:\/\//i.test(first)) return 443;
  if (/^http:\/\//i.test(first)) return 80;
  return null;
}

export function extractAllPortsFromUrls(urls: string[]): number[] {
  const ports = new Set<number>();
  for (const raw of urls) {
    for (const part of raw.split(';')) {
      const p = extractPortFromUrl(part.trim());
      if (p) ports.add(p);
    }
  }
  return Array.from(ports);
}

function extractUrlsFromAppSettingsObject(cfg: any): { urls: string[]; hasKestrelHttp: boolean } {
  if (!cfg || typeof cfg !== 'object') return { urls: [], hasKestrelHttp: false };
  const urls: string[] = [];
  let hasKestrelHttp = false;

  if (typeof cfg.Urls === 'string' && cfg.Urls.trim()) urls.push(cfg.Urls.trim());
  if (typeof cfg.urls === 'string' && cfg.urls.trim()) urls.push(cfg.urls.trim());
  if (typeof cfg.ASPNETCORE_URLS === 'string' && cfg.ASPNETCORE_URLS.trim()) {
    urls.push(cfg.ASPNETCORE_URLS.trim());
  }

  const endpoints = cfg.Kestrel?.Endpoints || cfg.kestrel?.endpoints;
  if (endpoints && typeof endpoints === 'object') {
    for (const [key, ep] of Object.entries(endpoints as Record<string, any>)) {
      const epUrl = ep?.Url || ep?.url;
      if (typeof epUrl === 'string' && epUrl.trim()) {
        urls.push(epUrl.trim());
        if (key.toLowerCase() === 'http') hasKestrelHttp = true;
      }
    }
  }

  const directPort = cfg.Port || cfg.port || cfg.Server?.Port || cfg.HttpPort;
  if (directPort && /^\d+$/.test(String(directPort).trim())) {
    urls.push(`http://localhost:${String(directPort).trim()}`);
  }

  return { urls, hasKestrelHttp };
}

export function resolveProjectPortInfo(project?: ProjectItem): ResolvedProjectPortInfo {
  const env: Record<string, string> = {
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development'
  };

  if (!project) {
    return {
      defaultUrl: 'http://localhost:5000',
      defaultPort: 5000,
      allUrls: ['http://localhost:5000'],
      source: 'fallback',
      hasKestrelHttpConfig: false,
      env
    };
  }

  const allFiles = flattenFiles(project.files);
  let applicationUrl = '';
  let source: ResolvedProjectPortInfo['source'] = 'fallback';
  let hasKestrelHttpConfig = false;

  // 1. Check launchSettings.json (either pre-parsed on ProjectItem or live edited file content)
  let launchSettings = project.launchSettings;
  const launchFile = allFiles.find(f => f.name.toLowerCase() === 'launchsettings.json');
  if (launchFile?.content) {
    const parsedLaunch = parseJsonLenient(launchFile.content);
    if (parsedLaunch?.profiles) {
      launchSettings = parsedLaunch;
    }
  }

  const profiles = launchSettings?.profiles || {};
  const prof =
    Object.values(profiles).find(p => p && p.commandName === 'Project') ||
    Object.values(profiles)[0];

  if (prof) {
    if (prof.applicationUrl) {
      applicationUrl = String(prof.applicationUrl).trim();
      env.ASPNETCORE_URLS = applicationUrl;
      source = 'launchSettings.json';
    }
    if (prof.environmentVariables) {
      for (const [k, v] of Object.entries(prof.environmentVariables)) {
        if (v !== undefined && v !== null) {
          env[k] = String(v);
          if (!applicationUrl && (k === 'ASPNETCORE_URLS' || k === 'DOTNET_URLS')) {
            applicationUrl = String(v).trim();
            source = 'launchSettings.json';
          }
        }
      }
    }
  }

  // 2. Check appsettings.Development.json & appsettings.json
  for (const cfgName of ['appsettings.Development.json', 'appsettings.json'] as const) {
    const cfgFile = allFiles.find(f => f.name.toLowerCase() === cfgName.toLowerCase());
    if (!cfgFile?.content) continue;
    const parsedCfg = parseJsonLenient(cfgFile.content);
    if (!parsedCfg) continue;
    const extracted = extractUrlsFromAppSettingsObject(parsedCfg);
    if (extracted.hasKestrelHttp) hasKestrelHttpConfig = true;
    if (!applicationUrl && extracted.urls.length > 0) {
      applicationUrl = extracted.urls.join(';');
      source = cfgName;
    }
  }

  // 3. Fallback default for Web API / Exe
  if (!applicationUrl && (project.projectType === 'webapi' || project.projectType === 'console')) {
    applicationUrl = 'http://localhost:5124';
    source = 'fallback';
  }

  const splitUrls = applicationUrl
    ? applicationUrl.split(';').map(u => u.trim()).filter(Boolean)
    : [];
  // Prefer http URL when both http and https exist for simple local curl/browser, or first URL
  const primaryUrl =
    splitUrls.find(u => u.startsWith('http://')) ||
    splitUrls[0] ||
    'http://localhost:5000';

  return {
    defaultUrl: primaryUrl,
    defaultPort: extractPortFromUrl(primaryUrl),
    allUrls: splitUrls.length > 0 ? splitUrls : [primaryUrl],
    source,
    hasKestrelHttpConfig,
    env
  };
}

export function buildUrlForPort(
  port: number,
  protocol: 'http' | 'https' = 'http'
): string {
  const safePort = Math.max(1, Math.min(65535, Math.floor(port)));
  return `${protocol}://localhost:${safePort}`;
}

export function resolveEffectiveLaunchConfig(
  project?: ProjectItem,
  override?: ProjectPortConfig | null
): {
  env: Record<string, string>;
  url: string | null;
  port: number | null;
  isCustomOverride: boolean;
  source: ResolvedProjectPortInfo['source'] | 'custom';
  defaultPort: number | null;
  defaultUrl: string;
} {
  const base = resolveProjectPortInfo(project);
  const customPort = override?.port && override.port > 0 ? override.port : null;

  if (customPort) {
    const customUrl = buildUrlForPort(customPort, override?.protocol || 'http');
    const env: Record<string, string> = {
      ...base.env,
      ASPNETCORE_URLS: customUrl,
      DOTNET_URLS: customUrl,
      PORT: String(customPort)
    };
    if (base.hasKestrelHttpConfig) {
      env.Kestrel__Endpoints__Http__Url = customUrl;
    }
    return {
      env,
      url: customUrl,
      port: customPort,
      isCustomOverride: true,
      source: 'custom',
      defaultPort: base.defaultPort,
      defaultUrl: base.defaultUrl
    };
  }

  return {
    env: base.env,
    url: base.defaultUrl,
    port: base.defaultPort,
    isCustomOverride: false,
    source: base.source,
    defaultPort: base.defaultPort,
    defaultUrl: base.defaultUrl
  };
}

export function suggestNextFreePort(preferredPort: number, occupiedPorts: number[]): number {
  const used = new Set(occupiedPorts);
  let candidate = preferredPort > 0 && preferredPort < 65535 ? preferredPort + 1 : 5050;
  for (let i = 0; i < 200; i++) {
    if (!used.has(candidate) && candidate >= 1024 && candidate <= 65535) {
      return candidate;
    }
    candidate++;
  }
  return 5555;
}
