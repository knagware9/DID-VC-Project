INSERT INTO users (email, password_hash, role, name)
VALUES (
  'portal@didvc.platform',
  '$2a$10$BXbRocEosFdIEKr9I31cq.rI3WLmgOXjB1JcVtry40xMTcDWJzItC',
  'portal_manager',
  'DID-VC Portal Manager'
) ON CONFLICT (email) DO NOTHING;
