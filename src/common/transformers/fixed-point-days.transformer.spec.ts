import {
  fixedPointDaysTransformer,
  toFixedPointDays,
} from './fixed-point-days.transformer';

describe('fixedPointDaysTransformer', () => {
  it('transforms days to scaled integer and back', () => {
    expect(fixedPointDaysTransformer.to(1.234)).toBe(1234);
    expect(fixedPointDaysTransformer.from(1234)).toBe(1.234);
  });

  it('handles null/undefined passthrough', () => {
    expect(fixedPointDaysTransformer.to(null)).toBeNull();
    expect(fixedPointDaysTransformer.from(undefined)).toBeNull();
  });

  it('converts helper to fixed-point integer', () => {
    expect(toFixedPointDays(2.5)).toBe(2500);
  });
});
