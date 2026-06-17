import React, { useEffect, useState } from 'react';
import { GuideContainer } from '../GuideContainer';
import { GuideProgress } from '../GuideProgress';
import { GuideStep, type StepStatus } from '../GuideStep';
import { GuideInfoBox } from '../GuideInfoBox';
import { GuideTester, type TestResult } from '../GuideTester';
import { useLowLatencyGuide } from '../../../store/guideStore';
import {
  detectPlatform,
  type Platform,
  getExternalAudioDevices,
  getLatencyInfo,
  testAudioContextCreation,
  testAudioPlayback,
  requestMicrophonePermission,
  type AudioDeviceInfo,
  type LatencyInfo,
  formatLatency,
  getLatencyRating,
} from '../../../utils/audioLatencyTests';
import '../Guide.css';

// Step IDs for the guide
const STEP_IDS = {
  PLATFORM: 'platform-detection',
  INTERFACE: 'interface-detection',
  DRIVER: 'driver-setup',
  AUDIO_TEST: 'audio-test',
  LATENCY_CHECK: 'latency-check',
  OPTIMIZATION: 'system-optimization',
  VERIFICATION: 'final-verification',
} as const;

const ALL_STEP_IDS = Object.values(STEP_IDS);

export function LowLatencyGuide() {
  const guide = useLowLatencyGuide();

  // Local state for detected info
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [externalDevices, setExternalDevices] = useState<AudioDeviceInfo[]>([]);
  const [latencyInfo, setLatencyInfo] = useState<LatencyInfo | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize on mount - auto-detect platform and devices
  useEffect(() => {
    if (!guide.isOpen) return;

    const initialize = async () => {
      setIsInitializing(true);

      // Detect platform
      const detectedPlatform = detectPlatform();
      setPlatform(detectedPlatform);

      // Auto-complete platform step
      if (!guide.isStepCompleted(STEP_IDS.PLATFORM)) {
        guide.setStepData(STEP_IDS.PLATFORM, { platform: detectedPlatform });
        guide.markStepCompleted(STEP_IDS.PLATFORM);
      }

      // Try to get devices (may need permission)
      try {
        const devices = await getExternalAudioDevices();
        setExternalDevices(devices);

        if (devices.length > 0) {
          guide.setStepData(STEP_IDS.INTERFACE, { devices });
          guide.markStepCompleted(STEP_IDS.INTERFACE);
        }
      } catch {
        // Will handle in interface detection step
      }

      // Get latency info
      try {
        const latency = getLatencyInfo();
        setLatencyInfo(latency);
      } catch {
        // Will handle in latency check step
      }

      setIsInitializing(false);
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the panel opens; `guide` is a fresh object each render, so depending on it would re-run device enumeration / mic-permission requests on every store change
  }, [guide.isOpen]);

  // Calculate progress
  const completedSteps = guide.getCompletedSteps();
  const totalSteps = ALL_STEP_IDS.length;

  // Get step status helper
  const getStepStatus = (stepId: string): StepStatus => {
    const state = guide.getStepState(stepId);
    return state?.status || 'pending';
  };

  // Test functions for each step
  const testInterfaceDetection = async (): Promise<TestResult> => {
    // Request permission first
    await requestMicrophonePermission();

    const devices = await getExternalAudioDevices();
    setExternalDevices(devices);

    if (devices.length > 0) {
      guide.setStepData(STEP_IDS.INTERFACE, { devices });
      guide.markStepCompleted(STEP_IDS.INTERFACE);
      return {
        status: 'success',
        message: `Found ${devices.length} external device(s)`,
      };
    }

    return {
      status: 'warning',
      message: 'No external audio interface detected',
    };
  };

  const testAudioSystem = async (): Promise<TestResult> => {
    const contextResult = await testAudioContextCreation();
    if (!contextResult.success) {
      return { status: 'failure', message: contextResult.message };
    }

    const playbackResult = await testAudioPlayback();
    if (!playbackResult.success) {
      return { status: 'failure', message: playbackResult.message };
    }

    guide.markStepCompleted(STEP_IDS.AUDIO_TEST);
    return { status: 'success', message: 'Audio system working correctly' };
  };

  const testLatency = async (): Promise<TestResult> => {
    const latency = getLatencyInfo();
    setLatencyInfo(latency);
    guide.setStepData(STEP_IDS.LATENCY_CHECK, { latency });

    const rating = getLatencyRating(latency.totalLatency);

    if (rating === 'good') {
      guide.markStepCompleted(STEP_IDS.LATENCY_CHECK);
      return {
        status: 'success',
        message: `Total latency: ${formatLatency(latency.totalLatency)} (excellent)`,
      };
    }

    if (rating === 'okay') {
      guide.markStepCompleted(STEP_IDS.LATENCY_CHECK);
      return {
        status: 'warning',
        message: `Total latency: ${formatLatency(latency.totalLatency)} (acceptable)`,
      };
    }

    return {
      status: 'failure',
      message: `Total latency: ${formatLatency(latency.totalLatency)} (high)`,
    };
  };

  // Filter steps based on platform
  const isWindows = platform === 'windows';
  const isMac = platform === 'mac';

  return (
    <GuideContainer
      isOpen={guide.isOpen}
      onClose={guide.close}
      title="Low Latency Audio Setup"
      subtitle="Optimize your audio for real-time performance"
      footer={
        <div className="guide-footer-actions">
          <button className="guide-btn secondary" onClick={guide.reset}>
            Reset Progress
          </button>
          {completedSteps.length === totalSteps && (
            <button className="guide-btn success" onClick={guide.close}>
              Done
            </button>
          )}
        </div>
      }
    >
      {/* Progress */}
      <GuideProgress
        completed={completedSteps.length}
        total={totalSteps}
        platform={platform}
      />

      {/* Introduction */}
      <GuideInfoBox type="info" title="What is Audio Latency?">
        Latency is the delay between when you play a note and when you hear it.
        For real-time music making, you want latency under 10ms (imperceptible)
        to 20ms (acceptable). This guide will help you optimize your setup.
      </GuideInfoBox>

      {/* Latency Display */}
      {latencyInfo && (
        <div className="guide-latency-display">
          <div className="guide-latency-item">
            <div className="guide-latency-label">Base</div>
            <div className={`guide-latency-value ${getLatencyRating(latencyInfo.baseLatency)}`}>
              {formatLatency(latencyInfo.baseLatency)}
            </div>
          </div>
          <div className="guide-latency-item">
            <div className="guide-latency-label">Output</div>
            <div className={`guide-latency-value ${getLatencyRating(latencyInfo.outputLatency)}`}>
              {formatLatency(latencyInfo.outputLatency)}
            </div>
          </div>
          <div className="guide-latency-item">
            <div className="guide-latency-label">Total</div>
            <div className={`guide-latency-value ${getLatencyRating(latencyInfo.totalLatency)}`}>
              {formatLatency(latencyInfo.totalLatency)}
            </div>
          </div>
        </div>
      )}

      {/* Completed Section */}
      {completedSteps.length > 0 && (
        <GuideSection title="Completed" count={completedSteps.length} defaultCollapsed>
          {/* Platform Detection */}
          {guide.isStepCompleted(STEP_IDS.PLATFORM) && (
            <GuideStep
              stepNumber={1}
              title="Platform Detection"
              description={`Detected: ${platform === 'windows' ? 'Windows' : platform === 'mac' ? 'macOS' : 'Linux'}`}
              status="completed"
            />
          )}

          {/* Interface Detection */}
          {guide.isStepCompleted(STEP_IDS.INTERFACE) && (
            <GuideStep
              stepNumber={2}
              title="USB Audio Interface"
              description={
                externalDevices.length > 0
                  ? `Found: ${externalDevices[0].label}`
                  : 'External interface detected'
              }
              status="completed"
            />
          )}

          {/* Driver Setup */}
          {guide.isStepCompleted(STEP_IDS.DRIVER) && (
            <GuideStep
              stepNumber={3}
              title="Driver Setup"
              description="Drivers configured correctly"
              status="completed"
            />
          )}

          {/* Audio Test */}
          {guide.isStepCompleted(STEP_IDS.AUDIO_TEST) && (
            <GuideStep
              stepNumber={4}
              title="Audio System Test"
              description="Audio playback working"
              status="completed"
            />
          )}

          {/* Latency Check */}
          {guide.isStepCompleted(STEP_IDS.LATENCY_CHECK) && (
            <GuideStep
              stepNumber={5}
              title="Latency Check"
              description={latencyInfo ? `${formatLatency(latencyInfo.totalLatency)} total` : 'Latency measured'}
              status="completed"
            />
          )}

          {/* Optimization */}
          {guide.isStepCompleted(STEP_IDS.OPTIMIZATION) && (
            <GuideStep
              stepNumber={6}
              title="System Optimization"
              description="Settings optimized"
              status="completed"
            />
          )}

          {/* Verification */}
          {guide.isStepCompleted(STEP_IDS.VERIFICATION) && (
            <GuideStep
              stepNumber={7}
              title="Final Verification"
              description="Setup complete"
              status="completed"
            />
          )}
        </GuideSection>
      )}

      {/* To Do Section */}
      <GuideSection
        title="To Do"
        count={totalSteps - completedSteps.length}
      >
        {/* Platform Detection */}
        {!guide.isStepCompleted(STEP_IDS.PLATFORM) && (
          <GuideStep
            stepNumber={1}
            title="Platform Detection"
            description="Detecting your operating system..."
            status={isInitializing ? 'in_progress' : 'completed'}
          />
        )}

        {/* Interface Detection */}
        {!guide.isStepCompleted(STEP_IDS.INTERFACE) && (
          <GuideStep
            stepNumber={2}
            title="USB Audio Interface Detection"
            description="Check for external audio devices like Focusrite Scarlett"
            status={getStepStatus(STEP_IDS.INTERFACE)}
            defaultExpanded
          >
            <p>
              For the lowest latency, we recommend using a dedicated USB audio
              interface like the Focusrite Scarlett series. These devices bypass
              your computer's built-in audio and provide professional-quality,
              low-latency audio.
            </p>

            {externalDevices.length > 0 ? (
              <GuideInfoBox type="success" title="External Interface Found">
                {externalDevices.map((device) => (
                  <div key={device.deviceId}>
                    <strong>{device.label}</strong>
                    {device.manufacturer && ` (${device.manufacturer})`}
                  </div>
                ))}
              </GuideInfoBox>
            ) : (
              <GuideInfoBox type="warning" title="No External Interface Detected">
                Click "Detect Devices" to check for connected audio interfaces.
                Make sure your device is plugged in via USB.
              </GuideInfoBox>
            )}

            <div className="guide-step-actions">
              <GuideTester
                label="Detect Devices"
                onTest={testInterfaceDetection}
              />
            </div>
          </GuideStep>
        )}

        {/* Driver Setup - Windows Only */}
        {!guide.isStepCompleted(STEP_IDS.DRIVER) && isWindows && (
          <GuideStep
            stepNumber={3}
            title="Install Audio Drivers (Windows)"
            description="Install ASIO drivers for lowest latency"
            status={getStepStatus(STEP_IDS.DRIVER)}
            defaultExpanded
          >
            <p>
              Windows requires special drivers (ASIO) for professional audio
              latency. If you have a Focusrite Scarlett, you need to install
              Focusrite Control 2.
            </p>

            <GuideInfoBox type="tip" title="ASIO vs WASAPI">
              <strong>ASIO</strong> provides the lowest latency (3-5ms).
              <br />
              <strong>WASAPI Exclusive</strong> is built into Windows but has
              higher latency (10-20ms).
              <br />
              <strong>Always use ASIO</strong> when available.
            </GuideInfoBox>

            <h5 style={{ margin: '16px 0 8px', color: 'var(--text-primary)' }}>
              For Focusrite Scarlett:
            </h5>
            <ol style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
              <li>Download <a href="https://downloads.focusrite.com/" target="_blank" rel="noopener noreferrer" className="guide-external-link">Focusrite Control 2 <ExternalLinkIcon /></a></li>
              <li>Run the installer as Administrator</li>
              <li>Restart your computer when prompted</li>
              <li>In your DAW, select "Focusrite USB ASIO" as the audio driver</li>
            </ol>

            <div className="guide-step-actions">
              <button
                className="guide-btn primary"
                onClick={() => guide.markStepCompleted(STEP_IDS.DRIVER)}
              >
                I've installed the drivers
              </button>
              <button
                className="guide-btn secondary"
                onClick={() => {
                  guide.setStepStatus(STEP_IDS.DRIVER, 'skipped');
                  guide.markStepCompleted(STEP_IDS.DRIVER);
                }}
              >
                Skip (using built-in audio)
              </button>
            </div>
          </GuideStep>
        )}

        {/* Driver Setup - Mac */}
        {!guide.isStepCompleted(STEP_IDS.DRIVER) && isMac && (
          <GuideStep
            stepNumber={3}
            title="Audio Configuration (macOS)"
            description="macOS has built-in low-latency Core Audio"
            status={getStepStatus(STEP_IDS.DRIVER)}
            defaultExpanded
          >
            <GuideInfoBox type="success" title="Good News!">
              macOS uses Core Audio, which has excellent built-in latency
              (15-30% better than Windows ASIO on average). You don't need to
              install special drivers.
            </GuideInfoBox>

            <p>
              If you have a Focusrite Scarlett, you can optionally install
              Focusrite Control 2 for additional features and the "Low Latency
              Kext" for ~1ms improvement.
            </p>

            <h5 style={{ margin: '16px 0 8px', color: 'var(--text-primary)' }}>
              Optional for Focusrite:
            </h5>
            <ul style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
              <li>Download <a href="https://downloads.focusrite.com/" target="_blank" rel="noopener noreferrer" className="guide-external-link">Focusrite Control 2 <ExternalLinkIcon /></a></li>
              <li>Install the optional "Low Latency Kext" for ~1ms improvement</li>
            </ul>

            <div className="guide-step-actions">
              <button
                className="guide-btn primary"
                onClick={() => guide.markStepCompleted(STEP_IDS.DRIVER)}
              >
                Continue
              </button>
            </div>
          </GuideStep>
        )}

        {/* Audio Test */}
        {!guide.isStepCompleted(STEP_IDS.AUDIO_TEST) && (
          <GuideStep
            stepNumber={4}
            title="Audio System Test"
            description="Verify audio playback is working"
            status={getStepStatus(STEP_IDS.AUDIO_TEST)}
            defaultExpanded
          >
            <p>
              Let's test that your audio system is working correctly. This will
              play a short beep to verify output.
            </p>

            <div className="guide-step-actions">
              <GuideTester label="Test Audio" onTest={testAudioSystem} />
            </div>
          </GuideStep>
        )}

        {/* Latency Check */}
        {!guide.isStepCompleted(STEP_IDS.LATENCY_CHECK) && (
          <GuideStep
            stepNumber={5}
            title="Latency Measurement"
            description="Measure your current audio latency"
            status={getStepStatus(STEP_IDS.LATENCY_CHECK)}
            defaultExpanded
          >
            <p>
              Let's measure your current audio latency. For real-time music
              making, you want:
            </p>
            <ul style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
              <li><strong>&lt; 10ms</strong> - Excellent (imperceptible)</li>
              <li><strong>10-20ms</strong> - Good (acceptable)</li>
              <li><strong>&gt; 20ms</strong> - High (noticeable delay)</li>
            </ul>

            <div className="guide-step-actions">
              <GuideTester label="Measure Latency" onTest={testLatency} />
            </div>
          </GuideStep>
        )}

        {/* System Optimization */}
        {!guide.isStepCompleted(STEP_IDS.OPTIMIZATION) && (
          <GuideStep
            stepNumber={6}
            title="System Optimization"
            description="Optimize your system for low latency"
            status={getStepStatus(STEP_IDS.OPTIMIZATION)}
            defaultExpanded
          >
            {isWindows ? (
              <>
                <h5 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>
                  Windows Optimization:
                </h5>
                <ol style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
                  <li>Set Power Plan to "High Performance"</li>
                  <li>Disable USB selective suspend in Power Options</li>
                  <li>Close unnecessary background applications</li>
                  <li>Disable Game Mode (Settings → Gaming)</li>
                  <li>Update your audio interface drivers</li>
                </ol>

                <GuideInfoBox type="tip" title="Buffer Size">
                  In your audio settings, start with a buffer size of 256 samples.
                  If stable, try 128 samples for lower latency.
                </GuideInfoBox>
              </>
            ) : isMac ? (
              <>
                <h5 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>
                  macOS Optimization:
                </h5>
                <ol style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
                  <li>Disable Time Machine during sessions</li>
                  <li>Turn off Bluetooth if not needed</li>
                  <li>Close unnecessary background applications</li>
                  <li>Keep your Mac plugged in (avoid battery mode)</li>
                  <li>Connect audio interface directly (not through a hub)</li>
                </ol>

                <GuideInfoBox type="tip" title="Buffer Size">
                  Mac can typically handle lower buffer sizes. Try 128 samples,
                  or even 64 samples with a quality audio interface.
                </GuideInfoBox>
              </>
            ) : (
              <p>
                Close unnecessary background applications and ensure your audio
                interface is connected directly via USB.
              </p>
            )}

            <div className="guide-step-actions">
              <button
                className="guide-btn primary"
                onClick={() => guide.markStepCompleted(STEP_IDS.OPTIMIZATION)}
              >
                I've optimized my system
              </button>
            </div>
          </GuideStep>
        )}

        {/* Final Verification */}
        {!guide.isStepCompleted(STEP_IDS.VERIFICATION) && (
          <GuideStep
            stepNumber={7}
            title="Final Verification"
            description="Confirm your setup is working"
            status={getStepStatus(STEP_IDS.VERIFICATION)}
            defaultExpanded
          >
            <p>
              You're almost done! Let's run a final test to make sure everything
              is working correctly.
            </p>

            {latencyInfo && (
              <GuideInfoBox
                type={getLatencyRating(latencyInfo.totalLatency) === 'bad' ? 'warning' : 'success'}
                title="Current Latency"
              >
                Total latency: <strong>{formatLatency(latencyInfo.totalLatency)}</strong>
                {getLatencyRating(latencyInfo.totalLatency) === 'good' && ' - Excellent!'}
                {getLatencyRating(latencyInfo.totalLatency) === 'okay' && ' - Good enough for most use cases.'}
                {getLatencyRating(latencyInfo.totalLatency) === 'bad' && ' - Consider reviewing the optimization steps.'}
              </GuideInfoBox>
            )}

            <div className="guide-step-actions">
              <GuideTester
                label="Run Final Test"
                onTest={async () => {
                  const latency = getLatencyInfo();
                  setLatencyInfo(latency);

                  const audio = await testAudioPlayback();
                  if (!audio.success) {
                    return { status: 'failure', message: audio.message };
                  }

                  guide.markStepCompleted(STEP_IDS.VERIFICATION);
                  return {
                    status: 'success',
                    message: `Setup complete! Latency: ${formatLatency(latency.totalLatency)}`,
                  };
                }}
              />
            </div>
          </GuideStep>
        )}
      </GuideSection>

      {/* All Complete */}
      {completedSteps.length === totalSteps && (
        <GuideInfoBox type="success" title="Setup Complete!">
          Your audio system is now optimized for low-latency performance.
          {latencyInfo && (
            <>
              <br />
              <br />
              <strong>Final latency: {formatLatency(latencyInfo.totalLatency)}</strong>
            </>
          )}
        </GuideInfoBox>
      )}
    </GuideContainer>
  );
}

// Section component for grouping steps
interface GuideSectionProps {
  title: string;
  count: number;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function GuideSection({ title, count, defaultCollapsed, children }: GuideSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed || false);

  if (count === 0) return null;

  return (
    <div className="guide-section">
      <div
        className="guide-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="guide-section-title">{title}</h3>
        <span className="guide-section-count">{count}</span>
        <div className={`guide-section-toggle ${isCollapsed ? 'collapsed' : ''}`}>
          <ChevronDownIcon />
        </div>
      </div>
      {!isCollapsed && <div className="guide-section-content">{children}</div>}
    </div>
  );
}

// Icons
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export default LowLatencyGuide;
