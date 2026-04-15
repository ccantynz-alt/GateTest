const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TerraformModule = require('../src/modules/terraform');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new TerraformModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('TerraformModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no .tf files exist', async () => {
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'terraform:no-files'));
  });

  it('finds .tf, .tfvars, and .hcl', async () => {
    write(tmp, 'main.tf',          'resource "aws_vpc" "v" { cidr_block = "10.0.0.0/16" }\n');
    write(tmp, 'vars.tfvars',       'region = "us-east-1"\n');
    write(tmp, 'terragrunt.hcl',    'include "root" { path = find_in_parent_folders() }\n');
    const r = await run(tmp);
    const scanning = r.checks.find((c) => c.name === 'terraform:scanning');
    assert.match(scanning.message, /3 Terraform/);
  });

  it('excludes .terraform/ and node_modules/', async () => {
    write(tmp, '.terraform/modules/x/main.tf', 'resource "aws_s3_bucket" "b" { acl = "public-read" }');
    write(tmp, 'node_modules/x/main.tf',       'resource "aws_s3_bucket" "b" { acl = "public-read" }');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'terraform:no-files'));
  });
});

describe('TerraformModule — S3 public buckets', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-s3-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on public-read ACL', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket" "public" {',
      '  bucket = "my-public"',
      '  acl    = "public-read"',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('terraform:public-bucket:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on public-read-write ACL', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket_acl" "bad" {',
      '  bucket = aws_s3_bucket.main.id',
      '  acl    = "public-read-write"',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:public-bucket:')));
  });

  it('errors when public_access_block disables a guard', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket_public_access_block" "b" {',
      '  bucket                  = aws_s3_bucket.main.id',
      '  block_public_acls       = false',
      '  block_public_policy     = true',
      '  ignore_public_acls      = true',
      '  restrict_public_buckets = true',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:public-access-block-off:')));
  });

  it('accepts private ACL silently', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket" "private" {',
      '  bucket = "my-private"',
      '  acl    = "private"',
      '  tags = { Env = "prod" }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:public-bucket:')), undefined);
  });
});

describe('TerraformModule — wide-open security groups', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-sg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on SSH (port 22) open to 0.0.0.0/0', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_security_group" "ssh" {',
      '  name = "ssh-all"',
      '  ingress {',
      '    from_port   = 22',
      '    to_port     = 22',
      '    protocol    = "tcp"',
      '    cidr_blocks = ["0.0.0.0/0"]',
      '  }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('terraform:open-port:ssh:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on Postgres (port 5432) open to 0.0.0.0/0', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_security_group" "pg" {',
      '  name = "pg-all"',
      '  ingress {',
      '    from_port   = 5432',
      '    to_port     = 5432',
      '    protocol    = "tcp"',
      '    cidr_blocks = ["0.0.0.0/0"]',
      '  }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:open-port:postgres:')));
  });

  it('accepts port 443 open to the world (legitimate HTTPS)', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_security_group" "web" {',
      '  name = "web"',
      '  ingress {',
      '    from_port   = 443',
      '    to_port     = 443',
      '    protocol    = "tcp"',
      '    cidr_blocks = ["0.0.0.0/0"]',
      '  }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:open-port:')), undefined);
  });

  it('accepts SSH restricted to a private CIDR', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_security_group" "ssh" {',
      '  name = "ssh-bastion"',
      '  ingress {',
      '    from_port   = 22',
      '    to_port     = 22',
      '    protocol    = "tcp"',
      '    cidr_blocks = ["10.0.0.0/24"]',
      '  }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:open-port:')), undefined);
  });
});

describe('TerraformModule — encryption', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-enc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on RDS with storage_encrypted = false', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_db_instance" "bad" {',
      '  identifier          = "prod-db"',
      '  storage_encrypted   = false',
      '  tags                = { Env = "prod" }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('terraform:unencrypted:aws_db_instance:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('warns when encryption key is not set at all', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_ebs_volume" "x" {',
      '  availability_zone = "us-east-1a"',
      '  size              = 20',
      '  tags              = { Env = "prod" }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:unencrypted-missing:aws_ebs_volume:')));
  });

  it('accepts encrypted = true', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_ebs_volume" "x" {',
      '  availability_zone = "us-east-1a"',
      '  size              = 20',
      '  encrypted         = true',
      '  tags              = { Env = "prod" }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:unencrypted-missing:aws_ebs_volume:')), undefined);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:unencrypted:aws_ebs_volume:')), undefined);
  });
});

describe('TerraformModule — IAM wildcards + long-lived creds', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-iam-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on IAM policy with Allow + Principal "*"', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket_policy" "wildcard" {',
      '  bucket = aws_s3_bucket.main.id',
      '  policy = jsonencode({',
      '    Version = "2012-10-17",',
      '    Statement = [{',
      '      Effect    = "Allow",',
      '      Principal = "*",',
      '      Action    = "s3:GetObject",',
      '      Resource  = "*"',
      '    }]',
      '  })',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    // The jsonencode({...}) form doesn't produce "Effect": "Allow" string in
    // the HCL text — it produces Effect = "Allow". We test with the raw
    // JSON-in-HEREDOC form below, which matches the regex.
    // Force raw JSON form:
    write(tmp, 'main.tf', [
      'resource "aws_s3_bucket_policy" "wildcard" {',
      '  bucket = aws_s3_bucket.main.id',
      '  policy = <<POLICY',
      '{',
      '  "Version": "2012-10-17",',
      '  "Statement": [{',
      '    "Effect": "Allow",',
      '    "Principal": "*",',
      '    "Action": "s3:GetObject",',
      '    "Resource": "*"',
      '  }]',
      '}',
      'POLICY',
      '}',
    ].join('\n'));
    const r2 = await run(tmp);
    assert.ok(r2.checks.find((c) => c.name.startsWith('terraform:iam-wildcard:')));
  });

  it('warns on aws_iam_access_key resource (long-lived creds)', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_iam_access_key" "deploy" {',
      '  user = aws_iam_user.deploy.name',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:long-lived-iam:aws_iam_access_key:')));
  });
});

describe('TerraformModule — secrets + user_data', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-sec-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on hardcoded AWS access key', async () => {
    write(tmp, 'terraform.tfvars', 'aws_access_key = "AKIAIOSFODNN7EXAMPLE"\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:hardcoded-secret:aws-key:')));
  });

  it('warns on user_data piping curl to shell', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_instance" "web" {',
      '  ami           = "ami-123"',
      '  instance_type = "t3.small"',
      '  tags          = { Env = "prod" }',
      '  user_data = <<EOF',
      '#!/bin/bash',
      'curl -sSL https://example.com/bootstrap.sh | bash',
      'EOF',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:user-data-curl-pipe:')));
  });
});

describe('TerraformModule — tags', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-tags-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns when a tagged-required resource has no tags', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_instance" "untagged" {',
      '  ami           = "ami-123"',
      '  instance_type = "t3.small"',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('terraform:no-tags:aws_instance:')));
  });

  it('does not flag when tags are present', async () => {
    write(tmp, 'main.tf', [
      'resource "aws_instance" "tagged" {',
      '  ami           = "ami-123"',
      '  instance_type = "t3.small"',
      '  tags          = { Env = "prod", Owner = "team-a" }',
      '}',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('terraform:no-tags:')), undefined);
  });
});

describe('TerraformModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tf-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 'main.tf', 'resource "aws_vpc" "v" { cidr_block = "10.0.0.0/16" }\n');
    const r = await run(tmp);
    const summary = r.checks.find((c) => c.name === 'terraform:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 file\(s\)/);
  });
});
