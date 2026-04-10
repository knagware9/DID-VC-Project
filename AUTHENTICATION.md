# Authentication & User Management

## Overview

The DID VC Platform now includes a complete authentication system with separate registration and login pages for Issuers, Holders, and Verifiers, along with role-specific dashboards.

## Features

- ✅ **User Registration** - Register as Issuer, Holder, or Verifier
- ✅ **User Login** - Secure login with email and password
- ✅ **Role-Based Access Control** - Each role has its own dashboard
- ✅ **Protected Routes** - Dashboards are only accessible to authenticated users
- ✅ **Session Management** - Token-based authentication with 7-day sessions
- ✅ **Automatic DID Generation** - DIDs are created automatically upon registration

## User Roles

### Issuer
- Can issue verifiable credentials
- Has access to Issuer Dashboard
- Automatically gets a DID upon registration

### Holder
- Can store credentials
- Can create verifiable presentations
- Has access to Holder Dashboard
- Automatically gets a DID upon registration

### Verifier
- Can verify credentials and presentations
- Has access to Verifier Dashboard
- Gets a Verifier ID upon registration

## Authentication Flow

### Registration
1. User visits `/register` or `/register?role=issuer` (or holder/verifier)
2. Fills in registration form:
   - Role selection (Issuer/Holder/Verifier)
   - Name (optional)
   - Email
   - Password (minimum 6 characters)
   - Confirm Password
3. Upon successful registration:
   - User account is created
   - DID/Verifier ID is generated automatically
   - User is logged in automatically
   - Redirected to their role-specific dashboard

### Login
1. User visits `/login?role=issuer` (or holder/verifier)
2. Enters email and password
3. Upon successful login:
   - Session token is created (valid for 7 days)
   - User is redirected to their role-specific dashboard

### Logout
- Click "Logout" button in navbar
- Session token is invalidated
- User is redirected to home page

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "role": "issuer",
    "name": "John Doe"
  }
  ```

- `POST /api/auth/login` - Login user
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

- `POST /api/auth/logout` - Logout (requires auth token)
  Headers: `Authorization: Bearer <token>`

- `GET /api/auth/me` - Get current user info (requires auth token)
  Headers: `Authorization: Bearer <token>`

## Protected Routes

All dashboard routes require authentication:
- `/issuer/dashboard` - Requires issuer role
- `/holder/dashboard` - Requires holder role
- `/verifier/dashboard` - Requires verifier role

If unauthenticated, users are redirected to login page.
If authenticated but wrong role, users are redirected to their own dashboard.

## Frontend Components

### AuthContext
- Provides authentication state management
- Handles login, register, logout
- Manages session tokens
- Auto-redirects after login/register

### ProtectedRoute
- Wraps protected components
- Checks authentication status
- Validates role permissions
- Redirects unauthorized users

### Pages
- `LoginPage` - Login form with role selection
- `RegisterPage` - Registration form
- `IssuerDashboard` - Issuer-specific dashboard
- `HolderDashboard` - Holder-specific dashboard
- `VerifierDashboard` - Verifier-specific dashboard

## Security Notes

- Passwords are hashed using SHA-256 (for demo purposes)
- Session tokens expire after 7 days
- All protected API endpoints require authentication token
- Tokens are stored in localStorage (consider httpOnly cookies for production)

## Usage Example

1. **Register as Issuer:**
   - Go to `/register?role=issuer`
   - Fill in details and submit
   - Automatically redirected to `/issuer/dashboard`

2. **Login as Holder:**
   - Go to `/login?role=holder`
   - Enter credentials
   - Redirected to `/holder/dashboard`

3. **Access Dashboard:**
   - Must be logged in
   - Must have correct role
   - Can issue/store/verify credentials based on role

## Next Steps

For production use, consider:
- Using bcrypt or Argon2 for password hashing
- Implementing JWT tokens with refresh tokens
- Adding email verification
- Adding password reset functionality
- Using httpOnly cookies for token storage
- Implementing rate limiting on auth endpoints
- Adding 2FA/MFA support

