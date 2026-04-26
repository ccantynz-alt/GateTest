// Tests for integrations/infra/scanner.js
//
// Uses Node's built-in test runner (matches the rest of the GateTest suite).
// All SSH / HTTP / TLS I/O is mocked via constructor injection.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  InfraScanner,
  loadSpec,
  parseYaml,
  redact,
  parseListeningPorts,
  shellEscape,
  validateSpec,
} = require('../integrations/infra/scanner.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSpec(overrides = {}) {
  return {
    host: '203.0.113.10',
    ssh_user: 'gatetest',
    ssh_key_path: '~/.ssh/gatetest_scanner',
    services: [
      { name: 'crontech-web', state: 'active' },
      { name: 'crontech-api', state: 'active' },
      { name: 'caddy', state: 'active' },
    ],
    ports: [80, 443, 3000],
    paths: [
      { path: '/var/log/caddy', owner: 'caddy', group: 'caddy', mode: '755' },
    ],
    certs: [{ domain: 'crontech.ai', min_days: 14 }],
    endpoints: [{ url: 'https://crontech.ai/', expect_status: 200 }],
    disk: { path: '/', min_free_pct: 20 },
    crash_loop: { max_restarts_per_hour: 10 },
    ...overrides,
  };
}

// Scriptable SSH fixture: map { 'regex or literal' -> { stdout, code } } or function.
function makeSshExecutor(scenario) {
  return function factory() {
    return async function run(cmd) {
      for (const [matcher, response] of scenario) {
        if (typeof matcher === 'string' && cmd.includes(matcher)) {
          const r = typeof response === 'function' ? response(cmd) : response;
          return { stdout: '', stderr: '', code: 0, ...r };
        }
        if (matcher instanceof RegExp && matcher.test(cmd)) {
          const r = typeof response === 'function' ? response(cmd) : response;
          return { stdout: '', stderr: '', code: 0, ...r };
        }
      }
      return { stdout: '', stderr: '', code: 0 };
    };
  };
}

const LISTENING_ALL = [
  'State      Recv-Q  Send-Q     Local Address:Port        Peer Address:Port',
  'LISTEN     0       128              0.0.0.0:80               0.0.0.0:*',
  'LISTEN     0       128              0.0.0.0:443              0.0.0.0:*',
  'LISTEN     0       128              0.0.0.0:3000             0.0.0.0:*',
].join('\n');

// df -P ... | tail -n 1 runs remotely, so the SSH executor receives only the
// trailing data row.
const DF_20PCT_FREE = '/dev/vda1        104857600 83886080   20971520      80% /';
const DF_5PCT_FREE = '/dev/vda1        104857600 99614720    5242880      95% /';

const STAT_GOOD = 'directory|caddy|caddy|755';
const STAT_WRONG_OWNER = 'directory|root|root|755';

// ---------------------------------------------------------------------------
// Unit tests for helpers
// ---------------------------------------------------------------------------

describe('infra-scanner: helpers', () => {
  it('redact scrubs PEM blocks, tokens, and bearer auth', () => {
    const input =
      'key: -----BEGIN PRIVATE KEY-----\nMIIEvAIBA...\n-----END PRIVATE KEY-----\n' +
      'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
      'sk_live_51AbCdEf0123456789xyz\n' +
      'Authorization: Bearer xyz.abc.def';
    const out = redact(input);
    assert.ok(!out.includes('BEGIN PRIVATE KEY'), 'PEM not redacted');
    assert.ok(!out.includes('ghp_'), 'GitHub PAT not redacted');
    assert.ok(!out.includes('sk_live_'), 'Stripe key not redacted');
    assert.ok(!out.includes('xyz.abc.def'), 'Bearer token not redacted');
    assert.ok(out.includes('[REDACTED]'));
  });

  it('parseListeningPorts handles ss + netstat formats', () => {
    const ss = parseListeningPorts(LISTENING_ALL);
    assert.ok(ss.has(80));
    assert.ok(ss.has(443));
    assert.ok(ss.has(3000));

    const netstat = parseListeningPorts(
      'tcp   0   0 0.0.0.0:22   0.0.0.0:*   LISTEN\n' +
      'tcp   0   0 0.0.0.0:5432 0.0.0.0:*   LISTEN',
    );
    assert.ok(netstat.has(22));
    assert.ok(netstat.has(5432));
  });

  it('shellEscape wraps with single quotes and escapes embedded quotes', () => {
    assert.strictEqual(shellEscape('caddy'), "'caddy'");
    assert.strictEqual(shellEscape("o'hara"), "'o'\\''hara'");
  });

  it('validateSpec rejects empty or missing fields', () => {
    assert.throws(() => validateSpec(null), /spec must be an object/);
    assert.throws(() => validateSpec({}), /spec.host is required/);
    assert.throws(() => validateSpec({ host: 'x' }), /spec.ssh_user is required/);
    assert.doesNotThrow(() => validateSpec({ host: 'x', ssh_user: 'y' }));
  });

  it('parseYaml handles the example spec shape', () => {
    const yaml = [
      'host: 1.2.3.4',
      'ssh_user: deploy',
      'services:',
      '  - name: web',
      '    state: active',
      '  - name: api',
      '    state: active',
      'ports: [80, 443, 3000]',
      'paths:',
      '  - path: /var/log/caddy',
      '    owner: caddy',
      '    group: caddy',
      '    mode: "755"',
      'disk:',
      '  path: /',
      '  min_free_pct: 20',
    ].join('\n');
    const parsed = parseYaml(yaml);
    assert.strictEqual(parsed.host, '1.2.3.4');
    assert.strictEqual(parsed.ssh_user, 'deploy');
    assert.strictEqual(parsed.services.length, 2);
    assert.strictEqual(parsed.services[0].name, 'web');
    assert.strictEqual(parsed.services[0].state, 'active');
    assert.deepStrictEqual(parsed.ports, [80, 443, 3000]);
    assert.strictEqual(parsed.paths[0].path, '/var/log/caddy');
    assert.strictEqual(parsed.paths[0].mode, '755');
    assert.strictEqual(parsed.disk.min_free_pct, 20);
  });

  it('loadSpec reads the shipped example spec file', () => {
    const specPath = path.resolve(__dirname, '..', 'integrations', 'infra', 'example-crontech.spec.yaml');
    const spec = loadSpec(specPath);
    assert.strictEqual(spec.host, '45.76.171.37');
    assert.strictEqual(spec.ssh_user, 'deploy');
    assert.ok(Array.isArray(spec.services));
    assert.ok(spec.services.length >= 4);
    assert.ok(spec.ports.includes(443));
  });

  it('loadSpec accepts JSON', () => {
    const tmp = path.join(os.tmpdir(), `infra-spec-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ host: 'h', ssh_user: 'u', ports: [80] }));
    const spec = loadSpec(tmp);
    assert.strictEqual(spec.host, 'h');
    assert.deepStrictEqual(spec.ports, [80]);
    fs.unlinkSync(tmp);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for the scanner itself, with injected transports
// ---------------------------------------------------------------------------

describe('infra-scanner: all checks pass', () => {
  it('reports passed = true when every section is healthy', async () => {
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        ['systemctl is-active', { stdout: 'active\nactive\nactive\n0\n' }],
        [/ss -tln|netstat/, { stdout: LISTENING_ALL }],
        ['stat -c', { stdout: STAT_GOOD }],
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_20PCT_FREE }],
        [/journalctl/, { stdout: '2\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60, validTo: '2027-01-01' }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.summary.passed, true, JSON.stringify(report.summary));
    assert.strictEqual(report.summary.total_issues, 0);
    assert.strictEqual(report.sections.services.status, 'passed');
    assert.strictEqual(report.sections.ports.status, 'passed');
    assert.strictEqual(report.sections.paths.status, 'passed');
    assert.strictEqual(report.sections.certs.status, 'passed');
    assert.strictEqual(report.sections.endpoints.status, 'passed');
    assert.strictEqual(report.sections.disk.status, 'passed');
    assert.strictEqual(report.sections.crash_loop.status, 'passed');
  });
});

describe('infra-scanner: one service fail', () => {
  it('reports a failing service as the only issue', async () => {
    let callIdx = 0;
    const services = ['active', 'failed', 'active']; // crontech-api is down
    const scanner = new InfraScanner({
      sshExecutor: () => async (cmd) => {
        if (cmd.includes('systemctl is-active')) {
          const state = services[callIdx++ % services.length];
          return { stdout: `${state}\n${state}\n`, stderr: '', code: 0 };
        }
        if (cmd.includes('ss -tln') || cmd.includes('netstat')) return { stdout: LISTENING_ALL, stderr: '', code: 0 };
        if (cmd.includes('stat -c')) return { stdout: STAT_GOOD, stderr: '', code: 0 };
        if (cmd.startsWith('curl -k')) return { stdout: '200', stderr: '', code: 0 };
        if (cmd.includes('df -P')) return { stdout: DF_20PCT_FREE, stderr: '', code: 0 };
        if (cmd.includes('journalctl')) return { stdout: '1\n', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      },
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.summary.passed, false);
    assert.strictEqual(report.sections.services.status, 'failed');
    assert.strictEqual(report.sections.services.issues, 1);
    const failing = report.sections.services.checks.find((c) => !c.ok);
    assert.strictEqual(failing.service, 'crontech-api');
    assert.match(failing.detail, /failed/);
    // Everything else still passes
    assert.strictEqual(report.sections.ports.status, 'passed');
    assert.strictEqual(report.sections.paths.status, 'passed');
  });
});

describe('infra-scanner: port missing', () => {
  it('flags a port that is not listening', async () => {
    const missingPort3000 = LISTENING_ALL.split('\n').filter((l) => !l.includes(':3000')).join('\n');
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        ['systemctl is-active', { stdout: 'active\nactive\n0\n' }],
        [/ss -tln|netstat/, { stdout: missingPort3000 }],
        ['stat -c', { stdout: STAT_GOOD }],
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_20PCT_FREE }],
        [/journalctl/, { stdout: '0\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.sections.ports.status, 'failed');
    const failing = report.sections.ports.checks.find((c) => !c.ok);
    assert.strictEqual(failing.port, 3000);
    assert.match(failing.detail, /NOT listening/);
  });
});

describe('infra-scanner: cert expiry warn', () => {
  it('fails when cert expires before min_days', async () => {
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        ['systemctl is-active', { stdout: 'active\nactive\nactive\n0\n' }],
        [/ss -tln|netstat/, { stdout: LISTENING_ALL }],
        ['stat -c', { stdout: STAT_GOOD }],
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_20PCT_FREE }],
        [/journalctl/, { stdout: '0\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 7, validTo: '2026-04-26' }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.sections.certs.status, 'failed');
    const failing = report.sections.certs.checks[0];
    assert.strictEqual(failing.ok, false);
    assert.strictEqual(failing.days_remaining, 7);
    assert.match(failing.detail, /expires in 7d/);
  });
});

describe('infra-scanner: disk full fail', () => {
  it('fails when free % is below threshold', async () => {
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        ['systemctl is-active', { stdout: 'active\nactive\nactive\n0\n' }],
        [/ss -tln|netstat/, { stdout: LISTENING_ALL }],
        ['stat -c', { stdout: STAT_GOOD }],
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_5PCT_FREE }],
        [/journalctl/, { stdout: '0\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.sections.disk.status, 'failed');
    const check = report.sections.disk.checks[0];
    assert.strictEqual(check.free_pct, 5);
    assert.match(check.detail, /below min 20%/);
  });
});

describe('infra-scanner: crash-loop detection', () => {
  it('flags a service with too many restarts in the last hour', async () => {
    let svcCount = 0;
    const scanner = new InfraScanner({
      sshExecutor: () => async (cmd) => {
        if (cmd.includes('systemctl is-active')) return { stdout: 'active\nactive\n0\n', stderr: '', code: 0 };
        if (cmd.includes('ss -tln') || cmd.includes('netstat')) return { stdout: LISTENING_ALL, stderr: '', code: 0 };
        if (cmd.includes('stat -c')) return { stdout: STAT_GOOD, stderr: '', code: 0 };
        if (cmd.startsWith('curl -k')) return { stdout: '200', stderr: '', code: 0 };
        if (cmd.includes('df -P')) return { stdout: DF_20PCT_FREE, stderr: '', code: 0 };
        if (cmd.includes('journalctl')) {
          // 2nd service (crontech-api) is crash-looping: 42 restarts
          const count = svcCount === 1 ? '42\n' : '1\n';
          svcCount++;
          return { stdout: count, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.sections.crash_loop.status, 'failed');
    const loop = report.sections.crash_loop.checks.find((c) => !c.ok);
    assert.strictEqual(loop.restarts_last_hour, 42);
    assert.match(loop.detail, /CRASH LOOP/);
  });
});

describe('infra-scanner: wrong file ownership', () => {
  it('flags a path that is owned by the wrong user — the Caddy log-dir bug', async () => {
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        ['systemctl is-active', { stdout: 'active\nactive\nactive\n0\n' }],
        [/ss -tln|netstat/, { stdout: LISTENING_ALL }],
        ['stat -c', { stdout: STAT_WRONG_OWNER }], // owned by root, not caddy
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_20PCT_FREE }],
        [/journalctl/, { stdout: '0\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    assert.strictEqual(report.sections.paths.status, 'failed');
    const check = report.sections.paths.checks[0];
    assert.strictEqual(check.owner, 'root');
    assert.match(check.detail, /owner=root expected=caddy/);
    assert.match(check.detail, /group=root expected=caddy/);
  });
});

describe('infra-scanner: auth material is redacted from report', () => {
  it('never leaks token-shaped strings into the final JSON', async () => {
    const scanner = new InfraScanner({
      sshExecutor: makeSshExecutor([
        [
          'systemctl is-active',
          {
            // Malicious-looking output that would leak if we forgot to redact:
            stdout: 'active\nghp_leakedTokenValueThatShouldNotAppear12345\n',
          },
        ],
        [/ss -tln|netstat/, { stdout: LISTENING_ALL }],
        ['stat -c', { stdout: STAT_GOOD }],
        [/^curl -k /, { stdout: '200' }],
        [/df -P/, { stdout: DF_20PCT_FREE }],
        [/journalctl/, { stdout: '0\n' }],
      ]),
      httpProbe: async () => ({ ok: true, status: 200 }),
      tlsProbe: async () => ({ ok: true, days: 60 }),
    });
    const report = await scanner.scan(makeSpec());
    const serialised = JSON.stringify(report);
    assert.ok(
      !serialised.includes('ghp_leakedTokenValueThatShouldNotAppear12345'),
      'Scanner leaked a GitHub-PAT-shaped string into the report',
    );
    assert.ok(serialised.includes('[REDACTED]'));
  });
});

describe('infra-scanner: schema is valid JSON', () => {
  it('ships a parseable spec.schema.json', () => {
    const schemaPath = path.resolve(
      __dirname, '..', 'integrations', 'infra', 'spec.schema.json',
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.strictEqual(schema.type, 'object');
    assert.deepStrictEqual(schema.required, ['host', 'ssh_user']);
    assert.ok(schema.properties.services);
    assert.ok(schema.properties.crash_loop);
  });
});
