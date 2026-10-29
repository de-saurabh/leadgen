import { and, eq } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import type { SecretBox } from './crypto.js';

export class NumberError extends Error {
  constructor(
    public readonly code: 'already_connected' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

export interface ConnectNumberInput {
  phoneNumberId: string;
  wabaId?: string | undefined;
  /** The number customers see; any formatting, stored as digits. */
  displayNumber: string;
  accessToken: string;
}

/** The fields safe to send to the dashboard: never the token, encrypted or not. */
const publicColumns = {
  id: schema.whatsappNumbers.id,
  phoneNumberId: schema.whatsappNumbers.phoneNumberId,
  wabaId: schema.whatsappNumbers.wabaId,
  displayNumber: schema.whatsappNumbers.displayNumber,
  status: schema.whatsappNumbers.status,
  createdAt: schema.whatsappNumbers.createdAt,
};

export async function connectNumber(
  db: AppDb,
  box: SecretBox,
  organizationId: string,
  input: ConnectNumberInput,
) {
  const [existing] = await db
    .select({ id: schema.whatsappNumbers.id })
    .from(schema.whatsappNumbers)
    .where(eq(schema.whatsappNumbers.phoneNumberId, input.phoneNumberId))
    .limit(1);
  if (existing) throw new NumberError('already_connected', 'That number is already connected');

  const [row] = await db
    .insert(schema.whatsappNumbers)
    .values({
      organizationId,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId ?? null,
      displayNumber: input.displayNumber.replace(/\D/g, ''),
      accessTokenEnc: box.encrypt(input.accessToken),
    })
    .returning(publicColumns);
  return row!;
}

export function listNumbers(db: AppDb, organizationId: string) {
  return db
    .select(publicColumns)
    .from(schema.whatsappNumbers)
    .where(eq(schema.whatsappNumbers.organizationId, organizationId));
}

export async function disconnectNumber(db: AppDb, organizationId: string, id: string) {
  const deleted = await db
    .delete(schema.whatsappNumbers)
    .where(
      and(
        eq(schema.whatsappNumbers.id, id),
        eq(schema.whatsappNumbers.organizationId, organizationId),
      ),
    )
    .returning({ id: schema.whatsappNumbers.id });
  if (deleted.length === 0) throw new NumberError('not_found', 'number not found');
}
