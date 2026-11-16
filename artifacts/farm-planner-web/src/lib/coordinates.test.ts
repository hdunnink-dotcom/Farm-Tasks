import { describe, expect, it } from 'vitest';
import { formatCoordinatePair, parseCoordinatePair } from './coordinates';

describe('parseCoordinatePair', () => {
  it('reads a pin copied from Google Maps', () => {
    expect(parseCoordinatePair('-41.21045819015103, 172.90732378195517')).toEqual({ latitude: -41.210458, longitude: 172.907324 });
  });

  it('accepts decimal pairs with only a space, extra spaces or brackets', () => {
    expect(parseCoordinatePair('-41.2104 172.9073')).toEqual({ latitude: -41.2104, longitude: 172.9073 });
    expect(parseCoordinatePair('  (-41.2104 ,  172.9073)  ')).toEqual({ latitude: -41.2104, longitude: 172.9073 });
  });

  it('still reads degrees, minutes and seconds', () => {
    const parsed = parseCoordinatePair('41°12\'37.65"S 172°54\'26.37"E');
    expect(parsed?.latitude).toBeCloseTo(-41.210458, 5);
    expect(parsed?.longitude).toBeCloseTo(172.907325, 5);
  });

  it('treats an empty field as no pin and rejects out-of-range or garbled values', () => {
    expect(parseCoordinatePair('   ')).toEqual({ latitude: null, longitude: null });
    expect(parseCoordinatePair('-141.2, 172.9')).toBeNull();
    expect(parseCoordinatePair('-41.2, 192.9')).toBeNull();
    expect(parseCoordinatePair('Apple block')).toBeNull();
  });

  it('shows a decimal pin as degrees, minutes and seconds when the task is reopened', () => {
    const parsed = parseCoordinatePair('-41.21045819015103, 172.90732378195517')!;
    expect(formatCoordinatePair(parsed.latitude, parsed.longitude)).toBe('41°12\'37.65"S 172°54\'26.37"E');
  });
});
