import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as privacyModule from '@/server/projects/privacy/index';
import {
  projectsExportProvider,
  PROJECT_EXPORT_HEADERS,
  formatHtmlTable,
} from '@/server/projects/privacy/index';
import { projectsErasureProvider } from '@/server/projects/privacy/index';
import { projectsHoldProvider } from '@/server/projects/privacy/index';
import { projectsActivityProvider } from '@/server/projects/privacy/index';
import { getCategoryDefinition } from '@/server/privacy/export/categories';
import { formatColumnHeader } from '@/server/privacy/export/html';
import type { DbClient } from '@/server/db/client';

describe('TASK-0035 Projects Privacy Providers Unit Tests', () => {
  describe('Category Registration (AC-1, AC-8)', () => {
    it('AC-1: projects category is registered with all required statutory disclosures', () => {
      const def = getCategoryDefinition('projects');
      expect(def).toBeDefined();
      expect(def?.id).toBe('projects');
      expect(def?.title.en).toBe('Projects & Shoots');
      expect(def?.title.de).toBe('Projekte & Shootings');
      expect(def?.purpose.en).toContain('Execution and fulfillment');
      expect(def?.purpose.de).toContain('Durchführung und Erfüllung');
      expect(def?.lawfulBasis.en).toContain('Art. 6(1)(b) GDPR');
      expect(def?.lawfulBasis.de).toContain('Art. 6 Abs. 1 lit. b DSGVO');
      expect(def?.retention.en).toContain('§ 257 HGB / § 147 AO');
      expect(def?.retention.de).toContain('§ 257 HGB / § 147 AO');
      expect(def?.recipients.en).toContain('None (stored locally');
      expect(def?.recipients.de).toContain('Keine (ausschließlich lokale');
      expect(def?.source.en).toContain('Provided by the client');
      expect(def?.source.de).toContain('Vom Kunden bereitgestellt');
    });

    it('AC-8: formatColumnHeader localizes headers into German correctly', () => {
      expect(formatColumnHeader('project', 'de')).toBe('Projekt');
      expect(formatColumnHeader('stage', 'de')).toBe('Phase');
      expect(formatColumnHeader('shoot_date', 'de')).toBe('Shooting-Datum');
      expect(formatColumnHeader('locations', 'de')).toBe('Orte');
      expect(formatColumnHeader('timeline', 'de')).toBe('Zeitplan');
      expect(formatColumnHeader('tasks', 'de')).toBe('Aufgaben');
      expect(formatColumnHeader('participants', 'de')).toBe('Teilnehmer');
      expect(formatColumnHeader('role', 'de')).toBe('Rolle');

      // English fallback
      expect(formatColumnHeader('project', 'en')).toBe('Project');
      expect(formatColumnHeader('stage', 'en')).toBe('Stage');
      expect(formatColumnHeader('shoot_date', 'en')).toBe('Shoot Date');
      expect(formatColumnHeader('locations', 'en')).toBe('Locations');
      expect(formatColumnHeader('timeline', 'en')).toBe('Timeline');
      expect(formatColumnHeader('tasks', 'en')).toBe('Tasks');
      expect(formatColumnHeader('participants', 'en')).toBe('Participants');
    });

    it('AC-8: formatHtmlTable renders accessible HTML table with localized column headers', () => {
      const headersDe = [
        PROJECT_EXPORT_HEADERS.de.project,
        PROJECT_EXPORT_HEADERS.de.stage,
        PROJECT_EXPORT_HEADERS.de.shootDate,
        PROJECT_EXPORT_HEADERS.de.locations,
        PROJECT_EXPORT_HEADERS.de.timeline,
        PROJECT_EXPORT_HEADERS.de.tasks,
        PROJECT_EXPORT_HEADERS.de.participants,
      ];
      const rows = [
        [
          'Wedding Emma & Liam',
          'Inquiry',
          '2026-08-15',
          'St. Thomas Church',
          '14:00 Ceremony',
          'Prepare contract [ ]',
          'Emma: Bride',
        ],
      ];

      const html = formatHtmlTable(headersDe, rows, 'Projekte');
      expect(html).toContain('<th scope="col">Projekt</th>');
      expect(html).toContain('<th scope="col">Phase</th>');
      expect(html).toContain('<th scope="col">Shooting-Datum</th>');
      expect(html).toContain('<th scope="col">Orte</th>');
      expect(html).toContain('<th scope="col">Zeitplan</th>');
      expect(html).toContain('<th scope="col">Aufgaben</th>');
      expect(html).toContain('<th scope="col">Teilnehmer</th>');
      expect(html).toContain('<td>Wedding Emma &amp; Liam</td>');
      expect(html).toContain('aria-label="Projekte"');
    });
  });

  describe('Module Exports Sanity', () => {
    it('exports all providers and helpers from index', () => {
      expect(privacyModule.projectsExportProvider).toBeDefined();
      expect(privacyModule.projectsErasureProvider).toBeDefined();
      expect(privacyModule.projectsHoldProvider).toBeDefined();
      expect(privacyModule.projectsActivityProvider).toBeDefined();
      expect(privacyModule.PROJECT_EXPORT_HEADERS).toBeDefined();
      expect(privacyModule.formatHtmlTable).toBeDefined();
    });
  });

  describe('Hold Provider Logic (AC-2, AC-3)', () => {
    it('AC-2: hold provider returns active_project hold when a project is in active category', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () =>
                Promise.resolve([
                  { projectId: 'p1', stageCategory: 'inquiry' },
                  { projectId: 'p2', stageCategory: 'archived' },
                ]),
            }),
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const holds = await projectsHoldProvider.holds({ kind: 'client', clientId: 'c1' }, mockTx);

      expect(holds).toHaveLength(1);
      expect(holds[0]?.reason).toBe('active_project');
      expect(holds[0]?.retainUntil).toBeNull();
    });

    it('AC-3: hold provider returns upcoming_shoot hold when shoot is in future even if projects are completed/archived', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);

      const mockTx = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () =>
                Promise.resolve([
                  { projectId: 'p1', stageCategory: 'completed' },
                  { projectId: 'p2', stageCategory: 'archived' },
                ]),
            }),
            where: () => ({
              orderBy: () => Promise.resolve([{ startsAt: futureDate }]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const holds = await projectsHoldProvider.holds({ kind: 'client', clientId: 'c1' }, mockTx);

      expect(holds).toHaveLength(1);
      expect(holds[0]?.reason).toBe('upcoming_shoot');
      expect(holds[0]?.retainUntil).toBe(futureDate.toISOString());
    });

    it('AC-4: hold provider returns zero holds when all projects are archived/completed and shoots are in past', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () =>
                Promise.resolve([
                  { projectId: 'p1', stageCategory: 'completed' },
                  { projectId: 'p2', stageCategory: 'archived' },
                ]),
            }),
            where: () => ({
              orderBy: () => Promise.resolve([]), // no upcoming shoots
            }),
          }),
        }),
      } as unknown as DbClient;

      const holds = await projectsHoldProvider.holds({ kind: 'client', clientId: 'c1' }, mockTx);

      expect(holds).toHaveLength(0);
    });

    it('AC-4: hold provider returns zero holds when client has no projects at all', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const holds = await projectsHoldProvider.holds({ kind: 'client', clientId: 'c1' }, mockTx);

      expect(holds).toHaveLength(0);
    });

    it('AC-7: hold provider ignores non-client subjects (e.g. leads)', async () => {
      const mockTx = {} as DbClient;
      const holds = await projectsHoldProvider.holds({ kind: 'lead', leadId: 'lead-123' }, mockTx);
      expect(holds).toEqual([]);
    });
  });

  describe('Export Provider Unit (AC-1, AC-6)', () => {
    it('AC-1: returns empty array when client has no projects', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                orderBy: () => Promise.resolve([]),
              }),
            }),
          }),
        }),
      } as unknown as DbClient;

      const items = await projectsExportProvider.collect(
        {
          kind: 'client',
          clientId: 'c-none',
          contactId: 'c-none',
          contact: {} as never,
          client: {} as never,
        },
        mockTx,
      );
      expect(items).toEqual([]);
    });

    it('AC-1: handles project without primaryShootStartsAt, optional endsAt, and non-completed tasks', async () => {
      const shootDate = new Date('2026-09-01T12:00:00Z');
      let selectCount = 0;
      const mockTx = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                orderBy: () =>
                  Promise.resolve([
                    {
                      project: {
                        id: 'p1',
                        title: 'Project No Primary',
                        projectTypeKey: 'portrait',
                        currency: 'EUR',
                        priceMinor: 50000,
                        notes: 'Notes',
                        createdAt: new Date('2026-01-01'),
                        lastActivityAt: new Date('2026-01-02'),
                        primaryShootStartsAt: null,
                      },
                      stage: null,
                    },
                  ]),
              }),
            }),
            where: () => ({
              orderBy: () => {
                selectCount++;
                if (selectCount === 1) {
                  // shoots
                  return Promise.resolve([
                    {
                      id: 's1',
                      projectId: 'p1',
                      title: 'Main Shoot',
                      startsAt: shootDate,
                      endsAt: null,
                      timezone: 'UTC',
                      notes: null,
                    },
                  ]);
                }
                if (selectCount === 2) {
                  // shootLocations
                  return Promise.resolve([]);
                }
                if (selectCount === 3) {
                  // shootTimelineItems
                  return Promise.resolve([
                    {
                      id: 't1',
                      shootId: 's1',
                      title: 'Arrival',
                      startsAt: shootDate,
                      endsAt: null,
                      description: null,
                    },
                  ]);
                }
                if (selectCount === 4) {
                  // projectTasks
                  return Promise.resolve([
                    {
                      id: 'task1',
                      projectId: 'p1',
                      title: 'Upload raw photos',
                      isCompleted: false,
                      completedAt: null,
                      dueDate: null,
                    },
                  ]);
                }
                // projectParticipants
                return Promise.resolve([]);
              },
            }),
          }),
        }),
      } as unknown as DbClient;

      const items = (await projectsExportProvider.collect(
        {
          kind: 'client',
          clientId: 'c1',
          contactId: 'c1',
          contact: {} as never,
          client: {} as never,
        },
        mockTx,
      )) as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      const res = items[0];
      if (!res) throw new Error('Expected item');
      expect(res.stage).toBe('Unknown');
      expect(res.shoot_date).toBe(shootDate.toISOString());
    });

    it('AC-6: collects participant role and project title for contact subject', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              leftJoin: () => ({
                where: () => ({
                  orderBy: () =>
                    Promise.resolve([
                      {
                        participantId: 'part-1',
                        role: 'Planner',
                        isPrimary: false,
                        notes: 'Wedding coordinator',
                        createdAt: new Date('2026-02-01T10:00:00Z'),
                        projectId: 'proj-1',
                        projectTitle: 'Emma & Liam Wedding',
                        projectTypeKey: 'wedding',
                        stageName: 'Booked',
                      },
                    ]),
                }),
              }),
            }),
          }),
        }),
      } as unknown as DbClient;

      const items = (await projectsExportProvider.collect(
        {
          kind: 'contact',
          contactId: 'contact-planner',
          clientId: 'client-1',
          contact: {} as never,
          client: {} as never,
        },
        mockTx,
      )) as Record<string, unknown>[];

      expect(items).toHaveLength(1);
      const row = items[0];
      if (!row) throw new Error('Expected row');
      expect(row.project).toBe('Emma & Liam Wedding');
      expect(row.project_title).toBe('Emma & Liam Wedding');
      expect(row.role).toBe('Planner');
      expect(row.stage).toBe('Booked');
    });

    it('AC-1: returns empty array for lead subject in export provider', async () => {
      const mockTx = {} as DbClient;
      const res = await projectsExportProvider.collect(
        { kind: 'lead', leadId: 'l1', lead: {} as never },
        mockTx,
      );
      expect(res).toEqual([]);
    });
  });

  describe('Erasure Provider Unit (AC-4, AC-6)', () => {
    it('AC-4: plans client project count accurately and returns 0 for lead subject', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 3 }]),
          }),
        }),
      } as unknown as DbClient;

      const planLead = await projectsErasureProvider.plan({ kind: 'lead', leadId: 'l1' }, mockTx);
      expect(planLead).toBe(0);

      const planClient = await projectsErasureProvider.plan(
        { kind: 'client', clientId: 'c1' },
        mockTx,
      );
      expect(planClient).toBe(3);

      const mockTxEmpty = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const planEmpty = await projectsErasureProvider.plan(
        { kind: 'client', clientId: 'c1' },
        mockTxEmpty,
      );
      expect(planEmpty).toBe(0);
    });

    it('AC-6: plans contact participant count accurately and handles empty result', async () => {
      const mockTxEmpty = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const countEmpty = await projectsErasureProvider.plan(
        { kind: 'contact', clientId: 'c1', contactId: 'cont-1' },
        mockTxEmpty,
      );
      expect(countEmpty).toBe(0);

      const mockTxWithCount = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 5 }]),
          }),
        }),
      } as unknown as DbClient;

      const count2 = await projectsErasureProvider.plan(
        { kind: 'contact', clientId: 'c1', contactId: 'cont-1' },
        mockTxWithCount,
      );
      expect(count2).toBe(5);
    });

    it('AC-4: erase returns 0 for lead subject', async () => {
      const mockTx = {} as DbClient;
      const count = await projectsErasureProvider.erase({ kind: 'lead', leadId: 'l1' }, mockTx);
      expect(count).toBe(0);
    });

    it('AC-4: erase returns 0 when client has no projects', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const count = await projectsErasureProvider.erase({ kind: 'client', clientId: 'c1' }, mockTx);
      expect(count).toBe(0);
    });

    it('AC-4: erase cascades correctly when client has projects with no shoots', async () => {
      let selectCount = 0;
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                // clientProjects
                return Promise.resolve([{ id: 'p1' }]);
              }
              // clientShoots
              return Promise.resolve([]);
            },
          }),
        }),
        delete: () => ({
          where: () => {
            const p = Promise.resolve([{ id: 'p1' }]);
            (p as unknown as { returning: () => Promise<unknown[]> }).returning = () =>
              Promise.resolve([{ id: 'p1' }]);
            return p;
          },
        }),
      } as unknown as DbClient;

      const count = await projectsErasureProvider.erase({ kind: 'client', clientId: 'c1' }, mockTx);
      expect(count).toBe(1);
    });

    it('AC-6: erases contact participant referencing by nullifying if name retained or deleting if no name', async () => {
      let updated = false;
      let deleted = false;

      const mockTx = {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                { id: 'p1', name: 'Vendor Name' },
                { id: 'p2', name: null },
              ]),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => {
              updated = true;
              return Promise.resolve();
            },
          }),
        }),
        delete: () => ({
          where: () => {
            deleted = true;
            return Promise.resolve();
          },
        }),
      } as unknown as DbClient;

      const count = await projectsErasureProvider.erase(
        { kind: 'contact', clientId: 'c1', contactId: 'cont-1' },
        mockTx,
      );

      expect(count).toBe(2);
      expect(updated).toBe(true);
      expect(deleted).toBe(true);
    });
  });

  describe('Activity Provider Unit (AC-5)', () => {
    it('AC-5: returns candidate client IDs having active stage categories, recent activity, or upcoming shoots', async () => {
      const candidateIds = ['c-active-stage', 'c-recent-act', 'c-upcoming-shoot', 'c-dormant'];
      const since = new Date(Date.now() - 36 * 30 * 24 * 3600 * 1000); // 36 months ago

      const mockTx = {
        selectDistinct: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => {
                // Check if this was the stage check or shoot check
                return Promise.resolve([{ clientId: 'c-active-stage' }]);
              },
            }),
            where: () => Promise.resolve([{ clientId: 'c-recent-act' }]),
          }),
        }),
      } as unknown as DbClient;

      const activeSet = new Set(
        await projectsActivityProvider.activeClientIds(mockTx, since, candidateIds),
      );

      expect(activeSet.has('c-active-stage')).toBe(true);
      expect(activeSet.has('c-recent-act')).toBe(true);
      expect(activeSet.has('c-dormant')).toBe(false);
    });

    it('AC-5: returns empty array immediately when candidateIds is empty', async () => {
      const mockTx = {} as DbClient;
      const res = await projectsActivityProvider.activeClientIds(mockTx, new Date(), []);
      expect(res).toEqual([]);
    });
  });
});
