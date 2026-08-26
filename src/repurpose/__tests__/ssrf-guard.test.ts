jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { lookup } from 'node:dns/promises';
import { assertSafeToFetch } from '../ssrf-guard';

const mockLookup = lookup as unknown as jest.Mock;

function mockResolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

describe('assertSafeToFetch()', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects non-http(s) protocols before ever resolving DNS', async () => {
    await expect(assertSafeToFetch('file:///etc/passwd')).rejects.toThrow(/only http\/https/);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL', async () => {
    await expect(assertSafeToFetch('not a url')).rejects.toThrow(/not a valid URL/);
  });

  it('allows a public IPv4 address', async () => {
    mockResolvesTo('93.184.216.34'); // example.com's real address
    await expect(assertSafeToFetch('https://example.com/')).resolves.toBeUndefined();
  });

  it('blocks the AWS/GCP cloud metadata address', async () => {
    mockResolvesTo('169.254.169.254');
    await expect(assertSafeToFetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private or internal/
    );
  });

  it('blocks loopback (127.0.0.1)', async () => {
    mockResolvesTo('127.0.0.1');
    await expect(assertSafeToFetch('http://127.0.0.1:3000/')).rejects.toThrow(/private or internal/);
  });

  it('blocks RFC1918 ranges (10.x, 172.16-31.x, 192.168.x)', async () => {
    mockResolvesTo('10.0.0.5');
    await expect(assertSafeToFetch('http://internal-host/')).rejects.toThrow(/private or internal/);

    mockResolvesTo('172.20.0.5');
    await expect(assertSafeToFetch('http://internal-host/')).rejects.toThrow(/private or internal/);

    mockResolvesTo('192.168.1.5');
    await expect(assertSafeToFetch('http://internal-host/')).rejects.toThrow(/private or internal/);
  });

  it('does not treat 172.32.x.x (outside RFC1918) as private', async () => {
    mockResolvesTo('172.32.0.5');
    await expect(assertSafeToFetch('http://not-quite-private/')).resolves.toBeUndefined();
  });

  it('blocks IPv6 loopback and unique-local addresses', async () => {
    mockResolvesTo('::1');
    await expect(assertSafeToFetch('http://ipv6-loopback/')).rejects.toThrow(/private or internal/);

    mockResolvesTo('fd00::1');
    await expect(assertSafeToFetch('http://ipv6-ula/')).rejects.toThrow(/private or internal/);
  });

  it('blocks a hostname that resolves to a mix of public and private addresses', async () => {
    mockResolvesTo('93.184.216.34', '10.0.0.1');
    await expect(assertSafeToFetch('http://mixed-dns/')).rejects.toThrow(/private or internal/);
  });

  it('rejects when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeToFetch('http://does-not-exist.invalid/')).rejects.toThrow(/Could not resolve host/);
  });
});
