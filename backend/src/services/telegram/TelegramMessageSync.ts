import { telegramUserClient } from './TelegramUserClient';
import pool from '../../config/database';

class TelegramMessageSyncService {
  async syncMessages(accountId: string): Promise<void> {
    try {
      console.log(`[telegram-sync] Syncing messages for account ${accountId}`);

      // Get dialogs (conversations)
      const dialogs = await telegramUserClient.getDialogs(accountId, 50);
      console.log(`[telegram-sync] Found ${dialogs.length} dialogs`);

      for (const dialog of dialogs) {
        const dialogId = dialog.id?.toString() || 'unknown';
        const dialogName = dialog.name || 'Unknown Chat';
        const dialogDate = dialog.date ? new Date(dialog.date * 1000) : new Date();
        
        // Create or update conversation
        const conversationResult = await pool.query(
          `INSERT INTO conversations (account_id, platform_conversation_id, participant_name, participant_id, last_message_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (account_id, platform_conversation_id)
           DO UPDATE SET 
             participant_name = EXCLUDED.participant_name,
             last_message_at = EXCLUDED.last_message_at,
             updated_at = NOW()
           RETURNING id`,
          [accountId, dialogId, dialogName, dialogId, dialogDate]
        );

        const conversationId = conversationResult.rows[0].id;

        // Get messages from this conversation
        const messages = await telegramUserClient.getMessages(accountId, dialog.id.toString(), 20);

        for (const message of messages) {
          if (!message.text) continue;

          // Import encryption utility
          const { encrypt } = await import('../../utils/encryption');
          const encryptedContent = encrypt(message.text);

          // Insert message and track unread status
          await pool.query(
            `INSERT INTO messages (conversation_id, platform_message_id, content, sender_id, sender_name, sent_at, is_outgoing, is_read)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (conversation_id, platform_message_id) DO NOTHING`,
            [
              conversationId,
              message.id.toString(),
              encryptedContent,
              message.senderId || 'unknown',
              'Telegram User',
              new Date(message.date * 1000),
              message.out,
              true, // Mark all synced messages as read initially
            ]
          );
        }

        // Update unread count for conversation
        await pool.query(
          `UPDATE conversations 
           SET unread_count = (
             SELECT COUNT(*) FROM messages 
             WHERE conversation_id = $1 AND is_read = false AND is_outgoing = false
           )
           WHERE id = $1`,
          [conversationId]
        );
      }

      console.log(`[telegram-sync] Synced ${dialogs.length} conversations for account ${accountId}`);
    } catch (error) {
      console.error('[telegram-sync] Sync failed:', error);
      throw error;
    }
  }

  async startPeriodicSync(accountId: string): Promise<void> {
    console.log(`[telegram-sync] Starting periodic sync for account ${accountId}`);
    
    // Initial sync
    try {
      await this.syncMessages(accountId);
    } catch (error) {
      console.error('[telegram-sync] Initial sync failed:', error);
    }

    // Sync every 30 seconds
    setInterval(async () => {
      try {
        await this.syncMessages(accountId);
      } catch (error) {
        console.error('[telegram-sync] Periodic sync failed:', error);
      }
    }, 30000);
  }
}

export const telegramMessageSync = new TelegramMessageSyncService();
