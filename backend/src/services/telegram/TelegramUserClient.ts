import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import pool from '../../config/database';

interface TelegramSession {
  userId: string;
  accountId: string;
  phoneNumber: string;
  session: string;
  client?: TelegramClient;
}

class TelegramUserClientService {
  private sessions: Map<string, TelegramSession> = new Map();
  private apiId: number;
  private apiHash: string;

  constructor() {
    this.apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
    this.apiHash = process.env.TELEGRAM_API_HASH || '';
  }

  async startPhoneVerification(userId: string, phoneNumber: string): Promise<{ phoneCodeHash: string }> {
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    const result = await client.sendCode(
      {
        apiId: this.apiId,
        apiHash: this.apiHash,
      },
      phoneNumber
    );

    const tempKey = `temp_${userId}_${phoneNumber}`;
    this.sessions.set(tempKey, {
      userId,
      accountId: '',
      phoneNumber,
      session: String(stringSession.save() || ''),
      client,
    });

    return { phoneCodeHash: result.phoneCodeHash };
  }

  async verifyPhoneCode(
    userId: string,
    phoneNumber: string,
    phoneCode: string,
    phoneCodeHash: string
  ): Promise<{ accountId: string; username: string }> {
    const tempKey = `temp_${userId}_${phoneNumber}`;
    const tempSession = this.sessions.get(tempKey);

    if (!tempSession || !tempSession.client) {
      throw new Error('Session not found. Please restart verification.');
    }

    const result = await tempSession.client.invoke(
      new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode,
      })
    );

    const me = await tempSession.client.getMe();
    const username = (me as any).username || (me as any).firstName || phoneNumber;
    const telegramUserId = (me as any).id.toString();

    const sessionString = String(tempSession.client.session.save() || '');
    
    const accountResult = await pool.query(
      `INSERT INTO connected_accounts 
      (user_id, platform, platform_user_id, platform_username, access_token, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform, platform_user_id) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        platform_username = EXCLUDED.platform_username,
        is_active = true,
        updated_at = NOW()
      RETURNING id`,
      [userId, 'telegram', telegramUserId, username, sessionString, true]
    );

    const accountId = accountResult.rows[0].id;

    this.sessions.set(accountId, {
      userId,
      accountId,
      phoneNumber,
      session: String(sessionString),
      client: tempSession.client,
    });

    this.sessions.delete(tempKey);

    return { accountId, username };
  }

  async loadSession(accountId: string): Promise<TelegramClient | null> {
    if (this.sessions.has(accountId)) {
      return this.sessions.get(accountId)!.client || null;
    }

    const result = await pool.query(
      `SELECT user_id, access_token FROM connected_accounts 
       WHERE id = $1 AND platform = 'telegram' AND is_active = true`,
      [accountId]
    );

    if (result.rows.length === 0) return null;

    const sessionString = result.rows[0].access_token;
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    this.sessions.set(accountId, {
      userId: result.rows[0].user_id,
      accountId,
      phoneNumber: '',
      session: sessionString,
      client,
    });

    return client;
  }

  async getDialogs(accountId: string, limit: number = 50): Promise<any[]> {
    const client = await this.loadSession(accountId);
    if (!client) throw new Error('Session not found');

    const dialogs = await client.getDialogs({ limit });
    return dialogs.map((d) => ({
      id: d.id,
      name: d.name || d.title,
      isUser: d.isUser,
      isGroup: d.isGroup,
      unreadCount: d.unreadCount,
      date: d.date,
    }));
  }

  async getMessages(accountId: string, chatId: string, limit: number = 50): Promise<any[]> {
    const client = await this.loadSession(accountId);
    if (!client) throw new Error('Session not found');

    const messages = await client.getMessages(chatId, { limit });
    return messages.map((m) => ({
      id: m.id,
      text: m.text,
      senderId: m.senderId?.toString(),
      date: m.date,
      out: m.out,
    }));
  }

  async sendMessage(accountId: string, chatId: string, text: string): Promise<void> {
    const client = await this.loadSession(accountId);
    if (!client) throw new Error('Session not found');
    await client.sendMessage(chatId, { message: text });
  }

  async disconnect(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId);
    if (session?.client) {
      await session.client.disconnect();
      this.sessions.delete(accountId);
    }
  }
}

export const telegramUserClient = new TelegramUserClientService();
