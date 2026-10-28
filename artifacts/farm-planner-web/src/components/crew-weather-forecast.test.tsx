import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrewWeatherPanel, type CrewWeatherResponse } from './crew-weather-forecast';

afterEach(cleanup);

const forecast: CrewWeatherResponse = {
  location: { name: 'Ngātīmoti / Motueka, Tasman', latitude: -41.202325, longitude: 172.8772438 },
  source: 'MetService / MetOcean Point Forecast',
  sourceUrl: 'https://data.metservice.com/product/point-forecast-api',
  updatedAt: '2026-08-30T01:00:00.000Z',
  stale: false,
  days: Array.from({ length: 10 }, (_, day) => ({
    date: `2026-09-${String(day + 1).padStart(2, '0')}`,
    partial: day === 0,
    totalRainMm: day + 0.5,
    maxWindKmh: 24 + day,
    averageCloudCoverPercent: 88,
    condition: 'Overcast',
    hours: [
      {
        time: `2026-08-31T${String(18 + day).padStart(2, '0')}:00:00.000Z`,
        localHour: 6,
        temperatureC: 11,
        rainMm: 1.4,
        windKmh: 24,
        windDirectionDegrees: 225,
        windDirection: 'SW',
        cloudCoverPercent: 88,
        condition: 'Overcast',
      },
    ],
  })),
};

describe('CrewWeatherPanel', () => {
  it('shows ten compact daily forecasts with rain as the primary value', () => {
    render(<CrewWeatherPanel forecast={forecast} onRefresh={vi.fn()} />);

    expect(screen.getByText('Ngātīmoti / Motueka, Tasman')).toBeTruthy();
    expect(within(screen.getByTestId('crew-weather-days')).getAllByRole('button')).toHaveLength(10);
    expect(screen.getByText('0.5')).toBeTruthy();
    expect(screen.getAllByText('mm').length).toBeGreaterThan(0);
    expect(screen.getByText('from now')).toBeTruthy();
  });

  it('opens an hourly rain, wind and cloud forecast for the selected day', () => {
    render(<CrewWeatherPanel forecast={forecast} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByTestId('crew-weather-day-2026-09-01'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1.4 mm')).toBeTruthy();
    expect(within(dialog).getByText(/24 km\/h SW/)).toBeTruthy();
    expect(within(dialog).getByText(/88% · Overcast/)).toBeTruthy();
  });

  it('keeps the board usable with a clear retry state when weather is unavailable', () => {
    const onRefresh = vi.fn();
    render(<CrewWeatherPanel error="Weather forecast access has not been configured yet." onRefresh={onRefresh} />);

    expect(screen.getByTestId('crew-weather-unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry weather forecast' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});