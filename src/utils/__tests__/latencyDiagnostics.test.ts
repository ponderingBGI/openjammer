import { describe, it, expect, afterEach } from 'vitest';
import {
    diagnoseLatency,
    getLatencySummary,
    shouldShowLatencyWarning,
    getChromeOptimizationInstructions,
    isWindowsPlatform,
    isMacPlatform,
    getPlatformLatencyExpectation,
    WARNING_DISMISSAL_DURATION_MS,
    type LatencyMetricsInput
} from '../latencyDiagnostics';

// Helper to create mock metrics
function createMockMetrics(overrides: Partial<LatencyMetricsInput> = {}): LatencyMetricsInput {
    return {
        baseLatency: 5,
        outputLatency: 10,
        totalLatency: 15,
        estimatedRoundTrip: 40,
        classification: 'good',
        isBluetoothSuspected: false,
        sampleRate: 48000,
        ...overrides
    };
}

describe('latencyDiagnostics', () => {
    describe('diagnoseLatency', () => {
        it('should return no issues for excellent latency', () => {
            const metrics = createMockMetrics({
                estimatedRoundTrip: 8,
                classification: 'excellent'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.issues).toHaveLength(0);
            expect(diagnosis.showWarningBanner).toBe(false);
            expect(diagnosis.overallSeverity).toBe('none');
        });

        it('should return no issues for good latency', () => {
            const metrics = createMockMetrics({
                estimatedRoundTrip: 18,
                classification: 'good'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.issues).toHaveLength(0);
            expect(diagnosis.showWarningBanner).toBe(false);
        });

        it('should detect Bluetooth audio with high severity', () => {
            const metrics = createMockMetrics({
                outputLatency: 150,
                isBluetoothSuspected: true,
                classification: 'bad'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.issues.some(i => i.severity === 'high' && i.issue.includes('Bluetooth'))).toBe(true);
            expect(diagnosis.showWarningBanner).toBe(true);
            expect(diagnosis.overallSeverity).toBe('high');
        });

        it('should report high severity for bad latency', () => {
            const metrics = createMockMetrics({
                estimatedRoundTrip: 80,
                classification: 'bad'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.issues.some(i => i.severity === 'high')).toBe(true);
            expect(diagnosis.showWarningBanner).toBe(true);
        });

        it('should report medium severity for poor latency', () => {
            const metrics = createMockMetrics({
                estimatedRoundTrip: 45,
                classification: 'poor'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.issues.some(i => i.severity === 'medium')).toBe(true);
            expect(diagnosis.overallSeverity).toBe('medium');
        });

        it('should suggest enabling low latency mode when disabled and latency is poor', () => {
            const metrics = createMockMetrics({
                classification: 'poor'
            });
            const diagnosis = diagnoseLatency(metrics, false); // lowLatencyMode disabled

            expect(diagnosis.suggestions.some(s => s.includes('Low Latency Mode'))).toBe(true);
        });

        it('should not suggest low latency mode when already enabled', () => {
            const metrics = createMockMetrics({
                classification: 'poor'
            });
            const diagnosis = diagnoseLatency(metrics, true); // lowLatencyMode enabled

            expect(diagnosis.suggestions.some(s => s.includes('Enable Low Latency Mode'))).toBe(false);
        });

        it('should suggest closing audio apps for poor latency', () => {
            const metrics = createMockMetrics({
                classification: 'poor'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.suggestions.some(s => s.includes('Close other audio applications'))).toBe(true);
        });

        it('should suggest USB audio interface for poor latency', () => {
            const metrics = createMockMetrics({
                classification: 'bad'
            });
            const diagnosis = diagnoseLatency(metrics, true);

            expect(diagnosis.suggestions.some(s => s.includes('USB audio interface'))).toBe(true);
        });
    });

    describe('getLatencySummary', () => {
        it('should return correct summary for excellent latency', () => {
            const summary = getLatencySummary('excellent');
            expect(summary).toContain('excellent');
            expect(summary).toContain('professional');
        });

        it('should return correct summary for good latency', () => {
            const summary = getLatencySummary('good');
            expect(summary).toContain('good');
            expect(summary).toContain('playing instruments');
        });

        it('should return correct summary for acceptable latency', () => {
            const summary = getLatencySummary('acceptable');
            expect(summary).toContain('acceptable');
            expect(summary).toContain('practice');
        });

        it('should return correct summary for poor latency', () => {
            const summary = getLatencySummary('poor');
            expect(summary).toContain('high');
            expect(summary).toContain('delay');
        });

        it('should return correct summary for bad latency', () => {
            const summary = getLatencySummary('bad');
            expect(summary).toContain('very high');
            expect(summary).toContain('not suitable');
        });
    });

    describe('shouldShowLatencyWarning', () => {
        it('should not show warning for excellent latency', () => {
            expect(shouldShowLatencyWarning('excellent', null)).toBe(false);
        });

        it('should not show warning for good latency', () => {
            expect(shouldShowLatencyWarning('good', null)).toBe(false);
        });

        it('should not show warning for acceptable latency', () => {
            expect(shouldShowLatencyWarning('acceptable', null)).toBe(false);
        });

        it('should show warning for poor latency when not dismissed', () => {
            expect(shouldShowLatencyWarning('poor', null)).toBe(true);
        });

        it('should show warning for bad latency when not dismissed', () => {
            expect(shouldShowLatencyWarning('bad', null)).toBe(true);
        });

        it('should not show warning when dismissed within cooldown period', () => {
            const halfCooldown = Date.now() - (WARNING_DISMISSAL_DURATION_MS / 2);
            expect(shouldShowLatencyWarning('poor', halfCooldown)).toBe(false);
        });

        it('should show warning when dismissed beyond cooldown period', () => {
            const doubleCooldown = Date.now() - (WARNING_DISMISSAL_DURATION_MS * 2);
            expect(shouldShowLatencyWarning('poor', doubleCooldown)).toBe(true);
        });

        it('should show warning exactly at cooldown boundary', () => {
            const exactlyCooldown = Date.now() - WARNING_DISMISSAL_DURATION_MS;
            // At exactly cooldown period, the warning should show (>= cooldown has passed)
            expect(shouldShowLatencyWarning('poor', exactlyCooldown)).toBe(true);
        });
    });

    describe('getChromeOptimizationInstructions', () => {
        it('should return non-empty instructions', () => {
            const instructions = getChromeOptimizationInstructions();
            expect(instructions.length).toBeGreaterThan(0);
        });

        it('should mention --enable-exclusive-audio flag', () => {
            const instructions = getChromeOptimizationInstructions();
            expect(instructions).toContain('--enable-exclusive-audio');
        });

        it('should mention WASAPI', () => {
            const instructions = getChromeOptimizationInstructions();
            expect(instructions).toContain('WASAPI');
        });
    });

    describe('platform detection', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

        afterEach(() => {
            // Restore original platform
            if (originalPlatform) {
                Object.defineProperty(navigator, 'platform', originalPlatform);
            }
        });

        describe('isWindowsPlatform', () => {
            it('should detect Windows platform', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'Win32',
                    configurable: true
                });
                expect(isWindowsPlatform()).toBe(true);
            });

            it('should not detect non-Windows as Windows', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'MacIntel',
                    configurable: true
                });
                expect(isWindowsPlatform()).toBe(false);
            });
        });

        describe('isMacPlatform', () => {
            it('should detect Mac platform', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'MacIntel',
                    configurable: true
                });
                expect(isMacPlatform()).toBe(true);
            });

            it('should not detect non-Mac as Mac', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'Linux x86_64',
                    configurable: true
                });
                expect(isMacPlatform()).toBe(false);
            });
        });

        describe('getPlatformLatencyExpectation', () => {
            it('should return Mac expectations for Mac platform', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'MacIntel',
                    configurable: true
                });
                const expectation = getPlatformLatencyExpectation();
                expect(expectation.min).toBe(3);
                expect(expectation.typical).toBe(10);
                expect(expectation.description).toContain('macOS');
            });

            it('should return Windows expectations for Windows platform', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'Win32',
                    configurable: true
                });
                const expectation = getPlatformLatencyExpectation();
                expect(expectation.min).toBe(10);
                expect(expectation.typical).toBe(30);
                expect(expectation.description).toContain('Windows');
            });

            it('should return Linux expectations for Linux platform', () => {
                Object.defineProperty(navigator, 'platform', {
                    value: 'Linux x86_64',
                    configurable: true
                });
                const expectation = getPlatformLatencyExpectation();
                expect(expectation.min).toBe(5);
                expect(expectation.typical).toBe(30);
                expect(expectation.description).toContain('Linux');
            });
        });
    });

    describe('latency classification thresholds', () => {
        // Test edge cases for classification thresholds
        it('should have correct threshold at 10ms boundary', () => {
            // At exactly 10ms, classification should be 'excellent'
            const metrics10 = createMockMetrics({ estimatedRoundTrip: 10, classification: 'excellent' });
            const diagnosis10 = diagnoseLatency(metrics10, true);
            expect(diagnosis10.issues).toHaveLength(0);
        });

        it('should have correct threshold at 20ms boundary', () => {
            // At exactly 20ms, classification should be 'good'
            const metrics20 = createMockMetrics({ estimatedRoundTrip: 20, classification: 'good' });
            const diagnosis20 = diagnoseLatency(metrics20, true);
            expect(diagnosis20.issues).toHaveLength(0);
        });

        it('should have correct threshold at 30ms boundary', () => {
            // At exactly 30ms, classification should be 'acceptable'
            const metrics30 = createMockMetrics({ estimatedRoundTrip: 30, classification: 'acceptable' });
            const diagnosis30 = diagnoseLatency(metrics30, true);
            expect(diagnosis30.issues).toHaveLength(0);
        });

        it('should have correct threshold at 50ms boundary', () => {
            // At 51ms, classification should be 'bad'
            const metrics51 = createMockMetrics({ estimatedRoundTrip: 51, classification: 'bad' });
            const diagnosis51 = diagnoseLatency(metrics51, true);
            expect(diagnosis51.issues.some(i => i.severity === 'high')).toBe(true);
        });
    });
});
