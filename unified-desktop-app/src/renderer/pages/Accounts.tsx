import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useElectron } from '../contexts/ElectronContext';
import Header from '../components/Header';
import type { Platform, PlatformStatus } from '../types';

interface PlatformConfig {
  id: Platform;
  name: string;
  icon: string;
  color: string;
  description: string;
  authType: 'cookie' | 'qr' | 'token' | 'phone' | 'oauth';
  cookieFields?: string[];
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    color: 'bg-green-500',
    description: 'Connect via QR code scan',
    authType: 'qr',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    color: 'bg-blue-500',
    description: 'Connect via API credentials from my.telegram.org',
    authType: 'phone', // Uses GramJS MTProto
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: '🎮',
    color: 'bg-indigo-600',
    description: 'Connect with user token',
    authType: 'token',
  },
  {
    id: 'twitter',
    name: 'Twitter/X',
    icon: '🐦',
    color: 'bg-sky-500',
    description: 'Connect via browser login',
    authType: 'cookie',
    cookieFields: ['auth_token', 'ct0'],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '📸',
    color: 'bg-gradient-to-br from-purple-500 to-pink-500',
    description: 'Connect via Private API (fast) or Browser login',
    authType: 'instagram' as any, // Custom auth type for Instagram
    cookieFields: ['sessionid', 'csrftoken', 'ds_user_id'],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: '👤',
    color: 'bg-blue-600',
    description: 'Connect via Private API (fast) or Browser login',
    authType: 'facebook' as any, // Custom auth type for Facebook with Private API
    cookieFields: ['c_user', 'xs'],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: 'bg-blue-700',
    description: 'On-Device Bridge • Beeper/Texts.com style • Data stays local',
    authType: 'linkedin' as any, // Custom auth type for LinkedIn
    cookieFields: ['li_at', 'JSESSIONID'],
  },
  {
    id: 'teams' as Platform,
    name: 'Microsoft Teams',
    icon: '👥',
    color: 'bg-purple-600',
    description: 'Connect via Microsoft OAuth (work/school account)',
    authType: 'oauth' as any,
  },
  {
    id: 'gmail' as Platform,
    name: 'Gmail',
    icon: '📧',
    color: 'bg-red-500',
    description: 'Connect via Google OAuth (Primary inbox only)',
    authType: 'oauth' as any,
  },
];

const Accounts: React.FC = () => {
  const { isDark } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { isElectron, platformStatuses, connectPlatform, disconnectPlatform, refreshAllStatuses } = useElectron();
  const [connectingPlatform, setConnectingPlatform] = useState<Platform | null>(null);
  const [showModal, setShowModal] = useState<Platform | null>(null);
  const [modalData, setModalData] = useState<Record<string, string>>({});
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);

  // Refresh statuses on mount
  useEffect(() => {
    if (isElectron) {
      refreshAllStatuses();
    }
  }, [isElectron, refreshAllStatuses]);

  // Listen for WhatsApp QR code
  useEffect(() => {
    if (!isElectron || !(window.electronAPI as any).whatsapp) {
      console.log('[Accounts] WhatsApp API not available, isElectron:', isElectron);
      return;
    }

    console.log('[Accounts] Setting up WhatsApp QR listener...');

    const unsubQr = (window.electronAPI as any).whatsapp.onQrCode((data: { qrCode: string }) => {
      console.log('[Accounts] WhatsApp QR received in component!');
      console.log('[Accounts] QR data length:', data.qrCode?.length || 0);
      setWhatsappQr(data.qrCode);
      setShowModal('whatsapp');
      setConnectingPlatform(null);
    });

    const unsubStatus = (window.electronAPI as any).whatsapp.onStatusChange((data: { status: string }) => {
      console.log('[Accounts] WhatsApp status:', data.status);
      if (data.status === 'connected') {
        setWhatsappQr(null);
        setShowModal(null);
        showSuccess('WhatsApp connected!');
        refreshAllStatuses();
      }
    });

    console.log('[Accounts] WhatsApp listeners setup complete');

    return () => {
      console.log('[Accounts] Cleaning up WhatsApp listeners');
      unsubQr?.();
      unsubStatus?.();
    };
  }, [isElectron, refreshAllStatuses, showSuccess]);

  const handleConnect = async (platform: PlatformConfig) => {
    // Don't set loading for modal-based auth types
    if (platform.authType !== 'phone' && platform.authType !== 'token') {
      setConnectingPlatform(platform.id);
    }

    try {
      switch (platform.authType) {
        case 'qr':
          // WhatsApp - open QR code flow
          showInfo(`Initializing ${platform.name}...`);
          if (isElectron) {
            // Open modal immediately to show loading state
            setShowModal('whatsapp');
            setWhatsappQr(null); // Reset QR, will be set when received
            setConnectingPlatform(null);
            
            const result = await window.electronAPI.platform.connect(platform.id, {});
            if (result.success) {
              console.log('[Accounts] WhatsApp initialized, waiting for QR...');
              // QR will be shown via onQrCode listener
            } else {
              showError(result.error || 'Failed to initialize');
              setShowModal(null);
            }
          }
          break;

        case 'instagram':
          // Instagram - show login method selection modal
          setShowModal(platform.id);
          setModalData({ loginMethod: '' });
          setConnectingPlatform(null);
          return;

        case 'facebook':
          // Facebook - show login method selection modal (like Instagram)
          setShowModal(platform.id);
          setModalData({ loginMethod: '' });
          setConnectingPlatform(null);
          return;

        case 'linkedin':
          // LinkedIn - show Voyager API / Browser selection modal (like Instagram/Facebook)
          setShowModal(platform.id);
          setModalData({ loginMethod: '' });
          setConnectingPlatform(null);
          return;

        case 'phone':
          // Telegram - show phone input modal (no loading)
          setShowModal(platform.id);
          setModalData({});
          return; // Don't clear loading since we didn't set it

        case 'token':
          // Discord - open browser login
          showInfo(`Opening ${platform.name} login...`);
          if (isElectron && window.electronAPI.discord) {
            try {
              console.log('[Accounts] Calling discord.openLogin()');
              const result = await window.electronAPI.discord.openLogin();
              console.log('[Accounts] discord login result:', result);

              if (result?.success) {
                showSuccess(`Connected to ${platform.name}!`);
                refreshAllStatuses();
              } else {
                showError(result?.error || 'Login cancelled or failed');
              }
            } catch (err: any) {
              console.error('[Accounts] discord login error:', err);
              showError(err.message || 'Failed to open login window');
            }
          }
          break;

        case 'oauth':
          // OAuth-based platforms (Teams, Gmail)
          showInfo(`Opening ${platform.name} login...`);
          if (isElectron) {
            try {
              let result;
              if (platform.id === 'teams' && (window.electronAPI as any).teams) {
                console.log('[Accounts] Calling teams.openLogin()');
                result = await (window.electronAPI as any).teams.openLogin();
              } else if (platform.id === 'gmail' && (window.electronAPI as any).gmail) {
                console.log('[Accounts] Calling gmail.openLogin()');
                result = await (window.electronAPI as any).gmail.openLogin();
              }

              console.log(`[Accounts] ${platform.id} login result:`, result);

              if (result?.success) {
                showSuccess(`Connected to ${platform.name}!`);
                refreshAllStatuses();
              } else if (result?.error) {
                showError(result.error);
              }
              // Note: For Teams, window stays open for login - don't show error if no result
            } catch (err: any) {
              console.error(`[Accounts] ${platform.id} login error:`, err);
              showError(err.message || 'Failed to open login window');
            } finally {
              setConnectingPlatform(null);
            }
          }
          break;

        case 'cookie':
          // Cookie-based platforms - open browser login
          showInfo(`Opening ${platform.name} login...`);
          console.log(`[Accounts] Opening ${platform.id} login, isElectron:`, isElectron);
          console.log(`[Accounts] electronAPI available:`, !!window.electronAPI);
          console.log(`[Accounts] ${platform.id} API available:`, !!(window.electronAPI as any)?.[platform.id]);

          if (isElectron) {
            let result;
            try {
              if (platform.id === 'twitter' && window.electronAPI.twitter) {
                console.log('[Accounts] Calling twitter.openLogin()');
                result = await window.electronAPI.twitter.openLogin();
              } else if (platform.id === 'telegram' && window.electronAPI.telegram) {
                console.log('[Accounts] Calling telegram.openLogin()');
                result = await window.electronAPI.telegram.openLogin();
              } else if (platform.id === 'facebook' && window.electronAPI.facebook) {
                console.log('[Accounts] Calling facebook.openLogin()');
                result = await window.electronAPI.facebook.openLogin();
              } else if (platform.id === 'linkedin' && window.electronAPI.linkedin) {
                console.log('[Accounts] Calling linkedin.openLogin()');
                result = await window.electronAPI.linkedin.openLogin();
              } else {
                // Fallback - show cookie input modal
                console.log('[Accounts] No API for', platform.id, '- showing modal');
                setShowModal(platform.id);
                setModalData({});
                setConnectingPlatform(null);
                return;
              }

              console.log(`[Accounts] ${platform.id} login result:`, result);

              if (result?.success) {
                showSuccess(`Connected to ${platform.name}!`);
                refreshAllStatuses();
              } else {
                showError(result?.error || 'Login cancelled or failed');
              }
            } catch (err: any) {
              console.error(`[Accounts] ${platform.id} login error:`, err);
              showError(err.message || 'Failed to open login window');
            }
          }
          break;
      }
    } catch (error: any) {
      showError(error.message || `Failed to connect to ${platform.name}`);
    } finally {
      if (platform.authType !== 'phone' && platform.authType !== 'token' && platform.authType !== 'oauth') {
        setConnectingPlatform(null);
      }
    }
  };

  const handleDisconnect = async (platform: PlatformConfig) => {
    if (!confirm(`Disconnect from ${platform.name}? You'll need to reconnect to sync messages.`)) {
      return;
    }

    try {
      await disconnectPlatform(platform.id);
      showSuccess(`Disconnected from ${platform.name}`);
    } catch (error: any) {
      showError(error.message || `Failed to disconnect from ${platform.name}`);
    }
  };

  const handleModalSubmit = async () => {
    if (!showModal) return;

    const platform = PLATFORMS.find(p => p.id === showModal);
    if (!platform) return;

    setConnectingPlatform(showModal);

    try {
      let result;

      if (platform.authType === 'token' && platform.id === 'discord') {
        // Discord token
        if (!modalData.token) {
          showError('Please enter your Discord token');
          return;
        }
        result = await connectPlatform('discord', { token: modalData.token });
      } else if (platform.authType === 'phone' && platform.id === 'telegram') {
        // Telegram - need API credentials first
        if (!modalData.apiId || !modalData.apiHash || !modalData.phoneNumber) {
          showError('Please fill in all fields');
          return;
        }

        // Set API credentials and start verification
        if (isElectron && window.electronAPI.telegram) {
          await window.electronAPI.telegram.setCredentials(modalData.apiId, modalData.apiHash);

          // Start phone verification
          const verifyResult = await window.electronAPI.telegram.startVerification(modalData.phoneNumber);
          if (verifyResult?.success) {
            showInfo('Verification code sent! Check your Telegram app.');
            // Show code input
            setModalData(prev => ({ ...prev, step: 'code' }));
            setConnectingPlatform(null);
            return;
          } else {
            showError(verifyResult?.error || 'Failed to send verification code');
          }
        }
      } else if (platform.authType === 'cookie') {
        // Cookie-based (Twitter)
        const cookies: Record<string, string> = {};
        platform.cookieFields?.forEach(field => {
          if (modalData[field]) {
            cookies[field] = modalData[field];
          }
        });

        if (Object.keys(cookies).length !== (platform.cookieFields?.length || 0)) {
          showError('Please fill in all cookie fields');
          return;
        }

        result = await connectPlatform(platform.id, { cookies });
      }

      if (result?.success) {
        showSuccess(`Connected to ${platform.name}!`);
        setShowModal(null);
        setModalData({});
        refreshAllStatuses();
      } else if (result) {
        showError(result.error || 'Connection failed');
      }
    } catch (error: any) {
      showError(error.message || 'Connection failed');
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleTelegramCodeSubmit = async () => {
    if (!modalData.code) {
      showError('Please enter the verification code');
      return;
    }

    setConnectingPlatform('telegram');

    try {
      if (isElectron && window.electronAPI.telegram) {
        const result = await window.electronAPI.telegram.verifyCode(modalData.code);
        console.log('[Accounts] Telegram verifyCode result:', result);

        if (result?.success && !result?.needPassword) {
          showSuccess('Connected to Telegram!');
          setShowModal(null);
          setModalData({});
          refreshAllStatuses();
        } else if (result?.needPassword) {
          showInfo('2FA enabled. Please enter your password.');
          setModalData(prev => ({ ...prev, step: 'password' }));
        } else {
          showError(result?.error || 'Invalid code');
        }
      }
    } catch (error: any) {
      showError(error.message || 'Verification failed');
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleTelegramPasswordSubmit = async () => {
    if (!modalData.password) {
      showError('Please enter your 2FA password');
      return;
    }

    setConnectingPlatform('telegram');

    try {
      if (isElectron && window.electronAPI.telegram) {
        const result = await window.electronAPI.telegram.verifyPassword(modalData.password);
        if (result?.success) {
          showSuccess('Connected to Telegram!');
          setShowModal(null);
          setModalData({});
          refreshAllStatuses();
        } else {
          showError(result?.error || 'Invalid password');
        }
      }
    } catch (error: any) {
      showError(error.message || 'Verification failed');
    } finally {
      setConnectingPlatform(null);
    }
  };

  const renderModal = () => {
    if (!showModal) return null;

    const platform = PLATFORMS.find(p => p.id === showModal);
    if (!platform) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(null)}>
        <div className="card-3d p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <span className="text-2xl">{platform.icon}</span>
            Connect {platform.name}
          </h3>

          {/* WhatsApp QR Code */}
          {platform.id === 'whatsapp' && whatsappQr && (
            <div className="space-y-4">
              <div className="flex flex-col items-center">
                <div className="w-64 h-64 bg-white rounded-lg p-2 flex items-center justify-center">
                  <img
                    src={whatsappQr.startsWith('data:') ? whatsappQr : `data:image/png;base64,${whatsappQr}`}
                    alt="WhatsApp QR Code"
                    className="w-full h-full object-contain"
                  />
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-4 text-center">
                  Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
                </p>
              </div>
            </div>
          )}

          {platform.id === 'whatsapp' && !whatsappQr && (
            <div className="space-y-4">
              <div className="flex flex-col items-center">
                <div className="w-64 h-64 bg-[var(--bg-secondary)] rounded-lg flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-4">Generating QR code...</p>
              </div>
            </div>
          )}

          {platform.id === 'discord' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">User Token</label>
                <input
                  type="password"
                  value={modalData.token || ''}
                  onChange={e => setModalData({ ...modalData, token: e.target.value })}
                  placeholder="Enter your Discord user token"
                  className="input-professional w-full"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Open Discord in browser → F12 → Network → Filter "api" → Copy Authorization header
                </p>
              </div>
            </div>
          )}

          {platform.id === 'telegram' && !modalData.step && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">API ID</label>
                <input
                  type="text"
                  value={modalData.apiId || ''}
                  onChange={e => setModalData({ ...modalData, apiId: e.target.value })}
                  placeholder="Your Telegram API ID"
                  className="input-professional w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">API Hash</label>
                <input
                  type="password"
                  value={modalData.apiHash || ''}
                  onChange={e => setModalData({ ...modalData, apiHash: e.target.value })}
                  placeholder="Your Telegram API Hash"
                  className="input-professional w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={modalData.phoneNumber || ''}
                  onChange={e => setModalData({ ...modalData, phoneNumber: e.target.value })}
                  placeholder="+1234567890"
                  className="input-professional w-full"
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Get API credentials from <a href="https://my.telegram.org" target="_blank" rel="noopener" className="text-primary-500 hover:underline">my.telegram.org</a>
              </p>
            </div>
          )}

          {platform.id === 'telegram' && modalData.step === 'code' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Verification Code</label>
                <input
                  type="text"
                  value={modalData.code || ''}
                  onChange={e => setModalData({ ...modalData, code: e.target.value })}
                  placeholder="Enter the code from Telegram"
                  className="input-professional w-full"
                  autoFocus
                />
              </div>
            </div>
          )}

          {platform.id === 'telegram' && modalData.step === 'password' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">2FA Password</label>
                <input
                  type="password"
                  value={modalData.password || ''}
                  onChange={e => setModalData({ ...modalData, password: e.target.value })}
                  placeholder="Enter your 2FA password"
                  className="input-professional w-full"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Instagram Login Options */}
          {platform.id === 'instagram' && !modalData.loginMethod && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Choose your login method:
              </p>

              {/* Private API Option - Recommended */}
              <button
                onClick={() => setModalData({ ...modalData, loginMethod: 'private' })}
                className="w-full p-4 rounded-xl border-2 border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      Private API Login
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">FAST</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Username + Password • Instant messages • ~500ms response
                    </p>
                  </div>
                </div>
              </button>

              {/* Browser Login Option */}
              <button
                onClick={() => setModalData({ ...modalData, loginMethod: 'browser' })}
                className="w-full p-4 rounded-xl border-2 border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌐</span>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">Browser Login</div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Manual login in browser window • Slower • 3-5 sec response
                    </p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Instagram Private API Form */}
          {platform.id === 'instagram' && modalData.loginMethod === 'private' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setModalData({ loginMethod: '' })}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ← Back
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">Private API</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Username</label>
                <input
                  type="text"
                  value={modalData.igUsername || ''}
                  onChange={e => setModalData({ ...modalData, igUsername: e.target.value })}
                  placeholder="Your Instagram username"
                  className="input-professional w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Password</label>
                <input
                  type="password"
                  value={modalData.igPassword || ''}
                  onChange={e => setModalData({ ...modalData, igPassword: e.target.value })}
                  placeholder="Your Instagram password"
                  className="input-professional w-full"
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                ⚠️ If you have 2FA enabled, you may receive a verification code on your phone.
              </p>
            </div>
          )}

          {/* Facebook Login - Optimized Browser Bridge */}
          {platform.id === 'facebook' && !modalData.loginMethod && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🚀</span>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-semibold">Optimized Browser Bridge</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Hidden browser • Images/fonts/media blocked • ~150MB RAM
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setModalData({ ...modalData, loginMethod: 'optimized' })}
                className="w-full p-4 rounded-xl border-2 border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      Connect (Optimized)
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">LOW RAM</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Login once → Messages extracted via optimized hidden browser
                    </p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Facebook - After clicking Connect */}
          {platform.id === 'facebook' && modalData.loginMethod === 'optimized' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setModalData({ loginMethod: '' })}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ← Back
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">⚡ Optimized</span>
              </div>

              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <span className="text-xl">🔐</span>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">Step 1: Login to Facebook</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Click "Open Login" → Login → Enter PIN if prompted → Window auto-closes in 20 sec
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-green-500/10 text-xs text-green-600 dark:text-green-400">
                ✨ Extraction uses: Hidden browser • No images/fonts/media • ~150MB RAM
              </div>

              <div className="p-3 rounded-lg bg-yellow-500/10 text-xs text-yellow-600 dark:text-yellow-400">
                ⚠️ Enter PIN quickly after login. Window closes in 20 seconds.
              </div>
            </div>
          )}

          {/* LinkedIn - On-Device Bridge (Texts.com/Beeper Style) */}
          {platform.id === 'linkedin' && !modalData.loginMethod && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-600/10 to-cyan-500/10 border border-blue-600/20">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-semibold">On-Device Bridge</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Beeper/Texts.com style • Data stays on YOUR device • No server involved
                    </p>
                  </div>
                </div>
              </div>

              {/* On-Device Bridge - Primary Option */}
              <button
                onClick={() => setModalData({ ...modalData, loginMethod: 'bridge' })}
                className="w-full p-4 rounded-xl border-2 border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      On-Device Bridge
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">RECOMMENDED</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Hidden browser • Network interception • MutationObserver • Real-time updates
                    </p>
                  </div>
                </div>
              </button>

              <div className="p-3 rounded-lg bg-blue-500/10 text-xs text-blue-600 dark:text-blue-400">
                <strong>How it works:</strong> Real LinkedIn page loads in hidden browser → We intercept LinkedIn's own API responses → Data extracted via DOM observers → All processing on YOUR device
              </div>
            </div>
          )}

          {/* LinkedIn - On-Device Bridge selected */}
          {platform.id === 'linkedin' && modalData.loginMethod === 'bridge' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setModalData({ loginMethod: '' })}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ← Back
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">⚡ On-Device Bridge</span>
              </div>

              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <span className="text-xl">🔐</span>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">Step 1: Login to LinkedIn</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Click "Open Login" → Login normally → Window auto-closes after successful login
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-green-500/10 text-xs text-green-600 dark:text-green-400">
                  ✨ <strong>Features:</strong> Hidden persistent browser • Network response interception • MutationObserver for real-time • Resource blocking for speed
                </div>
                <div className="p-3 rounded-lg bg-purple-500/10 text-xs text-purple-600 dark:text-purple-400">
                  🔒 <strong>Privacy:</strong> All data processed locally • No external servers • Your credentials never leave your device
                </div>
                <div className="p-3 rounded-lg bg-cyan-500/10 text-xs text-cyan-600 dark:text-cyan-400">
                  💡 <strong>Debug:</strong> After connecting, run <code className="bg-black/20 px-1 rounded">window.electronAPI.linkedin.showBrowser()</code> in DevTools to see hidden browser
                </div>
              </div>
            </div>
          )}

          {/* LinkedIn - Legacy Voyager API (kept for compatibility) */}
          {platform.id === 'linkedin' && modalData.loginMethod === 'voyager' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setModalData({ loginMethod: '' })}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ← Back
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-500">⚠️ Legacy</span>
              </div>

              <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                <div className="flex items-start gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">Voyager API (Legacy)</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Direct API calls may be blocked by LinkedIn. Use On-Device Bridge instead.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {platform.id === 'twitter' && (
            <div className="space-y-4">
              {platform.cookieFields?.map(field => (
                <div key={field}>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{field}</label>
                  <input
                    type="text"
                    value={modalData[field] || ''}
                    onChange={e => setModalData({ ...modalData, [field]: e.target.value })}
                    placeholder={`Enter ${field}`}
                    className="input-professional w-full"
                  />
                </div>
              ))}
              <p className="text-xs text-[var(--text-muted)]">
                Login to x.com → F12 → Application → Cookies → Copy the values
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => { setShowModal(null); setModalData({}); setConnectingPlatform(null); }}
              className="btn-secondary-3d btn-professional flex-1"
            >
              Cancel
            </button>
            {/* Hide Connect button when showing method selection for Instagram, Facebook, or LinkedIn */}
            {!((platform.id === 'instagram' && !modalData.loginMethod) || (platform.id === 'facebook' && !modalData.loginMethod) || (platform.id === 'linkedin' && !modalData.loginMethod)) && (
              <button
                onClick={async () => {
                  if (platform.id === 'telegram' && modalData.step === 'code') {
                    handleTelegramCodeSubmit();
                  } else if (platform.id === 'telegram' && modalData.step === 'password') {
                    handleTelegramPasswordSubmit();
                  } else if (platform.id === 'instagram' && modalData.loginMethod === 'private') {
                    // Instagram Private API login
                    if (!modalData.igUsername || !modalData.igPassword) {
                      showError('Please enter username and password');
                      return;
                    }
                    setConnectingPlatform('instagram');
                    try {
                      const result = await (window.electronAPI.instagram as any).loginWithCredentials(
                        modalData.igUsername,
                        modalData.igPassword
                      );
                      console.log('[Accounts] Instagram Private API result:', result);
                      if (result?.success) {
                        showSuccess('Connected to Instagram via Private API! ⚡');
                        setShowModal(null);
                        setModalData({});
                        refreshAllStatuses();
                      } else if (result?.error?.includes('2FA')) {
                        showInfo('2FA required. Check your phone for verification code.');
                        // TODO: Add 2FA input step
                      } else {
                        showError(result?.error || 'Login failed');
                      }
                    } catch (err: any) {
                      showError(err.message || 'Login failed');
                    } finally {
                      setConnectingPlatform(null);
                    }
                  } else if (platform.id === 'instagram' && modalData.loginMethod === 'browser') {
                    // Instagram Browser login
                    setConnectingPlatform('instagram');
                    try {
                      const result = await window.electronAPI.instagram.openLogin();
                      console.log('[Accounts] Instagram browser login result:', result);
                      if (result?.success) {
                        showSuccess('Connected to Instagram via Browser!');
                        setShowModal(null);
                        setModalData({});
                        refreshAllStatuses();
                      } else {
                        showError(result?.error || 'Login cancelled or failed');
                      }
                    } catch (err: any) {
                      showError(err.message || 'Login failed');
                    } finally {
                      setConnectingPlatform(null);
                    }
                  } else if (platform.id === 'facebook' && modalData.loginMethod === 'optimized') {
                    // Facebook Optimized Browser Bridge - Open Login, auto-close after 10 sec
                    setConnectingPlatform('facebook');
                    try {
                      await window.electronAPI.facebook.setMode(false);
                      const result = await window.electronAPI.facebook.openLogin();
                      console.log('[Accounts] Facebook Browser Bridge login result:', result);
                      if (result?.success) {
                        showSuccess('Connected to Facebook! Expand Facebook in sidebar to load messages.');
                        setShowModal(null);
                        setModalData({});
                        await refreshAllStatuses();
                      } else {
                        showError(result?.error || 'Login cancelled or failed');
                      }
                    } catch (err: any) {
                      showError(err.message || 'Login failed');
                    } finally {
                      setConnectingPlatform(null);
                    }
                  } else if (platform.id === 'facebook') {
                    // Facebook fallback (shouldn't reach here)
                    setConnectingPlatform('facebook');
                    try {
                      const result = await window.electronAPI.facebook.openLogin();
                      console.log('[Accounts] Facebook browser login result:', result);
                      if (result?.success) {
                        showSuccess('Connected to Facebook!');
                        setShowModal(null);
                        setModalData({});
                        refreshAllStatuses();
                      } else {
                        showError(result?.error || 'Login cancelled or failed');
                      }
                    } catch (err: any) {
                      showError(err.message || 'Login failed');
                    } finally {
                      setConnectingPlatform(null);
                    }
                  } else if (platform.id === 'linkedin' && (modalData.loginMethod === 'bridge' || modalData.loginMethod === 'voyager' || modalData.loginMethod === 'browser')) {
                    // LinkedIn - On-Device Bridge (primary) or legacy modes
                    setConnectingPlatform('linkedin');
                    try {
                      // On-Device Bridge uses browser automation internally
                      // setMode(false) = browser automation, setMode(true) = voyager API (legacy)
                      const useVoyager = modalData.loginMethod === 'voyager';
                      if ((window.electronAPI as any).linkedin?.setMode) {
                        await (window.electronAPI as any).linkedin.setMode(useVoyager);
                      }
                      
                      const result = await window.electronAPI.linkedin.openLogin();
                      console.log('[Accounts] LinkedIn login result:', result);
                      if (result?.success) {
                        const modeName = modalData.loginMethod === 'bridge' ? 'On-Device Bridge' : 
                                        modalData.loginMethod === 'voyager' ? 'Voyager API' : 'Browser';
                        showSuccess(`Connected to LinkedIn via ${modeName}! ⚡`);
                        setShowModal(null);
                        setModalData({});
                        await refreshAllStatuses();
                      } else {
                        showError(result?.error || 'Login cancelled or failed');
                      }
                    } catch (err: any) {
                      showError(err.message || 'Login failed');
                    } finally {
                      setConnectingPlatform(null);
                    }
                  } else {
                    handleModalSubmit();
                  }
                }}
                disabled={connectingPlatform === platform.id}
                className="btn-primary-3d btn-professional flex-1 disabled:opacity-50"
              >
                {connectingPlatform === platform.id ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  platform.id === 'facebook' && modalData.loginMethod === 'optimized' ? '🔐 Open Login' : 
                  platform.id === 'linkedin' && modalData.loginMethod ? '🔐 Open Login' : 'Connect'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col dashboard-bg">
      <Header totalUnread={0} />

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Connected Accounts</h1>
            <p className="text-[var(--text-muted)] mt-1">
              Connect your social media accounts to manage all your DMs in one place
            </p>
          </div>

          {/* Platform Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLATFORMS.map((platform) => {
              const status = platformStatuses[platform.id];
              const isConnected = status?.connected || false;
              const isConnecting = connectingPlatform === platform.id;

              return (
                <div key={platform.id} className="card-3d p-6 flex items-start gap-4">
                  {/* Platform Icon */}
                  <div className={`w-12 h-12 rounded-xl ${platform.color} text-white text-2xl flex items-center justify-center`}>
                    {platform.icon}
                  </div>

                  {/* Platform Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-[var(--text-primary)]">{platform.name}</h3>
                      {isConnected && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mb-3">{platform.description}</p>

                    {/* Last sync info */}
                    {isConnected && status?.lastSync && (
                      <p className="text-xs text-[var(--text-muted)] mb-3">
                        Last sync: {new Date(status.lastSync).toLocaleString()}
                      </p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      {isConnected ? (
                        <>
                          <button
                            onClick={() => handleConnect(platform)}
                            className="btn-secondary-3d btn-professional text-sm"
                          >
                            🔄 Reconnect
                          </button>
                          <button
                            onClick={() => handleDisconnect(platform)}
                            className="btn-secondary-3d btn-professional text-sm text-red-500 hover:text-red-600"
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleConnect(platform)}
                          disabled={isConnecting}
                          className="btn-primary-3d btn-professional disabled:opacity-50 flex items-center gap-2"
                        >
                          {isConnecting ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            'Connect'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Info Box */}
          <div className="mt-8 p-4 rounded-xl bg-primary-500/10 border border-primary-500/20">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div>
                <h4 className="font-semibold text-[var(--text-primary)] mb-1">On-Device Bridge Technology</h4>
                <p className="text-sm text-[var(--text-muted)]">
                  Like Beeper and Texts.com, this app uses <strong>On-Device Bridges</strong> - all data processing happens locally on YOUR computer.
                  Your credentials never leave your device. We use hidden browser windows with network interception and MutationObservers
                  to extract messages in real-time, making it appear as if you're browsing normally.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Modal */}
      {renderModal()}
    </div>
  );
};

export default Accounts;
