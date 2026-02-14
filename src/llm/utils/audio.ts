const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const EXP_LUT = new Int16Array(256);
for (let i = 0; i < 256; i += 1) {
  let exponent = 7;
  let expMask = 0x80;
  while (exponent > 0 && (i & expMask) === 0) {
    exponent -= 1;
    expMask >>= 1;
  }
  EXP_LUT[i] = exponent;
}

function decodeMuLawSample(muLaw: number): number {
  const decoded = (~muLaw) & 0xff;
  const sign = decoded & 0x80;
  const exponent = (decoded >> 4) & 0x07;
  const mantissa = decoded & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

function encodeMuLawSample(sample: number): number {
  let pcm = sample;
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > MULAW_CLIP) {
    pcm = MULAW_CLIP;
  }
  pcm += MULAW_BIAS;

  const exponent = EXP_LUT[(pcm >> 7) & 0xff];
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  const muLaw = ~(sign | (exponent << 4) | mantissa);
  return muLaw & 0xff;
}

export function decodeTwilioMuLawBase64ToPcm16(base64MuLaw: string): Int16Array {
  const muLaw = Buffer.from(base64MuLaw, "base64");
  const pcm16 = new Int16Array(muLaw.length);
  for (let i = 0; i < muLaw.length; i += 1) {
    pcm16[i] = decodeMuLawSample(muLaw[i]);
  }
  return pcm16;
}

export function encodePcm16ToTwilioMuLawBase64(pcm16: Int16Array): string {
  const muLaw = Buffer.allocUnsafe(pcm16.length);
  for (let i = 0; i < pcm16.length; i += 1) {
    muLaw[i] = encodeMuLawSample(pcm16[i]);
  }
  return muLaw.toString("base64");
}

export function resamplePcm16Linear(
  input: Int16Array,
  inSampleRate: number,
  outSampleRate: number,
): Int16Array {
  if (input.length === 0 || inSampleRate === outSampleRate) {
    return new Int16Array(input);
  }

  const outputLength = Math.max(
    1,
    Math.round((input.length * outSampleRate) / inSampleRate),
  );
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const sourcePosition = (i * inSampleRate) / outSampleRate;
    const sourceIndex = Math.floor(sourcePosition);
    const nextIndex = Math.min(sourceIndex + 1, input.length - 1);
    const fraction = sourcePosition - sourceIndex;
    const sample =
      input[sourceIndex] * (1 - fraction) + input[nextIndex] * fraction;

    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }

  return output;
}

export function pcm16ToBase64LittleEndian(pcm16: Int16Array): string {
  const bytes = Buffer.allocUnsafe(pcm16.length * 2);
  for (let i = 0; i < pcm16.length; i += 1) {
    bytes.writeInt16LE(pcm16[i], i * 2);
  }
  return bytes.toString("base64");
}

export function base64LittleEndianToPcm16(base64Pcm16: string): Int16Array {
  const bytes = Buffer.from(base64Pcm16, "base64");
  const sampleCount = Math.floor(bytes.length / 2);
  const pcm16 = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm16[i] = bytes.readInt16LE(i * 2);
  }
  return pcm16;
}

export function chunkInt16(input: Int16Array, chunkSize: number): Int16Array[] {
  if (chunkSize < 1) {
    return [input];
  }

  const chunks: Int16Array[] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    chunks.push(input.subarray(i, Math.min(i + chunkSize, input.length)));
  }
  return chunks;
}
