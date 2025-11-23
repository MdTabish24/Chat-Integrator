import { telegramUserClient } from './TelegramUserClient';
import pool from '../../config/database';

class TelegramMessageSyncService {
  async syncMessages(accountId: string): Promise<void> {
    try {
      console.log(`[telegram-sync] Syncing messages for account ${accountId}`);

      // Get dialogs (conversations)
      const dialogs = await telegramUserClient.getDialogs(accountId, 50);

      for (const dialog of dialogs) {
        // Create or update conversation
        const conversationResult = await pool.query(
          `INSERT INTO conversations (account_id, platform_conversation_id, participant_name, last_message_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (account_id, platform_conversation_id)
           DO UPDATE SET participant_name = EXCLUDED.participant_name, updated_at = NOW()
           RETURNING id`,
          [accountId, dialog.id.toString(), dialog.name]
        );

        const conversationId = conversationResult.rows[0].id;

        // Get messages from this conversation
        const messages = await telegramUserClient.getMessages(accountId, dialog.id.toString(), 20);

        for (const message of messages) {
          if (!message.text) continue;

          // Insert message
          await pool.query(
            `INSERT INTO messages (conversation_id, platform_message_id, content, sender_id, sent_at, is_from_user)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (conversation_id, platform_message_id) DO NOTHING`,
            [
              conversationId,
              message.id.toString(),
              message.text,
              message.senderId || 'unknown',
              new Date(message.date * 1000),
              message.out,
            ]
          );
        }
      }

      console.log(`[telegram-sync] Synced ${dialogs.length} conversations for account ${accountId}`);
    } catch (error) {
      console.error('[telegram-sync] Sync failed:', error);
      throw error;
    }
  }

  async startPeriodicSync(accountId: string): Promise<void> {
    // Initial sync
    await this.syncMessages(accountId);

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
