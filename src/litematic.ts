
import { ShapeToInterface, Nbt } from "./nbt";
import { Virtual3DCanvas } from "./virtual_canvas";
import * as pako from 'pako';

export const SCHEMATIC_SHAPE = {
  'Version': 'int',
  'MinecraftDataVersion': 'int',
  'Metadata': {
    'Name': 'string',
    'Author': 'string',
    'Description': 'string',
    'EnclosingSize': { x: 'int', y: 'int', z: 'int' },
    'TimeCreated': 'long',
    'TimeModified': 'long',
    'TotalBlocks': 'int',
    'TotalVolume': 'int',
    'RegionCount': 'int',
  },
  'Regions': {
    '*': {
      'BlockStatePalette': [{
        'Name': 'string',
        'Properties': { '*': 'string' }
      }],
      'BlockStates': 'longArray',
      'Position': { x: 'int', y: 'int', z: 'int' },
      'Size': { x: 'int', y: 'int', z: 'int' },
      'Entities': [{ '*': '*' }],
      'TileEntities': [{ '*': '*' }],
      'PendingBlockTicks': [{ '*': '*' }],
    }
  }
} as const;

const REGION_SHAPE = SCHEMATIC_SHAPE['Regions']['*'];
const BLOCK_STATE_SHAPE = REGION_SHAPE['BlockStatePalette'][0];

/**
 * Converts the Nbt form of a block state palette entry into
 * a string like "minecraft:observer[facing=east]".
 */
export function blockState(state: ShapeToInterface<typeof BLOCK_STATE_SHAPE>): string {
  if (state['Properties'] && Object.keys(state['Properties']).length) {
    return `${state['Name']}[${Object.keys(state['Properties'])
      .sort()
      .map(prop => `${prop}=${state['Properties'][prop]}`)
      .join(',')}]`;
  }
  return `${state['Name']}`;
}

/**
 * Parses a string like "minecraft:observer[facing=east]" to
 * {Name: "minecraft:observer", Properties: {facing: "east"}}.
 */
export function parseBlockState(state: string): ShapeToInterface<typeof BLOCK_STATE_SHAPE> {
  let [name, props] = state.split('[');
  const properties: Record<string, string> = {};
  if (props) {
    for (const kv of props.slice(0, -1).split(',')) {
      const [key, value] = kv.split('=');
      properties[key] = value;
    }
  }

  return {
    'Name': name,
    'Properties': properties
  };
}

/**
 * Returns the number of bits needed to represent all of the block states
 * in nPaletteEntries. There is always a minimum of 2 bits.
 */
function bitsForBlockStates(nPaletteEntries: number): number {
  return Math.max(Math.ceil(Math.log2(nPaletteEntries)), 2);
}

/**
 * Reads the first region from a schematic.
 */
export class SchematicReader {
  readonly nbt = new Nbt(SCHEMATIC_SHAPE);
  readonly nbtData: ShapeToInterface<typeof SCHEMATIC_SHAPE>;
  readonly regionName: string;
  readonly palette: readonly string[];
  readonly blocks: Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly length: number;

  constructor(fileContents: ArrayBuffer) {
    const unzipped = pako.ungzip(new Uint8Array(fileContents));
    this.nbtData = this.nbt.parse(unzipped);
    const regions = Object.keys(this.nbtData['Regions']);
    if (regions.length !== 1) {
      console.warn('SchematicReader only supports a single region for now.');
    }

    this.regionName = regions[0];
    const region = this.nbtData['Regions'][this.regionName];
    this.palette = region['BlockStatePalette'].map(blockState);
    const bits = BigInt(bitsForBlockStates(this.palette.length));
    const mask = (1n << bits) - 1n;
    const width = this.width = Math.abs(region['Size']['x']);
    const height = this.height = Math.abs(region['Size']['y']);
    const length = this.length = Math.abs(region['Size']['z']);
    this.blocks = new Uint16Array(width * height * length);
    let offsetBits = 0n;

    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const offsetBigInt = (offsetBits / 64n);
          const offsetBigIntByte = Number(offsetBigInt * 8n);
          const currentBigInt = region['BlockStates'].getBigUint64(offsetBigIntByte);
          const nextBigInt = (offsetBigIntByte + 8 < region['BlockStates'].byteLength)
            ? region['BlockStates'].getBigUint64(offsetBigIntByte + 8)
            : 0n;
          const combined = (nextBigInt << 64n) + currentBigInt;
          const blockState = Number((combined >> (offsetBits % 64n)) & mask);
          this.blocks[x + width * (z + length * y)] = blockState;
          offsetBits += bits;
        }
      }
    }
  }

  getBlock(x: number, y: number, z: number): string {
    if (x < 0 || x >= this.width
      || y < 0 || y >= this.height
      || z < 0 || z >= this.length) {
      return 'minecraft:air';
    }
    const index = x + this.width * (z + this.length * y);
    return this.palette[this.blocks[index]];
  }

  get version() {
    return this.nbtData['Version'];
  }

  get minecraftDataVersion() {
    return this.nbtData['MinecraftDataVersion'];
  }

  get name() {
    return this.nbtData['Metadata']['Name'];
  }

  get author() {
    return this.nbtData['Metadata']['Author'];
  }

  get description() {
    return this.nbtData['Metadata']['Description'];
  }

  get totalBlocks() {
    return this.nbtData['Metadata']['TotalBlocks'];
  }

  get totalVolume() {
    return this.nbtData['Metadata']['TotalVolume'];
  }

  get enclosingSize() {
    return this.nbtData['Metadata']['EnclosingSize'];
  }

  get timeCreated() {
    return this.nbtData['Metadata']['TimeCreated'];
  }

  get timeModified() {
    return this.nbtData['Metadata']['TimeModified'];
  }

  get regionPosition() {
    return this.nbtData['Regions'][this.regionName]['Position'];
  }
}

/**
 * Simple interface for writing schematics with a
 * single region. Uses a virtual infinite space for
 * setting blocks, and then uses the smallest bounding box
 * when saving.
 */
export class SchematicWriter {
  nbt = new Nbt(SCHEMATIC_SHAPE);
  description = '';
  palette: { [blockState: string]: number } = { 'minecraft:air': 0 };
  paletteList = ['minecraft:air'];
  canvas = new Virtual3DCanvas();
  version = 5;
  minecraftDataVersion = 2730;

  constructor(public name: string, public author: string) {
  }

  /**
   * Gets the index of the given block state in the palette,
   * adding it to the palette if necessary.
   */
  getOrCreatePaletteIndex(blockState: string) {
    if (this.palette[blockState] !== undefined) {
      return this.palette[blockState];
    }
    this.paletteList.push(blockState);
    this.palette[blockState] = this.paletteList.length - 1;
    return this.palette[blockState];
  }

  /**
   * Sets the block (x, y, z) to the given block state.
   */
  setBlock(x: number, y: number, z: number, blockState: string) {
    this.canvas.set(x, y, z, this.getOrCreatePaletteIndex(blockState));
  }

  /**
   * Gets the block state at (x, y, z)
   */
  getBlock(x: number, y: number, z: number): string {
    return this.paletteList[this.canvas.get(x, y, z)];
  }

  asNbtData(): ShapeToInterface<typeof SCHEMATIC_SHAPE> {
    const [blocks, nonAirBlocks] = this.canvas.getAllBlocks();
    const extents = this.canvas.extents;
    const bits = bitsForBlockStates(this.paletteList.length);
    const uint64sRequired = Math.ceil(blocks.length * bits / 64);
    const blockStates = new DataView(new ArrayBuffer(uint64sRequired * 8));

    // Pack the blocks into the blockStates array using
    // only the number of bits required for each entry.
    let current = 0n;
    let next = 0n;
    let bitOffset = 0;
    let blockStatesIndex = 0;
    for (const block of blocks) {
      const shifted = BigInt(block) << BigInt(bitOffset);
      current |= shifted;
      next |= shifted >> 64n;
      bitOffset += bits;

      if (bitOffset >= 64) {
        bitOffset -= 64;
        blockStates.setBigUint64(blockStatesIndex, current);
        blockStatesIndex += 8;
        current = next;
        next = 0n;
      }
    }

    const now = BigInt(Date.now());

    return {
      'Version': this.version,
      'MinecraftDataVersion': this.minecraftDataVersion,
      'Metadata': {
        'Name': this.name,
        'Author': this.author,
        'Description': this.description,
        'TimeCreated': now,
        'TimeModified': now,
        'TotalBlocks': nonAirBlocks,
        'TotalVolume': this.canvas.width * this.canvas.height * this.canvas.length,
        'RegionCount': 1,
        'EnclosingSize': {
          'x': this.canvas.width,
          'y': this.canvas.height,
          'z': this.canvas.length
        }
      },
      'Regions': {
        [this.name]: {
          'BlockStatePalette': this.paletteList.map(parseBlockState),
          'BlockStates': blockStates,
          'Position': {
            'x': extents.minx,
            'y': extents.miny,
            'z': extents.minz
          },
          'Size': {
            'x': this.canvas.width,
            'y': this.canvas.height,
            'z': this.canvas.length
          },
          'Entities': [],
          'PendingBlockTicks': [],
          'TileEntities': [],
        }
      }
    };
  }

  save(): Uint8Array {
    const uncompressed = this.nbt.serialize(this.asNbtData());
    return pako.gzip(uncompressed);
  }
}

export class IntRange implements IterableIterator<number> {
  constructor(private start: number, private end: number, private readonly step = 1) {
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
    if (this.step > 0 && this.start < this.end || this.step < 0 && this.start > this.end) {
      const result = { value: this.start, done: false } as const;
      this.start += this.step;
      return result;
    } else {
      return { value: undefined, done: true } as const;
    }
  }

  expand(n: number) {
    return new IntRange(this.start - n, this.end + n, this.step);
  }

  reverse() {
    return new IntRange(this.end - 1, this.start - 1, -this.step);
  }
}