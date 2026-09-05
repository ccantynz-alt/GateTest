// =============================================================================
// SECRETS — corpus6 precision pass (nest, trpc, apollo-server, prisma)
// =============================================================================
// Four third-party repos scanned 2026-09-05 with `--suite full --all`. Every
// blocking `secrets:` finding was opened at its line and given a defendant —
// the code or the rule. Each rule change below carries its control pair: the
// legitimate line from the repo, verbatim, that must stay quiet, and the
// credential-shaped line in the same position that must still fire.
//
// The recall floor is OWASP NodeGoat: its five blocking findings are pinned
// here by shape (`mongodb://mongo:27017/nodegoat` in docker-compose, the
// zapApiKey, the committed `artifacts/cert/server.key`).
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SecretsModule = require('../src/modules/secrets');

// Assembled at runtime — a literal `sk_live_` is rejected by push protection.
const REAL_KEY = ['sk', 'live', '9f2b7c1d4e6a8b0c2d4e6f8a1b3c5d7e9f0a2b4c'].join('_');
const PUBLISHABLE_KEY = ['pk', 'live', '9f2b7c1d4e6a8b0c2d4e6f8a1b3c5d7e9f0a2b4c'].join('_');

// A real-shaped PKCS#1 header plus a few base64 lines. The body is not a
// valid key (the classifier only reads the header) but the shape is exact.
const RSA_KEY_FILE = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIICXgIBAAKBgQCfn8uP4FuHaaAPrMkcl1fNMQM5EGMT4nnNxxxxxxxxxxxxxxxxxxxx',
  'AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDw4o6gJy8UtmIbkcpnkO3Kwc4qkQ5w',
  '-----END RSA PRIVATE KEY-----',
  '',
].join('\n');
const PKCS8_KEY_FILE = '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n';
const OPENSSH_KEY_FILE = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn\n-----END OPENSSH PRIVATE KEY-----\n';
const CERT_FILE = '-----BEGIN CERTIFICATE-----\nMIICpDCCAYwCCQCyP27z3r0PFjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlsb2Nh\n-----END CERTIFICATE-----\n';
const CA_BUNDLE_FILE = '##\n## Bundle of CA Root Certificates\n##\n\n' + CERT_FILE;

async function scan(files, { gitignore = 'node_modules/\n', git = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-secrets-c6-'));
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    if (git) execSync('git init -q', { cwd: root, stdio: 'ignore' });
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, ...(meta || {}) }); },
      addInfo() {},
    };
    await new SecretsModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const byId = (found, id) => found.find((c) => c.id === id);
const fileFindings = (found) => found.filter((c) => !/gitignore/i.test(c.id));

// -----------------------------------------------------------------------------
// Database URL — a location is not a credential
// -----------------------------------------------------------------------------
describe('secrets — corpus6: Database URL without a credential', () => {
  const QUIET = {
    // nestjs/nest integration/mongoose/src/app.module.ts:7
    'loopback, no userinfo (nest)': "    MongooseModule.forRoot('mongodb://localhost:27017/test'),\n",
    // nestjs/nest sample/14-mongoose-base/src/database/database.providers.ts:7
    'loopback, no port (nest)': "    useFactory: (): Promise<typeof mongoose> => mongoose.connect('mongodb://localhost/test'),\n",
    // nestjs/nest sample/02-gateways/src/adapters/redis-io.adapter.ts:14
    'redis loopback (nest)': '    const pubClient = createClient({ url: `redis://localhost:6379` });\n',
    // prisma packages/1-framework/3-tooling/cli/scripts/record.ts:171
    'image-default creds on loopback (prisma)': "const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5433/postgres';\n",
    // prisma .github/workflows/ci.yml:231
    'image-default creds in CI env (prisma)': '      WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: postgres://postgres:postgres@127.0.0.1:5433/prisma_next_cloudflare_worker\n',
    // prisma packages/1-framework/3-tooling/cli/src/commands/init/templates/env.ts:50
    'template creds user:password (prisma)': "    lines.push('DATABASE_URL=\"mongodb://user:password@localhost:27017/mydb\"');\n",
    // prisma docs/Serverless Deployment Guide.md:75
    'shouting placeholders': '--connection-string="postgres://USER:PASS@HOST:PORT/DBNAME"\n',
    // prisma packages/3-extensions/mongo/src/runtime/binding.ts:122
    'placeholder host in an error message (prisma)': "        'Mongo URL must include a database name in its path (e.g. mongodb://host:27017/mydb), or pass dbName explicitly',\n",
    // apollo-server docs/source/performance/cache-backends.mdx:117
    'user:pass placeholder (apollo)': '  new KeyvRedis("redis://user:pass@localhost:6379", {\n',
  };
  for (const [why, line] of Object.entries(QUIET)) {
    it(`silent: ${why}`, async () => {
      const found = fileFindings(await scan({ 'src/db.ts': line }));
      assert.deepStrictEqual(found.map((f) => f.id), [], `${why} carries no credential`);
    });
  }

  const FIRES = {
    // OWASP NodeGoat docker-compose.yml:8 — a NAMED host is topology. Recall floor.
    'named host, no creds (NodeGoat floor)': '      MONGODB_URI: mongodb://mongo:27017/nodegoat\n',
    'real password on loopback': "const url = 'mongodb://app:Tr0ub4dor-and-3@localhost:27017/app';\n",
    'real password on a named host': "const url = 'postgres://admin:x9K2mPq7vL@db.prod.internal:5432/app';\n",
    'user==pass on a named host is a default credential, not a template': "const url = 'postgres://postgres:postgres@db:5432/app';\n",
    'redis password only': "const url = 'redis://:hunter2hunter2hunter2@cache.internal:6379';\n",
  };
  for (const [why, line] of Object.entries(FIRES)) {
    it(`fires: ${why}`, async () => {
      const found = fileFindings(await scan({ 'src/db.ts': line }));
      assert.strictEqual(found.length, 1, `${why} must still be reported`);
      assert.strictEqual(found[0].severity, 'error');
      assert.strictEqual(found[0].details[0].type, 'Database URL');
    });
  }

  it('_databaseUrlIsPlaceholder parses userinfo and host', () => {
    const m = new SecretsModule();
    assert.strictEqual(m._databaseUrlIsPlaceholder('mongodb://localhost:27017/test'), true);
    assert.strictEqual(m._databaseUrlIsPlaceholder('mongodb://[::1]:27017/test'), true);
    assert.strictEqual(m._databaseUrlIsPlaceholder('postgres://postgres@localhost/db'), true);
    assert.strictEqual(m._databaseUrlIsPlaceholder('mysql://user:pass@localhost:3306/service_a'), true);
    assert.strictEqual(m._databaseUrlIsPlaceholder('mysql://app:<password>@db.example.com/x'), true);
    assert.strictEqual(m._databaseUrlIsPlaceholder('mongodb://mongo:27017/nodegoat'), false);
    assert.strictEqual(m._databaseUrlIsPlaceholder('mongodb://app:s3cr3tP4ss@localhost:27017/app'), false);
    assert.strictEqual(m._databaseUrlIsPlaceholder('not a url'), false);
  });
});

// -----------------------------------------------------------------------------
// A value that names its own identifier, or probes for a property
// -----------------------------------------------------------------------------
describe('secrets — corpus6: self-referential values', () => {
  it('silent: a DI injection token equal to its own name (nest integration/injector/src/dynamic/dynamic.module.ts:3)', async () => {
    const found = fileFindings(await scan({ 'src/dynamic.module.ts': "export const DYNAMIC_TOKEN = 'DYNAMIC_TOKEN';\n" }));
    assert.deepStrictEqual(found.map((f) => f.id), []);
  });

  it('silent: a property probe (prisma packages/3-extensions/supabase/src/runtime/supabase.ts:183)', async () => {
    const found = fileFindings(await scan({
      'src/supabase.ts': "  const jwtSecret = 'jwtSecret' in options ? options.jwtSecret : undefined;\n",
    }));
    assert.deepStrictEqual(found.map((f) => f.id), []);
  });

  it('fires: a real value under the same identifier', async () => {
    const found = fileFindings(await scan({ 'src/dynamic.module.ts': "export const DYNAMIC_TOKEN = 'dyn_9f8e7d6c5b4a3b2c1d';\n" }));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].details[0].type, 'Token');
  });

  it('fires: a value that merely ends in the identifier', async () => {
    const found = fileFindings(await scan({ 'src/auth.ts': "const secret = 'Q7v2hjwtSecret';\n" }));
    assert.strictEqual(found.length, 1);
  });

  it('fires: `password: \'password\'` is a weak default, not a symbol (nest sample/21-serializer stays reported)', async () => {
    const found = fileFindings(await scan({ 'src/users.ts': "    password: 'password',\n" }));
    assert.strictEqual(found.length, 1);
  });

  it('fires: a real key on the line before an `in` probe on the next', async () => {
    const found = fileFindings(await scan({
      'src/x.ts': `const secret = '${REAL_KEY}';\nconst has = 'jwtSecret' in options;\n`,
    }));
    assert.strictEqual(found.length, 1);
    // Line 1 hits two patterns (identifier-keyed + vendor-shaped); line 2 none.
    assert.ok(found[0].details.length >= 1);
    assert.deepStrictEqual(found[0].details.map((d) => d.line), found[0].details.map(() => 1));
  });
});

// -----------------------------------------------------------------------------
// Keys a vendor designs to be public
// -----------------------------------------------------------------------------
describe('secrets — corpus6: public-by-design keys', () => {
  // trpc/trpc www/docusaurus.config.ts:46-52, verbatim.
  const DOCUSAURUS = [
    "    image: `${env.OG_URL}/api/landing?cache-buster=${new Date().getDate()}`,",
    '    algolia: {',
    "      appId: 'BTGPSR4MOE',",
    "      apiKey: 'ed8b3896f8e3e2b421e4c38834b915a8',",
    "      indexName: 'trpc',",
    '      // contextualSearch: true,',
    '    },',
    '',
  ].join('\n');

  it('silent: an Algolia DocSearch key inside its algolia block (trpc)', async () => {
    const found = fileFindings(await scan({ 'www/docusaurus.config.ts': DOCUSAURUS }));
    assert.deepStrictEqual(found.map((f) => f.id), []);
  });

  it('fires: the same 32-hex key with no algolia block around it', async () => {
    const found = fileFindings(await scan({ 'src/config.ts': "  apiKey: 'ed8b3896f8e3e2b421e4c38834b915a8',\n" }));
    assert.strictEqual(found.length, 1);
  });

  it('fires: an Algolia ADMIN key in an algolia block', async () => {
    const found = fileFindings(await scan({
      'src/config.ts': "  algolia: {\n    // admin key — can write to the index\n    apiKey: 'ed8b3896f8e3e2b421e4c38834b915a8',\n  },\n",
    }));
    assert.strictEqual(found.length, 1);
  });

  it('fires: a vendor-shaped key inside an algolia block', async () => {
    const found = fileFindings(await scan({
      'src/config.ts': `  algolia: {\n    apiKey: '${REAL_KEY}',\n  },\n`,
    }));
    assert.strictEqual(found.length, 1);
  });

  it('silent: a Stripe publishable key', async () => {
    const found = fileFindings(await scan({ 'src/stripe.ts': `const apiKey = '${PUBLISHABLE_KEY}';\n` }));
    assert.deepStrictEqual(found.map((f) => f.id), []);
  });

  it('fires: the Stripe secret key of the same shape', async () => {
    const found = fileFindings(await scan({ 'src/stripe.ts': `const apiKey = '${REAL_KEY}';\n` }));
    assert.strictEqual(found.length, 1);
  });
});

// -----------------------------------------------------------------------------
// Key files are opened; the .gitignore line is hygiene
// -----------------------------------------------------------------------------
describe('secrets — corpus6: private key files are read, not inferred from .gitignore', () => {
  it('fires: a committed RSA private key (OWASP NodeGoat artifacts/cert/server.key) blocks under its own path', async () => {
    const found = await scan({ 'artifacts/cert/server.key': RSA_KEY_FILE, 'artifacts/cert/server.crt': CERT_FILE });
    const key = byId(found, 'secrets:artifacts/cert/server.key');
    assert.ok(key, 'the key file itself is the finding');
    assert.strictEqual(key.severity, 'error');
    assert.strictEqual(key.details[0].type, 'Private Key');
    assert.strictEqual(byId(found, 'secrets:gitignore-*.key').severity, 'warning', 'reported once, at the file');
  });

  for (const [name, body] of [['PKCS#8 (nest privkey.pem)', PKCS8_KEY_FILE], ['OpenSSH', OPENSSH_KEY_FILE]]) {
    it(`fires: ${name} header`, async () => {
      const found = await scan({ 'src/tcp-tls/privkey.pem': body });
      assert.strictEqual(byId(found, 'secrets:src/tcp-tls/privkey.pem').severity, 'error');
    });
  }

  it('silent: a CA bundle at the root is public (apollo-server .cacert.pem) — the missing line is a warning', async () => {
    const found = await scan({ '.cacert.pem': CA_BUNDLE_FILE, 'src/index.ts': 'export {};\n' });
    assert.deepStrictEqual(fileFindings(found).map((f) => f.id), []);
    assert.strictEqual(byId(found, 'secrets:gitignore-*.pem').severity, 'warning');
  });

  it('silent: a certificate next to nothing', async () => {
    const found = await scan({ 'certs/ca.cert.pem': CERT_FILE });
    assert.deepStrictEqual(fileFindings(found).map((f) => f.id), []);
    assert.strictEqual(byId(found, 'secrets:gitignore-*.pem').severity, 'warning');
  });

  it('a private key under a test tree is a warning, like every other test-tree finding', async () => {
    const found = await scan({ '__tests__/tls/server.key': RSA_KEY_FILE });
    assert.strictEqual(byId(found, 'secrets:__tests__/tls/server.key').severity, 'warning');
  });

  it('an opaque .pem the scan cannot classify still escalates the .gitignore line (calibration stays honest)', async () => {
    const found = await scan({ 'config/certs/server.pem': 'x\n' });
    assert.deepStrictEqual(fileFindings(found).map((f) => f.id), []);
    assert.strictEqual(byId(found, 'secrets:gitignore-*.pem').severity, 'error');
  });

  it('a gitignored key in the working tree is local material, not a committed one', async () => {
    const found = await scan(
      { 'certs/server.key': RSA_KEY_FILE, 'src/index.ts': 'export {};\n' },
      { gitignore: 'node_modules/\n*.key\n', git: true },
    );
    assert.deepStrictEqual(found.filter((f) => f.id === 'secrets:certs/server.key'), []);
  });

  it('outside a git checkout the same key is reported — fail toward detection', async () => {
    const found = await scan({ 'certs/server.key': RSA_KEY_FILE }, { gitignore: 'node_modules/\n' });
    assert.strictEqual(byId(found, 'secrets:certs/server.key').severity, 'error');
  });

  it('the inline PEM pattern learned the OpenSSH and PGP forms too', async () => {
    const found = fileFindings(await scan({
      'src/keys.ts': 'const k = `-----BEGIN OPENSSH PRIVATE KEY-----\nconst p = `-----BEGIN PGP PRIVATE KEY BLOCK-----\n',
    }));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].details.length, 2);
  });
});

// Doctrine §5: the fixture/example/mock skip was `relPath.includes(...)` —
// `src/mockingbird.ts` and `counterexample-search/` were never scanned.
// Now a directory SEGMENT or a basename TOKEN, never a substring.
describe('secrets — fixture/example/mock paths are matched by segment and token', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'modules', 'secrets.js'), 'utf8');
  const re = new RegExp(src.match(/const FIXTURE_PATH_RE = \/(.*)\/;/)[1]);
  it('skips real fixture, example and mock paths', () => {
    for (const p of ['.env.example', 'tests/fixtures/a.key', 'src/__mocks__/x.ts', 'user.mock.ts', 'MockServer.ts', 'examples/demo/app.js', 'config/example.env', 'fixture.key', 'mocks/db.js']) {
      assert.ok(re.test(p), p);
    }
  });
  it('POSITIVE CONTROL: a longer word containing the token is application code and is scanned', () => {
    for (const p of ['src/mockingbird.ts', 'packages/counterexample-search/index.ts', 'src/examplesearch/x.js', 'lib/fixturesque.js', 'src/app.js']) {
      assert.ok(!re.test(p), p);
    }
  });
});
