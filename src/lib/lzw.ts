// LZW compression for song exports: variable-width codes (9–16 bits,
// MSB-first), byte alphabet, dictionary frozen when full. A 5-byte header
// ("TABZ" + version) marks compressed files so import can also accept plain
// JSON from older exports.

const MAX_CODE = 1 << 16;
const HEADER = [0x54, 0x41, 0x42, 0x5a, 0x01]; // "TABZ" v1

class BitWriter {
	private bytes: number[] = [];
	private current = 0;
	private filled = 0;

	write(code: number, width: number): void {
		for (let bit = width - 1; bit >= 0; bit--) {
			this.current = (this.current << 1) | ((code >> bit) & 1);
			this.filled++;
			if (this.filled === 8) {
				this.bytes.push(this.current);
				this.current = 0;
				this.filled = 0;
			}
		}
	}

	finish(): Uint8Array {
		if (this.filled > 0) this.bytes.push(this.current << (8 - this.filled));
		return Uint8Array.from(this.bytes);
	}
}

class BitReader {
	private position = 0;
	private readonly bytes: Uint8Array;

	constructor(bytes: Uint8Array) {
		this.bytes = bytes;
	}

	/** Returns -1 when the stream is exhausted. */
	read(width: number): number {
		if (this.position + width > this.bytes.length * 8) return -1;
		let code = 0;
		for (let i = 0; i < width; i++) {
			const byte = this.bytes[this.position >> 3];
			code = (code << 1) | ((byte >> (7 - (this.position & 7))) & 1);
			this.position++;
		}
		return code;
	}
}

export function lzwCompress(input: Uint8Array): Uint8Array {
	const writer = new BitWriter();
	if (input.length === 0) return writer.finish();

	// Dictionary keyed by (prefixCode << 8) | nextByte — fits in 24 bits.
	const dictionary = new Map<number, number>();
	let nextCode = 256;
	let width = 9;
	let prefix = input[0];

	for (let i = 1; i < input.length; i++) {
		const key = (prefix << 8) | input[i];
		const found = dictionary.get(key);
		if (found !== undefined) {
			prefix = found;
			continue;
		}
		writer.write(prefix, width);
		if (nextCode < MAX_CODE) {
			dictionary.set(key, nextCode);
			nextCode++;
			if (nextCode === 1 << width && width < 16) width++;
		}
		prefix = input[i];
	}
	writer.write(prefix, width);
	return writer.finish();
}

export function lzwDecompress(input: Uint8Array): Uint8Array {
	const reader = new BitReader(input);
	// Entries as (previousEntry, appendedByte) chains to avoid copying strings.
	const previousOf = new Int32Array(MAX_CODE).fill(-1);
	const byteOf = new Uint8Array(MAX_CODE);
	for (let code = 0; code < 256; code++) byteOf[code] = code;
	let nextCode = 256;
	let width = 9;

	const output: number[] = [];
	const emit = (code: number): number => {
		// Walk the chain, then reverse in place — returns the first byte.
		const start = output.length;
		let cursor = code;
		while (cursor !== -1) {
			output.push(byteOf[cursor]);
			cursor = cursor < 256 ? -1 : previousOf[cursor];
		}
		// The chain came out reversed.
		for (let left = start, right = output.length - 1; left < right; left++, right--) {
			const swap = output[left];
			output[left] = output[right];
			output[right] = swap;
		}
		return output[start];
	};

	let previous = reader.read(width);
	if (previous === -1) return new Uint8Array(0);
	emit(previous);

	for (;;) {
		const code = reader.read(width);
		if (code === -1) break;
		let firstByte: number;
		if (code < nextCode) {
			firstByte = emit(code);
		} else {
			// KwKwK: the code being defined by this very step.
			const start = output.length;
			firstByte = emit(previous);
			output.push(output[start]);
		}
		if (nextCode < MAX_CODE) {
			previousOf[nextCode] = previous;
			byteOf[nextCode] = firstByte;
			nextCode++;
			// The decoder lags the encoder by one dictionary entry, so it must
			// widen one code early to stay in step.
			if (nextCode + 1 === 1 << width && width < 16) width++;
		}
		previous = code;
	}
	return Uint8Array.from(output);
}

export function isCompressedExport(bytes: Uint8Array): boolean {
	return bytes.length >= HEADER.length && HEADER.every((value, index) => bytes[index] === value);
}

export function compressText(text: string): Uint8Array {
	const body = lzwCompress(new TextEncoder().encode(text));
	const result = new Uint8Array(HEADER.length + body.length);
	result.set(HEADER, 0);
	result.set(body, HEADER.length);
	return result;
}

export function decompressText(bytes: Uint8Array): string {
	if (!isCompressedExport(bytes)) throw new Error("not a compressed export");
	return new TextDecoder().decode(lzwDecompress(bytes.subarray(HEADER.length)));
}
