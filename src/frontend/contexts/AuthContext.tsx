import React, { createContext, useContext, useState, useEffect } from 'react';

const API_BASE = '/api';

export type UserRole = 'corporate' | 'government_agency' | 'verifier' | 'portal_manager';

interface User {
  id: string;
  email: string;
  role: UserRole;
  did?: string;
  name?: string;
  authority_type?: string;
  sub_role?: string | null;
  org_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role: UserRole, name?: string, authority_type?: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${storedToken}` } })
        .then(r => r.json())
        .then(data => {
          if (data.success) { setToken(storedToken); setUser(data.user); }
          else localStorage.removeItem('auth_token');
        })
        .catch(() => localStorage.removeItem('auth_token'))
        .finally(() => setLoading(false));
    } else { setLoading(false); }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    redirectByRole(data.user.role, data.user.sub_role);
  };

  const register = async (email: string, password: string, role: UserRole, name?: string, authority_type?: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role, name, authority_type }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_token', data.token);
    redirectByRole(role);
  };

  const logout = () => {
    if (token) fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    setToken(null); setUser(null);
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  };

  function redirectByRole(role: UserRole, subRole?: string | null) {
    setTimeout(() => {
      if (role === 'portal_manager') window.location.href = '/portal/dashboard';
      else if (role === 'corporate' && subRole === 'authorized_signatory') window.location.href = '/corporate/signatory';
      else if (role === 'corporate') window.location.href = '/corporate/dashboard';
      else if (role === 'government_agency') window.location.href = '/authority/dashboard';
      else window.location.href = '/verifier/dashboard';
    }, 100);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
