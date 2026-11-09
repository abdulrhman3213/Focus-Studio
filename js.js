/***********************************************************************
 * SERVICE WORKER REGISTRATION (for PWA install + better background)
 ***********************************************************************/
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((e) => {
            console.log('SW registration failed:', e);
        });
    });
}

/***********************************************************************
 * 0. UNTHROTTLED BACKGROUND WEB WORKER CLOCK
 ***********************************************************************/
class BackgroundWorkerClock {
    constructor() {
        this.callbacks = new Map();
        this.nextId = 1;
        this.worker = null;
        this.initWorker();
    }

    initWorker() {
        try {
            const workerCode = `
                const timers = new Map();
                self.onmessage = function(e) {
                    const { cmd, id, ms } = e.data;
                    if (cmd === 'setInterval') {
                        if (timers.has(id)) clearInterval(timers.get(id));
                        const t = setInterval(() => self.postMessage({ id, type: 'interval' }), ms);
                        timers.set(id, t);
                    } else if (cmd === 'setTimeout') {
                        if (timers.has(id)) clearTimeout(timers.get(id));
                        const t = setTimeout(() => {
                            timers.delete(id);
                            self.postMessage({ id, type: 'timeout' });
                        }, ms);
                        timers.set(id, t);
                    } else if (cmd === 'clear') {
                        if (timers.has(id)) {
                            clearInterval(timers.get(id));
                            clearTimeout(timers.get(id));
                            timers.delete(id);
                        }
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));
            this.worker.onmessage = (e) => {
                const { id, type } = e.data;
                const entry = this.callbacks.get(id);
                if (!entry) return;
                if (type === 'timeout') this.callbacks.delete(id);
                try { entry.fn(); } catch (err) {}
            };
        } catch (err) {
            this.worker = null;
        }
    }

    setInterval(fn, ms) {
        if (!this.worker) return window.setInterval(fn, ms);
        const id = this.nextId++;
        this.callbacks.set(id, { fn, type: 'interval' });
        this.worker.postMessage({ cmd: 'setInterval', id, ms: Math.max(15, Math.round(ms)) });
        return id;
    }

    setTimeout(fn, ms) {
        if (!this.worker) return window.setTimeout(fn, ms);
        const id = this.nextId++;
        this.callbacks.set(id, { fn, type: 'timeout' });
        this.worker.postMessage({ cmd: 'setTimeout', id, ms: Math.max(15, Math.round(ms)) });
        return id;
    }

    clear(id) {
        if (!id) return;
        if (!this.worker) { window.clearInterval(id); window.clearTimeout(id); return; }
        this.callbacks.delete(id);
        this.worker.postMessage({ cmd: 'clear', id });
    }
}

const bgClock = new BackgroundWorkerClock();

/***********************************************************************
 * 1. CHANNEL DEFINITIONS
 ***********************************************************************/
const STUDIO_CHANNELS = [
    { id: 'gentle-rain', category: 'weather', title: 'Gentle Rain', subtitle: 'Bandpass pink noise + light high-frequency droplet impulses', icon: 'fa-cloud-rain', accentColor: 'text-cyan-400', defaultVol: 50 },
    { id: 'heavy-rain', category: 'weather', title: 'Heavy Rainstorm', subtitle: 'Dense multi-band rain wash with deep low-mid body & swell', icon: 'fa-cloud-showers-heavy', accentColor: 'text-blue-400', defaultVol: 65 },
    { id: 'rain-window', category: 'weather', title: 'Window Raindrops', subtitle: 'High-Q resonant bandpass taps (800Hz-2.4kHz) on glass pane', icon: 'fa-house-flood-water', accentColor: 'text-sky-400', defaultVol: 50 },
    { id: 'distant-thunder', category: 'weather', title: 'Distant Rolling Thunder', subtitle: 'Stochastic sub-bass rumbles (35-90Hz burst envelope)', icon: 'fa-bolt-lightning', accentColor: 'text-amber-400', defaultVol: 45, hasThunderTrigger: true },
    { id: 'ocean-waves', category: 'weather', title: 'Ocean Waves', subtitle: '0.12 Hz LFO stereo surf sweep + receding shoreline foam hiss', icon: 'fa-water', accentColor: 'text-teal-400', defaultVol: 60 },
    { id: 'babbling-brook', category: 'weather', title: 'Mountain Stream / Brook', subtitle: 'Fast LFO multi-band resonant water ripples & bubbling eddies', icon: 'fa-droplet', accentColor: 'text-cyan-300', defaultVol: 45 },
    { id: 'underwater-abyss', category: 'weather', title: 'Deep Underwater Abyss', subtitle: '110Hz hydrophone pressure rumble & soft resonant bubble blips', icon: 'fa-water-ladder', accentColor: 'text-indigo-400', defaultVol: 50 },
    { id: 'forest-wind', category: 'nature', title: 'Forest Wind in Pines', subtitle: 'Dual detuned resonant bandpass filters swept by slow LFOs', icon: 'fa-wind', accentColor: 'text-emerald-400', defaultVol: 45 },
    { id: 'cozy-fireplace', category: 'nature', title: 'Cozy Fireplace', subtitle: 'Warm low-pass hearth hum + mid crackle bursts & micro-pops', icon: 'fa-fire', accentColor: 'text-orange-400', defaultVol: 55 },
    { id: 'night-crickets', category: 'nature', title: 'Night Crickets & Cicadas', subtitle: 'Rhythmic AM-modulated 3.8kHz-4.6kHz evening insect chorus', icon: 'fa-moon', accentColor: 'text-indigo-300', defaultVol: 35 },
    { id: 'singing-birds', category: 'nature', title: 'Morning Forest Birds', subtitle: 'Procedural FM-synthesized melodic bird chirps & two-tone calls', icon: 'fa-dove', accentColor: 'text-lime-400', defaultVol: 35 },
    { id: 'howling-blizzard', category: 'nature', title: 'Howling Blizzard Wind', subtitle: 'High-resonance whistling arctic gusts (300Hz-1100Hz sweep)', icon: 'fa-snowflake', accentColor: 'text-cyan-200', defaultVol: 45 },
    { id: 'coffee-shop', category: 'spaces', title: 'Coffee Shop Murmur', subtitle: 'Multi-formant warm background chatter + ceramic cup clinks', icon: 'fa-mug-saucer', accentColor: 'text-amber-300', defaultVol: 50 },
    { id: 'mech-keyboard', category: 'spaces', title: 'Mechanical Keyboard', subtitle: 'Tactile switch clacks + 220Hz keycap thock & speed selector', icon: 'fa-keyboard', accentColor: 'text-indigo-300', defaultVol: 40, hasKeyboardSpeedSelector: true },
    { id: 'quiet-library', category: 'spaces', title: 'Quiet Library Hall', subtitle: 'Soft reading room tone + page-turn rustles & muted footsteps', icon: 'fa-book-open-reader', accentColor: 'text-yellow-400', defaultVol: 45 },
    { id: 'night-train', category: 'spaces', title: 'Night Train Ride', subtitle: 'Rhythmic clack-clack rail joint cadence & sleeper cabin hum', icon: 'fa-train-subway', accentColor: 'text-sky-300', defaultVol: 55 },
    { id: 'airplane-cabin', category: 'spaces', title: 'Airplane Cabin Cruise', subtitle: 'Pressurized 180Hz turbine drone + smooth cabin air wash', icon: 'fa-plane', accentColor: 'text-blue-300', defaultVol: 50 },
    { id: 'vinyl-crackle', category: 'spaces', title: 'Vintage Vinyl Crackle', subtitle: 'Warm analog needle surface hiss + stochastic micro dust pops', icon: 'fa-record-vinyl', accentColor: 'text-rose-300', defaultVol: 35 },
    { id: 'clock-tick', category: 'spaces', title: 'Grandfather Clock', subtitle: 'Steady 60 BPM mechanical pendulum tick-tock & woody body', icon: 'fa-clock', accentColor: 'text-yellow-500', defaultVol: 35 },
    { id: 'brown-noise', category: 'noise', title: 'Brown Noise', subtitle: 'Deep -6dB/octave leaky integrator low-frequency rumble', icon: 'fa-layer-group', accentColor: 'text-amber-500', defaultVol: 50 },
    { id: 'pink-noise', category: 'noise', title: 'Pink Noise', subtitle: 'Balanced -3dB/octave Paul Kellet natural octave spectrum', icon: 'fa-chart-simple', accentColor: 'text-rose-400', defaultVol: 35 },
    { id: 'white-noise', category: 'noise', title: 'White Noise', subtitle: 'Crisp flat-spectrum speech masking noise with soft high trim', icon: 'fa-braille', accentColor: 'text-slate-200', defaultVol: 25 },
    { id: 'green-noise', category: 'noise', title: 'Green Noise', subtitle: 'Mid-range 500Hz bandpass-centered natural acoustic spectrum', icon: 'fa-leaf', accentColor: 'text-emerald-400', defaultVol: 45 },
    { id: 'grey-noise', category: 'noise', title: 'Grey Noise', subtitle: 'Psychoacoustic equal-loudness curve (inverse A-weighting)', icon: 'fa-sliders', accentColor: 'text-indigo-300', defaultVol: 40 },
    { id: 'lofi-chords', category: 'music', title: 'Lo-Fi Electric Piano (Rhodes)', subtitle: 'Polyphonic 7th/9th chord sequencer + analog tape pitch wobble', icon: 'fa-music', accentColor: 'text-indigo-400', defaultVol: 60, hasChordMoodSelector: true },
    { id: 'felt-piano', category: 'music', title: 'Soft Felt Piano Notes', subtitle: 'Sparse generative pentatonic/minor felt piano with warm decay', icon: 'fa-wand-magic-sparkles', accentColor: 'text-violet-300', defaultVol: 50 },
    { id: 'ambient-drone', category: 'music', title: 'Ambient Space Pad', subtitle: 'Lush detuned multi-oscillator 5th/9th harmonic breathing drone', icon: 'fa-infinity', accentColor: 'text-purple-400', defaultVol: 45 },
    { id: 'singing-bowls', category: 'music', title: 'Tibetan Singing Bowls', subtitle: 'Inharmonic metallic FM bell partials (1 : 2.75 : 5.4) + Strike button', icon: 'fa-bell', accentColor: 'text-yellow-300', defaultVol: 40, hasBowlTrigger: true },
    { id: 'synth-arp', category: 'music', title: 'Warm Analog Synth Arp', subtitle: 'Muted low-pass 80s synth-wave study pulse arpeggiator', icon: 'fa-wave-square', accentColor: 'text-cyan-400', defaultVol: 45, hasArpSpeedSelector: true },
    { id: 'binaural-beats', category: 'brainwaves', title: 'Binaural Focus Beats', subtitle: 'True stereo L/R pure sine offset + state & carrier pitch selector', icon: 'fa-headphones-simple', accentColor: 'text-fuchsia-400', defaultVol: 30, hasBinauralSelector: true },
    { id: 'isochronic-pulses', category: 'brainwaves', title: 'Isochronic Focus Pulses', subtitle: 'Rhythmic AM tone pulses (No headphones required)', icon: 'fa-circle-nodes', accentColor: 'text-cyan-400', defaultVol: 30, hasIsochronicSelector: true },
    { id: 'solfeggio-drone', category: 'brainwaves', title: 'Solfeggio Harmonic Drone', subtitle: 'Pure harmonic sine/triangle pad (432Hz, 528Hz, 396Hz)', icon: 'fa-om', accentColor: 'text-emerald-300', defaultVol: 35, hasSolfeggioSelector: true },
    { id: 'rage-gangsta', category: 'rage', title: "Gangsta's Paradise (Instrumental)", subtitle: 'Gothic Cathedral Choir + West Coast Strings + 808 Sub + Boom-Bap Beat (No Words)', icon: 'fa-crown', accentColor: 'text-amber-400', defaultVol: 75, isRageTrack: true, bpm: 85, keySignature: 'C Minor' },
    { id: 'rage-amour', category: 'rage', title: '𝕬𝖒𝖔𝖚𝖗 𝕻𝖑𝖆𝖘𝖙𝖎𝖖𝖚𝖊 (Instrumental)', subtitle: 'Nostalgic French Synthwave Lead + Driving Pulse Bass + Analog Pads (No Words)', icon: 'fa-heart-crack', accentColor: 'text-rose-400', defaultVol: 75, isRageTrack: true, bpm: 106, keySignature: 'D Minor' },
    { id: 'rage-gogyal', category: 'rage', title: 'Go Gyal (Aggressive Drift Phonk)', subtitle: 'Overdriven 808 Cowbell Riff + Distorted Brazilian Sub-Bass + Phonk Percussion', icon: 'fa-bolt', accentColor: 'text-fuchsia-400', defaultVol: 75, isRageTrack: true, bpm: 130, keySignature: 'F# Minor' },
    { id: 'rage-bloodymary', category: 'rage', title: 'Bloody Mary (Dark Gothic Instrumental)', subtitle: 'Haunting Harpsichord Pluck + Dramatic Dark Cello Swells + Heavy Stomp Beat', icon: 'fa-skull', accentColor: 'text-rose-500', defaultVol: 75, isRageTrack: true, bpm: 100, keySignature: 'A Minor' },
    { id: 'rage-littledarkage', category: 'rage', title: 'Little Dark Age (Gothic Synth-Pop)', subtitle: 'Heavy Detuned Sawtooth Bass + Haunting Analog Lead + 80s Gated Snare (No Words)', icon: 'fa-moon', accentColor: 'text-purple-400', defaultVol: 75, isRageTrack: true, bpm: 96, keySignature: 'D Minor' },
    { id: 'rage-soviet', category: 'rage', title: 'Soviet Union Anthem (Brass & Organ)', subtitle: 'Majestic Symphonic Brass + Cathedral Pipe Organ + Orchestral Timpani (No Words)', icon: 'fa-star', accentColor: 'text-red-500', defaultVol: 75, isRageTrack: true, bpm: 84, keySignature: 'C Major' },
    { id: 'rage-deathisnomore', category: 'rage', title: 'Death Is No More (Slowed Phonk)', subtitle: 'Eerie Reverb-Drenched Dark Cowbell Motif + Massive Rumbling 808 Sub-Bass', icon: 'fa-ghost', accentColor: 'text-emerald-400', defaultVol: 75, isRageTrack: true, bpm: 82, keySignature: 'C# Minor' },
    { id: 'rage-metamorphosis', category: 'rage', title: 'Metamorphosis (Sigma Drift Phonk)', subtitle: 'Hypnotic 808 Cowbell Hook + Saturated Sub-Bass + Crisp Memphis Phonk Hats', icon: 'fa-fire-flame-curved', accentColor: 'text-orange-400', defaultVol: 75, isRageTrack: true, bpm: 118, keySignature: 'D Minor' },
    { id: 'rage-afterdark', category: 'rage', title: 'After Dark x Memory Reboot', subtitle: 'Lush Detuned Cyberpunk Supersaw Pad + Shimmering Arpeggio + Reese Sub-Bass', icon: 'fa-wand-magic-sparkles', accentColor: 'text-cyan-400', defaultVol: 75, isRageTrack: true, bpm: 105, keySignature: 'F# Minor' },
    { id: 'rage-cornfield', category: 'rage', title: 'Cornfield Chase (Organ Overdrive)', subtitle: 'Interstellar Cathedral Pipe Organ 16th Arpeggios + Deep Pedal Sub + Brass Swells', icon: 'fa-rocket', accentColor: 'text-indigo-400', defaultVol: 75, isRageTrack: true, bpm: 112, keySignature: 'A Minor' }
];

const RAGE_HYBRID_PRESETS = {
    'dark-age-rainstorm': { name: '🔥 Dark Age Rainstorm', desc: 'Little Dark Age (Slowed) • Heavy Rain • Thunder', vibe: 'slowed', channels: { 'rage-littledarkage': 78, 'heavy-rain': 50, 'distant-thunder': 45 } },
    'death-is-no-more-3am': { name: '💀 Death Is No More (3 AM)', desc: 'Death Is No More (Slowed) • Gentle Rain • Brown Noise', vibe: 'slowed', channels: { 'rage-deathisnomore': 80, 'gentle-rain': 45, 'brown-noise': 35 } },
    'gangstas-cathedral': { name: "👑 Gangsta's Cathedral", desc: "Gangsta's Paradise • Window Drops • Vinyl Crackle", vibe: 'normal', channels: { 'rage-gangsta': 80, 'rain-window': 45, 'vinyl-crackle': 30 } },
    'phonk-question-crusher': { name: '⚡ Go Gyal Overdrive', desc: 'Go Gyal Phonk • Gamma 40Hz Peak Focus', vibe: 'normal', binauralOverride: 'gamma', channels: { 'rage-gogyal': 82, 'binaural-beats': 25 } },
    'bloody-mary-midnight': { name: '🩸 Bloody Mary Midnight', desc: 'Bloody Mary (Slowed) • Fireplace • Thunder', vibe: 'slowed', channels: { 'rage-bloodymary': 78, 'cozy-fireplace': 50, 'distant-thunder': 40 } },
    'amour-plastique-nostalgia': { name: '🌌 Amour Plastique Nostalgia', desc: 'Amour Plastique (Slowed) • Ocean Waves • Vinyl', vibe: 'slowed', channels: { 'rage-amour': 78, 'ocean-waves': 45, 'vinyl-crackle': 30 } }
};

const CURATED_PRESETS = {
    'rainstorm-study': { name: 'Rainstorm Study', desc: 'Heavy Rain • Window Drops • Thunder • Brown Noise • Lo-Fi Piano', icon: 'fa-cloud-showers-heavy', color: 'text-cyan-400', channels: { 'heavy-rain': 65, 'rain-window': 50, 'distant-thunder': 45, 'brown-noise': 35, 'lofi-chords': 50 } },
    'midnight-library': { name: 'Midnight Library', desc: 'Quiet Library • Grandfather Clock • Window Drops • Felt Piano', icon: 'fa-book-open-reader', color: 'text-amber-400', channels: { 'quiet-library': 55, 'clock-tick': 30, 'rain-window': 45, 'felt-piano': 45 } },
    'cozy-coffee-shop': { name: 'Cozy Coffee Shop', desc: 'Coffee Shop • Gentle Rain • Lo-Fi Piano • Vinyl Crackle', icon: 'fa-mug-saucer', color: 'text-orange-400', channels: { 'coffee-shop': 55, 'gentle-rain': 40, 'lofi-chords': 55, 'vinyl-crackle': 30 } },
    'night-train-sleeper': { name: 'Night Train Sleeper', desc: 'Night Train • Heavy Rain • Distant Thunder • Ambient Space Pad', icon: 'fa-train-subway', color: 'text-sky-400', channels: { 'night-train': 65, 'heavy-rain': 45, 'distant-thunder': 35, 'ambient-drone': 40 } },
    'deep-exam-lockdown': { name: 'Deep Exam Lockdown', desc: 'Brown Noise • Green Noise • Binaural Gamma 40Hz • Airplane Cabin', icon: 'fa-brain', color: 'text-fuchsia-400', channels: { 'brown-noise': 55, 'green-noise': 45, 'binaural-beats': 30, 'airplane-cabin': 45 }, binauralOverride: 'gamma' },
    'coding-typing-flow': { name: 'Coding & Typing Flow', desc: 'Mechanical Keyboard • Warm Synth Arp • Pink Noise • Vinyl Crackle', icon: 'fa-laptop-code', color: 'text-indigo-400', channels: { 'mech-keyboard': 45, 'synth-arp': 50, 'pink-noise': 30, 'vinyl-crackle': 30 } },
    'zen-temple-garden': { name: 'Zen Temple Garden', desc: 'Mountain Stream • Tibetan Bowls • Forest Birds • Forest Wind', icon: 'fa-spa', color: 'text-emerald-400', channels: { 'babbling-brook': 55, 'singing-bowls': 45, 'singing-birds': 35, 'forest-wind': 40 } },
    'winter-cabin-fireplace': { name: 'Winter Cabin Fireplace', desc: 'Cozy Fireplace • Howling Blizzard • Brown Noise • Soft Felt Piano', icon: 'fa-fire', color: 'text-amber-300', channels: { 'cozy-fireplace': 65, 'howling-blizzard': 55, 'brown-noise': 35, 'felt-piano': 45 } },
    'starship-deep-space': { name: 'Starship Deep Space', desc: 'Underwater Abyss • Ambient Space Pad • Airplane Cabin • Isochronic', icon: 'fa-shuttle-space', color: 'text-purple-400', channels: { 'underwater-abyss': 55, 'ambient-drone': 50, 'airplane-cabin': 40, 'isochronic-pulses': 25 } },
    'summer-night-campfire': { name: 'Summer Night Campfire', desc: 'Night Crickets • Cozy Fireplace • Forest Wind • Mountain Stream', icon: 'fa-campground', color: 'text-lime-400', channels: { 'night-crickets': 45, 'cozy-fireplace': 60, 'forest-wind': 35, 'babbling-brook': 40 } },
    'ocean-cliff-sunset': { name: 'Ocean Cliff Sunset', desc: 'Ocean Waves • Forest Wind • Ambient Space Pad • Solfeggio 528Hz', icon: 'fa-water', color: 'text-teal-400', channels: { 'ocean-waves': 65, 'forest-wind': 40, 'ambient-drone': 40, 'solfeggio-drone': 35 }, solfeggioOverride: '528' },
    'lofi-vinyl-chill': { name: 'Lo-Fi Vinyl Chill', desc: 'Lo-Fi Piano • Vinyl Crackle • Gentle Rain • Window Drops', icon: 'fa-record-vinyl', color: 'text-rose-400', channels: { 'lofi-chords': 65, 'vinyl-crackle': 40, 'gentle-rain': 45, 'rain-window': 40 } }
};

const BINAURAL_MODES = {
    delta: { label: 'Delta 2.5Hz (Deep Sleep/Rest)', beatFreq: 2.5 },
    theta: { label: 'Theta 6Hz (Meditation)', beatFreq: 6 },
    alpha: { label: 'Alpha 10Hz (Calm Focus)', beatFreq: 10 },
    beta:  { label: 'Beta 18Hz (Active Study)', beatFreq: 18 },
    gamma: { label: 'Gamma 40Hz (Peak Cognition)', beatFreq: 40 }
};

const ISOCHRONIC_MODES = {
    alpha10: { label: 'Alpha 10Hz (Calm Flow)', carrierFreq: 196.00, pulseHz: 10 },
    beta16:  { label: 'Beta 16Hz (Active Study)', carrierFreq: 220.00, pulseHz: 16 },
    gamma32: { label: 'Gamma 32Hz (Peak Focus)', carrierFreq: 246.94, pulseHz: 32 }
};

const SOLFEGGIO_MODES = {
    '432': { label: '432 Hz (Deep Natural Calm)', freq: 432.0 },
    '528': { label: '528 Hz (Clarity & Harmonic Flow)', freq: 528.0 },
    '396': { label: '396 Hz (Warm Grounding)', freq: 396.0 }
};

const LOFI_PROGRESSIONS = {
    jazzhop: [
        [293.66, 349.23, 440.00, 523.25, 659.25],
        [196.00, 349.23, 440.00, 493.88, 659.25],
        [261.63, 329.63, 392.00, 493.88, 587.33],
        [220.00, 329.63, 392.00, 466.16, 622.25]
    ],
    rainyminor: [
        [220.00, 261.63, 329.63, 392.00, 493.88],
        [293.66, 349.23, 440.00, 523.25, 659.25],
        [329.63, 392.00, 493.88, 587.33, 739.99],
        [220.00, 311.13, 392.00, 493.88, 587.33]
    ],
    dreamylydian: [
        [349.23, 440.00, 523.25, 659.25, 783.99],
        [392.00, 493.88, 587.33, 659.25, 783.99],
        [329.63, 392.00, 493.88, 587.33, 739.99],
        [220.00, 261.63, 329.63, 392.00, 493.88]
    ]
};

const NOTE_SEMITONES = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};

function noteToFreq(noteStr, semitoneShift = 0) {
    if (!noteStr || noteStr === '-') return null;
    const match = /^([A-G][b#]?)(-?\d)$/.exec(noteStr);
    if (!match) return null;
    const semitone = NOTE_SEMITONES[match[1]];
    const octave = parseInt(match[2], 10);
    const midi = (octave + 1) * 12 + semitone + semitoneShift;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

const RAGE_SONG_SEQUENCES = {
    'rage-gangsta': {
        stepEighthMs: 352, leadVoice: 'strings-choir',
        padChords: [['C3', 'Eb4', 'G4', 'C5'], ['Ab2', 'Eb4', 'Ab4', 'C5'], ['F2', 'C4', 'F4', 'Ab4'], ['G2', 'D4', 'G4', 'B4']],
        leadSteps: ['G5', '-', 'G5', '-', 'G5', 'F5', 'Eb5', 'D5', 'Eb5', '-', 'Eb5', '-', 'Eb5', 'D5', 'C5', 'Bb4', 'C5', '-', 'C5', '-', 'C5', 'D5', 'Eb5', 'F5', 'D5', '-', 'B4', '-', 'G4', '-', 'D5', '-'],
        bassSteps: ['C2', '-', '-', 'C2', '-', '-', 'Eb2', '-', 'Ab1', '-', '-', 'Ab1', '-', '-', 'C2', '-', 'F1', '-', '-', 'F1', '-', '-', 'Ab1', '-', 'G1', '-', '-', 'G1', '-', '-', 'G2', '-'],
        drumPattern: 'boombap'
    },
    'rage-amour': {
        stepEighthMs: 283, leadVoice: 'french-synth',
        padChords: [['Bb2', 'F3', 'Bb3', 'D4'], ['F2', 'C3', 'A3', 'C4'], ['C3', 'G3', 'C4', 'E4'], ['D3', 'A3', 'D4', 'F4']],
        leadSteps: ['D5', '-', 'D5', 'C5', 'Bb4', 'A4', 'G4', 'F4', 'A4', '-', 'A4', 'G4', 'F4', 'G4', 'A4', 'C5', 'G4', '-', 'G4', 'A4', 'Bb4', 'A4', 'G4', 'E4', 'F4', '-', 'A4', '-', 'D5', '-', 'A4', '-'],
        bassSteps: ['Bb1', 'Bb2', 'Bb1', 'Bb2', 'Bb1', 'Bb2', 'Bb1', 'Bb2', 'F1', 'F2', 'F1', 'F2', 'F1', 'F2', 'F1', 'F2', 'C2', 'C3', 'C2', 'C3', 'C2', 'C3', 'C2', 'C3', 'D2', 'D3', 'D2', 'D3', 'D2', 'D3', 'A1', 'A2'],
        drumPattern: 'synthpop'
    },
    'rage-gogyal': {
        stepEighthMs: 230, leadVoice: 'phonk-cowbell',
        padChords: [['F#2', 'C#3', 'F#3', 'A3'], ['F#2', 'C#3', 'F#3', 'A3'], ['D2', 'A2', 'D3', 'F#3'], ['C#2', 'G#2', 'C#3', 'F3']],
        leadSteps: ['F#4', 'F#4', 'A4', 'F#4', 'B4', 'A4', 'F#4', 'E4', 'F#4', 'F#4', 'A4', 'F#4', 'C#5', 'B4', 'A4', 'G#4', 'F#4', 'F#4', 'A4', 'F#4', 'B4', 'A4', 'F#4', 'E4', 'D4', 'D4', 'E4', 'F#4', 'G#4', 'A4', 'G#4', 'F#4'],
        bassSteps: ['F#1', '-', 'F#1', 'F#1', '-', 'F#1', 'A1', '-', 'F#1', '-', 'F#1', 'F#1', '-', 'C#2', 'B1', 'A1', 'D1', '-', 'D1', 'D1', '-', 'D1', 'F#1', '-', 'C#1', '-', 'C#1', 'C#1', '-', 'E1', 'F1', '-'],
        drumPattern: 'brazilian-phonk'
    },
    'rage-bloodymary': {
        stepEighthMs: 300, leadVoice: 'gothic-pluck',
        padChords: [['A2', 'E3', 'A3', 'C4'], ['F2', 'C3', 'F3', 'A3'], ['C3', 'G3', 'C4', 'E4'], ['E2', 'B2', 'E3', 'G#3']],
        leadSteps: ['A4', '-', 'C5', 'B4', 'A4', '-', 'E5', '-', 'D5', 'C5', 'B4', 'C5', 'A4', '-', 'E4', '-', 'G4', '-', 'C5', 'B4', 'G4', '-', 'E5', '-', 'D5', 'C5', 'B4', 'A4', 'B4', '-', 'G#4', '-'],
        bassSteps: ['A1', '-', 'A1', '-', 'A1', '-', 'E2', '-', 'F1', '-', 'F1', '-', 'F1', '-', 'C2', '-', 'C2', '-', 'C2', '-', 'C2', '-', 'G1', '-', 'E1', '-', 'E1', '-', 'E1', '-', 'B1', '-'],
        drumPattern: 'stomp'
    },
    'rage-littledarkage': {
        stepEighthMs: 312, leadVoice: 'dark-analog',
        padChords: [['D3', 'A3', 'D4', 'F4'], ['Bb2', 'F3', 'Bb3', 'D4'], ['G2', 'D3', 'G3', 'Bb3'], ['A2', 'E3', 'A3', 'C#4']],
        leadSteps: ['A4', 'Bb4', 'A4', 'F4', 'D4', '-', 'F4', 'G4', 'A4', 'Bb4', 'A4', 'F4', 'Bb4', '-', 'A4', 'G4', 'G4', 'A4', 'Bb4', 'C5', 'D5', '-', 'C5', 'Bb4', 'A4', '-', 'G4', 'F4', 'E4', '-', 'C#4', '-'],
        bassSteps: ['D2', 'D2', 'D2', 'D2', 'D2', 'D2', 'F2', 'G2', 'Bb1', 'Bb1', 'Bb1', 'Bb1', 'Bb1', 'Bb1', 'D2', 'C2', 'G1', 'G1', 'G1', 'G1', 'G1', 'G1', 'Bb1', 'G1', 'A1', 'A1', 'A1', 'A1', 'A1', 'G1', 'F1', 'E1'],
        drumPattern: 'gated-80s'
    },
    'rage-soviet': {
        stepEighthMs: 357, leadVoice: 'majestic-brass',
        padChords: [['C3', 'E3', 'G3', 'C4'], ['F2', 'C3', 'F3', 'A3'], ['C3', 'E3', 'G3', 'C4'], ['F2', 'C3', 'F3', 'A3']],
        leadSteps: ['G4', 'C5', '-', 'G4', 'A4', 'B4', '-', 'E4', 'E4', 'A4', '-', 'G4', 'F4', 'G4', '-', 'C4', 'C4', 'D4', '-', 'D4', 'E4', 'F4', '-', 'F4', 'G4', 'A4', '-', 'B4', 'C5', 'D5', '-', 'G4'],
        bassSteps: ['C2', '-', 'G1', '-', 'A1', '-', 'E1', '-', 'F1', '-', 'C2', '-', 'D2', '-', 'G1', '-', 'C2', '-', 'B1', '-', 'A1', '-', 'F1', '-', 'F1', '-', 'D2', '-', 'G1', '-', 'C2', '-'],
        drumPattern: 'orchestral-march'
    },
    'rage-deathisnomore': {
        stepEighthMs: 365, leadVoice: 'dark-phonk-bell',
        padChords: [['C#3', 'G#3', 'C#4', 'E4'], ['A2', 'E3', 'A3', 'C#4'], ['F#2', 'C#3', 'F#3', 'A3'], ['G#2', 'D#3', 'G#3', 'B3']],
        leadSteps: ['C#5', 'E5', 'D#5', 'C#5', 'B4', 'C#5', 'G#4', '-', 'A4', 'C#5', 'B4', 'A4', 'G#4', 'A4', 'E4', '-', 'F#4', 'A4', 'G#4', 'F#4', 'E4', 'F#4', 'C#4', '-', 'G#4', '-', 'A4', 'G#4', 'F#4', 'E4', 'D#4', '-'],
        bassSteps: ['C#1', '-', '-', '-', 'C#1', '-', 'G#1', '-', 'A1', '-', '-', '-', 'A1', '-', 'E1', '-', 'F#1', '-', '-', '-', 'F#1', '-', 'C#1', '-', 'G#1', '-', '-', '-', 'G#1', '-', 'D#1', '-'],
        drumPattern: 'slow-phonk'
    },
    'rage-metamorphosis': {
        stepEighthMs: 254, leadVoice: 'phonk-cowbell',
        padChords: [['D3', 'A3', 'D4', 'F4'], ['Bb2', 'F3', 'Bb3', 'D4'], ['G2', 'D3', 'G3', 'Bb3'], ['A2', 'E3', 'A3', 'C#4']],
        leadSteps: ['D5', 'D5', 'F5', 'D5', 'A4', 'A4', 'C5', 'A4', 'Bb4', 'Bb4', 'D5', 'Bb4', 'A4', 'G4', 'F4', 'E4', 'D5', 'D5', 'F5', 'D5', 'A4', 'A4', 'C5', 'A4', 'G4', 'A4', 'Bb4', 'A4', 'G4', 'F4', 'E4', 'D4'],
        bassSteps: ['D1', '-', 'D1', '-', 'D1', '-', 'A1', '-', 'Bb1', '-', 'Bb1', '-', 'A1', '-', 'G1', '-', 'D1', '-', 'D1', '-', 'D1', '-', 'A1', '-', 'G1', '-', 'G1', '-', 'A1', '-', 'A1', '-'],
        drumPattern: 'drift-phonk'
    },
    'rage-afterdark': {
        stepEighthMs: 285, leadVoice: 'cyberpunk-arp',
        padChords: [['D3', 'A3', 'D4', 'F#4'], ['E3', 'B3', 'E4', 'G#4'], ['F#3', 'C#4', 'F#4', 'A4'], ['C#3', 'G#3', 'C#4', 'E4']],
        leadSteps: ['A4', 'C#5', 'F#5', 'E5', 'A4', 'C#5', 'F#5', 'E5', 'G#4', 'B4', 'E5', 'D#5', 'G#4', 'B4', 'E5', 'B4', 'A4', 'C#5', 'F#5', 'A5', 'G#5', 'F#5', 'E5', 'C#5', 'G#4', 'C#5', 'E5', 'C#5', 'B4', 'G#4', 'F#4', 'E4'],
        bassSteps: ['D1', '-', 'D1', '-', 'D1', '-', 'D2', '-', 'E1', '-', 'E1', '-', 'E1', '-', 'E2', '-', 'F#1', '-', 'F#1', '-', 'F#1', '-', 'F#2', '-', 'C#1', '-', 'C#1', '-', 'C#1', '-', 'B1', '-'],
        drumPattern: 'synthpop'
    },
    'rage-cornfield': {
        stepEighthMs: 268, leadVoice: 'cathedral-organ',
        padChords: [['F2', 'C3', 'A3', 'C4', 'E4'], ['G2', 'D3', 'B3', 'D4', 'G4'], ['A2', 'E3', 'A3', 'C4', 'E4'], ['E2', 'B2', 'G3', 'B3', 'E4']],
        leadSteps: ['A4', 'E5', 'C5', 'E5', 'A4', 'E5', 'C5', 'E5', 'B4', 'E5', 'D5', 'E5', 'B4', 'E5', 'D5', 'E5', 'C5', 'E5', 'A4', 'E5', 'C5', 'E5', 'A4', 'E5', 'B4', 'E5', 'G4', 'E5', 'B4', 'E5', 'G4', 'E5'],
        bassSteps: ['F1', '-', '-', '-', 'F1', '-', '-', '-', 'G1', '-', '-', '-', 'G1', '-', '-', '-', 'A1', '-', '-', '-', 'A1', '-', '-', '-', 'E1', '-', '-', '-', 'E1', '-', '-', '-'],
        drumPattern: 'cinematic-pulse'
    }
};

/***********************************************************************
 * 2. AUDIO ENGINE
 ***********************************************************************/
class FocusFlowAudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.monitorGain = null;
        this.analyser = null;
        this.isMasterPlaying = false;
        this.isMuted = false;
        this.masterVolume = 0.85;
        this.organicDriftEnabled = false;
        this.driftTimer = null;

        this.rageVibe = 'normal';
        this.rageDrumsEnabled = true;
        this.rageBassBoost = 0.45;
        this.rageSubBus = null;
        this.rageBassFilter = null;
        this.rageReverbNode = null;
        this.rageReverbWet = null;

        this.buffers = { white: null, pink: null, brown: null };

        this.channelState = {};
        STUDIO_CHANNELS.forEach((ch, idx) => {
            this.channelState[ch.id] = {
                active: false,
                volume: ch.defaultVol / 100,
                driftPhase: idx * 0.85,
                nodes: null,
                timers: [],
                thunderFreq: 'normal',
                keyboardWpm: 'flow',
                arpMood: 'midnight',
                binauralMode: 'alpha',
                binauralCarrier: 200,
                isochronicMode: 'alpha10',
                solfeggioMode: '528',
                lofiProgression: 'jazzhop'
            };
        });

        this.localTracks = new Map();

        this.screenOffPersistenceEnabled = true;
        this.bgAudioEl = null;
        this.bgBlobUrl = null;
        this.streamDest = null;
        this._bgBridgeInitialized = false;
        this._bgMediaSource = null;
        this._bgRecorder = null;
        this._bgSourceBuffer = null;
        this._bgChunkQueue = [];
        this._bgAppending = false;
        this.lastActiveRageTrackId = 'rage-gangsta';
        this.lastPresetName = null;
    }

    initContext() {
        if (this.ctx) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({ latencyHint: 'playback' });

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-10, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.01, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.82;

        this.monitorGain = this.ctx.createGain();
        this.monitorGain.gain.value = 1;

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.analyser);
        this.analyser.connect(this.monitorGain);
        this.monitorGain.connect(this.ctx.destination);

        if (typeof this.ctx.createMediaStreamDestination === 'function') {
            try {
                this.streamDest = this.ctx.createMediaStreamDestination();
                this.compressor.connect(this.streamDest);
            } catch (e) {}
        }

        this.ctx.addEventListener('statechange', () => {
            if (this.isMasterPlaying && this.screenOffPersistenceEnabled && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        });

        this.generateNoiseBuffers();
        this.initRageMasteringBus();
        this.initBackgroundMediaBridge();
        this.isMasterPlaying = true;
    }

    initBackgroundMediaBridge() {
        if (this._bgBridgeInitialized) return;
        if (!this.ctx) return;
        this.bgAudioEl = document.getElementById('bg-media-bridge');
        if (!this.bgAudioEl) return;

        if (!this.streamDest) {
            if (typeof this.ctx.createMediaStreamDestination !== 'function') return;
            try {
                this.streamDest = this.ctx.createMediaStreamDestination();
                this.compressor.connect(this.streamDest);
            } catch (e) { return; }
        }
        const stream = this.streamDest.stream;

        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        const mimeType = candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));

        if (!mimeType || !window.MediaSource) {
            try {
                this.bgAudioEl.srcObject = stream;
                this.bgAudioEl.muted = true;
                this.bgAudioEl.volume = 1;
                this._bgBridgeInitialized = true;
            } catch (e) {}
            return;
        }

        try {
            const mediaSource = new MediaSource();
            this._bgMediaSource = mediaSource;
            this.bgAudioEl.src = URL.createObjectURL(mediaSource);
            this.bgAudioEl.muted = true;
            this.bgAudioEl.volume = 1;

            mediaSource.addEventListener('sourceopen', () => {
                try {
                    const sb = mediaSource.addSourceBuffer(mimeType);
                    this._bgSourceBuffer = sb;

                    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
                    this._bgRecorder = recorder;

                    const flush = () => {
                        if (this._bgAppending || sb.updating || this._bgChunkQueue.length === 0) return;
                        this._bgAppending = true;
                        try { sb.appendBuffer(this._bgChunkQueue.shift()); }
                        catch (err) { this._bgAppending = false; }
                    };

                    sb.addEventListener('updateend', () => {
                        this._bgAppending = false;
                        try {
                            if (sb.buffered.length) {
                                const start = sb.buffered.start(0);
                                const end = sb.buffered.end(sb.buffered.length - 1);
                                if (end - start > 25) sb.remove(start, end - 20);
                            }
                        } catch (e) {}
                        flush();
                    });

                    recorder.addEventListener('dataavailable', (e) => {
                        if (e.data && e.data.size > 0) {
                            this._bgChunkQueue.push(e.data);
                            flush();
                        }
                    });

                    recorder.start(1000);
                    this._bgBridgeInitialized = true;
                } catch (err) {
                    console.warn('MSE setup failed, falling back to srcObject:', err);
                    try {
                        this.bgAudioEl.src = '';
                        this.bgAudioEl.srcObject = stream;
                        this.bgAudioEl.muted = true;
                        this._bgBridgeInitialized = true;
                    } catch (e) {}
                }
            }, { once: true });
        } catch (err) {
            try {
                this.bgAudioEl.srcObject = stream;
                this.bgAudioEl.muted = true;
                this._bgBridgeInitialized = true;
            } catch (e) {}
        }
    }

    syncBackgroundBridgePlayback(shouldPlay) {
        if (!this.bgAudioEl) this.initBackgroundMediaBridge();
        if (!this.bgAudioEl) return;

        if (shouldPlay && this.screenOffPersistenceEnabled) {
            if (this.bgAudioEl.paused) {
                this.bgAudioEl.play().then(() => {
                    updateMediaSessionMetadataAndArtwork();
                }).catch(() => {
                    bgClock.setTimeout(() => {
                        if (this.bgAudioEl && this.bgAudioEl.paused) {
                            this.bgAudioEl.play().then(() => {
                                updateMediaSessionMetadataAndArtwork();
                            }).catch(() => {});
                        }
                    }, 2000);
                });
            }
        } else {
            if (!this.bgAudioEl.paused) {
                this.bgAudioEl.pause();
            }
        }
    }

    initRageMasteringBus() {
        if (!this.ctx) return;
        this.rageSubBus = this.ctx.createGain();
        this.rageSubBus.gain.value = 1.0;

        this.rageBassFilter = this.ctx.createBiquadFilter();
        this.rageBassFilter.type = 'lowshelf';
        this.rageBassFilter.frequency.value = 68;
        this.rageBassFilter.gain.value = this.rageBassBoost * 11;

        this.rageReverbNode = this.ctx.createConvolver();
        this.rageReverbNode.buffer = this.createCathedralImpulseBuffer(2.8, 2.4);

        this.rageReverbWet = this.ctx.createGain();
        this.rageReverbWet.gain.value = 0.25;

        this.rageSubBus.connect(this.rageBassFilter);
        this.rageBassFilter.connect(this.masterGain);

        this.rageBassFilter.connect(this.rageReverbNode);
        this.rageReverbNode.connect(this.rageReverbWet);
        this.rageReverbWet.connect(this.masterGain);
    }

    createCathedralImpulseBuffer(durationSec = 2.8, decay = 2.4) {
        const rate = this.ctx.sampleRate;
        const length = Math.floor(rate * durationSec);
        const impulse = this.ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const env = Math.pow(1 - i / length, decay);
                data[i] = (Math.random() * 2 - 1) * env * 0.45;
            }
        }
        return impulse;
    }

    setRageVibe(vibeMode) {
        this.rageVibe = vibeMode;
        if (this.ctx && this.rageReverbWet) {
            const wetTarget = vibeMode === 'slowed' ? 0.58 : (vibeMode === 'nightcore' ? 0.18 : 0.28);
            this.rageReverbWet.gain.setTargetAtTime(wetTarget, this.ctx.currentTime, 0.15);
        }
        STUDIO_CHANNELS.filter(c => c.isRageTrack).forEach(ch => {
            if (this.channelState[ch.id]?.active) this.startChannelDSP(ch.id);
        });
        updateMediaSessionMetadataAndArtwork();
    }

    setRageBassBoost(norm0to1) {
        this.rageBassBoost = Math.max(0, Math.min(1, norm0to1));
        if (this.ctx && this.rageBassFilter) {
            this.rageBassFilter.gain.setTargetAtTime(this.rageBassBoost * 11, this.ctx.currentTime, 0.08);
        }
    }

    toggleRageDrums() {
        this.rageDrumsEnabled = !this.rageDrumsEnabled;
        return this.rageDrumsEnabled;
    }

    async ensureRunning() {
        this.initContext();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this.isMasterPlaying = true;
        this.syncBackgroundBridgePlayback(true);
        updateEngineBadgeUI();
    }

    generateNoiseBuffers() {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * 6;

        const whiteBuf = this.ctx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = whiteBuf.getChannelData(ch);
            for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }
        this.buffers.white = whiteBuf;

        const pinkBuf = this.ctx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = pinkBuf.getChannelData(ch);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.042;
                b6 = white * 0.115926;
            }
        }
        this.buffers.pink = pinkBuf;

        const brownBuf = this.ctx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = brownBuf.getChannelData(ch);
            let lastOut = 0.0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                data[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = data[i];
                data[i] *= 3.2;
            }
        }
        this.buffers.brown = brownBuf;
    }

    createLoopingNoiseNode(type = 'pink') {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers[type] || this.buffers.pink;
        src.loop = true;
        src.start(0, Math.random() * 4.5);
        return src;
    }

    async toggleChannel(id, forceState = null) {
        await this.ensureRunning();
        const st = this.channelState[id];
        if (!st) return;

        const nextState = forceState !== null ? forceState : !st.active;
        if (nextState === st.active) return;

        const chMeta = STUDIO_CHANNELS.find(c => c.id === id);
        if (nextState) {
            if (chMeta?.isRageTrack) this.lastActiveRageTrackId = id;
            this.startChannelDSP(id);
            st.active = true;
        } else {
            this.stopChannelDSP(id);
            st.active = false;
        }

        const anyPlayingNow = this.getActiveChannelIds().length > 0 || Array.from(this.localTracks.values()).some(t => t.playing);
        this.syncBackgroundBridgePlayback(anyPlayingNow && this.isMasterPlaying);

        updateChannelCardUI(id);
        updateMasterSummaryUI();
        renderActiveQuickDock();
        applyCategoryAndSearchFilter();
        updateMediaSessionMetadataAndArtwork();
    }

    setChannelVolume(id, volume0to1) {
        const st = this.channelState[id];
        if (!st) return;
        st.volume = Math.max(0, Math.min(1, volume0to1));
        if (st.active && st.nodes && st.nodes.channelGain && this.ctx) {
            st.nodes.channelGain.gain.setTargetAtTime(st.volume, this.ctx.currentTime, 0.06);
        }
        const mainSlider = document.getElementById(`slider-${id}`);
        const mainLabel = document.getElementById(`vol-label-${id}`);
        const pct = Math.round(st.volume * 100);
        if (mainSlider) mainSlider.value = pct;
        if (mainLabel) mainLabel.textContent = `${pct}%`;
        const quickSlider = document.getElementById(`quick-slider-${id}`);
        const quickLabel = document.getElementById(`quick-vol-${id}`);
        if (quickSlider) quickSlider.value = pct;
        if (quickLabel) quickLabel.textContent = `${pct}%`;
    }

    toggleOrganicDrift() {
        this.organicDriftEnabled = !this.organicDriftEnabled;
        if (this.organicDriftEnabled) {
            this.driftTimer = bgClock.setInterval(() => {
                if (!this.isMasterPlaying || !this.ctx) return;
                STUDIO_CHANNELS.forEach(ch => {
                    const st = this.channelState[ch.id];
                    if (st.active && st.nodes && st.nodes.channelGain) {
                        st.driftPhase += 0.11;
                        const mod = 1 + Math.sin(st.driftPhase) * 0.12;
                        const driftedVol = Math.max(0.02, Math.min(1.0, st.volume * mod));
                        st.nodes.channelGain.gain.setTargetAtTime(driftedVol, this.ctx.currentTime, 0.8);
                    }
                });
            }, 900);
        } else {
            if (this.driftTimer) bgClock.clear(this.driftTimer);
            this.driftTimer = null;
            if (this.ctx) {
                STUDIO_CHANNELS.forEach(ch => {
                    const st = this.channelState[ch.id];
                    if (st.active && st.nodes && st.nodes.channelGain) {
                        st.nodes.channelGain.gain.setTargetAtTime(st.volume, this.ctx.currentTime, 0.3);
                    }
                });
            }
        }
        return this.organicDriftEnabled;
    }

    startChannelDSP(id) {
        const st = this.channelState[id];
        this.stopChannelDSP(id);
        const now = this.ctx.currentTime;
        const channelGain = this.ctx.createGain();
        channelGain.gain.setValueAtTime(0.0001, now);
        channelGain.gain.setTargetAtTime(st.volume, now, 0.18);
        channelGain.connect(this.masterGain);

        const nodes = { channelGain, disposables: [] };
        const timers = [];

        switch (id) {
            case 'gentle-rain': {
                const pinkSrc = this.createLoopingNoiseNode('pink');
                const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1850;
                const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
                pinkSrc.connect(lp); lp.connect(hp); hp.connect(channelGain);
                const dropInterval = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.65) this.spawnRainDroplet(channelGain, 1800 + Math.random() * 2400, 0.04);
                }, 90);
                timers.push(dropInterval);
                nodes.disposables.push(pinkSrc, lp, hp);
                break;
            }
            case 'heavy-rain': {
                const pinkSrc = this.createLoopingNoiseNode('pink');
                const whiteSrc = this.createLoopingNoiseNode('white');
                const bodyFilter = this.ctx.createBiquadFilter(); bodyFilter.type = 'bandpass'; bodyFilter.frequency.value = 850; bodyFilter.Q.value = 0.6;
                const hissFilter = this.ctx.createBiquadFilter(); hissFilter.type = 'bandpass'; hissFilter.frequency.value = 3200; hissFilter.Q.value = 0.9;
                const swellLfo = this.ctx.createOscillator(); swellLfo.frequency.value = 0.09;
                const swellGain = this.ctx.createGain(); swellGain.gain.value = 220;
                swellLfo.connect(swellGain); swellGain.connect(bodyFilter.frequency); swellLfo.start();
                const hissGain = this.ctx.createGain(); hissGain.gain.value = 0.22;
                pinkSrc.connect(bodyFilter); bodyFilter.connect(channelGain);
                whiteSrc.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(channelGain);
                nodes.disposables.push(pinkSrc, whiteSrc, bodyFilter, hissFilter, hissGain, swellLfo, swellGain);
                break;
            }
            case 'rain-window': {
                const brownSrc = this.createLoopingNoiseNode('brown');
                const interiorLp = this.ctx.createBiquadFilter(); interiorLp.type = 'lowpass'; interiorLp.frequency.value = 340;
                const bedGain = this.ctx.createGain(); bedGain.gain.value = 0.42;
                brownSrc.connect(interiorLp); interiorLp.connect(bedGain); bedGain.connect(channelGain);
                const tapTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    const count = Math.random() < 0.4 ? 2 : 1;
                    for (let i = 0; i < count; i++) if (Math.random() < 0.8) this.spawnWindowTap(channelGain);
                }, 65);
                timers.push(tapTimer);
                nodes.disposables.push(brownSrc, interiorLp, bedGain);
                break;
            }
            case 'distant-thunder': {
                const subBed = this.createLoopingNoiseNode('brown');
                const subLp = this.ctx.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 68;
                const subGain = this.ctx.createGain(); subGain.gain.value = 0.25;
                subBed.connect(subLp); subLp.connect(subGain); subGain.connect(channelGain);
                const initTimeout = bgClock.setTimeout(() => {
                    if (st.active && this.isMasterPlaying) this.triggerThunderStrike(channelGain);
                }, 1100);
                timers.push(initTimeout);
                const scheduleNextThunder = () => {
                    const freqMap = { rare: [16, 28], normal: [8, 18], frequent: [4, 9] };
                    const [minS, maxS] = freqMap[st.thunderFreq] || [8, 18];
                    const delayMs = (minS + Math.random() * (maxS - minS)) * 1000;
                    const tId = bgClock.setTimeout(() => {
                        if (st.active && this.isMasterPlaying) {
                            this.triggerThunderStrike(channelGain);
                            scheduleNextThunder();
                        }
                    }, delayMs);
                    timers.push(tId);
                };
                scheduleNextThunder();
                nodes.disposables.push(subBed, subLp, subGain);
                break;
            }
            case 'ocean-waves': {
                const waveSrc1 = this.createLoopingNoiseNode('pink');
                const waveSrc2 = this.createLoopingNoiseNode('brown');
                const waveFilter = this.ctx.createBiquadFilter(); waveFilter.type = 'lowpass'; waveFilter.frequency.value = 480; waveFilter.Q.value = 1.4;
                const waveVCA = this.ctx.createGain(); waveVCA.gain.value = 0.55;
                const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.12;
                const lfoFilterDepth = this.ctx.createGain(); lfoFilterDepth.gain.value = 360;
                const lfoAmpDepth = this.ctx.createGain(); lfoAmpDepth.gain.value = 0.32;
                lfo.connect(lfoFilterDepth); lfoFilterDepth.connect(waveFilter.frequency);
                lfo.connect(lfoAmpDepth); lfoAmpDepth.connect(waveVCA.gain); lfo.start();
                waveSrc1.connect(waveFilter); waveSrc2.connect(waveFilter); waveFilter.connect(waveVCA); waveVCA.connect(channelGain);
                nodes.disposables.push(waveSrc1, waveSrc2, waveFilter, waveVCA, lfo, lfoFilterDepth, lfoAmpDepth);
                break;
            }
            case 'babbling-brook': {
                const brookSrc = this.createLoopingNoiseNode('pink');
                const bp1 = this.ctx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.value = 650; bp1.Q.value = 2.8;
                const bp2 = this.ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1350; bp2.Q.value = 3.5;
                const lfoFast1 = this.ctx.createOscillator(); lfoFast1.frequency.value = 3.4;
                const lfoG1 = this.ctx.createGain(); lfoG1.gain.value = 240;
                lfoFast1.connect(lfoG1); lfoG1.connect(bp1.frequency); lfoFast1.start();
                const lfoFast2 = this.ctx.createOscillator(); lfoFast2.frequency.value = 5.1;
                const lfoG2 = this.ctx.createGain(); lfoG2.gain.value = 420;
                lfoFast2.connect(lfoG2); lfoG2.connect(bp2.frequency); lfoFast2.start();
                brookSrc.connect(bp1); brookSrc.connect(bp2); bp1.connect(channelGain); bp2.connect(channelGain);
                const bubbleInterval = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.7) this.spawnRainDroplet(channelGain, 700 + Math.random() * 1100, 0.045);
                }, 85);
                timers.push(bubbleInterval);
                nodes.disposables.push(brookSrc, bp1, bp2, lfoFast1, lfoG1, lfoFast2, lfoG2);
                break;
            }
            case 'underwater-abyss': {
                const abyssSrc = this.createLoopingNoiseNode('brown');
                const hydroLp = this.ctx.createBiquadFilter(); hydroLp.type = 'lowpass'; hydroLp.frequency.value = 115; hydroLp.Q.value = 1.6;
                const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
                const lfoDepth = this.ctx.createGain(); lfoDepth.gain.value = 40;
                lfo.connect(lfoDepth); lfoDepth.connect(hydroLp.frequency); lfo.start();
                const subSine = this.ctx.createOscillator(); subSine.type = 'sine'; subSine.frequency.value = 52;
                const subGain = this.ctx.createGain(); subGain.gain.value = 0.18;
                subSine.connect(subGain); subGain.connect(channelGain); subSine.start();
                abyssSrc.connect(hydroLp); hydroLp.connect(channelGain);
                const bubbleTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.55) this.spawnBubbleBlip(channelGain);
                }, 950);
                timers.push(bubbleTimer);
                nodes.disposables.push(abyssSrc, hydroLp, lfo, lfoDepth, subSine, subGain);
                break;
            }
            case 'forest-wind': {
                const windSrc = this.createLoopingNoiseNode('pink');
                const bp1 = this.ctx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.value = 420; bp1.Q.value = 3.8;
                const bp2 = this.ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 680; bp2.Q.value = 4.2;
                const lfo1 = this.ctx.createOscillator(); lfo1.type = 'sine'; lfo1.frequency.value = 0.08;
                const lfo1Gain = this.ctx.createGain(); lfo1Gain.gain.value = 190;
                lfo1.connect(lfo1Gain); lfo1Gain.connect(bp1.frequency); lfo1.start();
                const lfo2 = this.ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 0.13;
                const lfo2Gain = this.ctx.createGain(); lfo2Gain.gain.value = 260;
                lfo2.connect(lfo2Gain); lfo2Gain.connect(bp2.frequency); lfo2.start();
                const outGain = this.ctx.createGain(); outGain.gain.value = 1.4;
                windSrc.connect(bp1); windSrc.connect(bp2); bp1.connect(outGain); bp2.connect(outGain); outGain.connect(channelGain);
                nodes.disposables.push(windSrc, bp1, bp2, lfo1, lfo1Gain, lfo2, lfo2Gain, outGain);
                break;
            }
            case 'cozy-fireplace': {
                const emberSrc = this.createLoopingNoiseNode('brown');
                const emberLp = this.ctx.createBiquadFilter(); emberLp.type = 'lowpass'; emberLp.frequency.value = 160;
                const emberGain = this.ctx.createGain(); emberGain.gain.value = 0.65;
                emberSrc.connect(emberLp); emberLp.connect(emberGain); emberGain.connect(channelGain);
                const crackleTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    const count = Math.random() < 0.35 ? 2 : 1;
                    for (let i = 0; i < count; i++) if (Math.random() < 0.75) this.spawnFireCrackle(channelGain);
                }, 75);
                timers.push(crackleTimer);
                nodes.disposables.push(emberSrc, emberLp, emberGain);
                break;
            }
            case 'night-crickets': {
                const chirpTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    this.spawnCricketChirp(channelGain, 4350 + Math.random() * 150);
                    if (Math.random() < 0.65) {
                        const subT = bgClock.setTimeout(() => {
                            if (this.isMasterPlaying && st.active) this.spawnCricketChirp(channelGain, 4680 + Math.random() * 140);
                        }, 140);
                        timers.push(subT);
                    }
                }, 360);
                timers.push(chirpTimer);
                break;
            }
            case 'singing-birds': {
                const airSrc = this.createLoopingNoiseNode('pink');
                const airBp = this.ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = 520;
                const airGain = this.ctx.createGain(); airGain.gain.value = 0.08;
                airSrc.connect(airBp); airBp.connect(airGain); airGain.connect(channelGain);
                const birdTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.65) this.spawnBirdSongPhrase(channelGain);
                }, 1350);
                timers.push(birdTimer);
                nodes.disposables.push(airSrc, airBp, airGain);
                break;
            }
            case 'howling-blizzard': {
                const pinkSrc = this.createLoopingNoiseNode('pink');
                const subSrc = this.createLoopingNoiseNode('brown');
                const whistle1 = this.ctx.createBiquadFilter(); whistle1.type = 'bandpass'; whistle1.frequency.value = 580; whistle1.Q.value = 6.5;
                const whistle2 = this.ctx.createBiquadFilter(); whistle2.type = 'bandpass'; whistle2.frequency.value = 920; whistle2.Q.value = 8.0;
                const lfo1 = this.ctx.createOscillator(); lfo1.frequency.value = 0.11;
                const lfo1G = this.ctx.createGain(); lfo1G.gain.value = 260;
                lfo1.connect(lfo1G); lfo1G.connect(whistle1.frequency); lfo1.start();
                const lfo2 = this.ctx.createOscillator(); lfo2.frequency.value = 0.07;
                const lfo2G = this.ctx.createGain(); lfo2G.gain.value = 340;
                lfo2.connect(lfo2G); lfo2G.connect(whistle2.frequency); lfo2.start();
                const subLp = this.ctx.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 140;
                const subG = this.ctx.createGain(); subG.gain.value = 0.45;
                pinkSrc.connect(whistle1); pinkSrc.connect(whistle2);
                whistle1.connect(channelGain); whistle2.connect(channelGain);
                subSrc.connect(subLp); subLp.connect(subG); subG.connect(channelGain);
                nodes.disposables.push(pinkSrc, subSrc, whistle1, whistle2, lfo1, lfo1G, lfo2, lfo2G, subLp, subG);
                break;
            }
            case 'coffee-shop': {
                const pink1 = this.createLoopingNoiseNode('pink');
                const pink2 = this.createLoopingNoiseNode('pink');
                const formant1 = this.ctx.createBiquadFilter(); formant1.type = 'bandpass'; formant1.frequency.value = 420; formant1.Q.value = 2.2;
                const formant2 = this.ctx.createBiquadFilter(); formant2.type = 'bandpass'; formant2.frequency.value = 1150; formant2.Q.value = 2.8;
                const murmurLfo1 = this.ctx.createOscillator(); murmurLfo1.frequency.value = 1.8;
                const murmurG1 = this.ctx.createGain(); murmurG1.gain.value = 160;
                murmurLfo1.connect(murmurG1); murmurG1.connect(formant1.frequency); murmurLfo1.start();
                const murmurLfo2 = this.ctx.createOscillator(); murmurLfo2.frequency.value = 2.7;
                const murmurG2 = this.ctx.createGain(); murmurG2.gain.value = 320;
                murmurLfo2.connect(murmurG2); murmurG2.connect(formant2.frequency); murmurLfo2.start();
                const f2Gain = this.ctx.createGain(); f2Gain.gain.value = 0.45;
                pink1.connect(formant1); formant1.connect(channelGain);
                pink2.connect(formant2); formant2.connect(f2Gain); f2Gain.connect(channelGain);
                const clinkTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.35) this.spawnCeramicClink(channelGain);
                }, 2400);
                timers.push(clinkTimer);
                nodes.disposables.push(pink1, pink2, formant1, formant2, murmurLfo1, murmurG1, murmurLfo2, murmurG2, f2Gain);
                break;
            }
            case 'mech-keyboard': {
                const scheduleKeystroke = () => {
                    const wpmIntervals = { slow: [160, 420], flow: [90, 240], fast: [55, 145] };
                    const [minMs, maxMs] = wpmIntervals[st.keyboardWpm] || [90, 240];
                    const isPause = Math.random() < 0.14;
                    const delay = isPause ? 450 + Math.random() * 550 : minMs + Math.random() * (maxMs - minMs);
                    const tId = bgClock.setTimeout(() => {
                        if (st.active && this.isMasterPlaying) {
                            const isSpacebar = Math.random() < 0.16;
                            this.spawnKeystroke(channelGain, isSpacebar);
                            scheduleKeystroke();
                        }
                    }, delay);
                    timers.push(tId);
                };
                scheduleKeystroke();
                break;
            }
            case 'quiet-library': {
                const roomSrc = this.createLoopingNoiseNode('brown');
                const roomBp = this.ctx.createBiquadFilter(); roomBp.type = 'lowpass'; roomBp.frequency.value = 210;
                const roomGain = this.ctx.createGain(); roomGain.gain.value = 0.55;
                const airSrc = this.createLoopingNoiseNode('pink');
                const airBp = this.ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = 650;
                const airGain = this.ctx.createGain(); airGain.gain.value = 0.12;
                roomSrc.connect(roomBp); roomBp.connect(roomGain); roomGain.connect(channelGain);
                airSrc.connect(airBp); airBp.connect(airGain); airGain.connect(channelGain);
                const rustleTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.55) this.spawnPageTurnRustle(channelGain, 0.22);
                    else if (Math.random() < 0.35) this.spawnDistantFootstep(channelGain);
                }, 2800);
                timers.push(rustleTimer);
                nodes.disposables.push(roomSrc, roomBp, roomGain, airSrc, airBp, airGain);
                break;
            }
            case 'night-train': {
                const coachSrc = this.createLoopingNoiseNode('brown');
                const coachLp = this.ctx.createBiquadFilter(); coachLp.type = 'lowpass'; coachLp.frequency.value = 135;
                const coachGain = this.ctx.createGain(); coachGain.gain.value = 0.65;
                coachSrc.connect(coachLp); coachLp.connect(coachGain); coachGain.connect(channelGain);
                const clackTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    this.spawnTrainClack(channelGain, 1.0);
                    const subClack = bgClock.setTimeout(() => {
                        if (this.isMasterPlaying && st.active) this.spawnTrainClack(channelGain, 0.78);
                    }, 210);
                    timers.push(subClack);
                }, 1450);
                timers.push(clackTimer);
                nodes.disposables.push(coachSrc, coachLp, coachGain);
                break;
            }
            case 'airplane-cabin': {
                const brownSrc = this.createLoopingNoiseNode('brown');
                const cabinLp = this.ctx.createBiquadFilter(); cabinLp.type = 'lowpass'; cabinLp.frequency.value = 260;
                const pinkSrc = this.createLoopingNoiseNode('pink');
                const airBp = this.ctx.createBiquadFilter(); airBp.type = 'bandpass'; airBp.frequency.value = 480; airBp.Q.value = 0.8;
                const airGain = this.ctx.createGain(); airGain.gain.value = 0.28;
                const turbine1 = this.ctx.createOscillator();
                const turbine2 = this.ctx.createOscillator();
                turbine1.type = 'sine'; turbine2.type = 'triangle';
                turbine1.frequency.value = 178.0; turbine2.frequency.value = 89.5;
                const turbGain = this.ctx.createGain(); turbGain.gain.value = 0.11;
                brownSrc.connect(cabinLp); cabinLp.connect(channelGain);
                pinkSrc.connect(airBp); airBp.connect(airGain); airGain.connect(channelGain);
                turbine1.connect(turbGain); turbine2.connect(turbGain); turbGain.connect(cabinLp);
                turbine1.start(); turbine2.start();
                nodes.disposables.push(brownSrc, cabinLp, pinkSrc, airBp, airGain, turbine1, turbine2, turbGain);
                break;
            }
            case 'vinyl-crackle': {
                const grooveSrc = this.createLoopingNoiseNode('pink');
                const grooveBp = this.ctx.createBiquadFilter(); grooveBp.type = 'bandpass'; grooveBp.frequency.value = 1850; grooveBp.Q.value = 1.4;
                const grooveGain = this.ctx.createGain(); grooveGain.gain.value = 0.14;
                grooveSrc.connect(grooveBp); grooveBp.connect(grooveGain); grooveGain.connect(channelGain);
                const popTimer = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    if (Math.random() < 0.75) this.spawnVinylPop(channelGain);
                }, 80);
                timers.push(popTimer);
                nodes.disposables.push(grooveSrc, grooveBp, grooveGain);
                break;
            }
            case 'clock-tick': {
                let isTick = true;
                this.spawnClockTick(channelGain, true);
                const tickInterval = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    isTick = !isTick;
                    this.spawnClockTick(channelGain, isTick);
                }, 1000);
                timers.push(tickInterval);
                break;
            }
            case 'brown-noise': {
                const src = this.createLoopingNoiseNode('brown');
                const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
                src.connect(lp); lp.connect(channelGain);
                nodes.disposables.push(src, lp);
                break;
            }
            case 'pink-noise': {
                const src = this.createLoopingNoiseNode('pink');
                const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
                src.connect(lp); lp.connect(channelGain);
                nodes.disposables.push(src, lp);
                break;
            }
            case 'white-noise': {
                const src = this.createLoopingNoiseNode('white');
                const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10500;
                const atten = this.ctx.createGain(); atten.gain.value = 0.35;
                src.connect(lp); lp.connect(atten); atten.connect(channelGain);
                nodes.disposables.push(src, lp, atten);
                break;
            }
            case 'green-noise': {
                const src = this.createLoopingNoiseNode('pink');
                const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.1;
                const boost = this.ctx.createGain(); boost.gain.value = 1.35;
                src.connect(bp); bp.connect(boost); boost.connect(channelGain);
                nodes.disposables.push(src, bp, boost);
                break;
            }
            case 'grey-noise': {
                const src = this.createLoopingNoiseNode('pink');
                const lowShelf = this.ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 180; lowShelf.gain.value = 7.5;
                const midScoop = this.ctx.createBiquadFilter(); midScoop.type = 'peaking'; midScoop.frequency.value = 2600; midScoop.Q.value = 1.1; midScoop.gain.value = -8.0;
                const highShelf = this.ctx.createBiquadFilter(); highShelf.type = 'highshelf'; highShelf.frequency.value = 6500; highShelf.gain.value = 4.5;
                const outGain = this.ctx.createGain(); outGain.gain.value = 0.55;
                src.connect(lowShelf); lowShelf.connect(midScoop); midScoop.connect(highShelf); highShelf.connect(outGain); outGain.connect(channelGain);
                nodes.disposables.push(src, lowShelf, midScoop, highShelf, outGain);
                break;
            }
            case 'lofi-chords': {
                const vinylSrc = this.createLoopingNoiseNode('pink');
                const vinylFilter = this.ctx.createBiquadFilter(); vinylFilter.type = 'bandpass'; vinylFilter.frequency.value = 1900; vinylFilter.Q.value = 1.5;
                const vinylGain = this.ctx.createGain(); vinylGain.gain.value = 0.025;
                vinylSrc.connect(vinylFilter); vinylFilter.connect(vinylGain); vinylGain.connect(channelGain);
                let stepIndex = 0;
                const playCurrentChord = () => {
                    if (!st.active || !this.isMasterPlaying) return;
                    const prog = LOFI_PROGRESSIONS[st.lofiProgression] || LOFI_PROGRESSIONS.jazzhop;
                    const chordFreqs = prog[stepIndex % prog.length];
                    this.playRhodesChord(channelGain, chordFreqs, 4.2);
                    stepIndex++;
                };
                playCurrentChord();
                const chordInterval = bgClock.setInterval(playCurrentChord, 4200);
                timers.push(chordInterval);
                nodes.disposables.push(vinylSrc, vinylFilter, vinylGain);
                break;
            }
            case 'felt-piano': {
                const scale = [261.63, 293.66, 311.13, 392.00, 440.00, 523.25, 587.33, 622.25, 783.99];
                const schedulePianoNote = () => {
                    const delay = 1400 + Math.random() * 2300;
                    const tId = bgClock.setTimeout(() => {
                        if (st.active && this.isMasterPlaying) {
                            const freq = scale[Math.floor(Math.random() * scale.length)];
                            this.playFeltPianoNote(channelGain, freq);
                            if (Math.random() < 0.35) {
                                const freq2 = scale[Math.floor(Math.random() * scale.length)];
                                const subP = bgClock.setTimeout(() => {
                                    if (st.active && this.isMasterPlaying) this.playFeltPianoNote(channelGain, freq2 * 0.5);
                                }, 180);
                                timers.push(subP);
                            }
                            schedulePianoNote();
                        }
                    }, delay);
                    timers.push(tId);
                };
                this.playFeltPianoNote(channelGain, 392.00);
                schedulePianoNote();
                break;
            }
            case 'ambient-drone': {
                const droneFreqs = [130.81, 196.00, 261.63, 293.66, 392.00];
                const padFilter = this.ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 620; padFilter.Q.value = 1.2;
                const filterLfo = this.ctx.createOscillator(); filterLfo.type = 'sine'; filterLfo.frequency.value = 0.065;
                const filterLfoDepth = this.ctx.createGain(); filterLfoDepth.gain.value = 340;
                filterLfo.connect(filterLfoDepth); filterLfoDepth.connect(padFilter.frequency); filterLfo.start();
                droneFreqs.forEach((freq, idx) => {
                    const osc1 = this.ctx.createOscillator();
                    const osc2 = this.ctx.createOscillator();
                    osc1.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
                    osc2.type = 'sine';
                    osc1.frequency.value = freq; osc1.detune.value = (idx - 2) * 6;
                    osc2.frequency.value = freq; osc2.detune.value = -(idx - 2) * 5;
                    const voiceGain = this.ctx.createGain(); voiceGain.gain.value = 0.09;
                    osc1.connect(voiceGain); osc2.connect(voiceGain); voiceGain.connect(padFilter);
                    osc1.start(); osc2.start();
                    nodes.disposables.push(osc1, osc2, voiceGain);
                });
                padFilter.connect(channelGain);
                nodes.disposables.push(padFilter, filterLfo, filterLfoDepth);
                break;
            }
            case 'singing-bowls': {
                const bowlFreqs = [216.0, 288.0, 324.0, 432.0];
                this.triggerSingingBowl(channelGain, 288.0);
                const bowlInterval = bgClock.setInterval(() => {
                    if (!this.isMasterPlaying || !st.active) return;
                    const f = bowlFreqs[Math.floor(Math.random() * bowlFreqs.length)];
                    this.triggerSingingBowl(channelGain, f);
                }, 7200);
                timers.push(bowlInterval);
                break;
            }
            case 'synth-arp': {
                const arpPatterns = {
                    midnight: [130.81, 164.81, 196.00, 246.94, 261.63, 246.94, 196.00, 164.81],
                    bladerunner: [146.83, 174.61, 220.00, 261.63, 329.63, 261.63, 220.00, 174.61],
                    uplift: [174.61, 220.00, 261.63, 329.63, 392.00, 329.63, 261.63, 220.00]
                };
                let arpStep = 0;
                const triggerArpStep = () => {
                    if (!st.active || !this.isMasterPlaying) return;
                    const pattern = arpPatterns[st.arpMood] || arpPatterns.midnight;
                    const freq = pattern[arpStep % pattern.length];
                    this.playSynthArpNote(channelGain, freq, 0.36);
                    arpStep++;
                };
                triggerArpStep();
                const arpInterval = bgClock.setInterval(triggerArpStep, 260);
                timers.push(arpInterval);
                break;
            }
            case 'binaural-beats': {
                const modeCfg = BINAURAL_MODES[st.binauralMode] || BINAURAL_MODES.alpha;
                const carrier = Number(st.binauralCarrier) || 200;
                const leftOsc = this.ctx.createOscillator();
                const rightOsc = this.ctx.createOscillator();
                leftOsc.type = 'sine'; rightOsc.type = 'sine';
                leftOsc.frequency.value = carrier - (modeCfg.beatFreq / 2);
                rightOsc.frequency.value = carrier + (modeCfg.beatFreq / 2);
                const panL = this.ctx.createStereoPanner();
                const panR = this.ctx.createStereoPanner();
                panL.pan.value = -1; panR.pan.value = 1;
                const binGain = this.ctx.createGain(); binGain.gain.value = 0.35;
                leftOsc.connect(panL); rightOsc.connect(panR); panL.connect(binGain); panR.connect(binGain); binGain.connect(channelGain);
                leftOsc.start(); rightOsc.start();
                nodes.leftOsc = leftOsc;
                nodes.rightOsc = rightOsc;
                nodes.disposables.push(leftOsc, rightOsc, panL, panR, binGain);
                break;
            }
            case 'isochronic-pulses': {
                const isoCfg = ISOCHRONIC_MODES[st.isochronicMode] || ISOCHRONIC_MODES.alpha10;
                const carrier = this.ctx.createOscillator();
                carrier.type = 'sine'; carrier.frequency.value = isoCfg.carrierFreq;
                const pulseGate = this.ctx.createGain(); pulseGate.gain.value = 0.22;
                const modLfo = this.ctx.createOscillator();
                modLfo.type = 'sine'; modLfo.frequency.value = isoCfg.pulseHz;
                const modDepth = this.ctx.createGain(); modDepth.gain.value = 0.20;
                modLfo.connect(modDepth); modDepth.connect(pulseGate.gain);
                carrier.connect(pulseGate); pulseGate.connect(channelGain);
                carrier.start(); modLfo.start();
                nodes.carrier = carrier;
                nodes.modLfo = modLfo;
                nodes.disposables.push(carrier, pulseGate, modLfo, modDepth);
                break;
            }
            case 'solfeggio-drone': {
                const solCfg = SOLFEGGIO_MODES[st.solfeggioMode] || SOLFEGGIO_MODES['528'];
                const baseFreq = solCfg.freq;
                const fundamental = this.ctx.createOscillator();
                const subOctave = this.ctx.createOscillator();
                const fifthHarmonic = this.ctx.createOscillator();
                fundamental.type = 'sine'; subOctave.type = 'triangle'; fifthHarmonic.type = 'sine';
                fundamental.frequency.value = baseFreq;
                subOctave.frequency.value = baseFreq * 0.5;
                fifthHarmonic.frequency.value = baseFreq * 0.75;
                const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 950;
                const gFund = this.ctx.createGain(); gFund.gain.value = 0.22;
                const gSub = this.ctx.createGain(); gSub.gain.value = 0.16;
                const gFifth = this.ctx.createGain(); gFifth.gain.value = 0.08;
                fundamental.connect(gFund); subOctave.connect(gSub); fifthHarmonic.connect(gFifth);
                gFund.connect(lp); gSub.connect(lp); gFifth.connect(lp); lp.connect(channelGain);
                fundamental.start(); subOctave.start(); fifthHarmonic.start();
                nodes.fundamental = fundamental;
                nodes.subOctave = subOctave;
                nodes.fifthHarmonic = fifthHarmonic;
                nodes.disposables.push(fundamental, subOctave, fifthHarmonic, gFund, gSub, gFifth, lp);
                break;
            }
            case 'rage-gangsta':
            case 'rage-amour':
            case 'rage-gogyal':
            case 'rage-bloodymary':
            case 'rage-littledarkage':
            case 'rage-soviet':
            case 'rage-deathisnomore':
            case 'rage-metamorphosis':
            case 'rage-afterdark':
            case 'rage-cornfield': {
                channelGain.disconnect();
                channelGain.connect(this.rageSubBus || this.masterGain);
                const songCfg = RAGE_SONG_SEQUENCES[id];
                if (!songCfg) break;
                const tempoScale = this.rageVibe === 'slowed' ? 1.24 : (this.rageVibe === 'nightcore' ? 0.82 : 1.0);
                const semitoneShift = this.rageVibe === 'slowed' ? -3 : (this.rageVibe === 'nightcore' ? 2 : 0);
                const stepMs = Math.round(songCfg.stepEighthMs * tempoScale);
                const stepSec = stepMs / 1000;
                let stepIdx = 0;
                const runSequencerStep = () => {
                    if (!st.active || !this.isMasterPlaying) return;
                    const s = stepIdx % 32;
                    const barIdx = Math.floor(s / 8);
                    if (s % 8 === 0 && songCfg.padChords && songCfg.padChords[barIdx]) {
                        const chordFreqs = songCfg.padChords[barIdx].map(n => noteToFreq(n, semitoneShift)).filter(Boolean);
                        this.playRagePadChord(channelGain, chordFreqs, stepSec * 8.1, songCfg.leadVoice);
                    }
                    const leadNote = songCfg.leadSteps[s];
                    if (leadNote && leadNote !== '-') {
                        let holdSteps = 1;
                        while (s + holdSteps < 32 && songCfg.leadSteps[s + holdSteps] === '-') holdSteps++;
                        const leadFreq = noteToFreq(leadNote, semitoneShift);
                        if (leadFreq) this.playRageLeadNote(channelGain, leadFreq, stepSec * Math.min(holdSteps, 3) * 0.92, songCfg.leadVoice);
                    }
                    const bassNote = songCfg.bassSteps[s];
                    if (bassNote && bassNote !== '-') {
                        let bassHold = 1;
                        while (s + bassHold < 32 && songCfg.bassSteps[s + bassHold] === '-') bassHold++;
                        const bassFreq = noteToFreq(bassNote, semitoneShift);
                        if (bassFreq) this.playRage808Bass(channelGain, bassFreq, stepSec * Math.min(bassHold, 4) * 0.95, songCfg.leadVoice);
                    }
                    if (this.rageDrumsEnabled) this.triggerRageDrumStep(channelGain, s, stepSec, songCfg.drumPattern);
                    stepIdx++;
                };
                runSequencerStep();
                const seqInterval = bgClock.setInterval(runSequencerStep, stepMs);
                timers.push(seqInterval);
                break;
            }
        }

        st.nodes = nodes;
        st.timers = timers;
    }

    stopChannelDSP(id) {
        const st = this.channelState[id];
        if (!st) return;
        if (st.timers && st.timers.length) {
            st.timers.forEach(t => bgClock.clear(t));
            st.timers = [];
        }
        if (st.nodes && this.ctx) {
            const now = this.ctx.currentTime;
            const { channelGain, disposables } = st.nodes;
            if (channelGain) {
                try {
                    channelGain.gain.cancelScheduledValues(now);
                    channelGain.gain.setTargetAtTime(0.0001, now, 0.08);
                } catch (e) {}
            }
            setTimeout(() => {
                if (disposables) {
                    disposables.forEach(node => {
                        try {
                            if (typeof node.stop === 'function') node.stop();
                            node.disconnect();
                        } catch (e) {}
                    });
                }
                try { if (channelGain) channelGain.disconnect(); } catch (e) {}
            }, 260);
            st.nodes = null;
        }
    }

    // ----- TRANSIENT GENERATORS -----
    spawnRainDroplet(destNode, freq = 2200, peakGain = 0.04) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.025);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peakGain, now + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
        osc.connect(env); env.connect(destNode);
        osc.start(now); osc.stop(now + 0.038);
    }

    spawnWindowTap(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource(); noise.buffer = this.buffers.white;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(900 + Math.random() * 1450, now);
        bp.Q.value = 6.5;
        const env = this.ctx.createGain();
        const peak = 0.06 + Math.random() * 0.08;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);
        noise.connect(bp); bp.connect(env); env.connect(destNode);
        noise.start(now, Math.random() * 4.0, 0.05);
    }

    triggerThunderStrike(destNode = null) {
        if (!this.ctx) return;
        const target = destNode || (this.channelState['distant-thunder']?.nodes?.channelGain) || this.masterGain;
        if (!target) return;
        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource(); noise.buffer = this.buffers.brown; noise.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(145, now);
        lp.frequency.exponentialRampToValueAtTime(42, now + 4.8);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.95, now + 0.25);
        env.gain.exponentialRampToValueAtTime(0.45, now + 1.1);
        env.gain.linearRampToValueAtTime(0.75, now + 1.65);
        env.gain.exponentialRampToValueAtTime(0.0008, now + 5.2);
        noise.connect(lp); lp.connect(env); env.connect(target);
        noise.start(now, Math.random() * 2.5); noise.stop(now + 5.3);
    }

    spawnBubbleBlip(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
        const baseF = 180 + Math.random() * 240;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseF, now);
        osc.frequency.exponentialRampToValueAtTime(baseF * 2.1, now + 0.09);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.06, now + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
        osc.connect(env); env.connect(destNode);
        osc.start(now); osc.stop(now + 0.12);
    }

    spawnFireCrackle(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource(); src.buffer = this.buffers.white;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1400 + Math.random() * 2600;
        bp.Q.value = 3.2;
        const env = this.ctx.createGain();
        const peak = 0.08 + Math.random() * 0.14;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);
        src.connect(bp); bp.connect(env); env.connect(destNode);
        src.start(now, Math.random() * 4, 0.03);
    }

    spawnCricketChirp(destNode, freq = 4400) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        for (let p = 0; p < 3; p++) {
            const start = now + p * 0.038;
            const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, start);
            env.gain.setValueAtTime(0.0001, start);
            env.gain.linearRampToValueAtTime(0.045, start + 0.006);
            env.gain.exponentialRampToValueAtTime(0.0001, start + 0.028);
            osc.connect(env); env.connect(destNode);
            osc.start(start); osc.stop(start + 0.032);
        }
    }

    spawnBirdSongPhrase(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const notesCount = 2 + Math.floor(Math.random() * 3);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = (Math.random() * 1.4) - 0.7;
        pan.connect(destNode);
        for (let i = 0; i < notesCount; i++) {
            const t = now + i * (0.11 + Math.random() * 0.06);
            const dur = 0.08 + Math.random() * 0.07;
            const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
            const fStart = 2100 + Math.random() * 1400;
            const fEnd = fStart * (0.82 + Math.random() * 0.42);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(fStart, t);
            osc.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
            env.gain.setValueAtTime(0.0001, t);
            env.gain.linearRampToValueAtTime(0.06, t + 0.015);
            env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(env); env.connect(pan);
            osc.start(t); osc.stop(t + dur + 0.01);
        }
    }

    spawnCeramicClink(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const base = 2200 + Math.random() * 900;
        [1, 2.42].forEach((ratio, idx) => {
            const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.value = base * ratio;
            const amp = idx === 0 ? 0.035 : 0.018;
            env.gain.setValueAtTime(0.0001, now);
            env.gain.linearRampToValueAtTime(amp, now + 0.002);
            env.gain.exponentialRampToValueAtTime(0.0001, now + (idx === 0 ? 0.14 : 0.06));
            osc.connect(env); env.connect(destNode);
            osc.start(now); osc.stop(now + 0.16);
        });
    }

    spawnPageTurnRustle(destNode, peakGain = 0.25) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource(); src.buffer = this.buffers.pink;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(900, now);
        bp.frequency.exponentialRampToValueAtTime(2600, now + 0.18);
        bp.frequency.exponentialRampToValueAtTime(1100, now + 0.38);
        bp.Q.value = 1.8;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peakGain, now + 0.08);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        src.connect(bp); bp.connect(env); env.connect(destNode);
        src.start(now, Math.random() * 3, 0.45);
    }

    spawnDistantFootstep(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        for (let step = 0; step < 2; step++) {
            const t = now + step * 0.58;
            const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(95, t);
            osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
            env.gain.setValueAtTime(0.0001, t);
            env.gain.linearRampToValueAtTime(0.05, t + 0.01);
            env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
            osc.connect(env); env.connect(destNode);
            osc.start(t); osc.stop(t + 0.12);
        }
    }

    spawnKeystroke(destNode, isSpacebar = false) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const clickSrc = this.ctx.createBufferSource(); clickSrc.buffer = this.buffers.white;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = isSpacebar ? 1600 : (2300 + Math.random() * 800);
        bp.Q.value = 2.5;
        const clickEnv = this.ctx.createGain();
        clickEnv.gain.setValueAtTime(0.0001, now);
        clickEnv.gain.linearRampToValueAtTime(0.14, now + 0.002);
        clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
        clickSrc.connect(bp); bp.connect(clickEnv); clickEnv.connect(destNode);
        clickSrc.start(now, Math.random() * 4, 0.025);
        const thockOsc = this.ctx.createOscillator(); const thockEnv = this.ctx.createGain();
        thockOsc.type = 'triangle';
        const baseF = isSpacebar ? 155 : (210 + Math.random() * 45);
        thockOsc.frequency.setValueAtTime(baseF, now);
        thockOsc.frequency.exponentialRampToValueAtTime(75, now + 0.038);
        thockEnv.gain.setValueAtTime(0.0001, now);
        thockEnv.gain.linearRampToValueAtTime(0.18, now + 0.003);
        thockEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);
        thockOsc.connect(thockEnv); thockEnv.connect(destNode);
        thockOsc.start(now); thockOsc.stop(now + 0.048);
    }

    spawnTrainClack(destNode, vel = 1.0) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        [0, 0.075].forEach((offset, idx) => {
            const t = now + offset;
            const src = this.ctx.createBufferSource(); src.buffer = this.buffers.pink;
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass'; bp.frequency.value = idx === 0 ? 340 : 280; bp.Q.value = 3.0;
            const env = this.ctx.createGain();
            const amp = 0.16 * vel * (idx === 0 ? 1 : 0.82);
            env.gain.setValueAtTime(0.0001, t);
            env.gain.linearRampToValueAtTime(amp, t + 0.004);
            env.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
            src.connect(bp); bp.connect(env); env.connect(destNode);
            src.start(t, Math.random() * 3, 0.07);
        });
    }

    spawnVinylPop(destNode) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource(); src.buffer = this.buffers.white;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = 2600 + Math.random() * 3200;
        hp.Q.value = 4.0;
        const env = this.ctx.createGain();
        const amp = 0.03 + Math.random() * 0.06;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(amp, now + 0.001);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.009);
        src.connect(hp); hp.connect(env); env.connect(destNode);
        src.start(now, Math.random() * 4, 0.015);
    }

    spawnClockTick(destNode, isTick = true) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
        osc.type = 'triangle';
        const f = isTick ? 980 : 740;
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.025);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.14, now + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
        osc.connect(env); env.connect(destNode);
        osc.start(now); osc.stop(now + 0.036);
    }

    playRhodesChord(destNode, chordFreqs, durationSec = 4.2) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const chordFilter = this.ctx.createBiquadFilter();
        chordFilter.type = 'lowpass';
        chordFilter.frequency.setValueAtTime(1450, now);
        chordFilter.frequency.exponentialRampToValueAtTime(480, now + durationSec * 0.9);
        const wobbleLfo = this.ctx.createOscillator();
        wobbleLfo.frequency.value = 3.2;
        const wobbleGain = this.ctx.createGain(); wobbleGain.gain.value = 4.5;
        wobbleLfo.connect(wobbleGain);
        wobbleLfo.start(now); wobbleLfo.stop(now + durationSec);
        chordFilter.connect(destNode);
        chordFreqs.forEach((freq, i) => {
            const noteStart = now + i * 0.035;
            const oscMain = this.ctx.createOscillator();
            const oscTine = this.ctx.createOscillator();
            oscMain.type = 'sine'; oscTine.type = 'triangle';
            oscMain.frequency.setValueAtTime(freq, noteStart);
            oscTine.frequency.setValueAtTime(freq * 2, noteStart);
            wobbleGain.connect(oscMain.detune);
            const noteEnv = this.ctx.createGain();
            noteEnv.gain.setValueAtTime(0.0001, noteStart);
            noteEnv.gain.linearRampToValueAtTime(0.11, noteStart + 0.06);
            noteEnv.gain.exponentialRampToValueAtTime(0.045, noteStart + 1.2);
            noteEnv.gain.exponentialRampToValueAtTime(0.0005, noteStart + durationSec - 0.1);
            const tineEnv = this.ctx.createGain();
            tineEnv.gain.setValueAtTime(0.0001, noteStart);
            tineEnv.gain.linearRampToValueAtTime(0.028, noteStart + 0.015);
            tineEnv.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.45);
            oscMain.connect(noteEnv); oscTine.connect(tineEnv);
            noteEnv.connect(chordFilter); tineEnv.connect(chordFilter);
            oscMain.start(noteStart); oscTine.start(noteStart);
            oscMain.stop(noteStart + durationSec); oscTine.stop(noteStart + 0.5);
        });
    }

    playFeltPianoNote(destNode, freq = 392.0) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(920, now);
        lp.frequency.exponentialRampToValueAtTime(280, now + 2.8);
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        osc1.type = 'sine'; osc2.type = 'triangle';
        osc1.frequency.value = freq; osc2.frequency.value = freq;
        osc2.detune.value = 3.5;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.18, now + 0.045);
        env.gain.exponentialRampToValueAtTime(0.0004, now + 3.1);
        osc1.connect(env); osc2.connect(env); env.connect(lp); lp.connect(destNode);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + 3.2); osc2.stop(now + 3.2);
    }

    triggerSingingBowl(destNode = null, baseFreq = 288.0) {
        if (!this.ctx) return;
        const target = destNode || (this.channelState['singing-bowls']?.nodes?.channelGain) || this.masterGain;
        if (!target) return;
        const now = this.ctx.currentTime;
        const partials = [
            { ratio: 1.0, amp: 0.22, decay: 6.8 },
            { ratio: 2.756, amp: 0.09, decay: 4.5 },
            { ratio: 5.404, amp: 0.035, decay: 2.6 }
        ];
        partials.forEach(p => {
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            osc1.type = 'sine'; osc2.type = 'sine';
            osc1.frequency.value = baseFreq * p.ratio;
            osc2.frequency.value = (baseFreq * p.ratio) + 1.4;
            const env = this.ctx.createGain();
            env.gain.setValueAtTime(0.0001, now);
            env.gain.linearRampToValueAtTime(p.amp, now + 0.08);
            env.gain.exponentialRampToValueAtTime(0.0002, now + p.decay);
            osc1.connect(env); osc2.connect(env); env.connect(target);
            osc1.start(now); osc2.start(now);
            osc1.stop(now + p.decay + 0.1); osc2.stop(now + p.decay + 0.1);
        });
    }

    playSynthArpNote(destNode, freq, durationSec = 0.35) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        osc1.type = 'sawtooth'; osc2.type = 'triangle';
        osc1.frequency.value = freq; osc2.frequency.value = freq * 0.5;
        osc1.detune.value = 6;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(980, now);
        lp.frequency.exponentialRampToValueAtTime(260, now + durationSec);
        lp.Q.value = 2.4;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.14, now + 0.018);
        env.gain.exponentialRampToValueAtTime(0.0005, now + durationSec);
        osc1.connect(lp); osc2.connect(lp); lp.connect(env); env.connect(destNode);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + durationSec + 0.02); osc2.stop(now + durationSec + 0.02);
    }

    playRagePadChord(destNode, freqs, durationSec, voiceType) {
        if (!this.ctx || !freqs.length) return;
        const now = this.ctx.currentTime;
        const padFilter = this.ctx.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.setValueAtTime(voiceType === 'cathedral-organ' ? 2400 : 1350, now);
        padFilter.Q.value = 1.2;
        padFilter.connect(destNode);
        freqs.forEach((f, idx) => {
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            if (voiceType === 'strings-choir' || voiceType === 'majestic-brass') {
                osc1.type = 'sawtooth'; osc2.type = 'triangle';
                osc1.detune.value = -9 + idx * 4; osc2.detune.value = 9 - idx * 3;
            } else if (voiceType === 'cathedral-organ') {
                osc1.type = 'triangle'; osc2.type = 'sine';
                osc2.frequency.setValueAtTime(f * 2, now);
            } else {
                osc1.type = 'sawtooth'; osc2.type = 'sawtooth';
                osc1.detune.value = -11; osc2.detune.value = 11;
            }
            osc1.frequency.setValueAtTime(f, now);
            if (voiceType !== 'cathedral-organ') osc2.frequency.setValueAtTime(f, now);
            const env = this.ctx.createGain();
            const peak = voiceType === 'cathedral-organ' ? 0.085 : 0.065;
            env.gain.setValueAtTime(0.0001, now);
            env.gain.linearRampToValueAtTime(peak, now + Math.min(0.35, durationSec * 0.2));
            env.gain.setValueAtTime(peak * 0.85, now + durationSec * 0.75);
            env.gain.exponentialRampToValueAtTime(0.0002, now + durationSec);
            osc1.connect(env); osc2.connect(env); env.connect(padFilter);
            osc1.start(now); osc2.start(now);
            osc1.stop(now + durationSec + 0.05); osc2.stop(now + durationSec + 0.05);
        });
    }

    playRageLeadNote(destNode, freq, durationSec, voiceType) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        if (voiceType === 'phonk-cowbell' || voiceType === 'dark-phonk-bell') {
            const sq1 = this.ctx.createOscillator();
            const sq2 = this.ctx.createOscillator();
            sq1.type = 'square'; sq2.type = 'square';
            sq1.frequency.setValueAtTime(freq, now);
            sq2.frequency.setValueAtTime(freq * 1.481, now);
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(freq * 1.25, now);
            bp.Q.value = voiceType === 'dark-phonk-bell' ? 4.5 : 3.2;
            const env = this.ctx.createGain();
            const dur = Math.max(0.18, durationSec * 0.9);
            env.gain.setValueAtTime(0.0001, now);
            env.gain.linearRampToValueAtTime(0.22, now + 0.005);
            env.gain.exponentialRampToValueAtTime(0.0004, now + dur);
            sq1.connect(bp); sq2.connect(bp); bp.connect(env); env.connect(destNode);
            sq1.start(now); sq2.start(now);
            sq1.stop(now + dur + 0.02); sq2.stop(now + dur + 0.02);
            return;
        }
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        let attack = 0.015;
        let peak = 0.17;
        if (voiceType === 'gothic-pluck') {
            osc1.type = 'sawtooth'; osc2.type = 'square';
            osc2.frequency.setValueAtTime(freq * 2, now);
            filter.frequency.setValueAtTime(3400, now);
            filter.frequency.exponentialRampToValueAtTime(520, now + durationSec);
            attack = 0.005; peak = 0.19;
        } else if (voiceType === 'majestic-brass') {
            osc1.type = 'sawtooth'; osc2.type = 'sawtooth';
            osc1.detune.value = -8; osc2.detune.value = 8;
            osc2.frequency.setValueAtTime(freq, now);
            filter.frequency.setValueAtTime(650, now);
            filter.frequency.linearRampToValueAtTime(2400, now + 0.09);
            filter.frequency.exponentialRampToValueAtTime(1100, now + durationSec);
            attack = 0.04; peak = 0.20;
        } else if (voiceType === 'cathedral-organ') {
            osc1.type = 'triangle'; osc2.type = 'sine';
            osc2.frequency.setValueAtTime(freq * 2, now);
            filter.frequency.setValueAtTime(2800, now);
            attack = 0.012; peak = 0.18;
        } else {
            osc1.type = 'sawtooth'; osc2.type = 'triangle';
            osc1.detune.value = -7; osc2.detune.value = 7;
            osc2.frequency.setValueAtTime(freq, now);
            filter.frequency.setValueAtTime(2600, now);
            filter.frequency.exponentialRampToValueAtTime(850, now + durationSec);
            filter.Q.value = 1.8;
        }
        osc1.frequency.setValueAtTime(freq, now);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + attack);
        env.gain.exponentialRampToValueAtTime(0.0004, now + durationSec);
        osc1.connect(filter); osc2.connect(filter); filter.connect(env); env.connect(destNode);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + durationSec + 0.02); osc2.stop(now + durationSec + 0.02);
    }

    playRage808Bass(destNode, freq, durationSec, voiceType) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const subOsc = this.ctx.createOscillator();
        const harmOsc = this.ctx.createOscillator();
        subOsc.type = 'sine';
        harmOsc.type = (voiceType === 'phonk-cowbell' || voiceType === 'dark-analog') ? 'sawtooth' : 'triangle';
        subOsc.frequency.setValueAtTime(freq * 1.45, now);
        subOsc.frequency.exponentialRampToValueAtTime(freq, now + 0.045);
        harmOsc.frequency.setValueAtTime(freq, now);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(280, now);
        lp.frequency.exponentialRampToValueAtTime(110, now + durationSec);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.32, now + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);
        const harmGain = this.ctx.createGain(); harmGain.gain.value = 0.38;
        subOsc.connect(env);
        harmOsc.connect(harmGain); harmGain.connect(lp); lp.connect(env); env.connect(destNode);
        subOsc.start(now); harmOsc.start(now);
        subOsc.stop(now + durationSec + 0.03); harmOsc.stop(now + durationSec + 0.03);
    }

    triggerRageDrumStep(destNode, stepIn32, stepSec, patternType) {
        if (!this.ctx) return;
        const s = stepIn32 % 8;
        if (patternType === 'brazilian-phonk' || patternType === 'drift-phonk') {
            if (s === 0 || s === 3 || s === 6) this.spawnRageKick(destNode, 0.38);
            if (s === 2 || s === 6) this.spawnRageSnare(destNode, 0.24, true);
            this.spawnRageHiHat(destNode, 0.08);
            bgClock.setTimeout(() => {
                if (this.isMasterPlaying && this.rageDrumsEnabled) this.spawnRageHiHat(destNode, 0.05);
            }, stepSec * 500);
        } else if (patternType === 'synthpop' || patternType === 'gated-80s') {
            if (s % 2 === 0) this.spawnRageKick(destNode, 0.34);
            if (s === 2 || s === 6) this.spawnRageSnare(destNode, 0.25, patternType === 'gated-80s');
            this.spawnRageHiHat(destNode, s % 2 === 1 ? 0.09 : 0.05);
        } else if (patternType === 'orchestral-march') {
            if (s === 0 || s === 4) this.spawnRageKick(destNode, 0.32);
            if (s === 2 || s === 6 || s === 7) this.spawnRageSnare(destNode, 0.14, false);
        } else if (patternType === 'cinematic-pulse') {
            if (s === 0 || s === 4) this.spawnRageKick(destNode, 0.28);
            this.spawnRageHiHat(destNode, 0.04);
        } else {
            if (s === 0 || s === 3 || s === 4) this.spawnRageKick(destNode, 0.35);
            if (s === 2 || s === 6) this.spawnRageSnare(destNode, 0.22, true);
            if (s % 2 === 0) this.spawnRageHiHat(destNode, 0.06);
        }
    }

    spawnRageKick(destNode, peak = 0.35) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(135, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.24);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0005, now + 0.26);
        osc.connect(env); env.connect(destNode);
        osc.start(now); osc.stop(now + 0.28);
    }

    spawnRageSnare(destNode, peak = 0.22, gatedReverb = false) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource(); noise.buffer = this.buffers.white;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1850; bp.Q.value = 1.1;
        const nEnv = this.ctx.createGain();
        const decay = gatedReverb ? 0.26 : 0.16;
        nEnv.gain.setValueAtTime(0.0001, now);
        nEnv.gain.linearRampToValueAtTime(peak, now + 0.003);
        nEnv.gain.exponentialRampToValueAtTime(0.0004, now + decay);
        noise.connect(bp); bp.connect(nEnv); nEnv.connect(destNode);
        noise.start(now, Math.random() * 3, decay + 0.02);
        const body = this.ctx.createOscillator(); const bEnv = this.ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(195, now);
        body.frequency.exponentialRampToValueAtTime(95, now + 0.08);
        bEnv.gain.setValueAtTime(0.0001, now);
        bEnv.gain.linearRampToValueAtTime(peak * 0.7, now + 0.002);
        bEnv.gain.exponentialRampToValueAtTime(0.0004, now + 0.1);
        body.connect(bEnv); bEnv.connect(destNode);
        body.start(now); body.stop(now + 0.11);
    }

    spawnRageHiHat(destNode, peak = 0.07) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource(); src.buffer = this.buffers.white;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 6800;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0002, now + 0.045);
        src.connect(hp); hp.connect(env); env.connect(destNode);
        src.start(now, Math.random() * 4, 0.055);
    }

    updateBinauralFrequencies() {
        const st = this.channelState['binaural-beats'];
        if (!st || !st.active || !st.nodes || !this.ctx) return;
        const modeCfg = BINAURAL_MODES[st.binauralMode] || BINAURAL_MODES.alpha;
        const carrier = Number(st.binauralCarrier) || 200;
        const now = this.ctx.currentTime;
        if (st.nodes.leftOsc && st.nodes.rightOsc) {
            st.nodes.leftOsc.frequency.setTargetAtTime(carrier - (modeCfg.beatFreq / 2), now, 0.15);
            st.nodes.rightOsc.frequency.setTargetAtTime(carrier + (modeCfg.beatFreq / 2), now, 0.15);
        }
    }

    updateIsochronicFrequencies() {
        const st = this.channelState['isochronic-pulses'];
        if (!st || !st.active || !st.nodes || !this.ctx) return;
        const isoCfg = ISOCHRONIC_MODES[st.isochronicMode] || ISOCHRONIC_MODES.alpha10;
        const now = this.ctx.currentTime;
        if (st.nodes.carrier && st.nodes.modLfo) {
            st.nodes.carrier.frequency.setTargetAtTime(isoCfg.carrierFreq, now, 0.15);
            st.nodes.modLfo.frequency.setTargetAtTime(isoCfg.pulseHz, now, 0.15);
        }
    }

    updateSolfeggioFrequencies() {
        const st = this.channelState['solfeggio-drone'];
        if (!st || !st.active || !st.nodes || !this.ctx) return;
        const solCfg = SOLFEGGIO_MODES[st.solfeggioMode] || SOLFEGGIO_MODES['528'];
        const now = this.ctx.currentTime;
        if (st.nodes.fundamental) {
            st.nodes.fundamental.frequency.setTargetAtTime(solCfg.freq, now, 0.2);
            st.nodes.subOctave.frequency.setTargetAtTime(solCfg.freq * 0.5, now, 0.2);
            st.nodes.fifthHarmonic.frequency.setTargetAtTime(solCfg.freq * 0.75, now, 0.2);
        }
    }

    async setMasterVolume(vol0to1) {
        this.masterVolume = Math.max(0, Math.min(1, vol0to1));
        if (this.ctx && this.masterGain && !this.isMuted) {
            this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
        }
    }

    toggleMasterMute() {
        this.isMuted = !this.isMuted;
        if (this.ctx && this.masterGain) {
            const target = this.isMuted ? 0.0001 : this.masterVolume;
            this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
        }
        return this.isMuted;
    }

    async toggleMasterPlayPause() {
        this.initContext();
        const anyActive = this.getActiveChannelIds().length > 0 || this.localTracks.size > 0;
        if (!anyActive) {
            await applyPresetMix(CURATED_PRESETS['rainstorm-study'].channels);
            showToast('Activated "Rainstorm Study" mix');
            return;
        }
        if (this.ctx.state === 'running' && this.isMasterPlaying) {
            await this.ctx.suspend();
            this.isMasterPlaying = false;
            this.syncBackgroundBridgePlayback(false);
            this.localTracks.forEach(tr => {
                if (!tr.audioEl.paused) {
                    tr.wasPlayingBeforeMasterPause = true;
                    tr.audioEl.pause();
                }
            });
        } else {
            await this.ctx.resume();
            this.isMasterPlaying = true;
            this.syncBackgroundBridgePlayback(true);
            this.localTracks.forEach(tr => {
                if (tr.wasPlayingBeforeMasterPause) {
                    tr.audioEl.play().catch(() => {});
                    tr.wasPlayingBeforeMasterPause = false;
                }
            });
        }
        updateEngineBadgeUI();
        updateMasterSummaryUI();
        updateMediaSessionMetadataAndArtwork();
    }

    silenceAll() {
        STUDIO_CHANNELS.forEach(ch => {
            if (this.channelState[ch.id].active) {
                this.stopChannelDSP(ch.id);
                this.channelState[ch.id].active = false;
                updateChannelCardUI(ch.id);
            }
        });
        this.localTracks.forEach(tr => { tr.audioEl.pause(); tr.playing = false; });
        this.syncBackgroundBridgePlayback(false);
        renderLocalTracksUI();
        updateMasterSummaryUI();
        renderActiveQuickDock();
        applyCategoryAndSearchFilter();
        updateMediaSessionMetadataAndArtwork();
    }

    getActiveChannelIds() {
        return STUDIO_CHANNELS.filter(ch => this.channelState[ch.id].active).map(ch => ch.id);
    }

    async playCompletionChime() {
        await this.ensureRunning();
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((f, i) => {
            const start = now + i * 0.16;
            const osc = this.ctx.createOscillator(); const env = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(f, start);
            env.gain.setValueAtTime(0.0001, start);
            env.gain.linearRampToValueAtTime(0.18, start + 0.02);
            env.gain.exponentialRampToValueAtTime(0.0001, start + 1.8);
            osc.connect(env); env.connect(this.masterGain);
            osc.start(start); osc.stop(start + 1.85);
        });
    }
}

const audioEngine = new FocusFlowAudioEngine();

/***********************************************************************
 * 3. UI RENDERING
 ***********************************************************************/
let currentCategoryFilter = 'all';
let currentSearchQuery = '';

function renderCuratedPresets() {
    const container = document.getElementById('presetButtonsContainer');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(CURATED_PRESETS).forEach(([key, preset]) => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn group text-left p-3 rounded-xl bg-studio-900/80 hover:bg-studio-800/90 border border-white/10 hover:border-indigo-500/50 transition flex items-start gap-3';
        btn.innerHTML = `
            <div class="w-9 h-9 rounded-xl bg-slate-800/90 group-hover:bg-indigo-600/20 flex items-center justify-center shrink-0 border border-white/5 transition">
                <i class="fa-solid ${preset.icon} ${preset.color} text-sm"></i>
            </div>
            <div class="min-w-0 flex-1">
                <div class="text-xs font-bold text-white group-hover:text-indigo-300 truncate">${preset.name}</div>
                <div class="text-[11px] text-slate-400 truncate mt-0.5">${preset.desc}</div>
            </div>
        `;
        btn.addEventListener('click', async () => {
            if (preset.binauralOverride) {
                audioEngine.channelState['binaural-beats'].binauralMode = preset.binauralOverride;
                const sel = document.getElementById('binaural-mode-select');
                if (sel) sel.value = preset.binauralOverride;
            }
            if (preset.solfeggioOverride) {
                audioEngine.channelState['solfeggio-drone'].solfeggioMode = preset.solfeggioOverride;
                const sel = document.getElementById('solfeggio-mode-select');
                if (sel) sel.value = preset.solfeggioOverride;
            }
            audioEngine.lastPresetName = preset.name;
            await applyPresetMix(preset.channels);
            showToast(`Loaded "${preset.name}" preset`);
        });
        container.appendChild(btn);
    });
}

function renderRageHybridPresets() {
    const container = document.getElementById('rageHybridPresetsContainer');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(RAGE_HYBRID_PRESETS).forEach(([key, preset]) => {
        const btn = document.createElement('button');
        btn.className = 'text-left p-2.5 rounded-xl bg-studio-950/90 hover:bg-rose-950/50 border border-rose-500/30 hover:border-rose-400 transition group';
        btn.innerHTML = `
            <div class="text-xs font-bold text-white group-hover:text-rose-300 truncate">${preset.name}</div>
            <div class="text-[10px] text-slate-400 truncate mt-0.5">${preset.desc}</div>
        `;
        btn.addEventListener('click', async () => {
            if (preset.vibe) setRageVibeUI(preset.vibe);
            if (preset.binauralOverride) {
                audioEngine.channelState['binaural-beats'].binauralMode = preset.binauralOverride;
                const sel = document.getElementById('binaural-mode-select');
                if (sel) sel.value = preset.binauralOverride;
            }
            audioEngine.lastPresetName = preset.name;
            await applyPresetMix(preset.channels);
            showToast(`Activated ${preset.name}`);
        });
        container.appendChild(btn);
    });
}

function setRageVibeUI(vibeMode) {
    audioEngine.setRageVibe(vibeMode);
    document.querySelectorAll('.rage-vibe-btn').forEach(btn => {
        if (btn.dataset.rageVibe === vibeMode) {
            btn.className = 'rage-vibe-btn px-2.5 py-1 rounded-md text-[11px] font-semibold bg-rose-600 text-white shadow transition';
        } else {
            btn.className = 'rage-vibe-btn px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white transition';
        }
    });
}

function renderChannelCards() {
    STUDIO_CHANNELS.forEach(ch => {
        const container = document.getElementById(`category-${ch.category}`);
        if (!container) return;
        const st = audioEngine.channelState[ch.id];
        const pct = Math.round(st.volume * 100);
        let extraControlsHtml = '';
        if (ch.hasThunderTrigger) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2">
                    <select id="thunder-freq-select" class="bg-studio-950 text-[11px] text-slate-300 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="rare">Rare (16-28s)</option>
                        <option value="normal" selected>Normal (8-18s)</option>
                        <option value="frequent">Stormy (4-9s)</option>
                    </select>
                    <button id="strike-thunder-now-btn" class="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-medium transition">
                        <i class="fa-solid fa-bolt mr-1"></i>Strike Now
                    </button>
                </div>
            `;
        } else if (ch.hasKeyboardSpeedSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-slate-400">Cadence:</span>
                    <select id="keyboard-wpm-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="slow">Relaxed (45 WPM)</option>
                        <option value="flow" selected>Flow State (80 WPM)</option>
                        <option value="fast">Fast Sprint (115 WPM)</option>
                    </select>
                </div>
            `;
        } else if (ch.hasChordMoodSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-slate-400">Voicing:</span>
                    <select id="lofi-prog-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="jazzhop" selected>Jazz Hop 9ths</option>
                        <option value="rainyminor">Rainy Minor 11ths</option>
                        <option value="dreamylydian">Dreamy Lydian</option>
                    </select>
                </div>
            `;
        } else if (ch.hasBowlTrigger) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2">
                    <span class="text-[11px] text-slate-400">Harmonic Partials</span>
                    <button id="strike-bowl-now-btn" class="px-2.5 py-1 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-300 border border-yellow-500/30 text-[11px] font-medium transition">
                        <i class="fa-solid fa-bell mr-1"></i>Strike Bowl
                    </button>
                </div>
            `;
        } else if (ch.hasArpSpeedSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-slate-400">Arp Scale:</span>
                    <select id="arp-mood-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="midnight" selected>Midnight Cmaj7</option>
                        <option value="bladerunner">Cyberpunk Dm9</option>
                        <option value="uplift">Warm Horizon Fmaj9</option>
                    </select>
                </div>
            `;
        } else if (ch.hasBinauralSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 space-y-1.5 text-[11px]">
                    <div class="flex items-center justify-between gap-1.5">
                        <span class="text-slate-400">Wave:</span>
                        <select id="binaural-mode-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none flex-1">
                            <option value="delta">Delta 2.5Hz (Rest)</option>
                            <option value="theta">Theta 6Hz (Meditation)</option>
                            <option value="alpha" selected>Alpha 10Hz (Calm Focus)</option>
                            <option value="beta">Beta 18Hz (Active Study)</option>
                            <option value="gamma">Gamma 40Hz (Peak Cognition)</option>
                        </select>
                    </div>
                    <div class="flex items-center justify-between gap-1.5">
                        <span class="text-slate-400">Carrier:</span>
                        <select id="binaural-carrier-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none flex-1">
                            <option value="160">160 Hz (Warm Low)</option>
                            <option value="200" selected>200 Hz (Balanced)</option>
                            <option value="256">256 Hz (Root C4)</option>
                        </select>
                    </div>
                </div>
            `;
        } else if (ch.hasIsochronicSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-slate-400">Pulse:</span>
                    <select id="isochronic-mode-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="alpha10" selected>Alpha 10Hz (Calm)</option>
                        <option value="beta16">Beta 16Hz (Alert)</option>
                        <option value="gamma32">Gamma 32Hz (Peak)</option>
                    </select>
                </div>
            `;
        } else if (ch.hasSolfeggioSelector) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-slate-400">Tuning:</span>
                    <select id="solfeggio-mode-select" class="bg-studio-950 text-slate-200 rounded-lg px-2 py-1 border border-white/10 focus:outline-none">
                        <option value="432">432 Hz (Deep Calm)</option>
                        <option value="528" selected>528 Hz (Clarity)</option>
                        <option value="396">396 Hz (Grounding)</option>
                    </select>
                </div>
            `;
        } else if (ch.isRageTrack) {
            extraControlsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-rose-500/20 flex items-center justify-between gap-2 text-[10px]">
                    <span class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono">${ch.bpm} BPM • ${ch.keySignature}</span>
                    <button data-solo-rage="${ch.id}" class="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white font-semibold transition">
                        <i class="fa-solid fa-headphones mr-1"></i>Solo Anthem
                    </button>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.id = `card-${ch.id}`;
        card.dataset.channelId = ch.id;
        card.dataset.category = ch.category;
        card.dataset.searchText = `${ch.title} ${ch.subtitle} ${ch.category} ${ch.keySignature || ''}`.toLowerCase();
        card.className = `channel-card ${ch.isRageTrack ? 'rage-card' : ''} rounded-2xl p-4 flex flex-col justify-between`;
        card.innerHTML = `
            <div>
                <div class="flex items-start justify-between gap-3">
                    <button id="toggle-btn-${ch.id}" class="flex items-center gap-3 text-left group flex-1">
                        <div id="icon-box-${ch.id}" class="w-10 h-10 rounded-xl bg-slate-800/90 group-hover:bg-slate-700/90 flex items-center justify-center border border-white/10 transition shrink-0">
                            <i class="fa-solid ${ch.icon} ${ch.accentColor} text-base"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <h4 class="text-sm font-semibold text-white group-hover:text-indigo-300 transition truncate">${ch.title}</h4>
                                <div class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></div>
                            </div>
                            <p class="text-[11px] text-slate-400 line-clamp-2 mt-0.5">${ch.subtitle}</p>
                        </div>
                    </button>
                    <button id="power-pill-${ch.id}" class="px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-slate-800/80 text-slate-400 border border-white/10 hover:text-white transition shrink-0">OFF</button>
                </div>
            </div>
            <div class="mt-4 pt-2">
                <div class="flex items-center justify-between text-[11px] mb-1.5">
                    <span class="text-slate-400">Channel Level</span>
                    <span id="vol-label-${ch.id}" class="font-mono font-semibold text-slate-200">${pct}%</span>
                </div>
                <input id="slider-${ch.id}" type="range" min="0" max="100" value="${pct}" class="studio-slider">
                ${extraControlsHtml}
            </div>
        `;
        container.appendChild(card);

        document.getElementById(`toggle-btn-${ch.id}`).addEventListener('click', () => audioEngine.toggleChannel(ch.id));
        document.getElementById(`power-pill-${ch.id}`).addEventListener('click', () => audioEngine.toggleChannel(ch.id));
        document.getElementById(`slider-${ch.id}`).addEventListener('input', (e) => {
            const val = Number(e.target.value);
            audioEngine.setChannelVolume(ch.id, val / 100);
            if (val > 0 && !audioEngine.channelState[ch.id].active) audioEngine.toggleChannel(ch.id, true);
        });

        const soloRageBtn = card.querySelector(`[data-solo-rage="${ch.id}"]`);
        if (soloRageBtn) {
            soloRageBtn.addEventListener('click', async () => {
                STUDIO_CHANNELS.filter(c => c.isRageTrack && c.id !== ch.id).forEach(other => {
                    if (audioEngine.channelState[other.id].active) audioEngine.toggleChannel(other.id, false);
                });
                await audioEngine.toggleChannel(ch.id, true);
                showToast(`Playing ${ch.title}`);
            });
        }
    });

    const thunderFreqSelect = document.getElementById('thunder-freq-select');
    if (thunderFreqSelect) thunderFreqSelect.addEventListener('change', (e) => { audioEngine.channelState['distant-thunder'].thunderFreq = e.target.value; });
    const strikeThunderBtn = document.getElementById('strike-thunder-now-btn');
    if (strikeThunderBtn) {
        strikeThunderBtn.addEventListener('click', async () => {
            await audioEngine.ensureRunning();
            if (!audioEngine.channelState['distant-thunder'].active) await audioEngine.toggleChannel('distant-thunder', true);
            else audioEngine.triggerThunderStrike();
            showToast('Thunder rumble triggered');
        });
    }
    const kbSelect = document.getElementById('keyboard-wpm-select');
    if (kbSelect) kbSelect.addEventListener('change', (e) => { audioEngine.channelState['mech-keyboard'].keyboardWpm = e.target.value; });
    const lofiProgSelect = document.getElementById('lofi-prog-select');
    if (lofiProgSelect) lofiProgSelect.addEventListener('change', (e) => { audioEngine.channelState['lofi-chords'].lofiProgression = e.target.value; });
    const strikeBowlBtn = document.getElementById('strike-bowl-now-btn');
    if (strikeBowlBtn) {
        strikeBowlBtn.addEventListener('click', async () => {
            await audioEngine.ensureRunning();
            if (!audioEngine.channelState['singing-bowls'].active) await audioEngine.toggleChannel('singing-bowls', true);
            else audioEngine.triggerSingingBowl(null, 288.0);
            showToast('Tibetan singing bowl struck');
        });
    }
    const arpMoodSelect = document.getElementById('arp-mood-select');
    if (arpMoodSelect) arpMoodSelect.addEventListener('change', (e) => { audioEngine.channelState['synth-arp'].arpMood = e.target.value; });
    const binModeSelect = document.getElementById('binaural-mode-select');
    if (binModeSelect) binModeSelect.addEventListener('change', (e) => {
        audioEngine.channelState['binaural-beats'].binauralMode = e.target.value;
        audioEngine.updateBinauralFrequencies();
    });
    const binCarrierSelect = document.getElementById('binaural-carrier-select');
    if (binCarrierSelect) binCarrierSelect.addEventListener('change', (e) => {
        audioEngine.channelState['binaural-beats'].binauralCarrier = Number(e.target.value);
        audioEngine.updateBinauralFrequencies();
    });
    const isoSelect = document.getElementById('isochronic-mode-select');
    if (isoSelect) isoSelect.addEventListener('change', (e) => {
        audioEngine.channelState['isochronic-pulses'].isochronicMode = e.target.value;
        audioEngine.updateIsochronicFrequencies();
    });
    const solSelect = document.getElementById('solfeggio-mode-select');
    if (solSelect) solSelect.addEventListener('change', (e) => {
        audioEngine.channelState['solfeggio-drone'].solfeggioMode = e.target.value;
        audioEngine.updateSolfeggioFrequencies();
    });
}

function updateChannelCardUI(id) {
    const st = audioEngine.channelState[id];
    const card = document.getElementById(`card-${id}`);
    const pill = document.getElementById(`power-pill-${id}`);
    const iconBox = document.getElementById(`icon-box-${id}`);
    if (!card || !pill || !iconBox) return;
    if (st.active) {
        card.classList.add('active-card');
        pill.textContent = 'ON';
        pill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-indigo-500/25 text-indigo-300 border border-indigo-400/50 transition shrink-0';
        iconBox.className = 'w-10 h-10 rounded-xl bg-indigo-600/25 flex items-center justify-center border border-indigo-400/40 transition shrink-0';
    } else {
        card.classList.remove('active-card');
        pill.textContent = 'OFF';
        pill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-slate-800/80 text-slate-400 border border-white/10 hover:text-white transition shrink-0';
        iconBox.className = 'w-10 h-10 rounded-xl bg-slate-800/90 group-hover:bg-slate-700/90 flex items-center justify-center border border-white/10 transition shrink-0';
    }
}

function renderActiveQuickDock() {
    const dock = document.getElementById('activeMixQuickDock');
    const container = document.getElementById('activeMixPillsContainer');
    const countLabel = document.getElementById('quickDockCount');
    if (!dock || !container) return;
    const activeIds = audioEngine.getActiveChannelIds();
    if (activeIds.length === 0) { dock.classList.add('hidden'); return; }
    dock.classList.remove('hidden');
    countLabel.textContent = `(${activeIds.length} playing)`;
    container.innerHTML = '';
    activeIds.forEach(id => {
        const ch = STUDIO_CHANNELS.find(c => c.id === id);
        const st = audioEngine.channelState[id];
        const pct = Math.round(st.volume * 100);
        const item = document.createElement('div');
        item.className = 'flex items-center gap-2.5 px-3 py-2 rounded-xl bg-studio-950/90 border border-indigo-500/30';
        item.innerHTML = `
            <i class="fa-solid ${ch.icon} ${ch.accentColor} text-xs shrink-0"></i>
            <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between text-[11px] mb-1">
                    <span class="font-medium text-white truncate">${ch.title}</span>
                    <span id="quick-vol-${id}" class="font-mono text-indigo-300 ml-1">${pct}%</span>
                </div>
                <input id="quick-slider-${id}" type="range" min="0" max="100" value="${pct}" class="studio-slider">
            </div>
            <button data-remove-channel="${id}" class="text-slate-400 hover:text-rose-400 text-xs p-1" title="Turn off channel"><i class="fa-solid fa-xmark"></i></button>
        `;
        container.appendChild(item);
        item.querySelector(`#quick-slider-${id}`).addEventListener('input', (e) => audioEngine.setChannelVolume(id, Number(e.target.value) / 100));
        item.querySelector(`[data-remove-channel="${id}"]`).addEventListener('click', () => audioEngine.toggleChannel(id, false));
    });
}

function applyCategoryAndSearchFilter() {
    const categories = ['rage', 'weather', 'nature', 'spaces', 'noise', 'music', 'brainwaves'];
    let totalVisible = 0;
    categories.forEach(cat => {
        const sectionEl = document.getElementById(`section-${cat}`);
        const cards = document.querySelectorAll(`#category-${cat} .channel-card`);
        let visibleInSection = 0;
        cards.forEach(card => {
            const id = card.dataset.channelId;
            const isActive = audioEngine.channelState[id]?.active;
            const matchesCategory = currentCategoryFilter === 'all' || (currentCategoryFilter === 'active' && isActive) || currentCategoryFilter === cat;
            const matchesSearch = !currentSearchQuery || card.dataset.searchText.includes(currentSearchQuery);
            if (matchesCategory && matchesSearch) {
                card.classList.remove('hidden');
                visibleInSection++;
                totalVisible++;
            } else {
                card.classList.add('hidden');
            }
        });
        if (sectionEl) {
            if (visibleInSection > 0) sectionEl.classList.remove('hidden');
            else sectionEl.classList.add('hidden');
        }
    });
    const emptyState = document.getElementById('emptyFilterState');
    if (emptyState) emptyState.classList.toggle('hidden', totalVisible > 0);
}

async function applyPresetMix(channelMap) {
    await audioEngine.ensureRunning();
    STUDIO_CHANNELS.forEach(ch => {
        const targetPct = channelMap[ch.id];
        if (typeof targetPct === 'number' && targetPct > 0) {
            if (ch.isRageTrack) audioEngine.lastActiveRageTrackId = ch.id;
            audioEngine.setChannelVolume(ch.id, targetPct / 100);
            if (!audioEngine.channelState[ch.id].active) {
                audioEngine.startChannelDSP(ch.id);
                audioEngine.channelState[ch.id].active = true;
            }
        } else if (audioEngine.channelState[ch.id].active) {
            audioEngine.stopChannelDSP(ch.id);
            audioEngine.channelState[ch.id].active = false;
        }
        updateChannelCardUI(ch.id);
    });
    const anyPlayingNow = audioEngine.getActiveChannelIds().length > 0 || Array.from(audioEngine.localTracks.values()).some(t => t.playing);
    audioEngine.syncBackgroundBridgePlayback(anyPlayingNow && audioEngine.isMasterPlaying);
    updateMasterSummaryUI();
    renderActiveQuickDock();
    applyCategoryAndSearchFilter();
    updateMediaSessionMetadataAndArtwork();
}

function updateEngineBadgeUI() {
    const dot = document.getElementById('engineStatusDot');
    const text = document.getElementById('engineStatusText');
    const playIcon = document.getElementById('masterPlayPauseIcon');
    const playText = document.getElementById('masterPlayPauseText');
    const notifPlayIcon = document.getElementById('notifPlayPauseIcon');
    const bgDot = document.getElementById('bgAudioStatusDot');
    const bgText = document.getElementById('bgAudioStatusText');
    const bgPill = document.getElementById('bgAudioStatusPill');
    const running = audioEngine.ctx && audioEngine.ctx.state === 'running' && audioEngine.isMasterPlaying;
    const activeCount = audioEngine.getActiveChannelIds().length + Array.from(audioEngine.localTracks.values()).filter(t => t.playing).length;
    if (running && activeCount > 0) {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse'; text.textContent = 'Live Studio';
        playIcon.className = 'fa-solid fa-pause'; playText.textContent = 'Pause Master Mix';
        if (notifPlayIcon) notifPlayIcon.className = 'fa-solid fa-pause text-xs';
        if (bgDot) bgDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        if (bgText) bgText.textContent = 'Lock-Screen & Notification Bar Active';
        if (bgPill) bgPill.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/90 text-emerald-300 border border-emerald-500/40';
    } else if (activeCount > 0) {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400'; text.textContent = 'Paused';
        playIcon.className = 'fa-solid fa-play'; playText.textContent = 'Resume Mix';
        if (notifPlayIcon) notifPlayIcon.className = 'fa-solid fa-play text-xs';
        if (bgDot) bgDot.className = 'w-2 h-2 rounded-full bg-amber-400';
        if (bgText) bgText.textContent = 'Notification Bar Paused (Tap Play on Lock Screen)';
        if (bgPill) bgPill.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/90 text-amber-300 border border-amber-500/40';
    } else {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400'; text.textContent = 'Standby';
        playIcon.className = 'fa-solid fa-play'; playText.textContent = 'Play Master Mix';
        if (notifPlayIcon) notifPlayIcon.className = 'fa-solid fa-play text-xs';
        if (bgDot) bgDot.className = 'w-2 h-2 rounded-full bg-slate-400';
        if (bgText) bgText.textContent = 'Play Any Sound to Activate Notification Bar';
        if (bgPill) bgPill.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800/90 text-slate-300 border border-white/10';
    }
}

function updateMasterSummaryUI() {
    const activeIds = audioEngine.getActiveChannelIds();
    const badge = document.getElementById('activeChannelsCountBadge');
    const summary = document.getElementById('activeMixSummaryText');
    const localPlaying = Array.from(audioEngine.localTracks.values()).filter(t => t.playing);
    const totalActive = activeIds.length + localPlaying.length;
    const anyRageActive = activeIds.some(id => STUDIO_CHANNELS.find(c => c.id === id)?.isRageTrack);
    document.body.classList.toggle('rage-theme-active', anyRageActive);
    if (badge) badge.textContent = `${totalActive} Active`;
    if (totalActive === 0) {
        summary.textContent = 'No channels active — Choose a preset or toggle any sound card';
    } else {
        const names = activeIds.map(id => {
            const ch = STUDIO_CHANNELS.find(c => c.id === id);
            const pct = Math.round(audioEngine.channelState[id].volume * 100);
            return `${ch.title} (${pct}%)`;
        });
        localPlaying.forEach(tr => names.push(tr.name));
        summary.textContent = names.join(' • ');
    }
    updateEngineBadgeUI();
}

/***********************************************************************
 * 4. SAVED MIXES
 ***********************************************************************/
const SAVED_MIXES_KEY = 'focusflow_saved_mixes_v2';
function loadSavedMixesFromStorage() {
    try {
        const raw = localStorage.getItem(SAVED_MIXES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}
function saveMixesToStorage(list) {
    try { localStorage.setItem(SAVED_MIXES_KEY, JSON.stringify(list)); } catch (e) {}
}
function renderSavedMixesUI() {
    const list = loadSavedMixesFromStorage();
    const area = document.getElementById('userSavedMixesArea');
    const container = document.getElementById('userSavedMixesList');
    if (!area || !container) return;
    if (list.length === 0) { area.classList.add('hidden'); return; }
    area.classList.remove('hidden');
    container.innerHTML = '';
    list.forEach((mix, idx) => {
        const pill = document.createElement('div');
        pill.className = 'inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-xl bg-indigo-950/70 border border-indigo-500/30 text-xs text-indigo-200';
        pill.innerHTML = `
            <button class="font-medium hover:text-white transition" data-load-idx="${idx}">
                <i class="fa-solid fa-play text-[10px] text-indigo-400 mr-1"></i>${mix.name}
            </button>
            <button class="text-slate-400 hover:text-rose-400 px-1" data-del-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>
        `;
        pill.querySelector(`[data-load-idx="${idx}"]`).addEventListener('click', () => {
            applyPresetMix(mix.channels);
            showToast(`Loaded custom mix "${mix.name}"`);
        });
        pill.querySelector(`[data-del-idx="${idx}"]`).addEventListener('click', () => {
            const updated = loadSavedMixesFromStorage().filter((_, i) => i !== idx);
            saveMixesToStorage(updated);
            renderSavedMixesUI();
            showToast('Deleted custom mix');
        });
        container.appendChild(pill);
    });
}

/***********************************************************************
 * 5. TIMER
 ***********************************************************************/
const timerState = {
    focusMinutes: 50, breakMinutes: 10, isBreak: false, isRunning: false,
    remainingSeconds: 50 * 60, totalPhaseSeconds: 50 * 60, intervalId: null,
    completedToday: Number(localStorage.getItem('focusflow_sessions_today') || 0)
};

function updateTimerDisplayUI() {
    const min = Math.floor(timerState.remainingSeconds / 60);
    const sec = timerState.remainingSeconds % 60;
    const formatted = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = formatted;
    const circle = document.getElementById('timerProgressCircle');
    const circumference = 427.25;
    const progress = 1 - (timerState.remainingSeconds / Math.max(1, timerState.totalPhaseSeconds));
    circle.style.strokeDashoffset = String(circumference * progress);
    const badge = document.getElementById('timerPhaseBadge');
    const sub = document.getElementById('timerSubStatus');
    if (timerState.isBreak) {
        badge.textContent = 'Rest & Recharge';
        badge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        sub.textContent = timerState.isRunning ? 'Break in progress...' : 'Break Paused';
    } else {
        badge.textContent = 'Focus Session';
        badge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
        sub.textContent = timerState.isRunning ? 'Deep Focus Active' : 'Ready to Focus';
    }
    document.getElementById('customFocusMinLabel').textContent = timerState.focusMinutes;
    document.getElementById('customBreakMinLabel').textContent = timerState.breakMinutes;
    document.getElementById('completedSessionsCount').textContent = `${timerState.completedToday} Sessions`;
}

function startPauseTimer() {
    const icon = document.getElementById('timerStartPauseIcon');
    const text = document.getElementById('timerStartPauseText');
    if (timerState.isRunning) {
        bgClock.clear(timerState.intervalId);
        timerState.isRunning = false;
        icon.className = 'fa-solid fa-play';
        text.textContent = 'Resume';
    } else {
        timerState.isRunning = true;
        icon.className = 'fa-solid fa-pause';
        text.textContent = 'Pause';
        timerState.intervalId = bgClock.setInterval(() => {
            if (timerState.remainingSeconds > 0) {
                timerState.remainingSeconds--;
                updateTimerDisplayUI();
                updateMediaSessionPositionState();
            } else {
                handleTimerPhaseComplete();
            }
        }, 1000);
    }
    updateTimerDisplayUI();
    updateMediaSessionPositionState();
}

function handleTimerPhaseComplete() {
    bgClock.clear(timerState.intervalId);
    timerState.isRunning = false;
    if (document.getElementById('timerChimeCheckbox').checked) audioEngine.playCompletionChime();
    if (!timerState.isBreak) {
        timerState.completedToday++;
        try { localStorage.setItem('focusflow_sessions_today', String(timerState.completedToday)); } catch (e) {}
        showToast('Focus block complete! Time for a restorative break.');
        if (document.getElementById('autoPauseBreakCheckbox').checked && audioEngine.ctx && audioEngine.masterGain) {
            audioEngine.masterGain.gain.setTargetAtTime(0.05, audioEngine.ctx.currentTime, 1.5);
        }
        timerState.isBreak = true;
        timerState.totalPhaseSeconds = timerState.breakMinutes * 60;
        timerState.remainingSeconds = timerState.totalPhaseSeconds;
    } else {
        showToast('Break finished! Ready for your next focus session.');
        if (audioEngine.ctx && audioEngine.masterGain && !audioEngine.isMuted) {
            audioEngine.masterGain.gain.setTargetAtTime(audioEngine.masterVolume, audioEngine.ctx.currentTime, 0.8);
        }
        timerState.isBreak = false;
        timerState.totalPhaseSeconds = timerState.focusMinutes * 60;
        timerState.remainingSeconds = timerState.totalPhaseSeconds;
    }
    document.getElementById('timerStartPauseIcon').className = 'fa-solid fa-play';
    document.getElementById('timerStartPauseText').textContent = timerState.isBreak ? 'Start Break' : 'Start Focus';
    updateTimerDisplayUI();
}

function resetTimer() {
    bgClock.clear(timerState.intervalId);
    timerState.isRunning = false;
    timerState.totalPhaseSeconds = (timerState.isBreak ? timerState.breakMinutes : timerState.focusMinutes) * 60;
    timerState.remainingSeconds = timerState.totalPhaseSeconds;
    document.getElementById('timerStartPauseIcon').className = 'fa-solid fa-play';
    document.getElementById('timerStartPauseText').textContent = timerState.isBreak ? 'Start Break' : 'Start Focus';
    updateTimerDisplayUI();
    updateMediaSessionPositionState();
}

/***********************************************************************
 * 5B. MEDIA SESSION
 ***********************************************************************/
let notificationSkipMode = 'rage';
let currentPresetCycleIndex = 0;
let currentHybridCycleIndex = 0;
let wakeLockSentinel = null;
const artworkCanvas = document.createElement('canvas');
artworkCanvas.width = 512;
artworkCanvas.height = 512;

function generateNotificationArtworkDataUrl(title, subtitle, isRage, badgeText) {
    const ctx = artworkCanvas.getContext('2d');
    if (!ctx) return '';
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    if (isRage) {
        grad.addColorStop(0, '#2e0824'); grad.addColorStop(0.5, '#590d32'); grad.addColorStop(1, '#0f1026');
    } else {
        grad.addColorStop(0, '#0c1438'); grad.addColorStop(0.5, '#192252'); grad.addColorStop(1, '#062c3d');
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 512);
    ctx.save();
    ctx.strokeStyle = isRage ? 'rgba(244, 63, 94, 0.32)' : 'rgba(99, 102, 241, 0.32)';
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(256, 200, 118, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = isRage ? 'rgba(168, 85, 247, 0.25)' : 'rgba(6, 182, 212, 0.25)';
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(256, 200, 148, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = isRage ? 'rgba(244, 63, 94, 0.22)' : 'rgba(99, 102, 241, 0.22)';
    ctx.beginPath(); ctx.arc(256, 200, 82, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 74px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.fillText(isRage ? '🔥' : '🎧', 256, 202);
    ctx.fillStyle = isRage ? 'rgba(244, 63, 94, 0.85)' : 'rgba(79, 70, 229, 0.85)';
    ctx.beginPath(); ctx.roundRect(116, 36, 280, 40, 20); ctx.fill();
    ctx.font = 'bold 19px "JetBrains Mono", monospace'; ctx.fillStyle = '#ffffff';
    ctx.fillText((badgeText || 'FOCUSFLOW STUDIO').toUpperCase(), 256, 57);
    ctx.font = 'bold 31px Inter, sans-serif'; ctx.fillStyle = '#ffffff';
    const cleanTitle = title.length > 26 ? title.slice(0, 25) + '…' : title;
    ctx.fillText(cleanTitle, 256, 355);
    ctx.font = '500 21px Inter, sans-serif'; ctx.fillStyle = isRage ? '#fda4af' : '#93c5fd';
    const cleanSub = subtitle.length > 36 ? subtitle.slice(0, 35) + '…' : subtitle;
    ctx.fillText(cleanSub, 256, 398);
    ctx.font = '600 17px "JetBrains Mono", monospace'; ctx.fillStyle = '#94a3b8';
    ctx.fillText('FOCUSFLOW STUDIO PRO • NO WORDS', 256, 462);
    try { return artworkCanvas.toDataURL('image/png'); } catch (e) { return ''; }
}

function updateMediaSessionMetadataAndArtwork() {
    const activeIds = audioEngine.getActiveChannelIds();
    const activeRageTracks = activeIds.map(id => STUDIO_CHANNELS.find(c => c.id === id)).filter(ch => ch && ch.isRageTrack);
    const activeAmbientChannels = activeIds.map(id => STUDIO_CHANNELS.find(c => c.id === id)).filter(ch => ch && !ch.isRageTrack);
    const vibeLabels = { slowed: 'Slowed + Reverb', normal: '1.0x Normal', nightcore: 'Nightcore 1.22x' };
    const vibeTag = vibeLabels[audioEngine.rageVibe] || '1.0x Normal';
    let title = 'FocusFlow Studio Ready';
    let artist = 'Tap Play to start soundscape';
    let badgeText = 'STANDBY';
    let isRage = false;
    if (activeRageTracks.length > 0) {
        isRage = true;
        const primaryRage = activeRageTracks[0];
        title = primaryRage.title.replace(' (Instrumental)', '');
        const ambientNames = activeAmbientChannels.map(c => c.title).join(' + ');
        artist = ambientNames ? `${vibeTag} • + ${ambientNames}` : `${vibeTag} • ${primaryRage.bpm} BPM (${primaryRage.keySignature})`;
        badgeText = `🔥 RAGE • ${vibeTag}`;
    } else if (activeAmbientChannels.length > 0) {
        const names = activeAmbientChannels.map(c => c.title);
        title = audioEngine.lastPresetName || (names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`);
        artist = names.join(' • ');
        badgeText = `${activeAmbientChannels.length} CHANNELS ACTIVE`;
    }
    const previewTitle = document.getElementById('notifPreviewTitle');
    const previewArtist = document.getElementById('notifPreviewArtist');
    const previewVibe = document.getElementById('notifPreviewVibeBadge');
    const previewImg = document.getElementById('notificationArtworkPreview');
    if (previewTitle) previewTitle.textContent = title;
    if (previewArtist) previewArtist.textContent = artist;
    if (previewVibe) previewVibe.textContent = badgeText;
    const artworkUrl = generateNotificationArtworkDataUrl(title, artist, isRage, badgeText);
    if (previewImg && artworkUrl) previewImg.src = artworkUrl;
    if ('mediaSession' in navigator) {
        try {
            const min = Math.floor(timerState.remainingSeconds / 60);
            const sec = timerState.remainingSeconds % 60;
            const timerFormatted = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title, artist: artist, album: `FocusFlow Studio • Timer ${timerFormatted}`,
                artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/png' }] : []
            });
            const isPlayingNow = audioEngine.ctx && audioEngine.ctx.state === 'running' && audioEngine.isMasterPlaying && activeIds.length > 0;
            navigator.mediaSession.playbackState = isPlayingNow ? 'playing' : 'paused';
        } catch (e) {}
    }
    updateMediaSessionPositionState();
}

function updateMediaSessionPositionState() {
    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function') {
        try {
            const duration = Math.max(1, timerState.totalPhaseSeconds);
            const elapsed = Math.max(0, Math.min(duration, duration - timerState.remainingSeconds));
            navigator.mediaSession.setPositionState({ duration, playbackRate: 1.0, position: elapsed });
        } catch (e) {}
    }
}

async function skipNotificationTrack(direction = 1) {
    await audioEngine.ensureRunning();
    const rageChannels = STUDIO_CHANNELS.filter(c => c.isRageTrack);
    if (notificationSkipMode === 'rage') {
        let currentIdx = rageChannels.findIndex(c => audioEngine.channelState[c.id].active);
        if (currentIdx === -1) currentIdx = rageChannels.findIndex(c => c.id === audioEngine.lastActiveRageTrackId);
        if (currentIdx === -1) currentIdx = 0;
        const nextIdx = (currentIdx + direction + rageChannels.length) % rageChannels.length;
        const nextRage = rageChannels[nextIdx];
        rageChannels.forEach(rc => {
            if (rc.id !== nextRage.id && audioEngine.channelState[rc.id].active) {
                audioEngine.stopChannelDSP(rc.id);
                audioEngine.channelState[rc.id].active = false;
                updateChannelCardUI(rc.id);
            }
        });
        audioEngine.lastActiveRageTrackId = nextRage.id;
        if (!audioEngine.channelState[nextRage.id].active) {
            audioEngine.startChannelDSP(nextRage.id);
            audioEngine.channelState[nextRage.id].active = true;
        }
        updateChannelCardUI(nextRage.id);
        audioEngine.syncBackgroundBridgePlayback(true);
        updateMasterSummaryUI();
        renderActiveQuickDock();
        updateMediaSessionMetadataAndArtwork();
        showToast(`⏭ Track: ${nextRage.title}`);
    } else if (notificationSkipMode === 'hybrid') {
        const hybridKeys = Object.keys(RAGE_HYBRID_PRESETS);
        currentHybridCycleIndex = (currentHybridCycleIndex + direction + hybridKeys.length) % hybridKeys.length;
        const preset = RAGE_HYBRID_PRESETS[hybridKeys[currentHybridCycleIndex]];
        if (preset.vibe) setRageVibeUI(preset.vibe);
        audioEngine.lastPresetName = preset.name;
        await applyPresetMix(preset.channels);
        showToast(`⏭ Hybrid Mix: ${preset.name}`);
    } else {
        const presetKeys = Object.keys(CURATED_PRESETS);
        currentPresetCycleIndex = (currentPresetCycleIndex + direction + presetKeys.length) % presetKeys.length;
        const preset = CURATED_PRESETS[presetKeys[currentPresetCycleIndex]];
        audioEngine.lastPresetName = preset.name;
        await applyPresetMix(preset.channels);
        showToast(`⏭ Mix: ${preset.name}`);
    }
}

function registerMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const safeSetHandler = (action, handler) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
    };
    safeSetHandler('play', async () => {
        await audioEngine.ensureRunning();
        if (audioEngine.getActiveChannelIds().length === 0 && audioEngine.localTracks.size === 0) {
            await audioEngine.toggleChannel(audioEngine.lastActiveRageTrackId || 'rage-gangsta', true);
        }
        audioEngine.syncBackgroundBridgePlayback(true);
        updateEngineBadgeUI();
        updateMasterSummaryUI();
        updateMediaSessionMetadataAndArtwork();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });
    safeSetHandler('pause', async () => {
        if (audioEngine.ctx && audioEngine.ctx.state === 'running') await audioEngine.ctx.suspend();
        audioEngine.isMasterPlaying = false;
        audioEngine.syncBackgroundBridgePlayback(false);
        updateEngineBadgeUI();
        updateMasterSummaryUI();
        updateMediaSessionMetadataAndArtwork();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });
    safeSetHandler('stop', () => audioEngine.silenceAll());
    safeSetHandler('previoustrack', () => skipNotificationTrack(-1));
    safeSetHandler('nexttrack', () => skipNotificationTrack(1));
    safeSetHandler('seekbackward', () => {
        const order = ['slowed', 'normal', 'nightcore'];
        const idx = order.indexOf(audioEngine.rageVibe);
        const nextVibe = order[(idx - 1 + order.length) % order.length];
        setRageVibeUI(nextVibe);
        showToast(`Vibe: ${nextVibe.toUpperCase()}`);
    });
    safeSetHandler('seekforward', () => {
        const order = ['slowed', 'normal', 'nightcore'];
        const idx = order.indexOf(audioEngine.rageVibe);
        const nextVibe = order[(idx + 1) % order.length];
        setRageVibeUI(nextVibe);
        showToast(`Vibe: ${nextVibe.toUpperCase()}`);
    });
}

/***********************************************************************
 * 6. LOCAL AUDIO DECK
 ***********************************************************************/
async function handleLocalFilesUpload(fileList) {
    if (!fileList || fileList.length === 0) return;
    await audioEngine.ensureRunning();
    Array.from(fileList).forEach(file => {
        if (!file.type.startsWith('audio/')) return;
        const id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        const url = URL.createObjectURL(file);
        const audioEl = new Audio(url);
        audioEl.loop = true;
        audioEl.crossOrigin = 'anonymous';
        const mediaSource = audioEngine.ctx.createMediaElementSource(audioEl);
        const gainNode = audioEngine.ctx.createGain();
        gainNode.gain.value = 0.75;
        mediaSource.connect(gainNode);
        gainNode.connect(audioEngine.masterGain);
        audioEl.play().catch(() => {});
        audioEngine.localTracks.set(id, {
            id, name: file.name.replace(/\.[^/.]+$/, ''), audioEl, gainNode,
            volume: 0.75, playing: true, loop: true
        });
    });
    renderLocalTracksUI();
    updateMasterSummaryUI();
    showToast('Added local audio track to mixer');
}

function renderLocalTracksUI() {
    const container = document.getElementById('localTracksContainer');
    const countLabel = document.getElementById('localTracksCountLabel');
    if (!container || !countLabel) return;
    countLabel.textContent = `${audioEngine.localTracks.size} Tracks`;
    container.innerHTML = '';
    audioEngine.localTracks.forEach(tr => {
        const pct = Math.round(tr.volume * 100);
        const row = document.createElement('div');
        row.className = 'p-3 rounded-xl bg-studio-950/90 border border-white/10 space-y-2';
        row.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <button data-toggle-local="${tr.id}" class="w-7 h-7 rounded-lg ${tr.playing ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'} flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid ${tr.playing ? 'fa-pause' : 'fa-play'}"></i>
                    </button>
                    <span class="text-xs font-medium text-white truncate">${tr.name}</span>
                </div>
                <button data-remove-local="${tr.id}" class="text-slate-500 hover:text-rose-400 text-xs px-1.5"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="flex items-center gap-2">
                <input data-vol-local="${tr.id}" type="range" min="0" max="100" value="${pct}" class="studio-slider">
                <span class="text-[11px] font-mono text-slate-300 w-9 text-right">${pct}%</span>
            </div>
        `;
        row.querySelector(`[data-toggle-local="${tr.id}"]`).addEventListener('click', async () => {
            await audioEngine.ensureRunning();
            if (tr.playing) { tr.audioEl.pause(); tr.playing = false; }
            else { tr.audioEl.play().catch(() => {}); tr.playing = true; }
            renderLocalTracksUI(); updateMasterSummaryUI();
        });
        row.querySelector(`[data-vol-local="${tr.id}"]`).addEventListener('input', (e) => {
            const v = Number(e.target.value) / 100;
            tr.volume = v;
            tr.gainNode.gain.setTargetAtTime(v, audioEngine.ctx.currentTime, 0.05);
            row.querySelector('span.w-9').textContent = `${Math.round(v * 100)}%`;
        });
        row.querySelector(`[data-remove-local="${tr.id}"]`).addEventListener('click', () => {
            tr.audioEl.pause();
            try { tr.gainNode.disconnect(); } catch (e) {}
            audioEngine.localTracks.delete(tr.id);
            renderLocalTracksUI(); updateMasterSummaryUI();
        });
        container.appendChild(row);
    });
}

/***********************************************************************
 * 7. VISUALIZER
 ***********************************************************************/
let visualizerMode = 'hybrid';
function initVisualizer() {
    const canvas = document.getElementById('visualizerCanvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const resizeCanvas = () => {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx2d.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    const freqData = new Uint8Array(256);
    const timeData = new Uint8Array(256);
    function renderFrame() {
        requestAnimationFrame(renderFrame);
        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;
        ctx2d.clearRect(0, 0, width, height);
        if (!audioEngine.analyser || !audioEngine.isMasterPlaying) {
            ctx2d.strokeStyle = 'rgba(99, 102, 241, 0.2)';
            ctx2d.lineWidth = 1;
            ctx2d.beginPath();
            ctx2d.moveTo(0, height / 2);
            ctx2d.lineTo(width, height / 2);
            ctx2d.stroke();
            return;
        }
        audioEngine.analyser.getByteFrequencyData(freqData);
        audioEngine.analyser.getByteTimeDomainData(timeData);
        const isRageActive = document.body.classList.contains('rage-theme-active');
        if (visualizerMode === 'bars' || visualizerMode === 'hybrid') {
            const barCount = 48;
            const barWidth = (width / barCount) - 2;
            for (let i = 0; i < barCount; i++) {
                const val = freqData[i * 2] / 255;
                const barHeight = Math.max(2, val * (height * 0.82));
                const x = i * (barWidth + 2);
                const y = height - barHeight;
                const grad = ctx2d.createLinearGradient(0, height, 0, 0);
                if (isRageActive) {
                    grad.addColorStop(0, 'rgba(244, 63, 94, 0.75)');
                    grad.addColorStop(1, 'rgba(168, 85, 247, 0.95)');
                } else {
                    grad.addColorStop(0, 'rgba(99, 102, 241, 0.65)');
                    grad.addColorStop(1, 'rgba(6, 182, 212, 0.85)');
                }
                ctx2d.fillStyle = grad;
                ctx2d.fillRect(x, y, barWidth, barHeight);
            }
        }
        if (visualizerMode === 'wave' || visualizerMode === 'hybrid') {
            ctx2d.lineWidth = 1.8;
            ctx2d.strokeStyle = isRageActive ? 'rgba(251, 113, 133, 0.95)' : (visualizerMode === 'hybrid' ? 'rgba(167, 139, 250, 0.85)' : '#38bdf8');
            ctx2d.beginPath();
            const slice = width / timeData.length;
            let x = 0;
            for (let i = 0; i < timeData.length; i++) {
                const v = timeData[i] / 128.0;
                const y = (v * height) / 2;
                if (i === 0) ctx2d.moveTo(x, y);
                else ctx2d.lineTo(x, y);
                x += slice;
            }
            ctx2d.stroke();
        }
    }
    renderFrame();
}

/***********************************************************************
 * 8. TOASTS & EVENT BINDINGS
 ***********************************************************************/
function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'px-4 py-2.5 rounded-xl bg-studio-900/95 border border-indigo-500/40 text-xs font-medium text-white shadow-xl flex items-center gap-2 transition-all duration-300';
    toast.innerHTML = `<i class="fa-solid fa-circle-check text-indigo-400"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2600);
}

window.addEventListener('DOMContentLoaded', () => {
    renderCuratedPresets();
    renderRageHybridPresets();
    renderChannelCards();
    renderSavedMixesUI();
    updateTimerDisplayUI();
    initVisualizer();
    registerMediaSessionHandlers();
    updateMediaSessionMetadataAndArtwork();

    document.getElementById('notifPrevBtn')?.addEventListener('click', () => skipNotificationTrack(-1));
    document.getElementById('notifNextBtn')?.addEventListener('click', () => skipNotificationTrack(1));
    document.getElementById('notifPlayPauseBtn')?.addEventListener('click', () => audioEngine.toggleMasterPlayPause());

    const skipModeSelect = document.getElementById('notifSkipModeSelect');
    skipModeSelect?.addEventListener('change', (e) => {
        notificationSkipMode = e.target.value;
        const modeLabels = {
            rage: '🔥 Lock-Screen ⏮/⏭ now switches Rage Mode Instrumentals',
            presets: '✨ Lock-Screen ⏮/⏭ now switches Curated Soundscape Mixes',
            hybrid: '⚡ Lock-Screen ⏮/⏭ now switches Rage + Weather Hybrid Mixes'
        };
        showToast(modeLabels[notificationSkipMode]);
    });

    document.getElementById('pocketAudioLockBtn')?.addEventListener('click', () => {
        audioEngine.screenOffPersistenceEnabled = !audioEngine.screenOffPersistenceEnabled;
        const stateEl = document.getElementById('pocketAudioLockState');
        const btnEl = document.getElementById('pocketAudioLockBtn');
        const iconEl = document.getElementById('pocketAudioLockIcon');
        if (audioEngine.screenOffPersistenceEnabled) {
            stateEl.textContent = 'ON';
            btnEl.className = 'flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 transition flex items-center justify-center gap-1.5';
            iconEl.className = 'fa-solid fa-lock text-emerald-400';
            const anyPlaying = audioEngine.getActiveChannelIds().length > 0;
            audioEngine.syncBackgroundBridgePlayback(anyPlaying && audioEngine.isMasterPlaying);
            showToast('Screen-Off Background Audio Lock: ON');
        } else {
            stateEl.textContent = 'OFF';
            btnEl.className = 'flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 text-slate-400 border border-white/10 transition flex items-center justify-center gap-1.5';
            iconEl.className = 'fa-solid fa-lock-open text-slate-400';
            audioEngine.syncBackgroundBridgePlayback(false);
            showToast('Screen-Off Background Audio Lock: OFF');
        }
    });

    document.getElementById('wakeLockToggleBtn')?.addEventListener('click', async () => {
        const stateText = document.getElementById('wakeLockStateText');
        const btnEl = document.getElementById('wakeLockToggleBtn');
        if (!('wakeLock' in navigator)) { showToast('Screen WakeLock is not supported on this browser'); return; }
        try {
            if (wakeLockSentinel) {
                await wakeLockSentinel.release();
                wakeLockSentinel = null;
                stateText.textContent = 'OFF';
                btnEl.className = 'px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 transition flex items-center justify-center gap-1.5';
                showToast('Keep Screen Awake: OFF');
            } else {
                wakeLockSentinel = await navigator.wakeLock.request('screen');
                stateText.textContent = 'ON';
                btnEl.className = 'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 transition flex items-center justify-center gap-1.5';
                showToast('Keep Screen Awake: ON (Desk Mode)');
            }
        } catch (err) { showToast('Could not activate WakeLock'); }
    });

    document.addEventListener('visibilitychange', () => {
        const ae = audioEngine;
        if (!ae.bgAudioEl) return;
        if (document.hidden) {
            if (ae.monitorGain && ae.ctx) {
                try { ae.monitorGain.gain.setTargetAtTime(0, ae.ctx.currentTime, 0.05); } catch (e) {}
            }
            ae.bgAudioEl.muted = false;
            if (ae.isMasterPlaying && ae.screenOffPersistenceEnabled) {
                if (ae.ctx && ae.ctx.state === 'suspended') ae.ctx.resume().catch(() => {});
                ae.syncBackgroundBridgePlayback(true);
            }
        } else {
            if (ae.monitorGain && ae.ctx) {
                try { ae.monitorGain.gain.setTargetAtTime(1, ae.ctx.currentTime, 0.05); } catch (e) {}
            }
            ae.bgAudioEl.muted = true;
            if (ae.ctx && ae.ctx.state === 'suspended') ae.ctx.resume().catch(() => {});
        }
    });

    document.querySelectorAll('.rage-vibe-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const vibe = btn.dataset.rageVibe;
            setRageVibeUI(vibe);
            const labels = {
                slowed: '🌊 Slowed + Reverb (0.82x, -3 Semitones)',
                normal: '⚡ Normal Speed & Pitch (1.0x)',
                nightcore: '🔥 Nightcore Overdrive (1.22x, +2 Semitones)'
            };
            showToast(`Rage Mode Vibe: ${labels[vibe]}`);
        });
    });

    document.getElementById('rageDrumsToggleBtn')?.addEventListener('click', () => {
        const drumsOn = audioEngine.toggleRageDrums();
        const textEl = document.getElementById('rageDrumsToggleText');
        const btnEl = document.getElementById('rageDrumsToggleBtn');
        if (drumsOn) {
            textEl.textContent = 'Drums: ON';
            btnEl.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition flex items-center gap-1.5';
            showToast('Rage Percussion: Full Beat ON');
        } else {
            textEl.textContent = 'Melodic Only';
            btnEl.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition flex items-center gap-1.5';
            showToast('Melodic / Choir Only Mode (Drums Muted for Reading)');
        }
    });

    const rageBassSlider = document.getElementById('rageBassBoostSlider');
    const rageBassLabel = document.getElementById('rageBassBoostLabel');
    rageBassSlider?.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        rageBassLabel.textContent = `${val}%`;
        audioEngine.setRageBassBoost(val / 100);
    });

    document.getElementById('jumpToRageCategoryBtn')?.addEventListener('click', () => {
        document.getElementById('section-rage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.querySelectorAll('#categoryFilterTabs .cat-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategoryFilter = btn.dataset.catFilter;
            document.querySelectorAll('#categoryFilterTabs .cat-tab-btn').forEach(b => {
                b.className = 'cat-tab-btn shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium bg-studio-900/90 text-slate-300 hover:text-white border border-white/5 transition';
            });
            btn.className = 'cat-tab-btn shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white shadow transition';
            applyCategoryAndSearchFilter();
        });
    });

    const searchInput = document.getElementById('channelSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    searchInput.addEventListener('input', (e) => {
        currentSearchQuery = e.target.value.trim().toLowerCase();
        clearSearchBtn.classList.toggle('hidden', !currentSearchQuery);
        applyCategoryAndSearchFilter();
    });
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentSearchQuery = '';
        clearSearchBtn.classList.add('hidden');
        applyCategoryAndSearchFilter();
    });

    document.getElementById('organicDriftBtn').addEventListener('click', () => {
        const enabled = audioEngine.toggleOrganicDrift();
        const statusEl = document.getElementById('organicDriftStatus');
        statusEl.textContent = enabled ? 'ON' : 'OFF';
        statusEl.className = enabled ? 'text-emerald-400' : 'text-slate-400';
        showToast(enabled ? 'Organic Volume Drift enabled (±12% breathing)' : 'Organic Volume Drift disabled');
    });

    document.getElementById('randomMixBtn').addEventListener('click', async () => {
        const weatherPool = ['gentle-rain', 'heavy-rain', 'rain-window', 'ocean-waves', 'babbling-brook', 'underwater-abyss'];
        const spaceNaturePool = ['forest-wind', 'cozy-fireplace', 'night-crickets', 'coffee-shop', 'quiet-library', 'night-train', 'vinyl-crackle'];
        const musicNoisePool = ['lofi-chords', 'felt-piano', 'ambient-drone', 'singing-bowls', 'synth-arp', 'brown-noise', 'green-noise'];
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        const randomMix = {
            [pick(weatherPool)]: 45 + Math.floor(Math.random() * 25),
            [pick(spaceNaturePool)]: 35 + Math.floor(Math.random() * 25),
            [pick(musicNoisePool)]: 40 + Math.floor(Math.random() * 25)
        };
        await applyPresetMix(randomMix);
        showToast('Generated harmonious study soundscape');
    });

    const saveFormBar = document.getElementById('saveMixFormBar');
    const mixNameInput = document.getElementById('customMixNameInput');
    document.getElementById('openSaveMixModalBtn').addEventListener('click', () => {
        if (audioEngine.getActiveChannelIds().length === 0) {
            showToast('Activate at least one sound channel first');
            return;
        }
        saveFormBar.classList.remove('hidden');
        mixNameInput.focus();
    });
    document.getElementById('cancelSaveMixBtn').addEventListener('click', () => {
        saveFormBar.classList.add('hidden');
        mixNameInput.value = '';
    });
    document.getElementById('confirmSaveMixBtn').addEventListener('click', () => {
        const name = mixNameInput.value.trim() || `Studio Mix #${loadSavedMixesFromStorage().length + 1}`;
        const channels = {};
        audioEngine.getActiveChannelIds().forEach(id => {
            channels[id] = Math.round(audioEngine.channelState[id].volume * 100);
        });
        const existing = loadSavedMixesFromStorage();
        existing.push({ name, channels });
        saveMixesToStorage(existing);
        renderSavedMixesUI();
        saveFormBar.classList.add('hidden');
        mixNameInput.value = '';
        showToast(`Saved "${name}"`);
    });

    document.getElementById('vizModeBtn').addEventListener('click', () => {
        const modes = ['hybrid', 'bars', 'wave'];
        const nextIdx = (modes.indexOf(visualizerMode) + 1) % modes.length;
        visualizerMode = modes[nextIdx];
        document.getElementById('vizModeLabel').textContent = visualizerMode.charAt(0).toUpperCase() + visualizerMode.slice(1);
    });

    document.getElementById('masterPlayPauseBtn').addEventListener('click', () => audioEngine.toggleMasterPlayPause());
    document.getElementById('silenceAllBtn').addEventListener('click', () => { audioEngine.silenceAll(); showToast('All channels silenced'); });
    document.getElementById('quickDockSilenceBtn').addEventListener('click', () => { audioEngine.silenceAll(); showToast('All channels silenced'); });

    const masterSlider = document.getElementById('masterVolumeSlider');
    const masterValLabel = document.getElementById('masterVolumeValue');
    masterSlider.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        masterValLabel.textContent = `${val}%`;
        audioEngine.setMasterVolume(val / 100);
    });

    document.getElementById('masterMuteBtn').addEventListener('click', () => {
        const muted = audioEngine.toggleMasterMute();
        const icon = document.getElementById('masterVolumeIcon');
        icon.className = muted ? 'fa-solid fa-volume-xmark text-rose-400' : 'fa-solid fa-volume-high';
        showToast(muted ? 'Master output muted' : 'Master output unmuted');
    });

    document.querySelectorAll('.timer-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.timer-mode-btn').forEach(b => {
                b.className = 'timer-mode-btn py-1.5 px-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition';
            });
            btn.className = 'timer-mode-btn py-1.5 px-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow transition';
            timerState.focusMinutes = Number(btn.dataset.focus);
            timerState.breakMinutes = Number(btn.dataset.break);
            timerState.isBreak = false;
            resetTimer();
        });
    });

    document.getElementById('focusMinDec').addEventListener('click', () => {
        timerState.focusMinutes = Math.max(5, timerState.focusMinutes - 5);
        if (!timerState.isBreak && !timerState.isRunning) resetTimer(); else updateTimerDisplayUI();
    });
    document.getElementById('focusMinInc').addEventListener('click', () => {
        timerState.focusMinutes = Math.min(180, timerState.focusMinutes + 5);
        if (!timerState.isBreak && !timerState.isRunning) resetTimer(); else updateTimerDisplayUI();
    });
    document.getElementById('breakMinDec').addEventListener('click', () => {
        timerState.breakMinutes = Math.max(1, timerState.breakMinutes - 1);
        if (timerState.isBreak && !timerState.isRunning) resetTimer(); else updateTimerDisplayUI();
    });
    document.getElementById('breakMinInc').addEventListener('click', () => {
        timerState.breakMinutes = Math.min(60, timerState.breakMinutes + 1);
        if (timerState.isBreak && !timerState.isRunning) resetTimer(); else updateTimerDisplayUI();
    });

    document.getElementById('timerStartPauseBtn').addEventListener('click', startPauseTimer);
    document.getElementById('timerResetBtn').addEventListener('click', resetTimer);
    document.getElementById('timerSkipBtn').addEventListener('click', handleTimerPhaseComplete);
    document.getElementById('testChimeBtn').addEventListener('click', () => audioEngine.playCompletionChime());
    document.getElementById('resetSessionsCountBtn').addEventListener('click', () => {
        timerState.completedToday = 0;
        try { localStorage.setItem('focusflow_sessions_today', '0'); } catch (e) {}
        updateTimerDisplayUI();
    });

    const fileInput = document.getElementById('localAudioInput');
    const dropzone = document.getElementById('localAudioDropzone');
    fileInput.addEventListener('change', (e) => handleLocalFilesUpload(e.target.files));
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dropzone-active'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone-active'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dropzone-active');
        handleLocalFilesUpload(e.dataTransfer.files);
    });

    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        if (e.code === 'Space') {
            e.preventDefault();
            audioEngine.toggleMasterPlayPause();
        } else if (e.key.toLowerCase() === 'm') {
            e.preventDefault();
            document.getElementById('masterMuteBtn').click();
        }
    });

    document.getElementById('shortcutsInfoBtn')?.addEventListener('click', () => {
        showToast('Shortcuts: [Space] Play/Pause Master • [M] Mute Master');
    });
});