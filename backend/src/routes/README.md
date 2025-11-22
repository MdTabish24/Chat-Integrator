# API Routes Documentation

## Authentication Routes

Base URL: `/api/auth`

### Register User
**POST** `/api/auth/register`

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "createdAt": "2025-11-21T10:00:00.000Z"
  },
  "tokens": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token"
  }
}
```

**Error Responses:**
- `400` - Validation error (invalid email format, password too short)
- `409` - User already exists
- `500` - Registration failed

---

### Login
**POST** `/api/auth/login`

Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "createdAt": "2025-11-21T10:00:00.000Z"
  },
  "tokens": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token"
  }
}
```

**Error Responses:**
- `400` - Validation error
- `401` - Invalid email or password

---

### Refresh Token
**POST** `/api/auth/refresh`

Get a new access token using a refresh token.

**Request Body:**
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

**Response (200 OK):**
```json
{
  "tokens": {
    "accessToken": "new-jwt-access-token",
    "refreshToken": "new-jwt-refresh-token"
  }
}
```

**Error Responses:**
- `400` - Validation error
- `401` - Invalid, expired, or revoked refresh token

---

### Logout
**POST** `/api/auth/logout`

Logout and revoke the refresh token.

**Request Body:**
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

**Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses:**
- `400` - Validation error
- `500` - Logout failed

---

### Get Current User
**GET** `/api/auth/me`

Get information about the currently authenticated user.

**Headers:**
```
Authorization: Bearer <access-token>
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `401` - No token provided or user not authenticated
- `403` - Invalid or expired token

---

## Using Protected Routes

To access protected routes, include the access token in the Authorization header:

```
Authorization: Bearer <your-access-token>
```

### Token Expiry
- **Access Token**: 15 minutes
- **Refresh Token**: 7 days

When the access token expires, use the refresh token to get a new access token via the `/api/auth/refresh` endpoint.

### Security Notes
- Passwords must be at least 8 characters long
- Passwords are hashed using bcrypt with 10 salt rounds
- Refresh tokens are stored in the database and can be revoked
- All tokens are invalidated on logout
- JWT secrets should be changed in production (set via environment variables)
