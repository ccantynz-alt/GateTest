/**
 * CI/CD Config Generator - Generates pipeline configs with GateTest integrated.
 * Supports GitHub Actions, GitLab CI, and CircleCI.
 */

const fs = require('fs');
const path = require('path');

class CiGenerator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  generate(type) {
    switch (type) {
      case 'github': return this._github();
      case 'gitlab': return this._gitlab();
      case 'circleci': return this._circleci();
      default:
        throw new Error(`Unknown CI type: ${type}. Supported: github, gitlab, circleci`);
    }
  }

  _github() {
    const dir = path.join(this.projectRoot, '.github', 'workflows');
    fs.mkdirSync(dir, { recursive: true });

    const config = `name: GateTest Quality Gate
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  security-events: write

jobs:
  gatetest:
    name: Quality Gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: GateTest - Quick Suite
        if: github.event_name == 'pull_request'
        run: npx gatetest --suite quick --diff --sarif --junit

      - name: GateTest - Full Suite
        if: github.event_name == 'push'
        run: npx gatetest --suite full --sarif --junit

      - name: Upload SARIF to GitHub Security
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .gatetest/reports/gatetest-results.sarif
          category: gatetest

      - name: Upload JUnit Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: gatetest-results
          path: |
            .gatetest/reports/gatetest-results.xml
            .gatetest/reports/gatetest-report-latest.json
            .gatetest/reports/gatetest-report.html

      - name: Publish Test Results
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: GateTest Results
          path: .gatetest/reports/gatetest-results.xml
          reporter: java-junit

  security-scan:
    name: Security Deep Scan
    runs-on: ubuntu-latest
    needs: gatetest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx gatetest --module security --module secrets --sarif
      - name: Upload Security SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .gatetest/reports/gatetest-results.sarif
          category: gatetest-security

  performance:
    name: Performance Budget
    runs-on: ubuntu-latest
    needs: gatetest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx gatetest --module performance --module accessibility
`;

    const outPath = path.join(dir, 'gatetest.yml');
    fs.writeFileSync(outPath, config);
    return outPath;
  }

  _gitlab() {
    const config = `stages:
  - quality
  - security
  - performance

gatetest:quick:
  stage: quality
  image: node:20
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npm ci
    - npx gatetest --suite quick --diff --junit
  artifacts:
    when: always
    reports:
      junit: .gatetest/reports/gatetest-results.xml
    paths:
      - .gatetest/reports/

gatetest:full:
  stage: quality
  image: node:20
  rules:
    - if: '$CI_COMMIT_BRANCH == "main" || $CI_COMMIT_BRANCH == "master"'
  script:
    - npm ci
    - npx gatetest --suite full --junit --sarif
  artifacts:
    when: always
    reports:
      junit: .gatetest/reports/gatetest-results.xml
    paths:
      - .gatetest/reports/

gatetest:security:
  stage: security
  image: node:20
  script:
    - npm ci
    - npx gatetest --module security --module secrets
  allow_failure: false

gatetest:performance:
  stage: performance
  image: node:20
  script:
    - npm ci
    - npx gatetest --module performance --module accessibility
`;

    const outPath = path.join(this.projectRoot, '.gitlab-ci.yml');
    fs.writeFileSync(outPath, config);
    return outPath;
  }

  _circleci() {
    const dir = path.join(this.projectRoot, '.circleci');
    fs.mkdirSync(dir, { recursive: true });

    const config = `version: 2.1

executors:
  node:
    docker:
      - image: cimg/node:20.0
    working_directory: ~/project

jobs:
  gatetest:
    executor: node
    steps:
      - checkout
      - restore_cache:
          keys:
            - deps-{{ checksum "package-lock.json" }}
      - run: npm ci
      - save_cache:
          key: deps-{{ checksum "package-lock.json" }}
          paths:
            - node_modules
      - run:
          name: GateTest Quality Gate
          command: npx gatetest --suite full --junit --sarif
      - store_test_results:
          path: .gatetest/reports
      - store_artifacts:
          path: .gatetest/reports
          destination: gatetest-reports

  security:
    executor: node
    steps:
      - checkout
      - run: npm ci
      - run:
          name: Security Scan
          command: npx gatetest --module security --module secrets

workflows:
  quality-pipeline:
    jobs:
      - gatetest
      - security:
          requires:
            - gatetest
`;

    const outPath = path.join(dir, 'config.yml');
    fs.writeFileSync(outPath, config);
    return outPath;
  }
}

module.exports = { CiGenerator };
