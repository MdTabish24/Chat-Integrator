import { Pool, QueryResult } from 'pg';
import pool from '../config/database';
import { encrypt, decrypt } from '../utils/encryption';

/**
 * Generic query helper with error handling
 */
export const query = async <T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  try {
    const result = await pool.query<T>(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

/**
 * Execute a query and return the first row or null
 */
export const queryOne = async <T = any>(
  text: string,
  params?: any[]
): Promise<T | null> => {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
};

/**
 * Execute a query and return all rows
 */
export const queryMany = async <T = any>(
  text: string,
  params?: any[]
): Promise<T[]> => {
  const result = await query<T>(text, params);
  return result.rows;
};

/**
 * Insert a record and return the inserted row
 */
export const insertOne = async <T = any>(
  table: string,
  data: Record<string, any>
): Promise<T> => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  const text = `
    INSERT INTO ${table} (${columns})
    VALUES (${placeholders})
    RETURNING *
  `;

  const result = await queryOne<T>(text, values);
  if (!result) {
    throw new Error(`Failed to insert into ${table}`);
  }
  return result;
};

/**
 * Update a record by ID and return the updated row
 */
export const updateById = async <T = any>(
  table: string,
  id: string,
  data: Record<string, any>
): Promise<T | null> => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

  const text = `
    UPDATE ${table}
    SET ${setClause}, updated_at = NOW()
    WHERE id = $${keys.length + 1}
    RETURNING *
  `;

  return queryOne<T>(text, [...values, id]);
};

/**
 * Delete a record by ID
 */
export const deleteById = async (
  table: string,
  id: string
): Promise<boolean> => {
  const text = `DELETE FROM ${table} WHERE id = $1`;
  const result = await query(text, [id]);
  return result.rowCount! > 0;
};

/**
 * Find a record by ID
 */
export const findById = async <T = any>(
  table: string,
  id: string
): Promise<T | null> => {
  const text = `SELECT * FROM ${table} WHERE id = $1`;
  return queryOne<T>(text, [id]);
};

/**
 * Find records with pagination
 */
export const findWithPagination = async <T = any>(
  table: string,
  options: {
    where?: string;
    params?: any[];
    orderBy?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ rows: T[]; total: number }> => {
  const {
    where = '',
    params = [],
    orderBy = 'created_at DESC',
    limit = 50,
    offset = 0
  } = options;

  const whereClause = where ? `WHERE ${where}` : '';
  
  // Get total count
  const countText = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
  const countResult = await queryOne<{ count: string }>(countText, params);
  const total = parseInt(countResult?.count || '0');

  // Get paginated rows
  const dataText = `
    SELECT * FROM ${table}
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const rows = await queryMany<T>(dataText, [...params, limit, offset]);

  return { rows, total };
};

/**
 * Insert a connected account with encrypted tokens
 */
export const insertConnectedAccount = async (data: {
  userId: string;
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}): Promise<any> => {
  const encryptedAccessToken = encrypt(data.accessToken);
  const encryptedRefreshToken = data.refreshToken ? encrypt(data.refreshToken) : null;

  return insertOne('connected_accounts', {
    user_id: data.userId,
    platform: data.platform,
    platform_user_id: data.platformUserId,
    platform_username: data.platformUsername,
    access_token: encryptedAccessToken,
    refresh_token: encryptedRefreshToken,
    token_expires_at: data.tokenExpiresAt,
    is_active: true
  });
};

/**
 * Get connected account with decrypted tokens
 */
export const getConnectedAccountById = async (id: string): Promise<any | null> => {
  const account = await findById('connected_accounts', id);
  
  if (!account) {
    return null;
  }

  return {
    ...account,
    access_token: decrypt(account.access_token),
    refresh_token: account.refresh_token ? decrypt(account.refresh_token) : null
  };
};

/**
 * Update connected account tokens
 */
export const updateAccountTokens = async (
  accountId: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: Date
): Promise<any | null> => {
  const encryptedAccessToken = encrypt(accessToken);
  const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;

  const updateData: Record<string, any> = {
    access_token: encryptedAccessToken,
    token_expires_at: expiresAt
  };

  if (encryptedRefreshToken) {
    updateData.refresh_token = encryptedRefreshToken;
  }

  return updateById('connected_accounts', accountId, updateData);
};

/**
 * Insert a message with encrypted content
 */
export const insertMessage = async (data: {
  conversationId: string;
  platformMessageId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType?: string;
  mediaUrl?: string;
  isOutgoing?: boolean;
  sentAt: Date;
}): Promise<any> => {
  const encryptedContent = encrypt(data.content);

  return insertOne('messages', {
    conversation_id: data.conversationId,
    platform_message_id: data.platformMessageId,
    sender_id: data.senderId,
    sender_name: data.senderName,
    content: encryptedContent,
    message_type: data.messageType || 'text',
    media_url: data.mediaUrl,
    is_outgoing: data.isOutgoing || false,
    is_read: false,
    sent_at: data.sentAt
  });
};

/**
 * Get messages with decrypted content
 */
export const getMessagesByConversationId = async (
  conversationId: string,
  limit: number = 50,
  offset: number = 0
): Promise<any[]> => {
  const messages = await queryMany(
    `SELECT * FROM messages 
     WHERE conversation_id = $1 
     ORDER BY sent_at DESC 
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );

  return messages.map(msg => ({
    ...msg,
    content: decrypt(msg.content)
  }));
};

/**
 * Mark messages as read
 */
export const markMessagesAsRead = async (
  conversationId: string,
  messageIds?: string[]
): Promise<void> => {
  if (messageIds && messageIds.length > 0) {
    await query(
      `UPDATE messages 
       SET is_read = true 
       WHERE conversation_id = $1 AND id = ANY($2)`,
      [conversationId, messageIds]
    );
  } else {
    await query(
      `UPDATE messages 
       SET is_read = true 
       WHERE conversation_id = $1 AND is_read = false`,
      [conversationId]
    );
  }
};

/**
 * Update conversation unread count
 */
export const updateConversationUnreadCount = async (
  conversationId: string
): Promise<void> => {
  await query(
    `UPDATE conversations 
     SET unread_count = (
       SELECT COUNT(*) FROM messages 
       WHERE conversation_id = $1 AND is_read = false AND is_outgoing = false
     )
     WHERE id = $1`,
    [conversationId]
  );
};

/**
 * Log API usage
 */
export const logApiUsage = async (
  accountId: string,
  platform: string,
  endpoint: string,
  requestCount: number = 1
): Promise<void> => {
  await insertOne('api_usage_logs', {
    account_id: accountId,
    platform,
    endpoint,
    request_count: requestCount
  });
};

/**
 * Get API usage for a platform within a time window
 */
export const getApiUsage = async (
  accountId: string,
  platform: string,
  since: Date
): Promise<number> => {
  const result = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(request_count), 0) as total 
     FROM api_usage_logs 
     WHERE account_id = $1 AND platform = $2 AND timestamp >= $3`,
    [accountId, platform, since]
  );

  return parseInt(result?.total || '0');
};

/**
 * Transaction helper
 */
export const transaction = async <T>(
  callback: (client: Pool) => Promise<T>
): Promise<T> => {
  await pool.query('BEGIN');
  
  try {
    const result = await callback(pool);
    await pool.query('COMMIT');
    return result;
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
};
