-- DID-VC Platform Database Schema

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('corporate', 'government_agency', 'verifier')),
  name VARCHAR(255),
  mfa_secret VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  authority_type          VARCHAR(30)
                          CONSTRAINT chk_users_authority_type
                          CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'))
);

CREATE TABLE IF NOT EXISTS dids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_string VARCHAR(500) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  did_type VARCHAR(20) NOT NULL CHECK (did_type IN ('parent', 'sub')),
  parent_did_id UUID REFERENCES dids(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  sub_did_id UUID REFERENCES dids(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(corporate_user_id, employee_id)
);

CREATE TABLE IF NOT EXISTS vc_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_did_id UUID REFERENCES dids(id),
  issuer_user_id UUID REFERENCES users(id),
  credential_type VARCHAR(100) NOT NULL,
  request_data JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vc_json JSONB NOT NULL,
  holder_did_id UUID REFERENCES dids(id),
  issuer_did_id UUID REFERENCES dids(id),
  credential_type VARCHAR(100),
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT FALSE,
  vc_request_id UUID REFERENCES vc_requests(id)
);

CREATE TABLE IF NOT EXISTS revocation_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_by_user_id UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verifier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_did_id UUID REFERENCES dids(id),
  required_credential_types TEXT[],
  challenge VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),
  presentation_id UUID,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vp_json JSONB NOT NULL,
  holder_did_id UUID REFERENCES dids(id),
  verifier_request_id UUID REFERENCES verification_requests(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credential_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID REFERENCES credentials(id),
  presentation_json JSONB NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  scanned_count INTEGER DEFAULT 0
);

ALTER TABLE presentations ADD COLUMN IF NOT EXISTS direct_share_verifier_did VARCHAR(255);
ALTER TABLE presentations ADD COLUMN IF NOT EXISTS share_purpose VARCHAR(500);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_presentation' AND table_name = 'verification_requests'
  ) THEN
    ALTER TABLE verification_requests
      ADD CONSTRAINT fk_presentation
      FOREIGN KEY (presentation_id) REFERENCES presentations(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  actor_did VARCHAR(500),
  subject_did VARCHAR(500),
  credential_type_hash VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dids_user_id ON dids(user_id);
CREATE INDEX IF NOT EXISTS idx_dids_parent ON dids(parent_did_id);
CREATE INDEX IF NOT EXISTS idx_employee_corporate ON employee_registry(corporate_user_id);
CREATE INDEX IF NOT EXISTS idx_vc_requests_issuer ON vc_requests(issuer_user_id);
CREATE INDEX IF NOT EXISTS idx_vc_requests_status ON vc_requests(status);
CREATE INDEX IF NOT EXISTS idx_credentials_holder ON credentials(holder_did_id);
CREATE INDEX IF NOT EXISTS idx_credentials_revoked ON credentials(revoked);
CREATE INDEX IF NOT EXISTS idx_verification_requests_verifier ON verification_requests(verifier_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_credential_shares_token ON credential_shares(token);
CREATE INDEX IF NOT EXISTS idx_presentations_verifier_did ON presentations(direct_share_verifier_did);

CREATE TABLE IF NOT EXISTS organization_applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name                VARCHAR(255) NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  org_logo_url            TEXT,
  director_full_name      VARCHAR(255) NOT NULL,
  aadhaar_number          VARCHAR(12) NOT NULL,
  dob                     DATE NOT NULL,
  gender                  VARCHAR(20) NOT NULL,
  state                   VARCHAR(100) NOT NULL,
  pincode                 VARCHAR(10) NOT NULL,
  company_name            VARCHAR(255) NOT NULL,
  cin                     VARCHAR(21) NOT NULL,
  company_status          VARCHAR(50) NOT NULL,
  company_category        VARCHAR(100) NOT NULL,
  date_of_incorporation   DATE NOT NULL,
  pan_number              VARCHAR(10) NOT NULL,
  gstn                    VARCHAR(15) NOT NULL,
  ie_code                 VARCHAR(10) NOT NULL,
  director_name           VARCHAR(255) NOT NULL,
  din                     VARCHAR(20) NOT NULL,
  designation             VARCHAR(100) NOT NULL,
  signing_authority_level VARCHAR(100) DEFAULT 'Single Signatory',
  authority_verifications JSONB NOT NULL DEFAULT '{
    "mca":                {"status":"pending","verified_cin":false,"verified_company_name":false,"vc_id":null},
    "dgft":               {"status":"pending","verified_ie_code":false,"vc_id":null},
    "gstn_trust_anchor":  {"status":"pending","verified_gstn":false,"vc_id":null},
    "pan_trust_anchor":   {"status":"pending","verified_pan":false,"vc_id":null}
  }',
  application_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CONSTRAINT chk_org_app_status
                          CHECK (application_status IN ('pending', 'partial', 'complete', 'rejected')),
  rejection_reason        TEXT,
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Multi-authority trust stack: add authority_type to users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'authority_type'
  ) THEN
    ALTER TABLE users ADD COLUMN authority_type VARCHAR(30)
      CHECK (authority_type IN ('mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'));
  END IF;
END $$;

-- Phase 3A: Role hierarchy migrations

-- 1. Add sub_role column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'sub_role'
  ) THEN
    ALTER TABLE users ADD COLUMN sub_role VARCHAR(30)
      CONSTRAINT chk_users_sub_role CHECK (sub_role IN (
        'did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker',
        'super_admin', 'admin', 'operator', 'member'
      ));
  END IF;
END $$;

-- Ensure sub_role CHECK constraint has explicit name (find by column, not by auto-generated name)
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Find any existing CHECK constraint on the sub_role column (excluding our new one)
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'users'
    AND c.contype = 'c'
    AND a.attname = 'sub_role'
    AND c.conname != 'chk_users_sub_role'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(v_constraint_name);
    ALTER TABLE users ADD CONSTRAINT chk_users_sub_role CHECK (sub_role IN (
      'did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker',
      'super_admin', 'admin', 'operator', 'member'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE users ADD COLUMN org_id UUID REFERENCES users(id);
  END IF;
END $$;

-- Update role CHECK to include portal_manager (find by column, not by auto-generated name)
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Find any existing CHECK constraint on the role column (excluding our new one)
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'users'
    AND c.contype = 'c'
    AND a.attname = 'role'
    AND c.conname != 'chk_users_role'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_users_role' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role
      CHECK (role IN ('portal_manager', 'government_agency', 'corporate', 'verifier'));
  END IF;
END $$;

-- mc_actions table
CREATE TABLE IF NOT EXISTS mc_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type    VARCHAR(20) NOT NULL CHECK (resource_type IN ('vc_issuance', 'vp_share')),
  resource_id      UUID NOT NULL,
  org_id           UUID REFERENCES users(id),
  maker_id         UUID NOT NULL REFERENCES users(id),
  checker_id       UUID REFERENCES users(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  payload          JSONB NOT NULL DEFAULT '{}',
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- vp_requests table
CREATE TABLE IF NOT EXISTS vp_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_org_id  UUID REFERENCES users(id),
  verifier_id    UUID REFERENCES users(id),
  vc_ids         JSONB NOT NULL DEFAULT '[]',
  vp_json        JSONB,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'sent', 'rejected')),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mc_actions_resource ON mc_actions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_mc_actions_maker ON mc_actions(maker_id);
CREATE INDEX IF NOT EXISTS idx_mc_actions_status ON mc_actions(status);
CREATE INDEX IF NOT EXISTS idx_vp_requests_org ON vp_requests(holder_org_id);
CREATE INDEX IF NOT EXISTS idx_vp_requests_verifier ON vp_requests(verifier_id);

-- Portal Manager: update mc_actions resource_type constraint (full set, idempotent)
DO $$
BEGIN
  ALTER TABLE mc_actions DROP CONSTRAINT IF EXISTS mc_actions_resource_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Platform entities registry (DID issuers, VC issuers, Trust endorsers)
CREATE TABLE IF NOT EXISTS platform_entities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  entity_type      VARCHAR(30)  NOT NULL
                   CHECK (entity_type IN ('did_issuer', 'vc_issuer', 'trust_endorser')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'active', 'inactive', 'rejected')),
  user_id          UUID REFERENCES users(id),
  did              VARCHAR(255),
  onboarded_by     UUID REFERENCES users(id),
  activated_by     UUID REFERENCES users(id),
  notes            TEXT,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_entities_type   ON platform_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_platform_entities_status ON platform_entities(status);

-- Seed existing portal_manager accounts as super_admin
UPDATE users SET sub_role = 'super_admin'
WHERE role = 'portal_manager' AND sub_role IS NULL;

-- Maker-Checker for Issuers and Verifiers: expand mc_actions resource_type
DO $$
BEGIN
  ALTER TABLE mc_actions DROP CONSTRAINT IF EXISTS mc_actions_resource_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
ALTER TABLE mc_actions ADD CONSTRAINT mc_actions_resource_type_check
  CHECK (resource_type IN ('vc_issuance', 'vp_share', 'entity_onboarding', 'vc_request_approval', 'did_request_issuance'));

-- Government agency admins → super_admin with org_id=self
UPDATE users SET sub_role = 'super_admin', org_id = id
WHERE role = 'government_agency' AND sub_role IN ('did_issuer_admin', 'vc_issuer_admin');

-- Verifier admins → super_admin with org_id=self
UPDATE users SET sub_role = 'super_admin', org_id = id
WHERE role = 'verifier' AND sub_role IS NULL;

-- Polygon blockchain anchoring columns
ALTER TABLE dids ADD COLUMN IF NOT EXISTS polygon_tx_hash VARCHAR(66);
ALTER TABLE dids ADD COLUMN IF NOT EXISTS polygon_block_number INTEGER;

ALTER TABLE credentials ADD COLUMN IF NOT EXISTS polygon_tx_hash VARCHAR(66);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS polygon_vc_hash VARCHAR(64);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS polygon_block_number INTEGER;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS polygon_anchored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_credentials_polygon_tx ON credentials(polygon_tx_hash) WHERE polygon_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dids_polygon_tx        ON dids(polygon_tx_hash)        WHERE polygon_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credentials_vc_id      ON credentials((vc_json->>'id'));

-- Fix any government_agency users still using legacy sub_roles (re-run safe)
UPDATE users SET sub_role = 'super_admin', org_id = id
WHERE role = 'government_agency' AND sub_role IN ('did_issuer_admin', 'vc_issuer_admin')
  AND (org_id IS NULL OR org_id = id);

-- Fix government_agency super_admin users with no org_id (entity_onboarding race)
UPDATE users SET org_id = id
WHERE role = 'government_agency' AND sub_role = 'super_admin' AND org_id IS NULL;

-- Phase: requester & authorized_signatory roles
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_sub_role;
  ALTER TABLE users ADD CONSTRAINT chk_users_sub_role
    CHECK (sub_role IN (
      'did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker',
      'super_admin', 'admin', 'operator', 'member',
      'requester', 'authorized_signatory', 'employee'
    ));
END $$;

-- Employee portal: link employee_registry to a user account
ALTER TABLE employee_registry ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employee_registry_user_id ON employee_registry(user_id);

DO $$
BEGIN
  ALTER TABLE vc_requests DROP CONSTRAINT IF EXISTS vc_requests_status_check;
  ALTER TABLE vc_requests ADD CONSTRAINT vc_requests_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected'));
END $$;

ALTER TABLE vc_requests ADD COLUMN IF NOT EXISTS corp_status VARCHAR(30);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vc_requests_corp_status'
  ) THEN
    ALTER TABLE vc_requests ADD CONSTRAINT chk_vc_requests_corp_status
      CHECK (corp_status IN ('submitted','maker_reviewed','checker_approved','signatory_approved'));
  END IF;
END $$;
ALTER TABLE vc_requests ADD COLUMN IF NOT EXISTS corp_reviewer_id  UUID REFERENCES users(id);
ALTER TABLE vc_requests ADD COLUMN IF NOT EXISTS corp_checker_id   UUID REFERENCES users(id);
ALTER TABLE vc_requests ADD COLUMN IF NOT EXISTS corp_signatory_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_vc_requests_corp_status ON vc_requests(corp_status);

CREATE TABLE IF NOT EXISTS did_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id            UUID REFERENCES users(id),
  request_data      JSONB NOT NULL DEFAULT '{}',
  purpose           TEXT,
  corp_status       VARCHAR(30) NOT NULL DEFAULT 'submitted'
                    CONSTRAINT chk_did_requests_corp_status
                    CHECK (corp_status IN (
                      'submitted','maker_reviewed','checker_approved',
                      'signatory_approved','completed','rejected'
                    )),
  corp_reviewer_id  UUID REFERENCES users(id),
  corp_checker_id   UUID REFERENCES users(id),
  corp_signatory_id UUID REFERENCES users(id),
  created_did_id    UUID REFERENCES dids(id),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_did_requests_org         ON did_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_did_requests_requester   ON did_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_did_requests_corp_status ON did_requests(corp_status);

-- Employee credential sharing permissions (admin-granted)
CREATE TABLE IF NOT EXISTS employee_credential_permissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_registry_id UUID NOT NULL REFERENCES employee_registry(id) ON DELETE CASCADE,
  credential_type      VARCHAR(100) NOT NULL,
  granted_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_registry_id, credential_type)
);
CREATE INDEX IF NOT EXISTS idx_emp_cred_perms_registry
  ON employee_credential_permissions(employee_registry_id);
