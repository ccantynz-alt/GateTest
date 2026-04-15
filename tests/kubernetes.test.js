const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const KubernetesModule = require('../src/modules/kubernetes');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new KubernetesModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A "safe" pod: SHA-pinned image, limits, probes, non-root, no host ns.
const SAFE_POD = [
  'apiVersion: v1',
  'kind: Pod',
  'metadata:',
  '  name: web',
  'spec:',
  '  securityContext:',
  '    runAsNonRoot: true',
  '    runAsUser: 1000',
  '  containers:',
  '    - name: app',
  '      image: myrepo/app@sha256:deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeefde',
  '      securityContext:',
  '        allowPrivilegeEscalation: false',
  '        readOnlyRootFilesystem: true',
  '      resources:',
  '        limits:',
  '          cpu: 500m',
  '          memory: 256Mi',
  '        requests:',
  '          cpu: 100m',
  '          memory: 64Mi',
  '      readinessProbe:',
  '        httpGet: { path: /health, port: 8080 }',
  '      livenessProbe:',
  '        httpGet: { path: /alive, port: 8080 }',
  '',
].join('\n');

describe('KubernetesModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no manifests exist', async () => {
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'k8s:no-files'));
  });

  it('finds YAML files that declare apiVersion + kind', async () => {
    write(tmp, 'k8s/deployment.yaml', SAFE_POD);
    write(tmp, 'manifests/service.yml', [
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: s',
      'spec:',
      '  type: ClusterIP',
      '  ports: [{ port: 80 }]',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const scanning = r.checks.find((c) => c.name === 'k8s:scanning');
    assert.match(scanning.message, /2 Kubernetes/);
  });

  it('ignores YAML files without apiVersion+kind (e.g. plain config)', async () => {
    write(tmp, 'config.yaml', 'foo: bar\nbaz: qux\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'k8s:no-files'));
  });

  it('excludes .github/workflows/ (ciSecurity\'s job)', async () => {
    write(tmp, '.github/workflows/ci.yml', [
      'apiVersion: v1  # not actually K8s, but has the signals',
      'kind: Workflow',
      'name: ci',
      'on: push',
      'jobs: {}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'k8s:no-files'));
  });
});

describe('KubernetesModule — privileged + host namespaces', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-priv-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on privileged: true', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '      securityContext:',
      '        privileged: true',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('k8s:privileged:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on hostNetwork: true', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata: { name: bad }',
      'spec:',
      '  template:',
      '    spec:',
      '      hostNetwork: true',
      '      containers:',
      '        - name: app',
      '          image: alpine:3.19',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:hostnetwork:')));
  });

  it('errors on allowPrivilegeEscalation: true', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '      securityContext:',
      '        allowPrivilegeEscalation: true',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:privilege-escalation:')));
  });

  it('errors on runAsUser: 0', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  securityContext:',
      '    runAsUser: 0',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:run-as-root:')));
  });
});

describe('KubernetesModule — images', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-img-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on image :latest', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: nginx:latest',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:image-tag:')));
  });

  it('errors on tagless image', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: nginx',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:image-tag:')));
  });

  it('accepts SHA-pinned image silently', async () => {
    write(tmp, 'good.yaml', SAFE_POD);
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('k8s:image-tag:')), undefined);
  });
});

describe('KubernetesModule — dangerous mounts + caps', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-mount-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on docker.sock hostPath mount', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '  volumes:',
      '    - name: docker-sock',
      '      hostPath:',
      '        path: /var/run/docker.sock',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:dangerous-host-mount:')));
  });

  it('warns on capabilities.add: SYS_ADMIN', async () => {
    write(tmp, 'bad.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: bad }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '      securityContext:',
      '        capabilities:',
      '          add:',
      '            - SYS_ADMIN',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:dangerous-cap:SYS_ADMIN:')));
  });
});

describe('KubernetesModule — services + secrets', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-svc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on LoadBalancer without source ranges', async () => {
    write(tmp, 'svc.yaml', [
      'apiVersion: v1',
      'kind: Service',
      'metadata: { name: s }',
      'spec:',
      '  type: LoadBalancer',
      '  ports: [{ port: 80 }]',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:lb-open-world:')));
  });

  it('accepts LoadBalancer with loadBalancerSourceRanges', async () => {
    write(tmp, 'svc.yaml', [
      'apiVersion: v1',
      'kind: Service',
      'metadata: { name: s }',
      'spec:',
      '  type: LoadBalancer',
      '  ports: [{ port: 80 }]',
      '  loadBalancerSourceRanges:',
      '    - 10.0.0.0/24',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('k8s:lb-open-world:')), undefined);
  });

  it('warns on env value containing a credential-shaped secret', async () => {
    write(tmp, 'pod.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: p }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '      env:',
      '        - name: DATABASE_PASSWORD',
      '          value: hunter2SuperSecretValueABC123',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:inline-secret:')));
  });

  it('does not warn when secret is sourced from secretKeyRef', async () => {
    write(tmp, 'pod.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: p }',
      'spec:',
      '  containers:',
      '    - name: app',
      '      image: alpine:3.19',
      '      env:',
      '        - name: DATABASE_PASSWORD',
      '          valueFrom:',
      '            secretKeyRef:',
      '              name: db',
      '              key: password',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('k8s:inline-secret:')), undefined);
  });
});

describe('KubernetesModule — resource limits + probes', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-res-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns when a container has no resources.limits', async () => {
    write(tmp, 'pod.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: p }',
      'spec:',
      '  containers:',
      '    - name: nolimit',
      '      image: myrepo/app@sha256:deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeefde',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:no-limits:')));
  });

  it('warns when a container has no probes', async () => {
    write(tmp, 'pod.yaml', [
      'apiVersion: v1',
      'kind: Pod',
      'metadata: { name: p }',
      'spec:',
      '  containers:',
      '    - name: noprobe',
      '      image: myrepo/app@sha256:deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeefde',
      '      resources:',
      '        limits: { cpu: 100m, memory: 64Mi }',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('k8s:no-probes:')));
  });

  it('emits zero findings for the SAFE_POD baseline', async () => {
    write(tmp, 'pod.yaml', SAFE_POD);
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0, `unexpected findings: ${JSON.stringify(issues, null, 2)}`);
  });
});

describe('KubernetesModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-k8s-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 'pod.yaml', SAFE_POD);
    const r = await run(tmp);
    const summary = r.checks.find((c) => c.name === 'k8s:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 file\(s\)/);
  });
});
