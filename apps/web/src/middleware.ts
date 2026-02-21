import { NextRequest, NextResponse, NextFetchEvent } from 'next/server';

// ─── Comprehensive scanner / attack path blocklist ───────────────────────────
// Covers WordPress, Joomla, Drupal, Magento, phpMyAdmin, common webshells,
// sensitive files, and generic PHP exploitation paths.
const BLOCKED_PATH_PATTERNS: RegExp[] = [
  // Any PHP-family file extension
  /\.php\d*$/i,
  /\.phtml$/i,
  /\.phar$/i,

  // WordPress core entry points and directory trees
  /^\/(wp-login|wp-signup|wp-register|wp-cron|wp-mail|wp-trackback|wp-activate|wp-config)(\.php)?$/i,
  /^\/(wp-admin|wp-content|wp-includes|wp-json)(\/|$)/i,
  /^\/xmlrpc\.php/i,
  /^\/wp(\/|$)/i,

  // Joomla-specific paths (narrowed to avoid false-positives with common route names)
  /^\/(administrator|installation)(\/|$)/i,

  // Drupal
  /^\/(sites\/(default|all)|profiles|core)(\/|$)/i,

  // Magento
  /^\/(magento|downloader|mage|var\/export)(\/|$)/i,

  // Typo3
  /^\/(typo3|typo3conf|typo3temp|fileadmin)(\/|$)/i,

  // PrestaShop
  /^\/(prestashop|modules\/ps_)(\/|$)/i,

  // OpenCart
  /^\/(opencart|system\/storage)(\/|$)/i,

  // Concrete5 / ConcreteCMS
  /^\/(concrete|application\/files)(\/|$)/i,

  // Craft CMS
  /^\/(cpresources|craft)(\/|$)/i,

  // Umbraco
  /^\/(umbraco)(\/|$)/i,

  // Laravel / generic framework debug pages
  /^\/_ignition\//i,
  /^\/telescope(\/|$)/i,
  /^\/horizon(\/|$)/i,

  // Database admin panels
  /^\/(phpmyadmin|pma|myadmin|sqladmin|adminer|dbadmin|myphpadmin|phpmy|mypma|dbweb)(\/|$)/i,

  // Hosting control panels
  /^\/(cpanel|whm|webmail|plesk|plesk-stat|roundcube|horde|squirrelmail|webadmin)(\/|$)/i,

  // phpinfo
  /^\/phpinfo(\.php)?$/i,

  // Setup / install / upgrade scripts
  /^\/(install|setup|upgrade|reinstall|configuration)(\/|$)/i,

  // Common backup / dump directories
  /^\/(backup|backups|bak|dump|sql|db-backup)(\/|$)/i,

  // Temporary / old / archive directories
  /^\/(old|archive|temp|tmp|cache|archives)(\/|$)/i,

  // Generic test / debug paths
  /^\/(test|testing|debug)(\/|$)/i,

  // Sensitive dot-files and SCM metadata
  /^\/(\.env|\.env\.(local|dev|prod|production|test|staging))(\.php)?$/i,
  /^\/(\.git|\.svn|\.hg|\.bzr)(\/|$)/i,
  /^\/(\.ssh|\.aws|\.gcloud|\.config)(\/|$)/i,
  /^\/(\.htaccess|\.htpasswd|\.htusers)$/i,
  /^\/(\.DS_Store|Thumbs\.db|desktop\.ini|ehthumbs\.db)$/i,

  // Sensitive config / dependency files exposed at web root
  /^\/(web\.config|app\.config|appsettings\.json|web\.xml|context\.xml)$/i,
  /^\/(composer\.(json|lock)|Pipfile(\.lock)?|Gemfile(\.lock)?|requirements\.txt|package-lock\.json|yarn\.lock)$/i,

  // Exposed SSH / SSL private keys
  /^\/(id_rsa|id_dsa|id_ecdsa|id_ed25519|authorized_keys|known_hosts|server\.key|server\.pem|private\.pem)$/i,

  // Common named webshells and remote-access tools
  /^\/(shell|c99|r57|b374k|b374|wso|alfa|alpha|cmd|mini|indoxploit|vodkas|404|bypass|config|function|filesman|filemanager|fm|filesbrowser|explorer|luna|dark|b4tm4n|priv8|pric|2604|dx|1nj3ct0r|itsecteam|spymasta|webshell|remvio)(\.php)?$/i,

  // Generic single-letter / short webshell names seen in the wild
  /^\/[a-z]{1,4}\.php$/i,

  // CMS-style hidden trash / staging directories used by attackers
  /^\/(\.trash|\.recycler|\.quarantine)(\/|$)/i,

  // Server-side include files
  /\.(asp|aspx|cfm|cgi|pl|rb|py|sh|bash|jsp)(x)?$/i,

  // DotNetNuke
  /^\/(dnn|dotnetnuke|DesktopModules)(\/|$)/i,

  // Solr / Elasticsearch exposed endpoints (scanners look for these)
  /^\/(solr|elasticsearch|kibana)(\/|$)/i,

  // AWS metadata proxy attempts via path
  /^\/(latest\/meta-data|metadata)(\/|$)/i,
];

// ─── IP blocklist (per-instance in-process cache) ────────────────────────────
// Cloud Run can run multiple instances; each builds its own cache.
// Blocks are async-persisted to Redis via the API for cross-instance coverage.
// New instances quickly learn blocks when attackers retry.
const blockedIPs = new Map<string, number>(); // ip → expiry epoch ms

const BLOCK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BLOCKED_IPS = 10_000;

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function isIPBlocked(ip: string): boolean {
  const expiry = blockedIPs.get(ip);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    blockedIPs.delete(ip);
    return false;
  }
  return true;
}

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [ip, expiry] of blockedIPs) {
    if (now > expiry) blockedIPs.delete(ip);
  }
  // If still over the cap after cleanup, evict oldest entries
  if (blockedIPs.size > MAX_BLOCKED_IPS) {
    const toEvict = blockedIPs.size - MAX_BLOCKED_IPS;
    let evicted = 0;
    for (const ip of blockedIPs.keys()) {
      if (evicted >= toEvict) break;
      blockedIPs.delete(ip);
      evicted++;
    }
  }
}

function blockIP(ip: string): Promise<void> {
  blockedIPs.set(ip, Date.now() + BLOCK_TTL_MS);
  cleanupExpiredEntries();

  // Persist to Redis via the API so all instances and future restarts honour the block.
  // Uses event.waitUntil in the caller so the Edge runtime doesn't cancel the request.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const secret = process.env.INTERNAL_API_SECRET ?? 'dev-internal-secret';
  return fetch(`${apiUrl}/internal/block-ip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret,
    },
    body: JSON.stringify({ ip, ttlSeconds: BLOCK_TTL_MS / 1000 }),
  }).then(() => undefined).catch(() => undefined);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const ip = getClientIP(request);

  // Fast path: IP already known-bad
  if (ip !== 'unknown' && isIPBlocked(ip)) {
    return new NextResponse(null, { status: 404 });
  }

  // Check path against blocklist
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(pathname)) {
      if (ip !== 'unknown') event.waitUntil(blockIP(ip));
      return new NextResponse(null, { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next.js internals and static assets
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
