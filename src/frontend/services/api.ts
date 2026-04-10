const API_BASE = '/api';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function req(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  async register(email: string, password: string, role: string, name?: string) {
    return req(`${API_BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role, name }) });
  },
  async login(email: string, password: string) {
    return req(`${API_BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  },
  async verifyMFA(tempToken: string, code: string) {
    return req(`${API_BASE}/auth/verify-mfa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tempToken, code }) });
  },
  async logout(token: string) {
    return req(`${API_BASE}/auth/logout`, { method: 'POST', headers: authHeaders(token) });
  },
  async getCurrentUser(token: string) {
    return req(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  },

  // DIDs
  async getMyDIDs(token: string) { return req(`${API_BASE}/dids/my`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getDIDDocument(did: string) { return req(`${API_BASE}/dids/${encodeURIComponent(did)}/document`); },

  // Employees
  async getEmployees(token: string) { return req(`${API_BASE}/dids/employees`, { headers: { Authorization: `Bearer ${token}` } }); },
  async createEmployee(token: string, data: { employeeId: string; name: string; email: string }) {
    return req(`${API_BASE}/dids/employees`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },
  async bulkCreateEmployees(token: string, employees: any[]) {
    return req(`${API_BASE}/dids/employees/bulk`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ employees }) });
  },

  // VC Requests
  async submitVCRequest(token: string, data: { credentialType: string; requestData: any; targetIssuerId?: string }) {
    return req(`${API_BASE}/vc-requests`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },
  async getMyVCRequests(token: string) { return req(`${API_BASE}/vc-requests/my`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getPendingRequests(token: string) { return req(`${API_BASE}/vc-requests/pending`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getIssuedRequests(token: string) { return req(`${API_BASE}/vc-requests/issued`, { headers: { Authorization: `Bearer ${token}` } }); },
  async approveVCRequest(token: string, id: string) {
    return req(`${API_BASE}/vc-requests/${id}/approve`, { method: 'POST', headers: authHeaders(token) });
  },
  async rejectVCRequest(token: string, id: string, reason: string) {
    return req(`${API_BASE}/vc-requests/${id}/reject`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason }) });
  },

  // Credentials
  async getMyCredentials(token: string) { return req(`${API_BASE}/credentials/my`, { headers: { Authorization: `Bearer ${token}` } }); },

  // Corporate Internal Issuance
  async issueToEmployee(token: string, data: { employeeRegistryId: string; credentialTemplate: string; credentialData: any }) {
    return req(`${API_BASE}/corporate/issue-to-employee`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },
  async getIssuedByMe(token: string) { return req(`${API_BASE}/corporate/issued`, { headers: { Authorization: `Bearer ${token}` } }); },
  async revokeCredential(token: string, credentialId: string) {
    return req(`${API_BASE}/corporate/revoke/${credentialId}`, { method: 'POST', headers: authHeaders(token) });
  },

  // VP Composition
  async composeVP(token: string, data: { credentialIds: string[]; selectedFields?: Record<string, string[]>; verifierRequestId?: string; purpose?: string }) {
    return req(`${API_BASE}/presentations/compose`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },
  async getPresentation(token: string, id: string) { return req(`${API_BASE}/presentations/${id}`, { headers: { Authorization: `Bearer ${token}` } }); },

  // Verifier
  async requestProof(token: string, requiredCredentialTypes: string[], holderDid?: string) {
    return req(`${API_BASE}/verifier/request-proof`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ requiredCredentialTypes, holderDid }) });
  },
  async getMyVerificationRequests(token: string) { return req(`${API_BASE}/holder/verification-requests`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getVerificationRequests(token: string) { return req(`${API_BASE}/verifier/requests`, { headers: { Authorization: `Bearer ${token}` } }); },
  async approveVerification(token: string, id: string) {
    return req(`${API_BASE}/verifier/requests/${id}/approve`, { method: 'POST', headers: authHeaders(token) });
  },
  async rejectVerification(token: string, id: string, reason: string) {
    return req(`${API_BASE}/verifier/requests/${id}/reject`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason }) });
  },

  // Audit
  async getAuditLogs(token: string, limit = 50) { return req(`${API_BASE}/audit-logs?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } }); },

  // Polygon
  async getPolygonStatus(token: string) { return req(`${API_BASE}/polygon/status`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getPolygonNetwork() { return req(`${API_BASE}/polygon/network`); },

  // Users (for issuer/holder selection)
  async getHolders(token: string) { return req(`${API_BASE}/users/holders`, { headers: { Authorization: `Bearer ${token}` } }); },
  async getIssuers(token: string) { return req(`${API_BASE}/users/issuers`, { headers: { Authorization: `Bearer ${token}` } }); },

  // Direct credential issuance
  async issueDirectCredential(token: string, data: { holderDid: string; credentialType: string; credentialSubject: object; expiresAt?: string }) {
    return req(`${API_BASE}/credentials/issue-direct`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },

  // QR sharing
  async createShareQR(token: string, credentialId: string) {
    return req(`${API_BASE}/credentials/${credentialId}/share-qr`, { method: 'POST', headers: authHeaders(token) });
  },
  async getSharedCredential(shareToken: string) { return req(`${API_BASE}/share/${shareToken}`); },

  // DID-based sharing
  async shareToDID(token: string, data: { credentialIds: string[]; verifierDid: string; purpose?: string }) {
    return req(`${API_BASE}/presentations/share-to-did`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(data) });
  },
  async getSharedPresentations(token: string) { return req(`${API_BASE}/verifier/shared-presentations`, { headers: { Authorization: `Bearer ${token}` } }); },
};
