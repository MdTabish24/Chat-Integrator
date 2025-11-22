import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { AuthTokens, JWTPayload, User } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days
const SALT_ROUNDS = 10;

export class AuthService {
  /**
   * Register a new user
   */
  async register(email: string, password: string): Promise<User> {
    // Validate input
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id, email, created_at, updated_at`,
      [email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    return {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  /**
   * Login user and generate tokens
   */
  async login(email: string, password: string): Promise<{ user: User; tokens: AuthTokens }> {
    // Validate input
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    // Find user
    const result = await pool.query(
      'SELECT id, email, password_hash, created_at, updated_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      tokens,
    };
  }

  /**
   * Generate access and refresh tokens
   */
  async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JWTPayload = { userId, email };

    // Generate access token
    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    // Generate refresh token
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, refreshToken, expiresAt]
    );

    return { accessToken, refreshToken };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as JWTPayload;

      // Check if refresh token exists and is not revoked
      const result = await pool.query(
        `SELECT id, user_id, expires_at, revoked_at 
         FROM refresh_tokens 
         WHERE token = $1`,
        [refreshToken]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid refresh token');
      }

      const tokenRecord = result.rows[0];

      // Check if token is revoked
      if (tokenRecord.revoked_at) {
        throw new Error('Refresh token has been revoked');
      }

      // Check if token is expired
      if (new Date(tokenRecord.expires_at) < new Date()) {
        throw new Error('Refresh token has expired');
      }

      // Generate new tokens
      const newTokens = await this.generateTokens(decoded.userId, decoded.email);

      // Revoke old refresh token
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = $1',
        [refreshToken]
      );

      return newTokens;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Logout user by revoking refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = $1',
      [refreshToken]
    );
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Access token has expired');
      }
      throw new Error('Invalid access token');
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  }
}

export default new AuthService();
