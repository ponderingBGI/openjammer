/**
 * MIDI Manager
 * Singleton wrapper around Web MIDI API for device access, hot-plug detection, and message handling
 */

import { parseMIDIMessage } from './MIDIMessageParser';
import { getPresetRegistry } from './MIDIDevicePresets';
import type {
  MIDIDeviceInfo,
  MIDIDevicePreset,
  MIDIEventCallback,
  MIDIDeviceCallback,
  MIDIManagerConfig,
  MIDISubscription,
} from './types';

class MIDIManager {
  private static instance: MIDIManager | null = null;

  private access: MIDIAccess | null = null;
  private isInitialized = false;
  private initError: string | null = null;

  // Event listeners
  private messageListeners: Map<string, Set<MIDIEventCallback>> = new Map();
  private deviceConnectedListeners: Set<MIDIDeviceCallback> = new Set();
  private deviceDisconnectedListeners: Set<MIDIDeviceCallback> = new Set();

  // Active input handlers
  private activeInputs: Map<string, MIDIInput> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): MIDIManager {
    if (!MIDIManager.instance) {
      MIDIManager.instance = new MIDIManager();
    }
    return MIDIManager.instance;
  }

  /**
   * Check if Web MIDI API is supported in this browser
   */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  /**
   * Initialize MIDI access
   */
  async init(config: MIDIManagerConfig = {}): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    if (!this.isSupported()) {
      this.initError = 'Web MIDI API is not supported in this browser';
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess({
        sysex: config.sysex ?? false,
        software: config.software ?? false,
      });

      // Set up hot-plug detection
      this.access.onstatechange = this.handleStateChange.bind(this);

      // Set up initial device handlers
      this.access.inputs.forEach((input) => {
        this.setupInputHandler(input);
      });

      this.isInitialized = true;
      return true;
    } catch (error) {
      const err = error as Error;
      this.initError = err.message || 'Failed to access MIDI devices';
      console.error('[MIDIManager] Initialization failed:', this.initError);
      return false;
    }
  }

  /**
   * Get initialization error message
   */
  getError(): string | null {
    return this.initError;
  }

  /**
   * Get all connected MIDI input devices
   */
  getInputDevices(): MIDIDeviceInfo[] {
    if (!this.access) return [];

    const devices: MIDIDeviceInfo[] = [];
    this.access.inputs.forEach((input) => {
      devices.push(this.midiInputToDeviceInfo(input));
    });
    return devices;
  }

  /**
   * Get all connected MIDI output devices
   */
  getOutputDevices(): MIDIDeviceInfo[] {
    if (!this.access) return [];

    const devices: MIDIDeviceInfo[] = [];
    this.access.outputs.forEach((output) => {
      devices.push({
        id: output.id,
        name: output.name ?? 'Unknown Device',
        manufacturer: output.manufacturer ?? 'Unknown',
        state: output.state as 'connected' | 'disconnected',
        type: 'output',
        version: output.version ?? undefined,
      });
    });
    return devices;
  }

  /**
   * Get a specific device by ID
   */
  getDeviceById(id: string): MIDIDeviceInfo | null {
    if (!this.access) return null;

    const input = this.access.inputs.get(id);
    if (input) {
      return this.midiInputToDeviceInfo(input);
    }

    const output = this.access.outputs.get(id);
    if (output) {
      return {
        id: output.id,
        name: output.name ?? 'Unknown Device',
        manufacturer: output.manufacturer ?? 'Unknown',
        state: output.state as 'connected' | 'disconnected',
        type: 'output',
        version: output.version ?? undefined,
      };
    }

    return null;
  }

  /**
   * Try to identify a device using preset registry
   */
  identifyDevice(device: MIDIDeviceInfo): MIDIDevicePreset | null {
    const registry = getPresetRegistry();
    return registry.matchDevice(device.name);
  }

  /**
   * Subscribe to MIDI messages from a specific device
   */
  subscribe(deviceId: string, callback: MIDIEventCallback): MIDISubscription {
    if (!this.messageListeners.has(deviceId)) {
      this.messageListeners.set(deviceId, new Set());
    }
    this.messageListeners.get(deviceId)!.add(callback);

    return {
      unsubscribe: () => {
        const listeners = this.messageListeners.get(deviceId);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this.messageListeners.delete(deviceId);
          }
        }
      },
    };
  }

  /**
   * Subscribe to all MIDI messages from all devices
   */
  subscribeAll(callback: MIDIEventCallback): MIDISubscription {
    return this.subscribe('*', callback);
  }

  /**
   * Register callback for device connected events
   */
  onDeviceConnected(callback: MIDIDeviceCallback): () => void {
    this.deviceConnectedListeners.add(callback);
    return () => {
      this.deviceConnectedListeners.delete(callback);
    };
  }

  /**
   * Register callback for device disconnected events
   */
  onDeviceDisconnected(callback: MIDIDeviceCallback): () => void {
    this.deviceDisconnectedListeners.add(callback);
    return () => {
      this.deviceDisconnectedListeners.delete(callback);
    };
  }

  /**
   * Handle MIDI access state changes (hot-plug events)
   */
  private handleStateChange(event: MIDIConnectionEvent): void {
    const port = event.port;
    if (!port) return;

    if (port.type === 'input') {
      const input = port as MIDIInput;
      const deviceInfo = this.midiInputToDeviceInfo(input);

      if (port.state === 'connected') {
        // Set up handler for new device
        this.setupInputHandler(input);

        // Notify listeners
        this.deviceConnectedListeners.forEach((cb) => cb(deviceInfo));
      } else {
        // Remove handler for disconnected device
        this.activeInputs.delete(input.id);

        // Notify listeners
        this.deviceDisconnectedListeners.forEach((cb) => cb(deviceInfo));
      }
    }
  }

  /**
   * Set up message handler for an input device
   */
  private setupInputHandler(input: MIDIInput): void {
    // Remove existing handler if any
    const existing = this.activeInputs.get(input.id);
    if (existing) {
      existing.onmidimessage = null;
    }

    // Set up new handler
    input.onmidimessage = (event: MIDIMessageEvent) => {
      this.handleMIDIMessage(input.id, event);
    };

    this.activeInputs.set(input.id, input);
  }

  /**
   * Handle incoming MIDI message
   */
  private handleMIDIMessage(deviceId: string, event: MIDIMessageEvent): void {
    if (!event.data || event.data.length === 0) return;

    const parsedEvent = parseMIDIMessage(event.data, event.timeStamp, deviceId);
    if (!parsedEvent) return;

    // Notify device-specific listeners
    const deviceListeners = this.messageListeners.get(deviceId);
    if (deviceListeners) {
      deviceListeners.forEach((cb) => cb(parsedEvent));
    }

    // Notify global listeners
    const globalListeners = this.messageListeners.get('*');
    if (globalListeners) {
      globalListeners.forEach((cb) => cb(parsedEvent));
    }
  }

  /**
   * Convert MIDIInput to MIDIDeviceInfo
   */
  private midiInputToDeviceInfo(input: MIDIInput): MIDIDeviceInfo {
    return {
      id: input.id,
      name: input.name ?? 'Unknown Device',
      manufacturer: input.manufacturer ?? 'Unknown',
      state: input.state as 'connected' | 'disconnected',
      type: 'input',
      version: input.version ?? undefined,
    };
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    // Remove all message handlers
    this.activeInputs.forEach((input) => {
      input.onmidimessage = null;
    });
    this.activeInputs.clear();

    // Clear all listeners
    this.messageListeners.clear();
    this.deviceConnectedListeners.clear();
    this.deviceDisconnectedListeners.clear();

    // Clear state change handler
    if (this.access) {
      this.access.onstatechange = null;
    }

    this.isInitialized = false;
    this.access = null;

    // Reset singleton so next getMIDIManager() creates a fresh instance
    MIDIManager.instance = null;
  }
}

// Export singleton getter
export function getMIDIManager(): MIDIManager {
  return MIDIManager.getInstance();
}

// Export for testing/debugging
export { MIDIManager };
