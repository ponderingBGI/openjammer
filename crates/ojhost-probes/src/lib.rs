//! Deterministic, deliberately unusual CLAP plug-ins used only by ojhost's
//! conformance and adversarial suites. One real dynamic library exposes every descriptor;
//! this keeps CI fast while still exercising CLAP's scan/load ABI boundary.

use std::ffi::CStr;
use std::fmt::Write as _;
use std::io::{Read, Write as _};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

static LIVE_INSTANCES: AtomicUsize = AtomicUsize::new(0);

/// Test-only ABI queried by the conformance harness to prove every CLAP
/// instance was destroyed rather than leaked behind an outstanding clack Arc.
#[no_mangle]
pub extern "C" fn oj_probe_live_instances() -> usize {
    LIVE_INSTANCES.load(Ordering::Acquire)
}

use clack_extensions::audio_ports::{
    AudioPortFlags, AudioPortInfo, AudioPortInfoWriter, AudioPortType, PluginAudioPorts,
    PluginAudioPortsImpl,
};
use clack_extensions::audio_ports_config::{
    AudioPortConfigWriter, AudioPortsConfiguration, MainPortInfo, PluginAudioPortsConfig,
    PluginAudioPortsConfigImpl,
};
use clack_extensions::latency::{PluginLatency, PluginLatencyImpl};
use clack_extensions::note_ports::{
    NoteDialect, NoteDialects, NotePortInfo, NotePortInfoWriter, PluginNotePorts,
    PluginNotePortsImpl,
};
use clack_extensions::params::{
    ParamDisplayWriter, ParamInfo, ParamInfoFlags, ParamInfoWriter, PluginAudioProcessorParams,
    PluginMainThreadParams, PluginParams,
};
use clack_extensions::state::{PluginState, PluginStateImpl};
use clack_extensions::tail::{PluginTail, PluginTailImpl, TailLength};
use clack_plugin::entry::prelude::*;
use clack_plugin::prelude::*;
use clack_plugin::stream::{InputStream, OutputStream};

const IDS: [&str; 14] = [
    "org.openjammer.probe.gain",
    "org.openjammer.probe.latency-n",
    "org.openjammer.probe.tail",
    "org.openjammer.probe.state-heavy",
    "org.openjammer.probe.params-500",
    "org.openjammer.probe.notes",
    "org.openjammer.probe.ports-weird",
    "org.openjammer.probe.slow-activate",
    "org.openjammer.probe.block-hang",
    "org.openjammer.probe.abort",
    "org.openjammer.probe.nan",
    "org.openjammer.probe.denormal",
    "org.openjammer.probe.event-flood",
    "org.openjammer.probe.state-liar",
];
const NAMES: [&str; 14] = [
    "probe-gain",
    "probe-latency-N",
    "probe-tail",
    "probe-state-heavy",
    "probe-params-500",
    "probe-notes",
    "probe-ports-weird",
    "probe-slow-activate",
    "probe-block-hang",
    "probe-abort",
    "probe-nan",
    "probe-denormal",
    "probe-event-flood",
    "probe-state-liar",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Gain,
    Latency,
    Tail,
    StateHeavy,
    Params500,
    Notes,
    PortsWeird,
    SlowActivate,
    BlockHang,
    Abort,
    Nan,
    Denormal,
    EventFlood,
    StateLiar,
}

impl Kind {
    const fn from_index(index: usize) -> Self {
        [
            Self::Gain,
            Self::Latency,
            Self::Tail,
            Self::StateHeavy,
            Self::Params500,
            Self::Notes,
            Self::PortsWeird,
            Self::SlowActivate,
            Self::BlockHang,
            Self::Abort,
            Self::Nan,
            Self::Denormal,
            Self::EventFlood,
            Self::StateLiar,
        ][index]
    }
}

struct Shared {
    gain: AtomicU64,
}
impl PluginShared<'_> for Shared {}
impl Drop for Shared {
    fn drop(&mut self) {
        LIVE_INSTANCES.fetch_sub(1, Ordering::AcqRel);
    }
}

struct Main<'a> {
    kind: Kind,
    values: Vec<f64>,
    state: Vec<u8>,
    latency: u32,
    host: HostMainThreadHandle<'a>,
}
impl<'a> PluginMainThread<'a, Shared> for Main<'a> {}

struct Audio<'a> {
    kind: Kind,
    shared: &'a Shared,
    active_note: bool,
    blocks: u32,
}

struct Probe;
impl Plugin for Probe {
    type AudioProcessor<'a> = Audio<'a>;
    type Shared<'a> = Shared;
    type MainThread<'a> = Main<'a>;

    fn declare_extensions(builder: &mut PluginExtensions<Self>, _shared: Option<&Shared>) {
        builder.register::<PluginParams>();
        builder.register::<PluginState>();
        builder.register::<PluginLatency>();
        builder.register::<PluginTail>();
        builder.register::<PluginAudioPorts>();
        builder.register::<PluginAudioPortsConfig>();
        builder.register::<PluginNotePorts>();
    }
}

impl<'a> PluginAudioProcessor<'a, Shared, Main<'a>> for Audio<'a> {
    fn activate(
        _host: HostAudioProcessorHandle<'a>,
        main: &mut Main<'a>,
        shared: &'a Shared,
        _config: PluginAudioConfiguration,
    ) -> Result<Self, PluginError> {
        if main.kind == Kind::SlowActivate {
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        Ok(Self {
            kind: main.kind,
            shared,
            active_note: false,
            blocks: 0,
        })
    }

    fn process(
        &mut self,
        _process: Process,
        mut audio: clack_plugin::prelude::Audio,
        events: Events,
    ) -> Result<ProcessStatus, PluginError> {
        use clack_plugin::events::event_types::{
            NoteChokeEvent, NoteEndEvent, NoteOffEvent, NoteOnEvent, ParamGestureBeginEvent,
            ParamGestureEndEvent, ParamValueEvent,
        };
        self.blocks = self.blocks.saturating_add(1);
        if self.kind == Kind::BlockHang && self.blocks == 2 {
            // A severe finite stall proves post-call budget containment. A truly
            // infinite in-process call cannot be preempted safely; that limit is
            // deliberately tested/documented at the host boundary instead of
            // pretending a timer can unwind arbitrary foreign code.
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if self.kind == Kind::Abort && self.blocks == 2 {
            std::process::abort();
        }
        let initial_gain = f64::from_bits(self.shared.gain.load(Ordering::Relaxed));
        let initial_note = self.active_note;
        for mut pair in &mut audio {
            let Some(channels) = pair.channels()?.into_f32() else {
                continue;
            };
            for channel in channels {
                match channel {
                    ChannelPair::InputOutput(input, output) => {
                        let mut gain = initial_gain;
                        let mut active = initial_note;
                        for (frame, (src, dst)) in input.iter().zip(output).enumerate() {
                            for event in events.input {
                                if event.header().time() as usize == frame {
                                    if let Some(value) = event.as_event::<ParamValueEvent>() {
                                        gain = value.value();
                                    }
                                    if event.as_event::<NoteOnEvent>().is_some() {
                                        active = true;
                                    }
                                    if event.as_event::<NoteOffEvent>().is_some()
                                        || event.as_event::<NoteChokeEvent>().is_some()
                                    {
                                        active = false;
                                    }
                                }
                            }
                            *dst = if self.kind == Kind::Nan {
                                if frame % 2 == 0 {
                                    f32::NAN
                                } else {
                                    f32::INFINITY
                                }
                            } else if self.kind == Kind::Denormal {
                                f32::from_bits(1)
                            } else if self.kind == Kind::Notes {
                                if active {
                                    0.25
                                } else {
                                    0.0
                                }
                            } else {
                                *src * gain as f32
                            };
                        }
                    }
                    ChannelPair::InPlace(buffer) => {
                        let mut gain = initial_gain;
                        for (frame, sample) in buffer.iter_mut().enumerate() {
                            for event in events.input {
                                if event.header().time() as usize == frame {
                                    if let Some(value) = event.as_event::<ParamValueEvent>() {
                                        gain = value.value();
                                    }
                                }
                            }
                            *sample *= gain as f32;
                        }
                    }
                    ChannelPair::OutputOnly(output) => {
                        let mut active = initial_note;
                        for (frame, sample) in output.iter_mut().enumerate() {
                            for event in events.input {
                                if event.header().time() as usize == frame {
                                    if event.as_event::<NoteOnEvent>().is_some() {
                                        active = true;
                                    }
                                    if event.as_event::<NoteOffEvent>().is_some()
                                        || event.as_event::<NoteChokeEvent>().is_some()
                                    {
                                        active = false;
                                    }
                                }
                            }
                            *sample = if self.kind == Kind::Notes && active {
                                0.25
                            } else {
                                0.0
                            };
                        }
                    }
                    ChannelPair::InputOnly(_) => {}
                }
            }
        }
        for event in events.input {
            if let Some(value) = event.as_event::<ParamValueEvent>() {
                self.shared
                    .gain
                    .store(value.value().to_bits(), Ordering::Relaxed);
                if self.kind == Kind::Params500 {
                    if let Some(id) = value.param_id() {
                        let time = event.header().time();
                        let _ = events
                            .output
                            .try_push(ParamGestureBeginEvent::new(time, id));
                        let _ = events.output.try_push(value);
                        let _ = events.output.try_push(ParamGestureEndEvent::new(time, id));
                    }
                }
            }
            if event.as_event::<NoteOnEvent>().is_some() {
                self.active_note = true;
            }
            if event.as_event::<NoteOffEvent>().is_some()
                || event.as_event::<NoteChokeEvent>().is_some()
            {
                self.active_note = false;
            }
            if let Some(choke) = event.as_event::<NoteChokeEvent>() {
                let _ = events
                    .output
                    .try_push(NoteEndEvent::new(event.header().time(), choke.pckn()));
            }
        }
        if self.kind == Kind::EventFlood {
            for i in 0..10_000u32 {
                let id = ClapId::new(1);
                let _ = events.output.try_push(ParamValueEvent::new(
                    i % 64,
                    id,
                    clack_plugin::events::Pckn::match_all(),
                    (i % 100) as f64 / 100.0,
                    clack_plugin::utils::Cookie::empty(),
                ));
            }
        }
        Ok(ProcessStatus::Continue)
    }
}

fn apply_params(shared: &Shared, input: &InputEvents) {
    use clack_plugin::events::event_types::ParamValueEvent;
    for event in input {
        if let Some(value) = event.as_event::<ParamValueEvent>() {
            shared
                .gain
                .store(value.value().to_bits(), Ordering::Relaxed);
        }
    }
}

impl PluginAudioProcessorParams for Audio<'_> {
    fn flush(&mut self, input: &InputEvents, _output: &mut OutputEvents) {
        apply_params(self.shared, input);
    }
}

impl PluginMainThreadParams for Main<'_> {
    fn count(&mut self) -> u32 {
        if self.kind == Kind::Params500 {
            500
        } else {
            1
        }
    }
    fn get_info(&mut self, index: u32, writer: &mut ParamInfoWriter) {
        if index >= PluginMainThreadParams::count(self) {
            return;
        }
        let name = if self.kind == Kind::Params500 {
            b"Probe Parameter".as_slice()
        } else {
            b"Gain".as_slice()
        };
        writer.set(&ParamInfo {
            id: ClapId::new(index + 1),
            flags: ParamInfoFlags::IS_AUTOMATABLE,
            cookie: clack_plugin::utils::Cookie::empty(),
            name,
            module: b"Conformance/Probe",
            min_value: 0.0,
            max_value: 2.0,
            default_value: 1.0,
        });
    }
    fn get_value(&mut self, id: ClapId) -> Option<f64> {
        self.values.get(id.get().checked_sub(1)? as usize).copied()
    }
    fn value_to_text(
        &mut self,
        _id: ClapId,
        value: f64,
        writer: &mut ParamDisplayWriter,
    ) -> std::fmt::Result {
        write!(writer, "{value:.3} dB")
    }
    fn text_to_value(&mut self, _id: ClapId, text: &CStr) -> Option<f64> {
        text.to_string_lossy()
            .split_whitespace()
            .next()?
            .parse()
            .ok()
    }
    fn flush(&mut self, input: &InputEvents, _output: &mut OutputEvents) {
        use clack_plugin::events::event_types::ParamValueEvent;
        for event in input {
            if let Some(value) = event.as_event::<ParamValueEvent>() {
                if let Some(id) = value.param_id() {
                    if let Some(slot) = self.values.get_mut(id.get().saturating_sub(1) as usize) {
                        *slot = value.value();
                    }
                }
            }
        }
    }
}

impl PluginStateImpl for Main<'_> {
    fn save(&mut self, output: &mut OutputStream) -> Result<(), PluginError> {
        output.write_all(&self.state)?;
        Ok(())
    }
    fn load(&mut self, input: &mut InputStream) -> Result<(), PluginError> {
        if self.kind == Kind::StateLiar {
            return Err(PluginError::Message("rejects its own saved state"));
        }
        self.state.clear();
        input.read_to_end(&mut self.state)?;
        if self.kind == Kind::Latency && self.state.len() == 4 {
            self.latency = u32::from_le_bytes(self.state[..4].try_into().unwrap());
            if let Some(ext) = self
                .host
                .get_extension::<clack_extensions::latency::HostLatency>()
            {
                ext.changed(&mut self.host);
            }
        } else if self.kind == Kind::Params500 {
            if let Some(ext) = self
                .host
                .get_extension::<clack_extensions::params::HostParams>()
            {
                ext.rescan(
                    &mut self.host,
                    clack_extensions::params::ParamRescanFlags::ALL,
                );
            }
        }
        Ok(())
    }
}
impl PluginLatencyImpl for Main<'_> {
    fn get(&mut self) -> u32 {
        self.latency
    }
}
impl PluginTailImpl for Audio<'_> {
    fn get(&self) -> TailLength {
        if self.kind == Kind::Tail {
            TailLength::Finite(48_000)
        } else {
            TailLength::Finite(0)
        }
    }
}

impl PluginAudioPortsImpl for Main<'_> {
    fn count(&mut self, is_input: bool) -> u32 {
        match self.kind {
            Kind::Notes if is_input => 0,
            Kind::PortsWeird => 2,
            _ => 1,
        }
    }
    fn get(&mut self, index: u32, is_input: bool, writer: &mut AudioPortInfoWriter) {
        if index >= PluginAudioPortsImpl::count(self, is_input) {
            return;
        }
        let channels = if self.kind == Kind::PortsWeird && index == 0 {
            1
        } else {
            2
        };
        writer.set(&AudioPortInfo {
            id: ClapId::new(index + if is_input { 10 } else { 20 }),
            name: if index == 0 {
                if is_input {
                    b"Main Mono"
                } else {
                    b"Main Out"
                }
            } else {
                if is_input {
                    b"Sidechain"
                } else {
                    b"Aux Out"
                }
            },
            channel_count: channels,
            flags: if index == 0 {
                AudioPortFlags::IS_MAIN
            } else {
                AudioPortFlags::empty()
            },
            port_type: Some(if channels == 1 {
                AudioPortType::MONO
            } else {
                AudioPortType::STEREO
            }),
            in_place_pair: None,
        });
    }
}

impl PluginAudioPortsConfigImpl for Main<'_> {
    fn count(&mut self) -> u32 {
        if self.kind == Kind::PortsWeird {
            2
        } else {
            1
        }
    }
    fn get(&mut self, index: u32, writer: &mut AudioPortConfigWriter) {
        if index >= PluginAudioPortsConfigImpl::count(self) {
            return;
        }
        let channels = index + 1;
        writer.write(&AudioPortsConfiguration {
            id: ClapId::new(100 + index),
            name: if index == 0 { b"Mono" } else { b"Stereo" },
            input_port_count: 1,
            output_port_count: 1,
            main_input: Some(MainPortInfo {
                channel_count: channels,
                port_type: AudioPortType::from_channel_count(channels),
            }),
            main_output: Some(MainPortInfo {
                channel_count: channels,
                port_type: AudioPortType::from_channel_count(channels),
            }),
        });
    }
    fn select(&mut self, id: ClapId) -> Result<(), PluginError> {
        if (100..=101).contains(&id.get()) {
            Ok(())
        } else {
            Err(PluginError::Message("bad config"))
        }
    }
}

impl PluginNotePortsImpl for Main<'_> {
    fn count(&mut self, is_input: bool) -> u32 {
        u32::from(self.kind == Kind::Notes && is_input)
    }
    fn get(&mut self, index: u32, is_input: bool, writer: &mut NotePortInfoWriter) {
        if index == 0 && self.kind == Kind::Notes && is_input {
            writer.set(&NotePortInfo {
                id: ClapId::new(1),
                name: b"Notes",
                supported_dialects: NoteDialects::CLAP | NoteDialects::MIDI,
                preferred_dialect: Some(NoteDialect::Clap),
            });
        }
    }
}

struct ProbesEntry {
    factory: PluginFactoryWrapper<ProbesFactory>,
}
impl Entry for ProbesEntry {
    fn new(path: Option<&CStr>) -> Result<Self, EntryLoadError> {
        if path.is_some_and(|p| p.to_string_lossy().contains("crash-on-scan")) {
            std::process::abort();
        }
        Ok(Self {
            factory: PluginFactoryWrapper::new(ProbesFactory::new()),
        })
    }
    fn declare_factories<'a>(&'a self, builder: &mut EntryFactories<'a>) {
        builder.register_factory(&self.factory);
    }
}

struct ProbesFactory {
    descriptors: Vec<clack_plugin::plugin::PluginDescriptor>,
}
impl ProbesFactory {
    fn new() -> Self {
        let descriptors = IDS
            .iter()
            .zip(NAMES)
            .map(|(id, name)| {
                clack_plugin::plugin::PluginDescriptor::new(id, name).with_vendor("OpenJammer")
            })
            .collect();
        Self { descriptors }
    }
}
impl PluginFactoryImpl for ProbesFactory {
    fn plugin_count(&self) -> u32 {
        self.descriptors.len() as u32
    }
    fn plugin_descriptor(&self, index: u32) -> Option<&clack_plugin::plugin::PluginDescriptor> {
        self.descriptors.get(index as usize)
    }
    fn create_plugin<'a>(
        &'a self,
        host: clack_plugin::host::HostInfo<'a>,
        id: &CStr,
    ) -> Option<PluginInstance<'a>> {
        let index = self.descriptors.iter().position(|d| d.id() == Some(id))?;
        let kind = Kind::from_index(index);
        let descriptor = &self.descriptors[index];
        Some(PluginInstance::new::<Probe>(
            host,
            descriptor,
            |_| {
                Ok(Shared {
                    gain: AtomicU64::new(1.0f64.to_bits()),
                })
            },
            move |host, _| {
                LIVE_INSTANCES.fetch_add(1, Ordering::AcqRel);
                let state = if kind == Kind::StateHeavy {
                    let mut v = vec![0u8; 1_048_576];
                    v[..8].copy_from_slice(b"OJPSTv01");
                    v
                } else {
                    b"oj-probe-state-v1".to_vec()
                };
                let latency = if kind == Kind::Latency {
                    std::env::var("OJ_PROBE_LATENCY")
                        .ok()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(257)
                } else {
                    0
                };
                Ok(Main {
                    kind,
                    values: vec![1.0; if kind == Kind::Params500 { 500 } else { 1 }],
                    state,
                    latency,
                    host,
                })
            },
        ))
    }
}

clack_plugin::clack_export_entry!(ProbesEntry);
