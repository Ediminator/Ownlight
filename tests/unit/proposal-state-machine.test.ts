import { describe, it, expect } from 'vitest';
import {
  canTransitionProposalStatus,
  assertProposalTransitionAllowed,
  assertProposalEditable,
  ProposalImmutableError,
  ProposalStateTransitionError,
  createAcceptedOptionsSnapshot,
  snapshotPackageToLineItem,
  snapshotCatalogueItemToLineItem,
} from '@/server/proposals/snapshot';
import type { Proposal, ProposalLineItem } from '@/server/db/schema/proposals';

describe('TASK-0058: Proposal State Machine & Immutability Engine (AC-6)', () => {
  describe('Legal transitions', () => {
    it('AC-6: permits valid forward transitions from draft', () => {
      expect(canTransitionProposalStatus('draft', 'sent')).toBe(true);
      expect(canTransitionProposalStatus('draft', 'accepted')).toBe(true);
      expect(canTransitionProposalStatus('draft', 'superseded')).toBe(true);
      expect(() => {
        assertProposalTransitionAllowed('draft', 'sent');
      }).not.toThrow();
      expect(() => {
        assertProposalTransitionAllowed('draft', 'accepted');
      }).not.toThrow();
    });

    it('AC-6: permits valid transitions from sent', () => {
      expect(canTransitionProposalStatus('sent', 'accepted')).toBe(true);
      expect(canTransitionProposalStatus('sent', 'declined')).toBe(true);
      expect(canTransitionProposalStatus('sent', 'expired')).toBe(true);
      expect(canTransitionProposalStatus('sent', 'superseded')).toBe(true);
      expect(() => {
        assertProposalTransitionAllowed('sent', 'accepted');
      }).not.toThrow();
      expect(() => {
        assertProposalTransitionAllowed('sent', 'declined');
      }).not.toThrow();
      expect(() => {
        assertProposalTransitionAllowed('sent', 'expired');
      }).not.toThrow();
    });

    it('AC-6: permits transitioning declined or expired proposals to superseded', () => {
      expect(canTransitionProposalStatus('declined', 'superseded')).toBe(true);
      expect(canTransitionProposalStatus('expired', 'superseded')).toBe(true);
      expect(() => {
        assertProposalTransitionAllowed('declined', 'superseded');
      }).not.toThrow();
      expect(() => {
        assertProposalTransitionAllowed('expired', 'superseded');
      }).not.toThrow();
    });
  });

  describe('Illegal transitions & immutable lock enforcement', () => {
    it('AC-6: forbids any transition out of accepted status', () => {
      expect(canTransitionProposalStatus('accepted', 'draft')).toBe(false);
      expect(canTransitionProposalStatus('accepted', 'sent')).toBe(false);
      expect(canTransitionProposalStatus('accepted', 'accepted')).toBe(false);
      expect(canTransitionProposalStatus('accepted', 'declined')).toBe(false);
      expect(canTransitionProposalStatus('accepted', 'expired')).toBe(false);
      expect(canTransitionProposalStatus('accepted', 'superseded')).toBe(false);

      expect(() => {
        assertProposalTransitionAllowed('accepted', 'draft');
      }).toThrow(ProposalImmutableError);
      expect(() => {
        assertProposalTransitionAllowed('accepted', 'sent');
      }).toThrow(ProposalImmutableError);
      expect(() => {
        assertProposalTransitionAllowed('accepted', 'accepted');
      }).toThrow(ProposalImmutableError);
    });

    it('AC-6: forbids backwards transitions to draft from non-draft states', () => {
      expect(canTransitionProposalStatus('sent', 'draft')).toBe(false);
      expect(canTransitionProposalStatus('declined', 'draft')).toBe(false);
      expect(canTransitionProposalStatus('expired', 'draft')).toBe(false);

      expect(() => {
        assertProposalTransitionAllowed('sent', 'draft');
      }).toThrow(ProposalStateTransitionError);
      expect(() => {
        assertProposalTransitionAllowed('declined', 'draft');
      }).toThrow(ProposalStateTransitionError);
    });

    it('AC-6: assertProposalEditable allows draft and sent proposals, but throws on accepted and superseded', () => {
      expect(() => {
        assertProposalEditable({ status: 'draft' });
      }).not.toThrow();
      expect(() => {
        assertProposalEditable({ status: 'sent' });
      }).not.toThrow();

      expect(() => {
        assertProposalEditable({ status: 'accepted' });
      }).toThrow(ProposalImmutableError);
      expect(() => {
        assertProposalEditable({ status: 'superseded' });
      }).toThrow(ProposalImmutableError);
    });
  });

  describe('Accepted options snapshot serialization', () => {
    it('AC-6: creates an immutable JSON snapshot capturing line items, quantities, and totals', () => {
      const mockProposal: Proposal = {
        id: '01920000-0000-7000-8000-000000000201',
        projectId: '01920000-0000-7000-8000-000000000071',
        clientId: '01920000-0000-7000-8000-000000000081',
        title: 'Wedding Photography Proposal',
        status: 'draft',
        version: 1,
        currency: 'EUR',
        subtotalMinor: 280000,
        taxMinor: 44706,
        totalMinor: 280000,
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: null,
        tokenHash: 'a'.repeat(64),
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockItems: ProposalLineItem[] = [
        {
          id: '01920000-0000-7000-8000-000000000211',
          proposalId: mockProposal.id,
          packageId: '01920000-0000-7000-8000-000000000101',
          catalogueItemId: null,
          itemType: 'base_package',
          name: 'Full Day Wedding Coverage',
          description: '8 Hours continuous coverage',
          unitPriceMinor: 250000,
          quantity: 1,
          minQuantity: 1,
          maxQuantity: 1,
          taxRateBasisPoints: 1900,
          isOptional: false,
          isSelected: true,
          position: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '01920000-0000-7000-8000-000000000212',
          proposalId: mockProposal.id,
          packageId: null,
          catalogueItemId: '01920000-0000-7000-8000-000000000102',
          itemType: 'addon',
          name: 'Fine Art Leather Album',
          description: '30x30 handmade album',
          unitPriceMinor: 50000,
          quantity: 1,
          minQuantity: 0,
          maxQuantity: 2,
          taxRateBasisPoints: 1900,
          isOptional: true,
          isSelected: true,
          position: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '01920000-0000-7000-8000-000000000213',
          proposalId: mockProposal.id,
          packageId: null,
          catalogueItemId: null,
          itemType: 'addon',
          name: 'Second Shooter',
          description: 'Unselected optional add-on',
          unitPriceMinor: 40000,
          quantity: 1,
          minQuantity: 0,
          maxQuantity: 1,
          taxRateBasisPoints: 1900,
          isOptional: true,
          isSelected: false,
          position: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const snapshot = createAcceptedOptionsSnapshot(mockProposal, mockItems, {
        acceptedByName: 'Emma Watson',
        acceptedByEmail: 'emma@example.com',
      });

      expect(snapshot).toBeDefined();
      expect(snapshot.acceptedByName).toBe('Emma Watson');
      expect(snapshot.acceptedByEmail).toBe('emma@example.com');
      expect(snapshot.totalMinor).toBe(300000); // 250000 + 50000
      expect(snapshot.subtotalMinor).toBe(300000);
      expect(snapshot.taxMinor).toBe(47899); // net = Math.round(300000 * 10000 / 11900) = 252101, tax = 300000 - 252101 = 47899
      expect(snapshot.currency).toBe('EUR');
      expect(snapshot.pricesIncludeTax).toBe(true);

      // Verify selected items only are included
      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.items[0]?.name).toBe('Full Day Wedding Coverage');
      expect(snapshot.items[0]?.lineTotalMinor).toBe(250000);
      expect(snapshot.items[1]?.name).toBe('Fine Art Leather Album');
      expect(snapshot.items[1]?.lineTotalMinor).toBe(50000);

      // Verify tax breakdown exists
      expect(snapshot.taxBreakdown).toHaveLength(1);
      expect(snapshot.taxBreakdown[0]?.taxRateBasisPoints).toBe(1900);
      expect(snapshot.taxBreakdown[0]?.grossMinor).toBe(300000);
    });
  });

  describe('Package and catalogue item snapshot helpers', () => {
    it('snapshots package into proposal line item structure with defaults and overrides', () => {
      const pkg = {
        id: '01920000-0000-7000-8000-000000000101',
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
        description: 'Comprehensive wedding coverage',
        projectTypeKey: 'wedding',
        basePriceMinor: 280000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const defaultItem = snapshotPackageToLineItem(pkg);
      expect(defaultItem.packageId).toBe(pkg.id);
      expect(defaultItem.catalogueItemId).toBeNull();
      expect(defaultItem.itemType).toBe('base_package');
      expect(defaultItem.name).toBe(pkg.name);
      expect(defaultItem.unitPriceMinor).toBe(280000);
      expect(defaultItem.quantity).toBe(1);
      expect(defaultItem.isOptional).toBe(false);
      expect(defaultItem.isSelected).toBe(true);

      const overriddenItem = snapshotPackageToLineItem(pkg, { position: 5, isOptional: true });
      expect(overriddenItem.position).toBe(5);
      expect(overriddenItem.isOptional).toBe(true);
    });

    it('snapshots catalogue item into proposal line item structure with defaults and overrides', () => {
      const item = {
        id: '01920000-0000-7000-8000-000000000102',
        name: 'Extra Hour Coverage',
        slug: 'extra-hour-coverage',
        description: 'Additional hour of coverage',
        category: 'service' as const,
        unitPriceMinor: 25000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const defaultItem = snapshotCatalogueItemToLineItem(item);
      expect(defaultItem.packageId).toBeNull();
      expect(defaultItem.catalogueItemId).toBe(item.id);
      expect(defaultItem.itemType).toBe('addon');
      expect(defaultItem.name).toBe(item.name);
      expect(defaultItem.unitPriceMinor).toBe(25000);
      expect(defaultItem.quantity).toBe(1);
      expect(defaultItem.isOptional).toBe(true);
      expect(defaultItem.isSelected).toBe(true);

      const overriddenItem = snapshotCatalogueItemToLineItem(item, {
        isSelected: false,
        maxQuantity: 3,
      });
      expect(overriddenItem.isSelected).toBe(false);
      expect(overriddenItem.maxQuantity).toBe(3);
    });

    it('snapshots package and catalogue items with null descriptions gracefully', () => {
      const pkgWithoutDesc = {
        id: '01920000-0000-7000-8000-000000000101',
        name: 'Package No Desc',
        slug: 'no-desc',
        description: null,
        projectTypeKey: null,
        basePriceMinor: 100000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const lineItem = snapshotPackageToLineItem(pkgWithoutDesc);
      expect(lineItem.description).toBeNull();

      const itemWithoutDesc = {
        id: '01920000-0000-7000-8000-000000000102',
        name: 'Item No Desc',
        slug: 'item-no-desc',
        description: null,
        category: 'product' as const,
        unitPriceMinor: 5000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const catLineItem = snapshotCatalogueItemToLineItem(itemWithoutDesc);
      expect(catLineItem.description).toBeNull();
    });

    it('creates snapshot without acceptanceDetails provided', () => {
      const mockProposal = {
        id: '01920000-0000-7000-8000-000000000201',
        projectId: '01920000-0000-7000-8000-000000000071',
        clientId: '01920000-0000-7000-8000-000000000081',
        title: 'Simple Proposal',
        status: 'draft' as const,
        version: 1,
        currency: 'EUR',
        subtotalMinor: 10000,
        taxMinor: 1597,
        totalMinor: 10000,
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: null,
        tokenHash: 'b'.repeat(64),
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const snapshot = createAcceptedOptionsSnapshot(mockProposal, []);
      expect(snapshot.acceptedByName).toBeNull();
      expect(snapshot.acceptedByEmail).toBeNull();
      expect(snapshot.items).toHaveLength(0);
    });
  });
});
