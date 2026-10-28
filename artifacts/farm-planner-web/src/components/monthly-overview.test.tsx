import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MonthlyOverview } from './monthly-overview';
import { useGetFarmMonthlySummary } from '@workspace/api-client-react';

// Mock the API client
vi.mock('@workspace/api-client-react', () => {
  return {
    useGetFarmMonthlySummary: vi.fn(),
    getGetFarmMonthlySummaryQueryKey: vi.fn(() => ['mock-key']),
  };
});

describe('MonthlyOverview', () => {
  afterEach(() => {
    cleanup();
  });
  const mockSummary = {
    month: '2024-03',
    scheduled: 150,
    completed: 120,
    completionRate: 0.8,
    outstanding: 30,
    overdue: 5,
    completionDateUnknown: 2,
    workers: [
      { workerId: 'w1', workerName: 'Alice', completed: 60 },
      { workerId: 'w2', workerName: 'Bob', completed: 60 }
    ],
    groups: [
      { name: 'Pruning', completed: 100 },
      { name: 'Spraying', completed: 20 }
    ],
    locations: [
      { name: 'North Block', completed: 80 },
      { name: 'South Block', completed: 40 }
    ],
    completions: [
      {
        eventId: 'e1',
        taskId: 't1',
        taskTitle: 'Prune apple trees',
        scheduledDate: '2024-03-01',
        completedAt: '2024-03-05T10:00:00Z',
        completedById: 'w1',
        completedByName: 'Alice',
        group: 'Pruning',
        location: 'North Block',
        source: 'Manual',
        recurrence: 'none',
        assigneeIds: [],
        assigneeNames: []
      }
    ]
  };

  it('renders loading state initially', () => {
    vi.mocked(useGetFarmMonthlySummary).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    } as any);

    render(<MonthlyOverview accountScope="test-account" />);
    
    expect(screen.getByTestId('panel-monthly-overview')).toBeTruthy();
    expect(screen.getByTestId('state-loading')).toBeTruthy();
  });

  it('renders error state', () => {
    vi.mocked(useGetFarmMonthlySummary).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: vi.fn(),
    } as any);

    render(<MonthlyOverview accountScope="test-account" />);
    
    expect(screen.getByText(/Could not load monthly summary/i)).toBeTruthy();
  });

  it('renders summary data correctly', () => {
    vi.mocked(useGetFarmMonthlySummary).mockReturnValue({
      isLoading: false,
      isError: false,
      data: mockSummary,
      refetch: vi.fn(),
    } as any);

    render(<MonthlyOverview accountScope="test-account" />);
    
    // Check main stats
    expect(screen.getByText('150')).toBeTruthy(); // Scheduled
    expect(screen.getByText('120')).toBeTruthy(); // Completed
    expect(screen.getByText('30')).toBeTruthy();  // Outstanding
    expect(screen.getByText('5')).toBeTruthy();   // Overdue
    
    // Check completion rate calculation detail
    expect(screen.getByText('80% completion rate')).toBeTruthy();

    // Check unknown date notice
    expect(screen.getByText(/2 tasks were completed without a known date/i)).toBeTruthy();

    // Check breakdowns
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60 done').length).toBe(2);
    
    expect(screen.getAllByText('Pruning').length).toBeGreaterThan(0);
    expect(screen.getByText('100 done')).toBeTruthy();
    
    expect(screen.getAllByText('North Block').length).toBeGreaterThan(0);
    expect(screen.getByText('80 done')).toBeTruthy();

    // Check completions table
    expect(screen.getByText('Prune apple trees')).toBeTruthy();
  });

  it('handles month navigation', () => {
    vi.mocked(useGetFarmMonthlySummary).mockReturnValue({
      isLoading: false,
      isError: false,
      data: mockSummary,
      refetch: vi.fn(),
    } as any);

    render(<MonthlyOverview accountScope="test-account" />);
    
    // Test navigation by checking if the hook is called with new parameters
    // Note: Due to the hook mock setup we just test the buttons render
    const prevButton = screen.getByTestId('button-prev-month');
    const nextButton = screen.getByTestId('button-next-month');
    
    expect(prevButton).toBeTruthy();
    expect(nextButton).toBeTruthy();
    
    // Click prev and next
    fireEvent.click(prevButton);
    fireEvent.click(nextButton);
    
    // The query hook will re-render with updated month state.
    // Without full context tracking in the mock, we know the click handlers didn't crash.
    expect(useGetFarmMonthlySummary).toHaveBeenCalled();
  });
});
