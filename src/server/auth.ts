/**
 * Authentication utilities
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';

export type UserRole = 'corporate' | 'government_agency' | 'verifier' | 'portal_manager';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  did?: string;
  created_at: Date;
  name?: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateMFACode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// In-memory MFA store (tokens expire in 5 min)
const mfaPending = new Map<string, { userId: string; code: string; expiresAt: number }>();

export function storeMFACode(userId: string, code: string): string {
  const tempToken = crypto.randomBytes(16).toString('hex');
  mfaPending.set(tempToken, {
    userId,
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return tempToken;
}

export function verifyMFACode(tempToken: string, code: string): string | null {
  const entry = mfaPending.get(tempToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    mfaPending.delete(tempToken);
    return null;
  }
  if (entry.code !== code) return null;
  mfaPending.delete(tempToken);
  return entry.userId;
}

export async function createSession(userId: string, role: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO sessions (token, user_id, role, expires_at) VALUES ($1, $2, $3, $4)',
    [token, userId, role, expiresAt]
  );
  return token;
}

export async function getSession(token: string): Promise<{ userId: string; role: string } | null> {
  const result = await query(
    'SELECT user_id, role FROM sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  if (result.rows.length === 0) return null;
  return { userId: result.rows[0].user_id, role: result.rows[0].role };
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}
