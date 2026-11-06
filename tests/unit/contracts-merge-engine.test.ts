import { describe, it, expect } from 'vitest';
import {
  resolveContractMergeFields,
  escapeHtml,
  stripControlChars,
  sanitizeMergeValue,
  ALLOWLISTED_MERGE_TOKENS,
  type ContractMergeData,
} from '@/server/contracts/merge-engine';

describe('Contracts Merge-Field Engine Unit Tests (AC-3)', () => {
  const sampleCommissionData: ContractMergeData = {
    client: {
      name: 'Emma Watson',
      company: 'Watson Media GmbH',
      email: 'emma@example.com',
      phone: '+49 30 1234567',
      address: 'Friedrichstraße 42',
      city: 'Berlin',
      postal_code: '10117',
      country: 'DE',
    },
    project: {
      title: 'Emma & Liam Wedding',
      type: 'Wedding Photography',
      price: '€2.500,00',
      currency: 'EUR',
      notes: 'Please capture golden hour portraits.',
    },
    shoot: {
      date: '15. August 2026',
      time: '14:00',
      timezone: 'Europe/Berlin',
      location: 'Schlosspark Sanssouci',
      address: 'Maulbeerallee, 14469 Potsdam',
    },
    package: {
      name: 'Full Day Wedding Coverage',
      deliverables: '• 8h coverage\n• 400 photos\n• Online gallery',
      total: '€2.500,00',
      subtotal: '€2.100,84',
      tax: '€399,16',
      addons: '• Second Photographer: €400,00',
    },
    studio: {
      name: 'Lichtwerk Fotografie',
      owner_name: 'Jane Doe',
      email: 'hello@lichtwerk.example',
      phone: '+49 30 9876543',
      address: 'Torstraße 100, 10119 Berlin',
      tax_number: '12/345/67890',
      vat_id: 'DE123456789',
    },
    contract: {
      number: 'CTR-2026-0001',
      issue_date: '06.11.2026',
      valid_until: '20.11.2026',
    },
  };

  it('AC-3: interpolates all allowlisted merge tokens across 6 namespaces accurately', () => {
    const templateText = `
Agreement between {{studio.name}} (Owner: {{studio.owner_name}}, Email: {{studio.email}}, Phone: {{studio.phone}}, Address: {{studio.address}}, Tax: {{studio.tax_number}}, VAT: {{studio.vat_id}})
and {{client.name}} (Company: {{client.company}}, Email: {{client.email}}, Phone: {{client.phone}}, Address: {{client.address}}, City: {{client.city}}, Postal: {{client.postal_code}}, Country: {{client.country}}).

Project: {{project.title}} (Type: {{project.type}}, Price: {{project.price}}, Currency: {{project.currency}}, Notes: {{project.notes}})
Shoot: Date: {{shoot.date}}, Time: {{shoot.time}}, Timezone: {{shoot.timezone}}, Location: {{shoot.location}}, Address: {{shoot.address}}
Package: {{package.name}}, Deliverables: {{package.deliverables}}, Subtotal: {{package.subtotal}}, Tax: {{package.tax}}, Total: {{package.total}}, Addons: {{package.addons}}
Contract: Number: {{contract.number}}, Issued: {{contract.issue_date}}, Valid Until: {{contract.valid_until}}
`;

    const result = resolveContractMergeFields(templateText, sampleCommissionData);

    expect(result.renderedText).toContain('Agreement between Lichtwerk Fotografie');
    expect(result.renderedText).toContain('Owner: Jane Doe');
    expect(result.renderedText).toContain('Tax: 12/345/67890');
    expect(result.renderedText).toContain('VAT: DE123456789');
    expect(result.renderedText).toContain('and Emma Watson');
    expect(result.renderedText).toContain('Company: Watson Media GmbH');
    expect(result.renderedText).toContain('Project: Emma &amp; Liam Wedding');
    expect(result.renderedText).toContain('Date: 15. August 2026');
    expect(result.renderedText).toContain('Package: Full Day Wedding Coverage');
    expect(result.renderedText).toContain('Total: €2.500,00');
    expect(result.renderedText).toContain('Contract: Number: CTR-2026-0001');

    expect(result.unmappedTokens).toHaveLength(0);
    expect(result.evaluatedValues['client.name']).toBe('Emma Watson');
    expect(result.evaluatedValues['studio.name']).toBe('Lichtwerk Fotografie');
  });

  it('AC-3: strictly HTML-escapes dynamic values to prevent XSS injection', () => {
    const maliciousData: ContractMergeData = {
      client: {
        name: '<script>alert("XSS Attack")</script>',
        company: '"><img src=x onerror=alert(1)>',
        address: "Tom & Jerry's Studio 'Special'",
      },
      project: {
        title:
          '<svg onload="javascript:eval(atob(\'ZG9jdW1lbnQubG9jYXRpb249Imh0dHA6Ly9hdHRhY2tlci5jb20i\'))">',
        notes: 'Ampersands & <tags> inside notes',
      },
    };

    const templateText =
      'Client: {{client.name}}, Company: {{client.company}}, Project: {{project.title}}';
    const result = resolveContractMergeFields(templateText, maliciousData);

    // Verify HTML escaping
    expect(result.renderedText).not.toContain('<script>');
    expect(result.renderedText).toContain(
      '&lt;script&gt;alert(&quot;XSS Attack&quot;)&lt;/script&gt;',
    );
    expect(result.renderedText).not.toContain('<img src=x onerror=alert(1)>');
    expect(result.renderedText).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(result.renderedText).not.toContain('<svg');
    expect(result.renderedText).toContain('&lt;svg onload=&quot;javascript:eval');
  });

  it('AC-3: strips ASCII control characters from dynamic merge values', () => {
    const inputWithControlChars = 'Hello\x00\x01\x07World\x1F!\nLine 2\tTabbed';
    const sanitized = sanitizeMergeValue(inputWithControlChars);

    expect(sanitized).not.toContain('\x00');
    expect(sanitized).not.toContain('\x01');
    expect(sanitized).not.toContain('\x07');
    expect(sanitized).not.toContain('\x1F');
    expect(sanitized).toContain('HelloWorld!\nLine 2\tTabbed');
  });

  it('AC-3: cleanly reports unmapped tokens and safely clears them from rendered output', () => {
    const templateWithUnknownAndMissing = `
Hello {{client.name}}, welcome to {{unknown.token}}!
Your appointment is on {{shoot.date}}.
Bonus token: {{custom_namespace.invalid_field}}.
`;

    // Only provide client.name
    const result = resolveContractMergeFields(templateWithUnknownAndMissing, {
      client: { name: 'Alice' },
    });

    expect(result.renderedText).toContain('Hello Alice, welcome to !');
    expect(result.renderedText).toContain('Your appointment is on .');
    expect(result.renderedText).not.toContain('{{unknown.token}}');
    expect(result.renderedText).not.toContain('{{shoot.date}}');

    expect(result.unmappedTokens).toContain('unknown.token');
    expect(result.unmappedTokens).toContain('shoot.date');
    expect(result.unmappedTokens).toContain('custom_namespace.invalid_field');
  });

  it('AC-3: preserves unmapped tokens when keepUnmappedTokens option is true', () => {
    const template = 'Client: {{client.name}}, Pending: {{package.name}}';
    const result = resolveContractMergeFields(
      template,
      { client: { name: 'Bob' } },
      {
        keepUnmappedTokens: true,
      },
    );

    expect(result.renderedText).toBe('Client: Bob, Pending: {{package.name}}');
    expect(result.unmappedTokens).toContain('package.name');
  });

  it('AC-3: handles empty, null, or undefined data objects without throwing exceptions', () => {
    expect(() => resolveContractMergeFields('Empty template', null)).not.toThrow();
    expect(() => resolveContractMergeFields('Empty template', undefined)).not.toThrow();
    expect(() => resolveContractMergeFields('Empty template', {})).not.toThrow();

    const result = resolveContractMergeFields('Hello {{client.name}}', null);
    expect(result.renderedText).toBe('Hello ');
    expect(result.unmappedTokens).toContain('client.name');
  });

  it('AC-3: verifies exhaustive namespace coverage in ALLOWLISTED_MERGE_TOKENS', () => {
    const namespaces = new Set(ALLOWLISTED_MERGE_TOKENS.map((t) => t.split('.')[0]));
    expect(namespaces.has('client')).toBe(true);
    expect(namespaces.has('project')).toBe(true);
    expect(namespaces.has('shoot')).toBe(true);
    expect(namespaces.has('package')).toBe(true);
    expect(namespaces.has('studio')).toBe(true);
    expect(namespaces.has('contract')).toBe(true);
    expect(ALLOWLISTED_MERGE_TOKENS.length).toBeGreaterThanOrEqual(30);
  });

  it('AC-3: sanitizeMergeValue handles numbers, booleans, bigints, and objects', () => {
    expect(sanitizeMergeValue(1234)).toBe('1234');
    expect(sanitizeMergeValue(true)).toBe('true');
    expect(sanitizeMergeValue(BigInt(999999))).toBe('999999');
    expect(sanitizeMergeValue({ complex: 'object' })).toBe('');
    expect(sanitizeMergeValue(null)).toBe('');
    expect(sanitizeMergeValue(undefined)).toBe('');

    expect(escapeHtml('<script>alert("xss")</script> & "quotes" \'apostrophe\'')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;apostrophe&#39;',
    );
    expect(stripControlChars('Hello\u0000World\u0008Test\t\r\n')).toBe('HelloWorldTest\t\r\n');
  });

  it('AC-3: resolveContractMergeFields handles empty string token values and tokens with whitespace', () => {
    const template = 'Client: {{   client.name   }}, Company: {{ client.company }}';
    const result = resolveContractMergeFields(template, {
      client: {
        name: 'Jane',
        company: '', // explicitly empty string
      },
    });

    expect(result.renderedText).toBe('Client: Jane, Company: ');
    expect(result.evaluatedValues['client.company']).toBe('');
  });
});
