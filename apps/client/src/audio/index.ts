interface AudioFrame {
  rpm: number;
  load: number;
  tyreSlip: number;
  speed: number;
}

function inRange(value: number, maximum = Number.MAX_VALUE): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError("Audio values must be finite and in range");
  }
}

export function firingFrequency(rpm: number): number {
  inRange(rpm);
  return rpm / 20;
}

export function createCarAudio(
  context: BaseAudioContext,
  destination: AudioNode,
) {
  const output = context.createGain();
  output.connect(destination);
  const voices = Array.from({ length: 6 }, (_, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0;
    oscillator.frequency.value = index < 4 ? 0 : 2200 + (index - 4) * 900;
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start();
    return { oscillator, gain };
  });
  let disposed = false;

  function update(frame: AudioFrame, time: number): void {
    const frequency = firingFrequency(frame.rpm);
    inRange(frame.load, 1);
    inRange(frame.tyreSlip, 1);
    inRange(frame.speed);
    inRange(time);
    if (disposed) {
      return;
    }
    const start = Math.max(context.currentTime, time);
    for (const [index, { oscillator, gain }] of voices.entries()) {
      let volume: number;
      if (index < 4) {
        oscillator.frequency.setTargetAtTime(
          Math.min(frequency * (index + 1), context.sampleRate * 0.45),
          start,
          0.008,
        );
        volume =
          index === 0
            ? 0.08 + frame.load * 0.14
            : (0.01 + frame.load * 0.19) / (index + 1);
        if (frame.rpm === 0) {
          volume = 0;
        }
      } else {
        volume = 0.14 * frame.tyreSlip * Math.min(frame.speed / 5, 1);
      }
      gain.gain.setTargetAtTime(volume, start, 0.008);
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    const end = context.currentTime + 0.04;
    output.gain.cancelAndHoldAtTime(context.currentTime);
    output.gain.linearRampToValueAtTime(0, end);
    let remaining = voices.length;
    for (const { oscillator, gain } of voices) {
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        remaining -= 1;
        if (remaining === 0) {
          output.disconnect();
        }
      };
      oscillator.stop(end);
    }
  }

  return { update, dispose };
}
