/**
 * Facebook Sidecar Manager
 * Automatically manages the Python sidecar process for Facebook Messenger Private API
 * 
 * Features:
 * - Auto-starts sidecar when app launches
 * - Auto-installs Python dependencies if needed
 * - Health checks and auto-restart
 * - Graceful shutdown on app exit
 */

import { spawn, ChildProcess, execSync, SpawnOptions } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import axios from 'axios';
import { fileURLToPath } from 'url';

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIDECAR_PORT = 5001;
const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const HEALTH_CHECK_INTERVAL = 60000; // 60 seconds

// Windows CREATE_NO_WINDOW flag
const CREATE_NO_WINDOW = 0x08000000;
const MAX_START_RETRIES = 3;
const MAX_HEALTH_CHECK_FAILURES = 3;

class FacebookSidecarManager {
    private process: ChildProcess | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private isStarting: boolean = false;
    private startRetries: number = 0;
    private healthCheckFailures: number = 0;
    private sidecarPath: string;
    private pythonPath: string | null = null;

    constructor() {
        console.log('[FacebookSidecarManager] Initializing...');
        console.log('[FacebookSidecarManager] __dirname:', __dirname);
        console.log('[FacebookSidecarManager] app.isPackaged:', app.isPackaged);
        console.log('[FacebookSidecarManager] process.resourcesPath:', process.resourcesPath);
        console.log('[FacebookSidecarManager] app.getAppPath():', app.getAppPath());

        if (app.isPackaged) {
            // In production, sidecar is in resources folder
            this.sidecarPath = path.join(process.resourcesPath, 'facebook-sidecar');

            // Fallback: check next to exe
            if (!fs.existsSync(this.sidecarPath)) {
                const exeDir = path.dirname(process.execPath);
                const fallbackPath = path.join(exeDir, 'resources', 'facebook-sidecar');
                console.log('[FacebookSidecarManager] Primary path not found, trying fallback:', fallbackPath);
                if (fs.existsSync(fallbackPath)) {
                    this.sidecarPath = fallbackPath;
                }
            }
        } else {
            // In development/npm start - go up from dist/main/main/services to project root
            this.sidecarPath = path.join(__dirname, '../../../../facebook-sidecar');
        }

        console.log('[FacebookSidecarManager] Final sidecarPath:', this.sidecarPath);

        // Check if sidecar directory exists
        const sidecarExists = fs.existsSync(this.sidecarPath);
        console.log('[FacebookSidecarManager] sidecarPath exists:', sidecarExists);

        if (sidecarExists) {
            try {
                const contents = fs.readdirSync(this.sidecarPath);
                console.log('[FacebookSidecarManager] sidecarPath contents:', contents);

                // Check venv
                const venvPath = path.join(this.sidecarPath, 'venv');
                const venvExists = fs.existsSync(venvPath);
                console.log('[FacebookSidecarManager] venv exists:', venvExists);
            } catch (e: any) {
                console.error('[FacebookSidecarManager] Error listing sidecar contents:', e.message);
            }
        }
    }

    /**
     * Find Python executable
     */
    private findPython(): string | null {
        const possiblePaths = [
            // Check venv first
            path.join(this.sidecarPath, 'venv', 'Scripts', 'python.exe'),
            path.join(this.sidecarPath, 'venv', 'bin', 'python'),
            path.join(this.sidecarPath, 'venv', 'bin', 'python3'),
            // System Python
            'python',
            'python3',
            'py',
        ];

        for (const pythonPath of possiblePaths) {
            try {
                if (pythonPath.includes(this.sidecarPath)) {
                    // Check if file exists for venv paths
                    if (fs.existsSync(pythonPath)) {
                        return pythonPath;
                    }
                } else {
                    // Check if command exists for system paths
                    execSync(`${pythonPath} --version`, { stdio: 'ignore' });
                    return pythonPath;
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    /**
     * Check if sidecar dependencies are installed
     */
    private async checkDependencies(): Promise<boolean> {
        const venvPython = path.join(
            this.sidecarPath,
            process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python'
        );

        if (!fs.existsSync(venvPython)) {
            return false;
        }

        // In packaged app, venv is bundled - skip slow import check
        if (app.isPackaged) {
            console.log('[FacebookSidecarManager] Packaged app - skipping dependency check');
            return true;
        }

        // In development, do full check
        try {
            execSync(`"${venvPython}" -c "import fastapi; import uvicorn"`, {
                stdio: 'ignore',
                cwd: this.sidecarPath,
                timeout: 10000,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Install sidecar dependencies
     */
    private async installDependencies(): Promise<boolean> {
        console.log('[FacebookSidecarManager] Installing dependencies...');

        const systemPython = this.findPython();
        if (!systemPython) {
            console.error('[FacebookSidecarManager] Python not found! Please install Python 3.9+');
            return false;
        }

        try {
            // Create venv if not exists
            const venvPath = path.join(this.sidecarPath, 'venv');
            if (!fs.existsSync(venvPath)) {
                console.log('[FacebookSidecarManager] Creating virtual environment...');
                execSync(`"${systemPython}" -m venv venv`, {
                    cwd: this.sidecarPath,
                    stdio: 'ignore',
                    windowsHide: true,
                });
            }

            // Get venv python path
            const venvPython = path.join(
                this.sidecarPath,
                process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python'
            );

            // Install requirements
            console.log('[FacebookSidecarManager] Installing Python packages...');
            execSync(`"${venvPython}" -m pip install -r requirements.txt --quiet`, {
                cwd: this.sidecarPath,
                stdio: 'ignore',
                windowsHide: true,
            });

            console.log('[FacebookSidecarManager] Dependencies installed successfully');
            return true;
        } catch (error: any) {
            console.error('[FacebookSidecarManager] Failed to install dependencies:', error.message);
            return false;
        }
    }

    /**
     * Check if sidecar is running
     */
    async isRunning(): Promise<boolean> {
        try {
            const response = await axios.get(`${SIDECAR_URL}/status`, { timeout: 2000 });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Start the sidecar process
     */
    async start(): Promise<boolean> {
        if (this.isStarting) {
            console.log('[FacebookSidecarManager] Already starting...');
            return false;
        }

        // Check if already running
        if (await this.isRunning()) {
            console.log('[FacebookSidecarManager] Sidecar already running');
            this.startHealthCheck();
            return true;
        }

        this.isStarting = true;

        try {
            // Check if sidecar directory exists
            if (!fs.existsSync(this.sidecarPath)) {
                console.error('[FacebookSidecarManager] Sidecar directory not found:', this.sidecarPath);
                this.isStarting = false;
                return false;
            }

            // Check/install dependencies
            const depsInstalled = await this.checkDependencies();
            if (!depsInstalled) {
                console.log('[FacebookSidecarManager] Dependencies not found, installing...');
                const installed = await this.installDependencies();
                if (!installed) {
                    this.isStarting = false;
                    return false;
                }
            }

            // Get Python path
            this.pythonPath = path.join(
                this.sidecarPath,
                process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python'
            );

            if (!fs.existsSync(this.pythonPath)) {
                console.error('[FacebookSidecarManager] Python not found in venv');
                this.isStarting = false;
                return false;
            }

            console.log('[FacebookSidecarManager] Starting sidecar process...');
            console.log('[FacebookSidecarManager] Python path:', this.pythonPath);
            console.log('[FacebookSidecarManager] Working directory:', this.sidecarPath);

            // Check if engine.py exists
            const enginePath = path.join(this.sidecarPath, 'engine.py');
            if (!fs.existsSync(enginePath)) {
                console.error('[FacebookSidecarManager] engine.py not found at:', enginePath);
                this.isStarting = false;
                return false;
            }
            console.log('[FacebookSidecarManager] engine.py found');

            // Spawn options - hide window on Windows
            const spawnOptions: SpawnOptions = {
                cwd: this.sidecarPath,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                windowsHide: true,
                shell: false,
            };

            // Start the process
            this.process = spawn(
                this.pythonPath,
                ['-m', 'uvicorn', 'engine:app', '--host', '127.0.0.1', '--port', String(SIDECAR_PORT)],
                spawnOptions
            );

            console.log('[FacebookSidecarManager] Process spawned with PID:', this.process.pid);

            // Handle stdout
            this.process.stdout?.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    console.log('[FacebookSidecar]', output);
                }
            });

            // Handle stderr
            this.process.stderr?.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    console.log('[FacebookSidecar STDERR]', output);
                }
            });

            // Handle process exit
            this.process.on('exit', (code) => {
                console.log('[FacebookSidecarManager] Process exited with code:', code);
                this.process = null;

                // Auto-restart if unexpected exit
                if (code !== 0 && this.startRetries < MAX_START_RETRIES) {
                    this.startRetries++;
                    console.log(`[FacebookSidecarManager] Restarting... (attempt ${this.startRetries}/${MAX_START_RETRIES})`);
                    setTimeout(() => this.start(), 3000);
                }
            });

            this.process.on('error', (error) => {
                console.error('[FacebookSidecarManager] Process error:', error.message);
            });

            // Wait for server to be ready
            const ready = await this.waitForReady(5000);

            if (ready) {
                console.log('[FacebookSidecarManager] Sidecar started successfully on port', SIDECAR_PORT);
                this.startRetries = 0;
                this.startHealthCheck();
            } else {
                console.error('[FacebookSidecarManager] Sidecar failed to start');
                this.stop();
            }

            this.isStarting = false;
            return ready;
        } catch (error: any) {
            console.error('[FacebookSidecarManager] Start error:', error.message);
            this.isStarting = false;
            return false;
        }
    }

    /**
     * Wait for sidecar to be ready
     */
    private async waitForReady(timeout: number): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            if (await this.isRunning()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        return false;
    }

    /**
     * Start health check timer
     */
    private startHealthCheck(): void {
        if (this.healthCheckTimer) {
            return;
        }

        this.healthCheckTimer = setInterval(async () => {
            if (this.process && !this.process.killed) {
                const running = await this.isRunning();
                if (!running) {
                    this.healthCheckFailures++;
                    console.log(`[FacebookSidecarManager] Health check failed (${this.healthCheckFailures}/${MAX_HEALTH_CHECK_FAILURES})`);
                } else {
                    if (this.healthCheckFailures > 0) {
                        console.log('[FacebookSidecarManager] Health check recovered');
                    }
                    this.healthCheckFailures = 0;
                }
            }
        }, HEALTH_CHECK_INTERVAL);
    }

    /**
     * Stop health check timer
     */
    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    /**
     * Stop the sidecar process
     */
    stop(): void {
        this.stopHealthCheck();
        this.startRetries = MAX_START_RETRIES; // Prevent auto-restart

        if (this.process) {
            console.log('[FacebookSidecarManager] Stopping sidecar...');

            // Kill process tree on Windows
            if (process.platform === 'win32') {
                try {
                    execSync(`taskkill /pid ${this.process.pid} /T /F`, { stdio: 'ignore' });
                } catch {
                    this.process.kill('SIGTERM');
                }
            } else {
                this.process.kill('SIGTERM');
            }

            this.process = null;
        }
    }

    /**
     * Get sidecar status
     */
    async getStatus(): Promise<{ running: boolean; connected: boolean; userId?: string; username?: string }> {
        try {
            const response = await axios.get(`${SIDECAR_URL}/status`, { timeout: 2000 });
            return {
                running: true,
                connected: response.data.connected,
                userId: response.data.user_id,
                username: response.data.username,
            };
        } catch {
            return { running: false, connected: false };
        }
    }

    /**
     * Login with cookies
     */
    async loginWithCookies(cookies: { c_user: string; xs: string; fr?: string; datr?: string }): Promise<any> {
        try {
            const response = await axios.post(`${SIDECAR_URL}/login-cookies`, cookies, { timeout: 30000 });
            return response.data;
        } catch (error: any) {
            console.error('[FacebookSidecarManager] Login error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Login with email/phone and password
     */
    async loginWithCredentials(email: string, password: string): Promise<any> {
        try {
            // Check if sidecar is running, if not try to start it
            let running = await this.isRunning();
            if (!running) {
                console.log('[FacebookSidecarManager] Sidecar not running, attempting to start...');
                const started = await this.start();
                if (!started) {
                    return { success: false, error: 'Facebook Private API server not running. Please restart the app.' };
                }
                // Wait a bit for sidecar to be ready
                await new Promise(resolve => setTimeout(resolve, 2000));
                running = await this.isRunning();
            }
            
            if (!running) {
                return { success: false, error: 'Facebook Private API server not running. Please restart the app.' };
            }
            
            const response = await axios.post(`${SIDECAR_URL}/login`, { 
                email, 
                password 
            }, { timeout: 60000 }); // 60 sec timeout for login
            return response.data;
        } catch (error: any) {
            console.error('[FacebookSidecarManager] Login credentials error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify OTP code
     */
    async verifyOtp(code: string): Promise<any> {
        try {
            const response = await axios.post(`${SIDECAR_URL}/verify-otp`, { code }, { timeout: 30000 });
            return response.data;
        } catch (error: any) {
            console.error('[FacebookSidecarManager] OTP verification error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Singleton instance
let sidecarManager: FacebookSidecarManager | null = null;

export function getFacebookSidecarManager(): FacebookSidecarManager {
    if (!sidecarManager) {
        sidecarManager = new FacebookSidecarManager();
    }
    return sidecarManager;
}

export { FacebookSidecarManager };
