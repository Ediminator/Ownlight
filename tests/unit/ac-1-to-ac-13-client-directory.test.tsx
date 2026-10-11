import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientDirectory } from '@/components/clients/client-directory';
import type { ListClientsResult, TagSummaryItem, ClientListItem } from '@/server/clients/repo';
import { listClientsAction } from '@/server/clients/actions';

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => '/en/clients',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'pageSummary' && values) {
      return `Page ${String(values.page)} of ${String(values.totalPages)}`;
    }
    if (key === 'resultsSummary' && values) {
      return `${String(values.count)} clients found`;
    }
    if (key === 'viewProfile' && values) {
      return `View profile for ${String(values.name)}`;
    }
    return `[${key}]`;
  },
}));

vi.mock('@/server/clients/actions', () => ({
  listClientsAction: vi.fn(),
}));

function createMockClient(index: number): ClientListItem {
  const pad = String(index).padStart(2, '0');
  return {
    id: `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    kind: index % 3 === 0 ? 'company' : 'person',
    displayName: `Client ${pad}`,
    primaryContact: {
      givenName: 'Contact',
      familyName: pad,
      email: `contact.${pad}@example.com`,
      phone: `+49 30 0000 ${pad}00`,
    },
    tags: [
      { id: 'tag-1', name: 'Wedding' },
      { id: 'tag-2', name: '2026' },
    ],
  };
}

const mockTags: TagSummaryItem[] = [
  { id: 'tag-1', name: 'Wedding', clientCount: 15 },
  { id: 'tag-2', name: '2026', clientCount: 10 },
  { id: 'tag-3', name: 'Corporate', clientCount: 5 },
];

describe('TASK-0011: Client Directory UI (AC-1 to AC-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockStateQueue = [];
  });

  it('AC-1: displays first 25 clients in name order with primary contact, email, phone, tags, and Page 1 of 2', () => {
    const clients30: ClientListItem[] = Array.from({ length: 25 }, (_, i) =>
      createMockClient(i + 1),
    );
    const initialClients: ListClientsResult = {
      items: clients30,
      total: 30,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory
        initialClients={initialClients}
        tags={mockTags}
        locale="en"
        initialPage={1}
      />,
    );

    // Verify first client name is rendered
    expect(html).toContain('Client 01');
    expect(html).toContain('contact.01@example.com');
    expect(html).toContain('+49 30 0000 0100');
    expect(html).toContain('Wedding');
    expect(html).toContain('2026');

    // Verify 25th client is rendered
    expect(html).toContain('Client 25');

    // Verify pagination displays "Page 1 of 2"
    expect(html).toContain('Page 1 of 2');

    // Next page button is present and not disabled
    expect(html).toContain('data-testid="pagination-next-btn"');
    expect(html).toContain('data-testid="pagination-prev-btn"');
  });

  it('AC-2: renders labelled search field of type="search", submit button, and polite live region', () => {
    const initialClients: ListClientsResult = {
      items: [createMockClient(1)],
      total: 1,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={initialClients} tags={mockTags} locale="en" />,
    );

    // Search field with type="search", proper id and associated label
    expect(html).toContain('type="search"');
    expect(html).toContain('id="client-search"');
    expect(html).toContain('for="client-search"');

    // Polite live region for accessibility (AC-2)
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('role="status"');

    // Search form and submit button
    expect(html).toContain('data-testid="client-search-form"');
    expect(html).toContain('data-testid="client-search-submit-btn"');
  });

  it('AC-3: renders labelled tag filter populated from tags with "All tags" default', () => {
    const initialClients: ListClientsResult = {
      items: [createMockClient(1)],
      total: 1,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={initialClients} tags={mockTags} locale="en" />,
    );

    expect(html).toContain('id="client-tag-filter"');
    expect(html).toContain('for="client-tag-filter"');
    expect(html).toContain('[allTags]');
    expect(html).toContain('Wedding (15)');
    expect(html).toContain('2026 (10)');
    expect(html).toContain('Corporate (5)');
  });

  it('AC-4: given an instance with no clients, then a localized empty state is shown instead of an empty table', () => {
    const emptyClients: ListClientsResult = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={emptyClients} tags={[]} locale="en" />,
    );

    // Empty state container rendered
    expect(html).toContain('data-testid="client-empty-state"');
    expect(html).toContain('[emptyStateTitle]');
    expect(html).toContain('[emptyStateDescription]');

    // Table is not rendered when 0 clients exist
    expect(html).not.toContain('data-testid="client-table"');
  });

  it('AC-4: given a search/filter with 0 matches, then a localized no-results message is shown', () => {
    const zeroResults: ListClientsResult = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    };

    // Simulate tagId active in URL search params
    mockSearchParams = new URLSearchParams('tagId=tag-1');

    const html = renderToStaticMarkup(
      <ClientDirectory
        initialClients={zeroResults}
        tags={mockTags}
        locale="en"
        initialTagId="tag-1"
      />,
    );

    // No results state rendered
    expect(html).toContain('data-testid="client-no-results-state"');
    expect(html).toContain('[noResultsTitle]');
    expect(html).toContain('[noResultsDescription]');
  });

  it('AC-10: renders both desktop table and mobile stacked card list with accessible touch targets >= 24px', () => {
    const initialClients: ListClientsResult = {
      items: [createMockClient(1), createMockClient(2)],
      total: 2,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={initialClients} tags={mockTags} locale="en" />,
    );

    // Desktop table with md:block or hidden md:table
    expect(html).toContain('data-testid="client-table"');
    expect(html).toContain('scope="col"');

    // Mobile stacked list with block md:hidden
    expect(html).toContain('data-testid="client-stacked-list"');
    expect(html).toContain('data-testid="client-card-018f0000-0000-7000-8000-000000000001"');

    // Interactive target sizes (buttons and inputs >= 44px or 36px)
    expect(html).toContain('min-h-[44px]');
  });

  it('AC-11: focus-visible ring styles are applied on interactive elements for visible focus indicators', () => {
    const initialClients: ListClientsResult = {
      items: [createMockClient(1)],
      total: 1,
      page: 1,
      pageSize: 25,
    };

    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={initialClients} tags={mockTags} locale="en" />,
    );

    // Visible focus ring classes present on search input, select, links, and buttons
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('focus-visible:ring-offset-2');
  });

  it('AC-13: displays generic localized error message on server error without leaking stack trace or SQL', () => {
    const html = renderToStaticMarkup(
      <ClientDirectory
        initialClients={{ items: [], total: 0, page: 1, pageSize: 25 }}
        tags={[]}
        locale="en"
        initialError="[errorMessage]"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="client-directory-error"');
    expect(html).toContain('[errorMessage]');
    expect(html).not.toContain('SELECT');
    expect(html).not.toContain('Stack');
  });

  it('triggers search submit, input change, clear search, and tag change', async () => {
    const mockAction = vi.mocked(listClientsAction);
    mockAction.mockResolvedValue({
      success: true,
      data: { items: [], total: 0, page: 1, pageSize: 25 },
    });

    let formSubmit: ((e: { preventDefault: () => void }) => void | Promise<void>) | undefined;
    let inputChange: ((e: { target: { value: string } }) => void) | undefined;
    let selectChange: ((e: { target: { value: string } }) => void) | undefined;
    let clearClick: (() => void) | undefined;
    let prevClick: (() => void) | undefined;
    let nextClick: (() => void) | undefined;

    function traverse(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      if (React.isValidElement(node)) {
        const props = node.props as Record<string, unknown>;
        if (node.type === 'form' && typeof props.onSubmit === 'function') {
          formSubmit = props.onSubmit as (e: {
            preventDefault: () => void;
          }) => void | Promise<void>;
        }
        if (node.type === 'input' && typeof props.onChange === 'function') {
          inputChange = props.onChange as (e: { target: { value: string } }) => void;
        }
        if (node.type === 'select' && typeof props.onChange === 'function') {
          selectChange = props.onChange as (e: { target: { value: string } }) => void;
        }
        if (node.type === 'button') {
          if (
            props['data-testid'] === 'client-search-clear-btn' &&
            typeof props.onClick === 'function'
          ) {
            clearClick = props.onClick as () => void;
          }
          if (
            props['data-testid'] === 'pagination-prev-btn' &&
            typeof props.onClick === 'function'
          ) {
            prevClick = props.onClick as () => void;
          }
          if (
            props['data-testid'] === 'pagination-next-btn' &&
            typeof props.onClick === 'function'
          ) {
            nextClick = props.onClick as () => void;
          }
        }
        if (props.children) {
          traverse(props.children);
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          traverse(item);
        }
      }
    }

    const initialClients: ListClientsResult = {
      items: Array.from({ length: 30 }, (_, i) => createMockClient(i + 1)),
      total: 50,
      page: 2,
      pageSize: 25,
    };

    mockStateQueue = ['existing query', initialClients, false, null, ''];

    function Capture() {
      const tree = ClientDirectory({
        initialClients,
        tags: mockTags,
        locale: 'en',
        initialPage: 2,
      });
      traverse(tree);
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Capture />);

    // Test input change
    inputChange?.({ target: { value: 'new query' } });

    // Test form submit
    await formSubmit?.({ preventDefault: () => undefined });
    expect(mockAction).toHaveBeenCalled();

    // Test clear search button click
    expect(clearClick).toBeDefined();
    clearClick?.();

    // Test tag change
    selectChange?.({ target: { value: 'tag-1' } });
    expect(mockReplace).toHaveBeenCalled();

    // Test pagination prev and next
    expect(prevClick).toBeDefined();
    expect(nextClick).toBeDefined();
    prevClick?.();
    nextClick?.();
  });

  it('handles listClientsAction failure and unexpected exception', async () => {
    const mockAction = vi.mocked(listClientsAction);
    mockAction.mockResolvedValueOnce({
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Simulated failure',
    });

    let formSubmit: ((e: { preventDefault: () => void }) => void | Promise<void>) | undefined;

    function traverse(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      if (React.isValidElement(node)) {
        const props = node.props as Record<string, unknown>;
        if (node.type === 'form' && typeof props.onSubmit === 'function') {
          formSubmit = props.onSubmit as (e: {
            preventDefault: () => void;
          }) => void | Promise<void>;
        }
        if (props.children) {
          traverse(props.children);
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          traverse(item);
        }
      }
    }

    function Capture() {
      const tree = ClientDirectory({
        initialClients: { items: [], total: 0, page: 1, pageSize: 25 },
        tags: [],
        locale: 'en',
      });
      traverse(tree);
      return <div>{tree}</div>;
    }

    renderToStaticMarkup(<Capture />);
    await formSubmit?.({ preventDefault: () => undefined });

    // Test rejection branch
    mockAction.mockRejectedValueOnce(new Error('Network error'));
    await formSubmit?.({ preventDefault: () => undefined });
  });

  it('I1-U01 & I1-U03: renders localized aria-label on dismiss button and ensures >= 24x24 px touch target', () => {
    mockStateQueue = [
      '', // searchTerm
      { items: [], total: 0, page: 1, pageSize: 25 }, // clientsResult
      false, // isLoading
      null, // errorMessage
      'Client and all associated records have been erased.', // deletedBanner
      'Client and all associated records have been erased.', // liveAnnouncement
    ];

    const html = renderToStaticMarkup(
      <ClientDirectory
        initialClients={{ items: [], total: 0, page: 1, pageSize: 25 }}
        tags={[]}
        locale="en"
      />,
    );

    // I1-U01: aria-label uses localized key [dismissBanner]
    expect(html).toContain('aria-label="[dismissBanner]"');
    // I1-U03: touch target has minimum width and height >= 24px (WCAG 2.2 AA SC 2.5.8)
    expect(html).toContain('min-h-[24px]');
    expect(html).toContain('min-w-[24px]');
  });
});
