import { Request, Response } from 'express';
import { telegramUserClient } from '../services/telegram/TelegramUserClient';

export const startPhoneAuth = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { phoneNumber } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const result = await telegramUserClient.startPhoneVerification(userId, phoneNumber);
    res.json({ success: true, phoneCodeHash: result.phoneCodeHash });
  } catch (error: any) {
    console.error('[telegram-user] Phone auth failed:', error);
    res.status(500).json({ error: error.message });
  }
};

export const verifyPhoneCode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { phoneNumber, phoneCode, phoneCodeHash } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await telegramUserClient.verifyPhoneCode(
      userId,
      phoneNumber,
      phoneCode,
      phoneCodeHash
    );

    res.json({ success: true, accountId: result.accountId, username: result.username });
  } catch (error: any) {
    console.error('[telegram-user] Code verification failed:', error);
    res.status(400).json({ error: error.message });
  }
};

export const getDialogs = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { accountId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const dialogs = await telegramUserClient.getDialogs(accountId);
    res.json({ dialogs });
  } catch (error: any) {
    console.error('[telegram-user] Get dialogs failed:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { accountId, chatId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const messages = await telegramUserClient.getMessages(accountId, chatId);
    res.json({ messages });
  } catch (error: any) {
    console.error('[telegram-user] Get messages failed:', error);
    res.status(500).json({ error: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { accountId, chatId } = req.params;
    const { text } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await telegramUserClient.sendMessage(accountId, chatId, text);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[telegram-user] Send message failed:', error);
    res.status(500).json({ error: error.message });
  }
};
