export * from './templates';
export * from './templates/appointment';
export * from './outbox';
export * from './outbox-processor';
export {
  sendEmail,
  getMailTransporter,
  setTestTransporter,
  validateRecipientAddress,
  type SendEmailOptions,
  type RecipientAddress,
} from '@/server/auth/email';
