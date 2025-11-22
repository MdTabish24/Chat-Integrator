import { Router } from 'express';
import authController from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', (req, res) => authController.register(req, res));

/**
 * @route   POST /api/auth/login
 * @desc    Login user and get tokens
 * @access  Public
 */
router.post('/login', (req, res) => authController.login(req, res));

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', (req, res) => authController.refresh(req, res));

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user and revoke refresh token
 * @access  Public
 */
router.post('/logout', (req, res) => authController.logout(req, res));

/**
 * @route   GET /api/auth/me
 * @desc    Get current user info
 * @access  Protected
 */
router.get('/me', authenticateToken, (req, res) => authController.getCurrentUser(req, res));

export default router;
