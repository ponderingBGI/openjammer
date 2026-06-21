/**
 * Crash-loop-safety + recovery (Track B P0).
 *
 * Public surface for the boot-time recovery machine that makes an OpenJammer
 * crash recoverable and a crash-LOOP impossible. See {@link runRecovery}.
 */

export * from './types';
export {
    decideRecovery,
    streakCount,
    snapshotCrashCount,
    parseMarker,
    serializeMarker,
    freshMarker,
    pruneCrashes,
} from './breaker';
export { WebMarkerStore, MemoryMarkerStore, newInstanceId, type MarkerStore } from './markerStore';
export {
    runRecovery,
    settle,
    markCleanExit,
    markSessionOpen,
    reset,
    type PayloadSource,
    type RecoverablePayload,
    type RecoveryOutcome,
    type RunRecoveryOpts,
} from './recover';
export {
    WebPayloadSource,
    writeEmergencyBackup,
    clearEmergencyBackup,
    validateRecoveredGraph,
    loadQuarantined,
    newestQuarantinedId,
    type EmergencyBackup,
    type RecoveredGraph,
} from './webPayloads';
