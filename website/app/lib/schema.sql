CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  payment_intent_id TEXT,
  customer_email TEXT,
  repo_url TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Results (JSONB, no more 500-char Stripe metadata limit)
  results JSONB,
  summary TEXT,
  score INTEGER,

  -- Cost tracking
  ai_cost_usd NUMERIC(10,4),
  tier_price_usd NUMERIC(10,2),

  -- Metadata
  modules_run TEXT[],
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  github_login TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  total_scans INTEGER DEFAULT 0,
  total_spent_usd NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS installations (
  id BIGSERIAL PRIMARY KEY,
  host TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  customer_email TEXT,
  customer_login TEXT,
  setup_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (host, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_scans_session ON scans(session_id);
CREATE INDEX IF NOT EXISTS idx_scans_email ON scans(customer_email);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_github ON customers(github_login);
CREATE INDEX IF NOT EXISTS idx_installations_host_id ON installations(host, installation_id);
CREATE INDEX IF NOT EXISTS idx_installations_customer_email ON installations(customer_email);
