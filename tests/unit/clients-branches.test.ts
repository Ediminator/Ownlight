import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createClientAction,
  updateClientAction,
  addContactAction,
  updateContactAction,
  removeContactAction,
  upsertAddressAction,
  removeAddressAction,
  getClientAction,
  listClientsAction,
} from '@/server/clients/actions';
import { authorizeClientRead, authorizeClientWrite } from '@/server/clients/policy';
import * as clientService from '@/server/clients/service';
import * as clientRepo from '@/server/clients/repo';
import * as authGuards from '@/server/auth/guards';
import * as settingsRepo from '@/server/settings/repo';
import * as auditModule from '@/server/audit';
import { UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import {
  isValidCountryCode,
  normalizeEmail,
  singleLineString,
  countryCodeSchema,
  updateContactInputSchema,
  addContactInputSchema,
  upsertAddressInputSchema,
} from '@/server/clients/schema';
import type { AuthContext } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';
import type { ClientWithRelations } from '@/server/clients/repo';
import type { AuditEvent } from '@/server/audit';
import type { User, Session } from '@/server/db/schema/auth';
import type { ApiKeyWithScopes } from '@/server/auth/api-keys';

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: '01912345-6789-7abc-8def-012345678000',
    email: 'owner@example.com',
    name: 'Owner',
    emailVerified: true,
    image: null,
    role: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '01912345-6789-7abc-8def-012345678001',
    userId: '01912345-6789-7abc-8def-012345678000',
    token: 'token-123',
    expiresAt: new Date(Date.now() + 86400000),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastReauthenticatedAt: new Date(),
    ...overrides,
  };
}

function createMockApiKey(overrides: Partial<ApiKeyWithScopes> = {}): ApiKeyWithScopes {
  return {
    id: 'key-1',
    name: 'Test Key',
    prefix: 'ow_',
    tokenHash: 'hash',
    scopes: ['*'],
    expiresAt: null,
    lastUsedAt: null,
    userId: '01912345-6789-7abc-8def-012345678000',
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockClientWithRelations(
  overrides: Partial<ClientWithRelations> = {},
): ClientWithRelations {
  return {
    client: {
      id: '01912345-6789-7abc-8def-012345678000',
      kind: 'person',
      displayName: 'Test Client',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    },
    contacts: [],
    addresses: [],
    tags: [],
    ...overrides,
  };
}

describe('Clients Domain & Actions Branch Coverage (Unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const dummyDbClient = {} as unknown as DbClient;

  describe('Server Actions error and boundary branches', () => {
    const ownerAuth: AuthContext = {
      user: createMockUser(),
      session: createMockSession(),
      authType: 'session',
      scopes: ['*'],
    };

    it('handles UnauthorizedError, ForbiddenError, unexpected errors, and validation errors across all actions', async () => {
      // 1. createClientAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(
        new UnauthorizedError('No session'),
      );
      expect(await createClientAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forbidden'));
      expect(await createClientAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash in create'));
      await expect(createClientAction({})).rejects.toThrow('Crash in create');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await createClientAction({})).code).toBe('VALIDATION_FAILED');

      // 2. updateClientAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(
        new UnauthorizedError('No session'),
      );
      expect(await updateClientAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forbidden'));
      expect(await updateClientAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash in update'));
      await expect(updateClientAction({})).rejects.toThrow('Crash in update');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await updateClientAction({})).code).toBe('VALIDATION_FAILED');

      // 3. addContactAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(
        new UnauthorizedError('No session'),
      );
      expect(await addContactAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forbidden'));
      expect(await addContactAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash in add contact'));
      await expect(addContactAction({})).rejects.toThrow('Crash in add contact');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await addContactAction({})).code).toBe('VALIDATION_FAILED');

      // 4. updateContactAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await updateContactAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await updateContactAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash'));
      await expect(updateContactAction({})).rejects.toThrow('Crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await updateContactAction({})).code).toBe('VALIDATION_FAILED');

      // 5. removeContactAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await removeContactAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await removeContactAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Fatal DB crash'));
      await expect(removeContactAction({})).rejects.toThrow('Fatal DB crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await removeContactAction({})).code).toBe('VALIDATION_FAILED');

      // 6. upsertAddressAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await upsertAddressAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await upsertAddressAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash'));
      await expect(upsertAddressAction({})).rejects.toThrow('Crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await upsertAddressAction({})).code).toBe('VALIDATION_FAILED');

      // 7. removeAddressAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await removeAddressAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await removeAddressAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash'));
      await expect(removeAddressAction({})).rejects.toThrow('Crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await removeAddressAction({})).code).toBe('VALIDATION_FAILED');

      // 8. getClientAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await getClientAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await getClientAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash'));
      await expect(getClientAction({})).rejects.toThrow('Crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await getClientAction({ clientId: 'not-a-uuid' })).code).toBe('VALIDATION_FAILED');

      vi.spyOn(clientService, 'getClient').mockResolvedValueOnce({
        success: true,
        data: createMockClientWithRelations(),
      });
      expect(
        (await getClientAction({ clientId: '01912345-6789-7abc-8def-012345678000' })).success,
      ).toBe(true);

      // 9. listClientsAction branches
      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new UnauthorizedError('Unauth'));
      expect(await listClientsAction({})).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new ForbiddenError('Forb'));
      expect(await listClientsAction({})).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });

      vi.spyOn(authGuards, 'requireAuth').mockRejectedValueOnce(new Error('Crash'));
      await expect(listClientsAction({})).rejects.toThrow('Crash');

      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      expect((await listClientsAction({ page: 0 })).code).toBe('VALIDATION_FAILED');

      vi.spyOn(clientService, 'getClientList').mockResolvedValueOnce({
        success: true,
        data: { items: [], total: 0, page: 1, pageSize: 25 },
      });
      expect((await listClientsAction()).success).toBe(true);
    });

    it('tests extractClientId and targetId fallback behaviors', async () => {
      vi.spyOn(authGuards, 'requireAuth').mockResolvedValue(ownerAuth);
      vi.spyOn(clientService, 'updateClient').mockResolvedValue({
        success: true,
        data: { clientId: '01912345-6789-7abc-8def-012345678000' },
      });

      // Valid clientId string
      const res = await updateClientAction({
        clientId: '01912345-6789-7abc-8def-012345678000',
        displayName: 'Updated Name',
      });
      expect(res.success).toBe(true);

      // Non-string / null / empty clientId branches
      await updateClientAction(null);
      await updateClientAction('string-input');
      await updateClientAction({ clientId: 12345 });
      await updateClientAction({ clientId: '' });
    });
  });

  describe('Policy branch coverage', () => {
    it('handles policy authorization scopes, role verification, and audit failure gracefully', async () => {
      const nonOwnerContext: AuthContext = {
        user: createMockUser({ role: 'client' }),
        session: createMockSession(),
        authType: 'session',
        scopes: ['*'],
      };

      // Non-owner read rejected
      await expect(authorizeClientRead(nonOwnerContext, dummyDbClient)).rejects.toThrow(
        ForbiddenError,
      );

      // Non-owner write rejected (covers line 89 in policy.ts)
      await expect(
        authorizeClientWrite('client.created', null, nonOwnerContext, dummyDbClient),
      ).rejects.toThrow(ForbiddenError);

      // ApiKey read missing scope
      const apiKeyNoScope: AuthContext = {
        user: createMockUser(),
        apiKey: createMockApiKey({ scopes: ['other:scope'] }),
        authType: 'apiKey',
        scopes: ['other:scope'],
      };
      await expect(authorizeClientRead(apiKeyNoScope, dummyDbClient)).rejects.toThrow(
        ForbiddenError,
      );

      // ApiKey with prefix only (no id)
      const apiKeyPrefixOnly: AuthContext = {
        user: createMockUser(),
        apiKey: createMockApiKey({ id: '', prefix: 'ow_', scopes: ['other:scope'] }),
        authType: 'apiKey',
        scopes: ['other:scope'],
      };
      await expect(
        authorizeClientWrite('client.created', null, apiKeyPrefixOnly, dummyDbClient),
      ).rejects.toThrow(ForbiddenError);

      // Audit module rejects during denied audit recording
      vi.spyOn(auditModule, 'audit').mockRejectedValueOnce(new Error('Audit DB is down'));
      await expect(
        authorizeClientWrite('client.created', null, apiKeyPrefixOnly, dummyDbClient),
      ).rejects.toThrow(ForbiddenError);

      // ApiKey with neither id nor prefix, and non-null targetId
      const apiKeyNoIdNoPrefix: AuthContext = {
        user: createMockUser(),
        apiKey: createMockApiKey({ id: '', prefix: '', scopes: ['other:scope'] }),
        authType: 'apiKey',
        scopes: ['other:scope'],
      };
      await expect(
        authorizeClientWrite('client.created', 'target-uuid', apiKeyNoIdNoPrefix, dummyDbClient),
      ).rejects.toThrow(ForbiddenError);

      // Owner role with apiKey missing write scope
      const ownerApiKeyNoWriteScope: AuthContext = {
        user: createMockUser({ role: 'owner' }),
        apiKey: createMockApiKey({ scopes: ['clients:read'] }),
        authType: 'apiKey',
        scopes: ['clients:read'],
      };
      await expect(
        authorizeClientWrite('client.created', null, ownerApiKeyNoWriteScope, dummyDbClient),
      ).rejects.toThrow(ForbiddenError);

      // RequireAuthOptions parameter passing
      vi.spyOn(authGuards, 'requireAuth').mockResolvedValueOnce({
        user: createMockUser(),
        session: createMockSession(),
        authType: 'session',
        scopes: ['*'],
      });
      const resolved = await authorizeClientRead({ headers: {} }, dummyDbClient);
      expect(resolved.user.role).toBe('owner');
    });
  });

  describe('Service branch coverage', () => {
    const ownerAuth: AuthContext = {
      user: createMockUser(),
      session: createMockSession(),
      authType: 'session',
      scopes: ['*'],
    };

    it('covers getClient, getClientList, not found returns, duplicate detections, and remove contact invariants', async () => {
      // getClient not found
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const getRes = await clientService.getClient(
        '01912345-6789-7abc-8def-012345678000',
        dummyDbClient,
      );
      expect(getRes).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // getClientList default parameters
      vi.spyOn(clientRepo, 'listClients').mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
      });
      const listRes = await clientService.getClientList(1, 25, dummyDbClient);
      expect(listRes.success).toBe(true);

      // createClient duplicate detected without acknowledgment
      vi.spyOn(clientRepo, 'findDuplicateEmails').mockResolvedValueOnce([
        { clientId: 'other-client', displayName: 'Other' },
      ]);
      const dupRes = await clientService.createClient(
        {
          kind: 'person',
          displayName: 'Test',
          primaryContact: { givenName: 'John', email: 'dup@example.com' },
          acknowledgeDuplicates: false,
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(dupRes.code).toBe('DUPLICATE_EMAIL');

      // createClient with fallback locale resolution
      vi.spyOn(settingsRepo, 'getStudioSettings').mockResolvedValueOnce({
        id: 'settings-1',
        studio_name: 'Studio',
        default_locale: 'en',
        timezone: 'UTC',
        currency: 'USD',
        created_at: new Date(),
        updated_at: new Date(),
        mfa_required: false,
        mfa_postponed_until: null,
      });
      vi.spyOn(clientRepo, 'findDuplicateEmails').mockResolvedValueOnce([]);
      vi.spyOn(clientRepo, 'insertClientWithPrimaryContact').mockResolvedValueOnce({
        clientId: 'client-1',
        contactId: 'contact-1',
      });
      vi.spyOn(auditModule, 'audit').mockResolvedValue({} as unknown as AuditEvent);

      const createRes = await clientService.createClient(
        {
          kind: 'person',
          displayName: 'Test',
          primaryContact: { givenName: 'John', email: 'john@example.com' },
          acknowledgeDuplicates: true,
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(createRes.success).toBe(true);

      // getStudioSettings error fallback
      vi.spyOn(settingsRepo, 'getStudioSettings').mockRejectedValueOnce(
        new Error('Settings missing'),
      );
      vi.spyOn(clientRepo, 'findDuplicateEmails').mockResolvedValueOnce([]);
      vi.spyOn(clientRepo, 'insertClientWithPrimaryContact').mockResolvedValueOnce({
        clientId: 'client-2',
        contactId: 'contact-2',
      });
      const createFallbackRes = await clientService.createClient(
        {
          kind: 'person',
          displayName: 'Test',
          primaryContact: { givenName: 'John', email: 'john2@example.com' },
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(createFallbackRes.success).toBe(true);

      // updateClient NOT_FOUND
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const updateRes = await clientService.updateClient(
        { clientId: '01912345-6789-7abc-8def-012345678000', displayName: 'New Name' },
        ownerAuth,
        dummyDbClient,
      );
      expect(updateRes).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // addContact NOT_FOUND
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const addRes = await clientService.addContact(
        { clientId: '01912345-6789-7abc-8def-012345678000', givenName: 'Jane' },
        ownerAuth,
        dummyDbClient,
      );
      expect(addRes).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // upsertAddress NOT_FOUND
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const addrRes = await clientService.upsertAddress(
        {
          clientId: '01912345-6789-7abc-8def-012345678000',
          type: 'postal',
          line1: 'Main St 1',
          city: 'Berlin',
          postalCode: '10115',
          countryCode: 'DE',
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(addrRes).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // removeAddress NOT_FOUND
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const rmAddrRes = await clientService.removeAddress(
        { clientId: '01912345-6789-7abc-8def-012345678000', type: 'postal' },
        ownerAuth,
        dummyDbClient,
      );
      expect(rmAddrRes).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // removeContact when existingClient is null
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(null);
      const rmNoClientRes = await clientService.removeContact(
        { clientId: '01912345-6789-7abc-8def-012345678000', contactId: 'contact-1' },
        ownerAuth,
        dummyDbClient,
      );
      expect(rmNoClientRes.code).toBe('NOT_FOUND');

      // removeContact when existingContact is not found on client
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(
        createMockClientWithRelations({
          contacts: [
            {
              id: 'contact-x',
              clientId: '01912345-6789-7abc-8def-012345678000',
              givenName: 'X',
              familyName: null,
              email: null,
              emailNormalized: null,
              phone: null,
              isPrimary: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
      const rmNoContactRes = await clientService.removeContact(
        { clientId: '01912345-6789-7abc-8def-012345678000', contactId: 'contact-y' },
        ownerAuth,
        dummyDbClient,
      );
      expect(rmNoContactRes.code).toBe('NOT_FOUND');

      // removeContact when deleteContactRecord returns null
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(
        createMockClientWithRelations({
          contacts: [
            {
              id: 'contact-1',
              clientId: '01912345-6789-7abc-8def-012345678000',
              givenName: '1',
              familyName: null,
              email: null,
              emailNormalized: null,
              phone: null,
              isPrimary: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'contact-2',
              clientId: '01912345-6789-7abc-8def-012345678000',
              givenName: '2',
              familyName: null,
              email: null,
              emailNormalized: null,
              phone: null,
              isPrimary: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
      vi.spyOn(clientRepo, 'deleteContactRecord').mockResolvedValueOnce(null);
      const rmDelFailedRes = await clientService.removeContact(
        { clientId: '01912345-6789-7abc-8def-012345678000', contactId: 'contact-1' },
        ownerAuth,
        dummyDbClient,
      );
      expect(rmDelFailedRes.code).toBe('NOT_FOUND');

      // getClient found
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(createMockClientWithRelations());
      const getFoundRes = await clientService.getClient(
        '01912345-6789-7abc-8def-012345678000',
        dummyDbClient,
      );
      expect(getFoundRes.success).toBe(true);

      // updateContact when fields change (familyName, phone, isPrimary)
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(
        createMockClientWithRelations({
          contacts: [
            {
              id: 'contact-1',
              clientId: '01912345-6789-7abc-8def-012345678000',
              givenName: 'OldGiven',
              familyName: 'OldFamily',
              email: 'old@example.com',
              emailNormalized: 'old@example.com',
              phone: '111',
              isPrimary: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
      vi.spyOn(clientRepo, 'findDuplicateEmails').mockResolvedValueOnce([]);
      vi.spyOn(clientRepo, 'updateContactRecord').mockResolvedValueOnce({
        id: 'contact-1',
        clientId: '01912345-6789-7abc-8def-012345678000',
        givenName: 'NewGiven',
        familyName: 'NewFamily',
        email: 'new@example.com',
        emailNormalized: 'new@example.com',
        phone: '222',
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const updateContactAllFieldsRes = await clientService.updateContact(
        {
          clientId: '01912345-6789-7abc-8def-012345678000',
          contactId: 'contact-1',
          givenName: 'NewGiven',
          familyName: 'NewFamily',
          email: 'new@example.com',
          phone: '222',
          isPrimary: true,
          acknowledgeDuplicates: true,
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(updateContactAllFieldsRes.success).toBe(true);

      // updateContact when updateContactRecord returns null
      vi.spyOn(clientRepo, 'getClientById').mockResolvedValueOnce(
        createMockClientWithRelations({
          contacts: [
            {
              id: 'contact-1',
              clientId: '01912345-6789-7abc-8def-012345678000',
              givenName: 'Given',
              familyName: null,
              email: null,
              emailNormalized: null,
              phone: null,
              isPrimary: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
      vi.spyOn(clientRepo, 'updateContactRecord').mockResolvedValueOnce(null);
      const updateContactFailedRes = await clientService.updateContact(
        {
          clientId: '01912345-6789-7abc-8def-012345678000',
          contactId: 'contact-1',
          givenName: 'Given2',
        },
        ownerAuth,
        dummyDbClient,
      );
      expect(updateContactFailedRes.code).toBe('NOT_FOUND');
    });
  });

  describe('Schema branch coverage', () => {
    it('tests singleLineString, countryCodeSchema, and schema edge cases', () => {
      const min2String = singleLineString(10, 2);
      expect(min2String.safeParse('a').success).toBe(false);
      expect(min2String.safeParse('hello\x00world').success).toBe(false);

      // Country code schema
      expect(countryCodeSchema.safeParse('DE').success).toBe(true);
      expect(countryCodeSchema.safeParse('de').success).toBe(true); // transformed to uppercase
      expect(countryCodeSchema.safeParse('XYZ').success).toBe(false);
      expect(countryCodeSchema.safeParse('ZZ').success).toBe(false);

      // isValidCountryCode catch block
      const displayNamesSpy = vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
        throw new Error('Intl unsupported');
      });
      expect(isValidCountryCode('DE')).toBe(false);
      displayNamesSpy.mockRestore();

      // normalizeEmail branches
      expect(normalizeEmail('   ')).toBeNull();
      expect(normalizeEmail(null)).toBeNull();
      expect(normalizeEmail(undefined)).toBeNull();
      expect(normalizeEmail(123 as unknown as string)).toBeNull();

      // addContactInputSchema with only familyName
      const familyOnlyAdd = addContactInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        familyName: 'Smith',
      });
      expect(familyOnlyAdd.success).toBe(true);

      // updateContactInputSchema refinement branches
      const validUpdate = updateContactInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        contactId: '01912345-6789-7abc-8def-012345678001',
        givenName: 'Alice',
      });
      expect(validUpdate.success).toBe(true);

      const invalidUpdateBothEmpty = updateContactInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        contactId: '01912345-6789-7abc-8def-012345678001',
        givenName: '   ',
        familyName: '',
      });
      expect(invalidUpdateBothEmpty.success).toBe(false);

      const invalidAddContactNeither = addContactInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        givenName: '',
        familyName: null,
      });
      expect(invalidAddContactNeither.success).toBe(false);

      // upsertAddressInputSchema postal code and country code refinements
      const missingPostal = upsertAddressInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        type: 'postal',
        line1: 'Street 1',
        city: 'City',
        countryCode: 'DE',
      });
      expect(missingPostal.success).toBe(false);

      const missingCountry = upsertAddressInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        type: 'postal',
        line1: 'Street 1',
        city: 'City',
        postalCode: '10115',
      });
      expect(missingCountry.success).toBe(false);

      const validWithSnakeCase = upsertAddressInputSchema.safeParse({
        clientId: '01912345-6789-7abc-8def-012345678000',
        type: 'billing',
        line1: 'Street 1',
        city: 'City',
        postal_code: '10115',
        country_code: 'DE',
      });
      expect(validWithSnakeCase.success).toBe(true);
    });

    it('covers client repo error and not-found branches', async () => {
      // 1. deleteContactRecord returns null when contact not found
      const mockTxNotFound = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      };
      const mockDbNotFound = {
        transaction: (cb: any) => cb(mockTxNotFound),
      } as unknown as DbClient;

      const delContactRes = await clientRepo.deleteContactRecord(
        'c-1',
        'ct-notfound',
        mockDbNotFound,
      );
      expect(delContactRes).toBeNull();

      // 2. upsertAddressRecord throws CLIENT_NOT_FOUND when client does not exist
      await expect(
        clientRepo.upsertAddressRecord(
          'c-notfound',
          {
            type: 'postal',
            line1: 'Test St',
            postalCode: '10115',
            city: 'Berlin',
            countryCode: 'DE',
          },
          mockDbNotFound,
        ),
      ).rejects.toThrow('CLIENT_NOT_FOUND');

      // 3. upsertAddressRecord throws Failed to upsert address when returning is empty
      const mockTxUpsertEmpty = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 'c-1' }]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => ({
              returning: () => Promise.resolve([]),
            }),
          }),
        }),
      };
      const mockDbUpsertEmpty = {
        transaction: (cb: any) => cb(mockTxUpsertEmpty),
      } as unknown as DbClient;

      await expect(
        clientRepo.upsertAddressRecord(
          'c-1',
          {
            type: 'postal',
            line1: 'Test St',
            postalCode: '10115',
            city: 'Berlin',
            countryCode: 'DE',
          },
          mockDbUpsertEmpty,
        ),
      ).rejects.toThrow('Failed to upsert address');

      // 4. deleteAddressRecord returns false when address does not exist
      const delAddrRes = await clientRepo.deleteAddressRecord('c-1', 'postal', mockDbNotFound);
      expect(delAddrRes).toBe(false);

      // 5. updateContactRecord returns null when contact not found
      const updateContactRes = await clientRepo.updateContactRecord(
        'c-1',
        'ct-notfound',
        { givenName: 'Test' },
        mockDbNotFound,
      );
      expect(updateContactRes).toBeNull();

      // 6. insertContact throws Failed to insert contact when returning is empty
      const mockTxInsertEmpty = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 'c-1' }]),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      };
      const mockDbInsertEmpty = {
        transaction: (cb: any) => cb(mockTxInsertEmpty),
      } as unknown as DbClient;

      await expect(
        clientRepo.insertContact('c-1', { givenName: 'Alice', isPrimary: true }, mockDbInsertEmpty),
      ).rejects.toThrow('Failed to insert contact');
    });
  });
});
