import { ValueTransformer } from 'typeorm';

const DAY_SCALE = 1000;

export const fixedPointDaysTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }

    return Math.round(value * DAY_SCALE);
  },
  from: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }

    return value / DAY_SCALE;
  },
};

export function toFixedPointDays(value: number): number {
  return Math.round(value * DAY_SCALE);
}
