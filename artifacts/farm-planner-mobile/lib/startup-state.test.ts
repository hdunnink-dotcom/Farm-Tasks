import { describe, expect, it } from 'vitest';
import { describeMobileConfiguration, describeRuntimeError } from './startup-state';

describe('mobile startup diagnostics', () => {
  it('identifies a missing planner server before protected requests start', () => {
    expect(
      describeMobileConfiguration({
        domain: '',
        publishableKey: 'pk_test_example',
        authDisabled: false,
      }),
    ).toMatchObject({
      kind: 'configuration',
      title: 'The planner server is not configured',
    });
  });

  it('identifies missing sign-in configuration when authentication is enabled', () => {
    expect(
      describeMobileConfiguration({
        domain: 'planner.example.test',
        publishableKey: '',
        authDisabled: false,
      }),
    ).toMatchObject({
      kind: 'configuration',
      title: 'Sign-in is not configured',
    });
  });

  it('allows the local test mode to run without a Clerk key', () => {
    expect(
      describeMobileConfiguration({
        domain: 'planner.example.test',
        publishableKey: '',
        authDisabled: true,
      }),
    ).toBeNull();
  });

  it('separates bundle failures from unexpected runtime failures', () => {
    expect(describeRuntimeError(new Error('Unable to resolve module from Metro bundle')).title).toBe(
      'The mobile bundle could not load',
    );
    expect(describeRuntimeError(new Error('Unexpected render failure')).title).toBe(
      'The planner could not open',
    );
  });
});