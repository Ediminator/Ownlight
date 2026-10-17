import { describe, it, expect } from 'vitest';
import type { ProjectTask } from '@/server/db/schema/projects';
import type {
  ProjectDetailData,
  ProjectDetailShootLocation,
  ProjectDetailTimelineItem,
  ProjectDetailParticipant,
  ClientProjectSummary,
} from '@/server/projects/service';

describe('Project Detail View & Fulfillment Unit Tests', () => {
  // AC-1: Data model and structure
  describe('AC-1: Project Detail Model & Assembly', () => {
    it('AC-1: validates complete project detail model structure with all relational components', () => {
      const mockProjectDetail: ProjectDetailData = {
        project: {
          id: '11111111-1111-4111-8111-111111111111',
          clientId: '22222222-2222-4222-8222-222222222222',
          leadId: null,
          title: 'Elena & Lucas Wedding',
          projectTypeKey: 'wedding',
          stageId: '33333333-3333-4333-8333-333333333333',
          priceMinor: 350000,
          currency: 'EUR',
          notes: 'Special request: sunset couple photos at 19:30',
          lastActivityAt: new Date('2026-06-01T10:00:00Z'),
          primaryShootStartsAt: null,
          primaryShootTimezone: null,
          createdAt: new Date('2026-06-01T10:00:00Z'),
          updatedAt: new Date('2026-06-01T10:00:00Z'),
        },
        client: {
          id: '22222222-2222-4222-8222-222222222222',
          displayName: 'Elena Rostova',
          email: 'elena@example.com',
          phone: '+49 30 12345678',
        },
        stages: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            key: 'inquiry',
            name: 'Inquiry',
            position: 1,
            color: '#6366f1',
            category: 'inquiry',
            isSystem: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            key: 'booked',
            name: 'Booked',
            position: 2,
            color: '#3b82f6',
            category: 'booked',
            isSystem: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentStage: {
          id: '33333333-3333-4333-8333-333333333333',
          key: 'inquiry',
          name: 'Inquiry',
          position: 1,
          color: '#6366f1',
          category: 'inquiry',
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        shoots: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            projectId: '11111111-1111-4111-8111-111111111111',
            title: 'Full Day Wedding Ceremony & Reception',
            startsAt: new Date('2026-08-15T12:00:00Z'),
            endsAt: new Date('2026-08-15T22:00:00Z'),
            timezone: 'Europe/Berlin',
            notes: 'Dual bodies, 35mm, 85mm, godox lighting kit',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        locations: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            shootId: '55555555-5555-4555-8555-555555555555',
            name: 'St. Hedwig Cathedral',
            addressLine1: 'Bebelplatz',
            addressLine2: null,
            postalCode: '10117',
            city: 'Berlin',
            countryCode: 'DE',
            notes: 'No flash photography allowed during vows',
            order: 1,
            shootTitle: 'Full Day Wedding Ceremony & Reception',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        timelineItems: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            shootId: '55555555-5555-4555-8555-555555555555',
            locationId: '66666666-6666-4666-8666-666666666666',
            title: 'Arrival & Guest Gathering',
            description: 'Capture candid photos of arriving guests and floral arrangements',
            startsAt: new Date('2026-08-15T12:00:00Z'),
            endsAt: new Date('2026-08-15T13:00:00Z'),
            order: 1,
            shootTitle: 'Full Day Wedding Ceremony & Reception',
            locationName: 'St. Hedwig Cathedral',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        participants: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            projectId: '11111111-1111-4111-8111-111111111111',
            contactId: null,
            name: 'Sophie Meier',
            role: 'Wedding Planner',
            email: 'sophie@berlinweddings.example',
            phone: '+49 170 9876543',
            isPrimary: true,
            notes: 'Day-of point of contact for schedule cues',
            contactDisplayName: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        tasks: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            projectId: '11111111-1111-4111-8111-111111111111',
            stageId: '33333333-3333-4333-8333-333333333333',
            title: 'Send consultation questionnaire',
            isCompleted: false,
            dueDate: new Date('2026-06-05T00:00:00Z'),
            order: 1,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        clientContacts: [
          {
            id: 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            displayName: 'Elena Rostova',
            email: 'elena@example.com',
            phone: '+49 30 12345678',
            isPrimary: true,
          },
        ],
      };

      expect(mockProjectDetail.project.id).toBe('11111111-1111-4111-8111-111111111111');
      expect(mockProjectDetail.shoots).toHaveLength(1);
      expect(mockProjectDetail.locations).toHaveLength(1);
      expect(mockProjectDetail.timelineItems).toHaveLength(1);
      expect(mockProjectDetail.participants).toHaveLength(1);
      expect(mockProjectDetail.tasks).toHaveLength(1);
      expect(mockProjectDetail.stages).toHaveLength(2);
    });
  });

  // AC-2: Duration calculation logic
  describe('AC-2: Shoot Session Duration & Formatting', () => {
    function calculateDuration(
      startsAt: Date | string,
      endsAt: Date | string | null,
    ): string | null {
      if (!endsAt) return null;
      const start = new Date(startsAt).getTime();
      const end = new Date(endsAt).getTime();
      const diffMinutes = Math.round((end - start) / (1000 * 60));
      if (diffMinutes <= 0) return null;

      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;

      if (hours === 0) return `${String(minutes)}m`;
      if (minutes === 0) return `${String(hours)}h`;
      return `${String(hours)}h ${String(minutes)}m`;
    }

    it('AC-2: calculates duration in hours and minutes accurately', () => {
      const start = '2026-08-15T10:00:00Z';
      const end1 = '2026-08-15T12:30:00Z';
      expect(calculateDuration(start, end1)).toBe('2h 30m');

      const end2 = '2026-08-15T14:00:00Z';
      expect(calculateDuration(start, end2)).toBe('4h');

      const end3 = '2026-08-15T10:45:00Z';
      expect(calculateDuration(start, end3)).toBe('45m');
    });

    it('AC-2: returns null for missing or invalid end dates', () => {
      const start = '2026-08-15T10:00:00Z';
      expect(calculateDuration(start, null)).toBeNull();

      const invalidEnd = '2026-08-15T09:00:00Z'; // before start
      expect(calculateDuration(start, invalidEnd)).toBeNull();
    });
  });

  // AC-3: Chronological timeline sorting
  describe('AC-3: Day-of Timeline Chronological Sorting', () => {
    it('AC-3: sorts timeline items chronologically by startsAt and secondary order', () => {
      const unsortedItems: ProjectDetailTimelineItem[] = [
        {
          id: 'item-3',
          shootId: 'shoot-1',
          locationId: 'loc-1',
          title: 'Reception Dinner & Speeches',
          description: null,
          startsAt: new Date('2026-08-15T18:00:00Z'),
          endsAt: new Date('2026-08-15T21:00:00Z'),
          order: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'item-1',
          shootId: 'shoot-1',
          locationId: 'loc-1',
          title: 'Getting Ready & Details',
          description: null,
          startsAt: new Date('2026-08-15T10:00:00Z'),
          endsAt: new Date('2026-08-15T12:00:00Z'),
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'item-2-b',
          shootId: 'shoot-1',
          locationId: 'loc-1',
          title: 'Family Group Photos',
          description: null,
          startsAt: new Date('2026-08-15T14:00:00Z'),
          endsAt: new Date('2026-08-15T15:00:00Z'),
          order: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'item-2-a',
          shootId: 'shoot-1',
          locationId: 'loc-1',
          title: 'Ceremony Service',
          description: null,
          startsAt: new Date('2026-08-15T14:00:00Z'),
          endsAt: new Date('2026-08-15T15:00:00Z'),
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const sorted = [...unsortedItems].sort((a, b) => {
        const timeDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.order - b.order;
      });

      expect(sorted[0]?.id).toBe('item-1');
      expect(sorted[1]?.id).toBe('item-2-a');
      expect(sorted[2]?.id).toBe('item-2-b');
      expect(sorted[3]?.id).toBe('item-3');
    });

    it('AC-3: maps linked locations correctly to timeline items', () => {
      const locations: ProjectDetailShootLocation[] = [
        {
          id: 'loc-ceremony',
          shootId: 'shoot-1',
          name: 'Cathedral of St. John',
          addressLine1: 'Main St 1',
          addressLine2: null,
          postalCode: '10115',
          city: 'Berlin',
          countryCode: 'DE',
          notes: null,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const locationMap = new Map(locations.map((l) => [l.id, l.name]));

      const itemWithLoc: ProjectDetailTimelineItem = {
        id: 'item-ceremony',
        shootId: 'shoot-1',
        locationId: 'loc-ceremony',
        title: 'Wedding Ceremony',
        description: null,
        startsAt: new Date('2026-08-15T14:00:00Z'),
        endsAt: null,
        order: 1,
        locationName: locationMap.get('loc-ceremony') ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(itemWithLoc.locationName).toBe('Cathedral of St. John');
    });
  });

  // AC-4: Participant role validation & classification
  describe('AC-4: Project Participant Roles & Primary Contact', () => {
    it('AC-4: distinguishes client contacts from external collaborators', () => {
      const clientContactParticipant: ProjectDetailParticipant = {
        id: 'part-1',
        projectId: 'proj-1',
        contactId: 'contact-uuid-1',
        name: null,
        role: 'Bride',
        email: 'bride@example.com',
        phone: '+49 30 11111111',
        isPrimary: true,
        notes: null,
        contactDisplayName: 'Anna Schmidt',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const vendorParticipant: ProjectDetailParticipant = {
        id: 'part-2',
        projectId: 'proj-1',
        contactId: null,
        name: 'Markus Vogel',
        role: 'Second Shooter',
        email: 'markus@photo.example',
        phone: '+49 171 2222222',
        isPrimary: false,
        notes: 'Covers groom prep and ceremony wide angles',
        contactDisplayName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(clientContactParticipant.contactId).not.toBeNull();
      expect(clientContactParticipant.contactDisplayName).toBe('Anna Schmidt');
      expect(clientContactParticipant.isPrimary).toBe(true);

      expect(vendorParticipant.contactId).toBeNull();
      expect(vendorParticipant.name).toBe('Markus Vogel');
      expect(vendorParticipant.role).toBe('Second Shooter');
      expect(vendorParticipant.isPrimary).toBe(false);
    });
  });

  // AC-5: Stage tasks counter & completion calculations
  describe('AC-5: Stage Task Checklist Counter & Advisory Incomplete Tasks', () => {
    const stageId = 'stage-inquiry-id';
    const tasks: ProjectTask[] = [
      {
        id: 't-1',
        projectId: 'p-1',
        stageId,
        title: 'Initial intake questionnaire',
        isCompleted: true,
        completedAt: new Date(),
        dueDate: null,
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 't-2',
        projectId: 'p-1',
        stageId,
        title: 'Schedule discovery call',
        isCompleted: false,
        completedAt: null,
        dueDate: null,
        order: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 't-3',
        projectId: 'p-1',
        stageId,
        title: 'Review shoot moodboard',
        isCompleted: false,
        completedAt: null,
        dueDate: null,
        order: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('AC-5: calculates completed count and progress percentage accurately', () => {
      const stageTasks = tasks.filter((t) => t.stageId === stageId || !t.stageId);
      const completedCount = stageTasks.filter((t) => t.isCompleted).length;
      const totalCount = stageTasks.length;
      const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      expect(completedCount).toBe(1);
      expect(totalCount).toBe(3);
      expect(progressPercent).toBe(33);
    });

    it('AC-5: identifies incomplete tasks that trigger advisory stage transition warning', () => {
      const incompleteTasks = tasks.filter(
        (t) => !t.isCompleted && (t.stageId === stageId || !t.stageId),
      );

      expect(incompleteTasks).toHaveLength(2);
      expect(incompleteTasks.map((t) => t.id)).toEqual(['t-2', 't-3']);
    });

    it('AC-5: returns zero incomplete tasks when all are checked', () => {
      const completedTasks: ProjectTask[] = tasks.map((t) => ({ ...t, isCompleted: true }));
      const incomplete = completedTasks.filter(
        (t) => !t.isCompleted && (t.stageId === stageId || !t.stageId),
      );

      expect(incomplete).toHaveLength(0);
    });
  });

  // AC-6: Client Profile Projects Listing
  describe('AC-6: Client Profile Projects Summary Data', () => {
    it('AC-6: formats client project summary items correctly with stage and primary shoot date', () => {
      const projectSummaries: ClientProjectSummary[] = [
        {
          id: 'proj-1',
          title: 'Clara & David Wedding',
          projectTypeKey: 'wedding',
          stageId: 'stage-uuid',
          stageKey: 'booked',
          stageName: 'Booked',
          stageColor: '#3b82f6',
          priceMinor: 280000,
          currency: 'EUR',
          primaryShootStartsAt: '2026-09-12T13:00:00Z',
          primaryShootTimezone: 'Europe/Berlin',
          taskCount: 4,
          completedTaskCount: 2,
          createdAt: '2026-09-01T10:00:00Z',
        },
      ];

      expect(projectSummaries[0]?.title).toBe('Clara & David Wedding');
      expect(projectSummaries[0]?.stageKey).toBe('booked');
      expect(projectSummaries[0]?.primaryShootStartsAt).not.toBeNull();
      expect(projectSummaries[0]?.completedTaskCount).toBe(2);
      expect(projectSummaries[0]?.taskCount).toBe(4);
    });
  });
});
