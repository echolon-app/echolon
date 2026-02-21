/**
 * FairPlay Decryption Implementation
 * Ported from UxPlay's playfair.c
 * 
 * This implements playfair_decrypt to decrypt the 72-byte ekey into a 16-byte aeskey
 * using the 164-byte FairPlay key message from the /fp-setup handshake.
 */

import * as crypto from 'crypto';
import {
  z_key,
  x_key,
  t_key,
  message_key,
  message_iv,
  table_s1,
  table_s2,
  table_s3,
  table_s4,
  table_s5,
  table_s6,
  table_s7,
  table_s8,
  table_s9,
  table_s10
} from './fairplay-tables';

// Convert arrays to Buffers for easier manipulation
const z_key_buf = Buffer.from(z_key);
const x_key_buf = Buffer.from(x_key);
const t_key_buf = Buffer.from(t_key);

const initial_session_key = Buffer.from([0xDC, 0xDC, 0xF3, 0xB9, 0x0B, 0x74, 0xDC, 0xFB, 0x86, 0x7F, 0xF7, 0x60, 0x16, 0x72, 0x90, 0x51]);

const default_sap = Buffer.from([
  0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79,
  0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79,
  0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79,
  0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79, 0x79,
  0x79, 0x79, 0x79, 0x79, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x03, 0x02, 0x53,
  0x00, 0x01, 0xcc, 0x34, 0x2a, 0x5e, 0x5b, 0x1a, 0x67, 0x73, 0xc2, 0x0e, 0x21, 0xb8, 0x22, 0x4d,
  0xf8, 0x62, 0x48, 0x18, 0x64, 0xef, 0x81, 0x0a, 0xae, 0x2e, 0x37, 0x03, 0xc8, 0x81, 0x9c, 0x23,
  0x53, 0x9d, 0xe5, 0xf5, 0xd7, 0x49, 0xbc, 0x5b, 0x7a, 0x26, 0x6c, 0x49, 0x62, 0x83, 0xce, 0x7f,
  0x03, 0x93, 0x7a, 0xe1, 0xf6, 0x16, 0xde, 0x0c, 0x15, 0xff, 0x33, 0x8c, 0xca, 0xff, 0xb0, 0x9e,
  0xaa, 0xbb, 0xe4, 0x0f, 0x5d, 0x5f, 0x55, 0x8f, 0xb9, 0x7f, 0x17, 0x31, 0xf8, 0xf7, 0xda, 0x60,
  0xa0, 0xec, 0x65, 0x79, 0xc3, 0x3e, 0xa9, 0x83, 0x12, 0xc3, 0xb6, 0x71, 0x35, 0xa6, 0x69, 0x4f,
  0xf8, 0x23, 0x05, 0xd9, 0xba, 0x5c, 0x61, 0x5f, 0xa2, 0x54, 0xd2, 0xb1, 0x83, 0x45, 0x83, 0xce,
  0xe4, 0x2d, 0x44, 0x26, 0xc8, 0x35, 0xa7, 0xa5, 0xf6, 0xc8, 0x42, 0x1c, 0x0d, 0xa3, 0xf1, 0xc7,
  0x00, 0x50, 0xf2, 0xe5, 0x17, 0xf8, 0xd0, 0xfa, 0x77, 0x8d, 0xfb, 0x82, 0x8d, 0x40, 0xc7, 0x8e,
  0x94, 0x1e, 0x1e, 0x1e
]);

// TODO: This is a placeholder - the full implementation requires porting all lookup tables
// from omg_hax.h which contains table_s1 through table_s10, message_key, message_iv, etc.
// This is a very large port (100k+ lines of lookup tables).

/**
 * Main FairPlay decryption function
 * UxPlay: playfair_decrypt(message3, cipherText, keyOut)
 * 
 * @param message3 - 164-byte FairPlay key message from /fp-setup handshake
 * @param cipherText - 72-byte encrypted key (ekey)
 * @param keyOut - Output buffer (16 bytes) for decrypted AES key
 */
export function playfairDecrypt(message3: Buffer, cipherText: Buffer, keyOut: Buffer): void {
  if (message3.length !== 164) {
    throw new Error(`Invalid message3 length: ${message3.length} (expected 164)`);
  }
  if (cipherText.length !== 72) {
    throw new Error(`Invalid cipherText length: ${cipherText.length} (expected 72)`);
  }
  if (keyOut.length !== 16) {
    throw new Error(`Invalid keyOut length: ${keyOut.length} (expected 16)`);
  }

  try {
    // UxPlay implementation:
    // unsigned char* chunk1 = &cipherText[16];
    // unsigned char* chunk2 = &cipherText[56];
    // unsigned char blockIn[16];
    // unsigned char sapKey[16];
    // uint32_t key_schedule[11][4];
    // generate_session_key(default_sap, message3, sapKey);
    // generate_key_schedule(sapKey, key_schedule);
    // z_xor(chunk2, blockIn, 1);
    // cycle(blockIn, key_schedule);
    // for (i = 0; i < 16; i++) {
    //   keyOut[i] = blockIn[i] ^ chunk1[i];
    // }
    // x_xor(keyOut, keyOut, 1);
    // z_xor(keyOut, keyOut, 1);

    const chunk1 = cipherText.slice(16, 32); // bytes 16-31
    const chunk2 = cipherText.slice(56, 72); // bytes 56-71
    
    const blockIn = Buffer.alloc(16);
    const sapKey = Buffer.alloc(16);
    const keySchedule: number[][] = Array(11).fill(null).map(() => Array(4).fill(0));

    // Generate session key from default_sap and message3
    generateSessionKey(default_sap, message3, sapKey);
    
    // Generate key schedule from session key
    generateKeySchedule(sapKey, keySchedule);
    
    // XOR chunk2 with z_key
    zXor(chunk2, blockIn, 1);
    
    // Cycle through encryption rounds
    cycle(blockIn, keySchedule);
    
    // XOR blockIn with chunk1 to get keyOut
    for (let i = 0; i < 16; i++) {
      keyOut[i] = blockIn[i] ^ chunk1[i];
    }
    
    // Final XOR operations
    xXor(keyOut, keyOut, 1);
    zXor(keyOut, keyOut, 1);
  } catch (err) {
    // Re-throw with more context
    throw new Error(`playfairDecrypt failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const static_source_1 = Buffer.from([0xFA, 0x9C, 0xAD, 0x4D, 0x4B, 0x68, 0x26, 0x8C, 0x7F, 0xF3, 0x88, 0x99, 0xDE, 0x92, 0x2E, 0x95, 0x1E]);
const static_source_2 = Buffer.from([
  0xEC, 0x4E, 0x27, 0x5E, 0xFD, 0xF2, 0xE8, 0x30, 0x97, 0xAE, 0x70, 0xFB, 0xE0, 0x00, 0x3F, 0x1C,
  0x39, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x09, 0x00, 0x0, 0x00, 0x00, 0x00, 0x00
]);

const sap_iv = Buffer.from([0x2B, 0x84, 0xFB, 0x79, 0xDA, 0x75, 0xB9, 0x04, 0x6C, 0x24, 0x73, 0xF7, 0xD1, 0xC4, 0xAB, 0x0E, 0x2B, 0x84, 0xFB, 0x79, 0x75, 0xB9, 0x04, 0x6C, 0x24, 0x73]);
const sap_key_material = Buffer.from([0xA1, 0x1A, 0x4A, 0x83, 0xF2, 0x7A, 0x75, 0xEE, 0xA2, 0x1A, 0x7D, 0xB8, 0x8D, 0x77, 0x92, 0xAB]);
const index_mangle = Buffer.from([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36, 0x6C]);

// Helper functions
function rol8(input: number, count: number): number {
  return ((input << count) & 0xff) | ((input & 0xff) >> (8 - count));
}

function rol8x(input: number, count: number): number {
  return ((input << count)) | (input >> (8 - count));
}

function weird_ror8(input: number, count: number): number {
  if (count === 0) return 0;
  return ((input >> count) & 0xff) | ((input & 0xff) << (8 - count));
}

function weird_rol8(input: number, count: number): number {
  if (count === 0) return 0;
  return ((input << count) & 0xff) | ((input & 0xff) >> (8 - count));
}

function weird_rol32(input: number, count: number): number {
  if (count === 0) return 0;
  return (input << count) ^ (input >> (8 - count));
}

function rol32(input: number, count: number): number {
  return ((input << count) & 0xffffffff) | ((input & 0xffffffff) >>> (32 - count));
}

function tXor(inBuf: Buffer, outBuf: Buffer): void {
  for (let i = 0; i < 16; i++) {
    outBuf[i] = inBuf[i] ^ t_key_buf[i];
  }
}

function xorBlocks(a: Buffer, b: Buffer, out: Buffer): void {
  for (let i = 0; i < 16; i++) {
    out[i] = a[i] ^ b[i];
  }
}

function tableIndex(i: number): number[] {
  const offset = ((31 * i) % 0x28) << 8;
  return table_s1.slice(offset, offset + 256);
}

function messageTableIndex(i: number): number[] {
  const offset = (97 * i % 144) << 8;
  return table_s2.slice(offset, offset + 256);
}

function permuteTable2(i: number): number[] {
  const offset = ((71 * i) % 144) << 8;
  return table_s4.slice(offset, offset + 256);
}

function permuteBlock1(block: Buffer): void {
  block[0] = table_s3[block[0]];
  block[4] = table_s3[0x400 + block[4]];
  block[8] = table_s3[0x800 + block[8]];
  block[12] = table_s3[0xc00 + block[12]];
  
  let tmp = block[13];
  block[13] = table_s3[0x100 + block[9]];
  block[9] = table_s3[0xd00 + block[5]];
  block[5] = table_s3[0x900 + block[1]];
  block[1] = table_s3[0x500 + tmp];
  
  tmp = block[2];
  block[2] = table_s3[0xa00 + block[10]];
  block[10] = table_s3[0x200 + tmp];
  tmp = block[6];
  block[6] = table_s3[0xe00 + block[14]];
  block[14] = table_s3[0x600 + tmp];
  
  tmp = block[3];
  block[3] = table_s3[0xf00 + block[7]];
  block[7] = table_s3[0x300 + block[11]];
  block[11] = table_s3[0x700 + block[15]];
  block[15] = table_s3[0xb00 + tmp];
}

function permuteBlock2(block: Buffer, round: number): void {
  const base = round * 16;
  block[0] = permuteTable2(base + 0)[block[0]];
  block[4] = permuteTable2(base + 4)[block[4]];
  block[8] = permuteTable2(base + 8)[block[8]];
  block[12] = permuteTable2(base + 12)[block[12]];
  
  let tmp = block[13];
  block[13] = permuteTable2(base + 13)[block[9]];
  block[9] = permuteTable2(base + 9)[block[5]];
  block[5] = permuteTable2(base + 5)[block[1]];
  block[1] = permuteTable2(base + 1)[tmp];
  
  tmp = block[2];
  block[2] = permuteTable2(base + 2)[block[10]];
  block[10] = permuteTable2(base + 10)[tmp];
  tmp = block[6];
  block[6] = permuteTable2(base + 6)[block[14]];
  block[14] = permuteTable2(base + 14)[tmp];
  
  tmp = block[3];
  block[3] = permuteTable2(base + 3)[block[7]];
  block[7] = permuteTable2(base + 7)[block[11]];
  block[11] = permuteTable2(base + 11)[block[15]];
  block[15] = permuteTable2(base + 15)[tmp];
}

function swap32(a: Buffer, offsetA: number, offsetB: number): void {
  const tmp = a[offsetA];
  a[offsetA] = a[offsetB];
  a[offsetB] = tmp;
}

function swapBytes(a: Buffer, i: number, j: number): void {
  const tmp = a[i];
  a[i] = a[j];
  a[j] = tmp;
}

// MD5 helper functions
function F(B: number, C: number, D: number): number {
  return (B & C) | (~B & D);
}

function G(B: number, C: number, D: number): number {
  return (B & D) | (C & ~D);
}

function H(B: number, C: number, D: number): number {
  return B ^ C ^ D;
}

function I(B: number, C: number, D: number): number {
  return C ^ (B | ~D);
}

const md5_shift = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

function modifiedMd5(originalBlockIn: Buffer, keyIn: Buffer, keyOut: Buffer): void {
  const blockIn = Buffer.from(originalBlockIn);
  const keyWords = new Uint32Array(keyIn.buffer, keyIn.byteOffset, 4);
  const outWords = new Uint32Array(keyOut.buffer, keyOut.byteOffset, 4);
  
  let A = keyWords[0];
  let B = keyWords[1];
  let C = keyWords[2];
  let D = keyWords[3];
  
  const blockWords = new Uint32Array(blockIn.buffer, blockIn.byteOffset, 16);
  
  for (let i = 0; i < 64; i++) {
    let j: number;
    if (i < 16) {
      j = i;
    } else if (i < 32) {
      j = (5 * i + 1) % 16;
    } else if (i < 48) {
      j = (3 * i + 5) % 16;
    } else {
      j = (7 * i) % 16;
    }
    
    const input = (blockIn[4 * j] << 24) | (blockIn[4 * j + 1] << 16) | (blockIn[4 * j + 2] << 8) | blockIn[4 * j + 3];
    const sinConstant = Math.floor(Math.abs(Math.sin(i + 1)) * (1 << 32));
    let Z = (A + input + sinConstant) >>> 0;
    
    if (i < 16) {
      Z = rol32((Z + F(B, C, D)) >>> 0, md5_shift[i]);
    } else if (i < 32) {
      Z = rol32((Z + G(B, C, D)) >>> 0, md5_shift[i]);
    } else if (i < 48) {
      Z = rol32((Z + H(B, C, D)) >>> 0, md5_shift[i]);
    } else {
      Z = rol32((Z + I(B, C, D)) >>> 0, md5_shift[i]);
    }
    
    Z = (Z + B) >>> 0;
    const tmp = D;
    D = C;
    C = B;
    B = Z;
    A = tmp;
    
    if (i === 31) {
      // Swap block words
      const aIdx = A & 15;
      const bIdx = B & 15;
      const cIdx = C & 15;
      const dIdx = D & 15;
      [blockWords[aIdx], blockWords[bIdx]] = [blockWords[bIdx], blockWords[aIdx]];
      [blockWords[cIdx], blockWords[dIdx]] = [blockWords[dIdx], blockWords[cIdx]];
      
      const aIdx2 = (A & (15 << 4)) >> 4;
      const bIdx2 = (B & (15 << 4)) >> 4;
      [blockWords[aIdx2], blockWords[bIdx2]] = [blockWords[bIdx2], blockWords[aIdx2]];
      
      const aIdx3 = (A & (15 << 8)) >> 8;
      const bIdx3 = (B & (15 << 8)) >> 8;
      [blockWords[aIdx3], blockWords[bIdx3]] = [blockWords[bIdx3], blockWords[aIdx3]];
      
      const aIdx4 = (A & (15 << 12)) >> 12;
      const bIdx4 = (B & (15 << 12)) >> 12;
      [blockWords[aIdx4], blockWords[bIdx4]] = [blockWords[bIdx4], blockWords[aIdx4]];
    }
  }
  
  outWords[0] = (keyWords[0] + A) >>> 0;
  outWords[1] = (keyWords[1] + B) >>> 0;
  outWords[2] = (keyWords[2] + C) >>> 0;
  outWords[3] = (keyWords[3] + D) >>> 0;
}

// garble function - very complex obfuscated function
function garble(buffer0: Buffer, buffer1: Buffer, buffer2: Buffer, buffer3: Buffer, buffer4: Buffer): void {
  let tmp: number, tmp2: number, tmp3: number;
  let A: number, B: number, C: number, D: number, E: number, M: number, J: number, G: number, F: number, H: number, K: number, R: number, S: number, T: number, U: number, V: number, W: number, X: number, Y: number, Z: number;
  
  buffer2[12] = 0x14 + (((buffer1[64] & 92) | ((Math.floor(buffer1[99] / 3)) & 35)) & buffer4[rol8x(buffer4[(buffer1[206] % 21)], 4) % 21]);
  buffer1[4] = Math.floor(buffer1[99] / 5) * Math.floor(buffer1[99] / 5) * 2;
  buffer2[34] = 0xb8;
  buffer1[153] ^= (buffer2[buffer1[203] % 35] * buffer2[buffer1[203] % 35] * buffer1[190]);
  buffer0[3] -= (((buffer4[buffer1[205] % 21] >> 1) & 80) | 0xe6440);
  buffer0[16] = 0x93;
  buffer0[13] = 0x62;
  buffer1[33] -= (buffer4[buffer1[36] % 21] & 0xf6);
  tmp2 = buffer2[buffer1[67] % 35];
  buffer2[12] = 0x07;
  tmp = buffer0[buffer1[181] % 20];
  buffer1[2] -= 3136;
  buffer0[19] = buffer4[buffer1[58] % 21];
  buffer3[0] = 92 - buffer2[buffer1[32] % 35];
  buffer3[4] = buffer2[buffer1[15] % 35] + 0x9e;
  buffer1[34] += Math.floor(buffer4[((buffer2[buffer1[15] % 35] + 0x9e) & 0xff) % 21] / 5);
  buffer0[19] += 0xfffffee6 - ((buffer0[buffer3[4] % 20] >> 1) & 102);
  buffer1[15] = (3 * (((buffer1[72] >> (buffer4[buffer1[190] % 21] & 7)) ^ (buffer1[72] << ((7 - ((buffer4[buffer1[190] % 21] - 1)) & 7)))) - (3 * buffer4[buffer1[126] % 21]))) ^ buffer1[15];
  buffer0[15] ^= buffer2[buffer1[181] % 35] * buffer2[buffer1[181] % 35] * buffer2[buffer1[181] % 35];
  buffer2[4] ^= Math.floor(buffer1[202] / 3);
  A = 92 - buffer0[buffer3[0] % 20];
  E = (A & 0xc6) | (~buffer1[105] & 0xc6) | (A & (~buffer1[105]));
  buffer2[1] += (E * E * E);
  buffer0[19] ^= Math.floor(((224 | (buffer4[buffer1[92] % 21] & 27)) * buffer2[buffer1[41] % 35]) / 3);
  buffer1[140] += weird_ror8(92, buffer1[5] & 7);
  buffer2[12] += ((((~buffer1[4]) ^ buffer2[buffer1[12] % 35]) | buffer1[182]) & 192) | (((~buffer1[4]) ^ buffer2[buffer1[12] % 35]) & buffer1[182]);
  buffer1[36] += 125;
  buffer1[124] = rol8x((((74 & buffer1[138]) | ((74 | buffer1[138]) & buffer0[15])) & buffer0[buffer1[43] % 20]) | (((74 & buffer1[138]) | ((74 | buffer1[138]) & buffer0[15]) | buffer0[buffer1[43] % 20]) & 95), 4);
  buffer3[8] = ((((buffer0[buffer3[4] % 20] & 95)) & ((buffer4[buffer1[68] % 21] & 46) << 1)) | 16) ^ 92;
  A = buffer1[177] + buffer4[buffer1[79] % 21];
  D = (((A >> 1) | ((3 * buffer1[148]) / 5)) & buffer2[1]) | ((A >> 1) & (Math.floor(3 * buffer1[148] / 5)));
  buffer3[12] = ((-34 - D));
  A = 8 - ((buffer2[22] & 7));
  B = (buffer1[33] >> (A & 7));
  C = buffer1[33] << (buffer2[22] & 7);
  buffer2[16] += ((buffer2[buffer3[0] % 35] & 159) | buffer0[buffer3[4] % 20] | 8) - ((B ^ C) | 128);
  buffer0[14] ^= buffer2[buffer3[12] % 35];
  A = weird_rol8(buffer4[buffer0[buffer1[201] % 20] % 21], ((buffer2[buffer1[112] % 35] << 1) & 7));
  D = (buffer0[buffer1[208] % 20] & 131) | (buffer0[buffer1[164] % 20] & 124);
  buffer1[19] += (A & Math.floor(D / 5)) | ((A | Math.floor(D / 5)) & 37);
  buffer2[8] = weird_ror8(140, ((buffer4[buffer1[45] % 21] + 92) * (buffer4[buffer1[45] % 21] + 92)) & 7);
  buffer1[190] = 56;
  buffer2[8] ^= buffer3[0];
  buffer1[53] = ~Math.floor((buffer0[buffer1[83] % 20] | 204) / 5);
  buffer0[13] += buffer0[buffer1[41] % 20];
  buffer0[10] = Math.floor(((buffer2[buffer3[0] % 35] & buffer1[2]) | ((buffer2[buffer3[0] % 35] | buffer1[2]) & buffer3[12])) / 15);
  A = (((56 | (buffer4[buffer1[2] % 21] & 68)) | buffer2[buffer3[8] % 35]) & 42) | (((buffer4[buffer1[2] % 21] & 68) | 56) & buffer2[buffer3[8] % 35]);
  buffer3[16] = (A * A) + 110;
  buffer3[20] = 202 - buffer3[16];
  buffer3[24] = buffer1[151];
  buffer2[13] ^= buffer4[buffer3[0] % 21];
  B = ((buffer2[buffer1[179] % 35] - 38) & 177) | (buffer3[12] & 177);
  C = ((buffer2[buffer1[179] % 35] - 38)) & buffer3[12];
  buffer3[28] = 30 + ((B | C) * (B | C));
  buffer3[32] = buffer3[28] + 62;
  A = ((buffer3[20] + (buffer3[0] & 74)) | ~buffer4[buffer3[0] % 21]) & 121;
  B = ((buffer3[20] + (buffer3[0] & 74)) & ~buffer4[buffer3[0] % 21]);
  tmp3 = (A | B);
  C = ((((A | B) ^ 0xffffffa6) | buffer3[0]) & 4) | (((A | B) ^ 0xffffffa6) & buffer3[0]);
  buffer1[47] = (buffer2[buffer1[89] % 35] + C) ^ buffer1[47];
  buffer3[36] = ((rol8((tmp & 179) + 68, 2) & buffer0[3]) | (tmp2 & ~buffer0[3])) - 15;
  buffer1[123] ^= 221;
  A = Math.floor(buffer4[buffer3[0] % 21] / 3) - buffer2[buffer3[4] % 35];
  C = (((buffer3[0] & 163) + 92) & 246) | (buffer3[0] & 92);
  E = ((C | buffer3[24]) & 54) | (C & buffer3[24]);
  buffer3[40] = A - E;
  buffer3[44] = tmp3 ^ 81 ^ (((buffer3[0] >> 1) & 101) + 26);
  buffer3[48] = buffer2[buffer3[4] % 35] & 27;
  buffer3[52] = 27;
  buffer3[56] = 199;
  buffer3[64] = buffer3[4] + (((((((buffer3[40] | buffer3[24]) & 177) | (buffer3[40] & buffer3[24])) & ((((buffer4[buffer3[0] % 20] & 177) | 176)) | ((buffer4[buffer3[0] % 21]) & ~3))) | ((((buffer3[40] & buffer3[24]) | ((buffer3[40] | buffer3[24]) & 177)) & 199) | ((((buffer4[buffer3[0] % 21] & 1) + 176) | (buffer4[buffer3[0] % 21] & ~3)) & buffer3[56]))) & (~buffer3[52])) | buffer3[48]);
  buffer2[33] ^= buffer1[26];
  buffer1[106] ^= buffer3[20] ^ 133;
  buffer2[30] = (Math.floor(buffer3[64] / 3) - (275 | (buffer3[0] & 247))) ^ buffer0[buffer1[122] % 20];
  buffer1[22] = (buffer2[buffer1[90] % 35] & 95) | 68;
  A = (buffer4[buffer3[36] % 21] & 184) | (buffer2[buffer3[44] % 35] & ~184);
  buffer2[18] += ((A * A * A) >> 1);
  buffer2[5] -= buffer4[buffer1[92] % 21];
  A = (((buffer1[41] & ~24) | (buffer2[buffer1[183] % 35] & 24)) & (buffer3[16] + 53)) | (buffer3[20] & buffer2[buffer3[20] % 35]);
  B = (buffer1[17] & (~buffer3[44])) | (buffer0[buffer1[59] % 20] & buffer3[44]);
  buffer2[18] ^= (A * B);
  A = weird_ror8(buffer1[11], buffer2[buffer1[28] % 35] & 7) & 7;
  B = (((buffer0[buffer1[93] % 20] & ~buffer0[14]) | (buffer0[14] & 150)) & ~28) | (buffer1[7] & 28);
  buffer2[22] = (((((B | weird_rol8(buffer2[buffer3[0] % 35], A)) & buffer2[33]) | (B & weird_rol8(buffer2[buffer3[0] % 35], A))) + 74) & 0xff);
  A = buffer4[(buffer0[buffer1[39] % 20] ^ 217) % 21];
  buffer0[15] -= ((((buffer3[20] | buffer3[0]) & 214) | (buffer3[20] & buffer3[0])) & A) | ((((buffer3[20] | buffer3[0]) & 214) | (buffer3[20] & buffer3[0]) | A) & buffer3[32]);
  B = (((buffer2[buffer1[57] % 35] & buffer0[buffer3[64] % 20]) | ((buffer0[buffer3[64] % 20] | buffer2[buffer1[57] % 35]) & 95) | (buffer3[64] & 45) | 82) & 32);
  C = ((buffer2[buffer1[57] % 35] & buffer0[buffer3[64] % 20]) | ((buffer2[buffer1[57] % 35] | buffer0[buffer3[64] % 20]) & 95)) & ((buffer3[64] & 45) | 82);
  D = (((Math.floor(buffer3[0] / 3) - (buffer3[64] | buffer1[22]))) ^ (buffer3[28] + 62) ^ ((B | C)));
  T = buffer0[(D & 0xff) % 20];
  buffer3[68] = (buffer0[buffer1[99] % 20] * buffer0[buffer1[99] % 20] * buffer0[buffer1[99] % 20] * buffer0[buffer1[99] % 20]) | buffer2[buffer3[64] % 35];
  U = buffer0[buffer1[50] % 20];
  W = buffer2[buffer1[138] % 35];
  X = buffer4[buffer1[39] % 21];
  Y = buffer0[buffer1[4] % 20];
  Z = buffer4[buffer1[202] % 21];
  V = buffer0[buffer1[151] % 20];
  S = buffer2[buffer1[14] % 35];
  R = buffer0[buffer1[145] % 20];
  A = (buffer2[buffer3[68] % 35] & buffer0[buffer1[209] % 20]) | ((buffer2[buffer3[68] % 35] | buffer0[buffer1[209] % 20]) & 24);
  B = weird_rol8(buffer4[buffer1[127] % 21], buffer2[buffer3[68] % 35] & 7);
  C = (A & buffer0[10]) | (B & ~buffer0[10]);
  D = 7 ^ (buffer4[buffer2[buffer3[36] % 35] % 21] << 1);
  buffer3[72] = (C & 71) | (D & ~71);
  buffer2[2] += (((buffer0[buffer3[20] % 20] << 1) & 159) | (buffer4[buffer1[190] % 21] & ~159)) & ((((buffer4[buffer3[64] % 21] & 110) | (buffer0[buffer1[25] % 20] & ~110)) & ~150) | (buffer1[25] & 150));
  buffer2[14] -= ((buffer2[buffer3[20] % 35] & (buffer3[72] ^ buffer2[buffer1[100] % 35])) & ~34) | (buffer1[97] & 34);
  buffer0[17] = 115;
  buffer1[23] ^= ((((((buffer4[buffer1[17] % 21] | buffer0[buffer3[20] % 20]) & buffer3[72]) | (buffer4[buffer1[17] % 21] & buffer0[buffer3[20] % 20])) & Math.floor(buffer1[50] / 3)) | (((((buffer4[buffer1[17] % 21] | buffer0[buffer3[20] % 20]) & buffer3[72]) | (buffer4[buffer1[17] % 21] & buffer0[buffer3[20] % 20]) | Math.floor(buffer1[50] / 3)) & 246)) << 1));
  buffer0[13] = ((((((buffer0[buffer3[40] % 20] | buffer1[10]) & 82) | (buffer0[buffer3[40] % 20] & buffer1[10])) & 209) | ((buffer0[buffer1[39] % 20] << 1) & 46)) >> 1);
  buffer2[33] -= buffer1[113] & 9;
  buffer2[28] -= ((((2 | (buffer1[110] & 222)) >> 1) & ~223) | (buffer3[20] & 223));
  J = weird_rol8((V | Z), (U & 7));
  A = (buffer2[16] & T) | (W & (~buffer2[16]));
  B = (buffer1[33] & 17) | (X & ~17);
  E = ((Y | Math.floor((A + B) / 5)) & 147) | (Y & Math.floor((A + B) / 5));
  M = (buffer3[40] & buffer4[((buffer3[8] + J + E) & 0xff) % 21]) | ((buffer3[40] | buffer4[((buffer3[8] + J + E) & 0xff) % 21]) & buffer2[23]);
  buffer0[15] = (((buffer4[buffer3[20] % 21] - 48) & (~buffer1[184])) | ((buffer4[buffer3[20] % 21] - 48) & 189) | (189 & ~buffer1[184])) & (M * M * M);
  buffer2[22] += buffer1[183];
  buffer3[76] = (3 * buffer4[buffer1[1] % 21]) ^ buffer3[0];
  A = buffer2[((buffer3[8] + (J + E)) & 0xff) % 35];
  F = (((buffer4[buffer1[178] % 21] & A) | ((buffer4[buffer1[178] % 21] | A) & 209)) * buffer0[buffer1[13] % 20]) * (buffer4[buffer1[26] % 21] >> 1);
  G = (F + 0x733ffff9) * 198 - (((F + 0x733ffff9) * 396 + 212) & 212) + 85;
  buffer3[80] = buffer3[36] + (G ^ 148) + ((G ^ 107) << 1) - 127;
  buffer3[84] = ((buffer2[buffer3[64] % 35]) & 245) | (buffer2[buffer3[20] % 35] & 10);
  A = buffer0[buffer3[68] % 20] | 81;
  buffer2[18] -= ((A * A * A) & ~buffer0[15]) | ((Math.floor(buffer3[80] / 15) & buffer0[15]));
  buffer3[88] = buffer3[8] + J + E - buffer0[buffer1[160] % 20] + Math.floor(buffer4[buffer0[((buffer3[8] + J + E) & 255) % 20] % 21] / 3);
  B = ((R ^ buffer3[72]) & ~198) | ((S * S) & 198);
  F = (buffer4[buffer1[69] % 21] & buffer1[172]) | ((buffer4[buffer1[69] % 21] | buffer1[172]) & ((buffer3[12] - B) + 77));
  buffer0[16] = 147 - ((buffer3[72] & ((F & 251) | 1)) | (((F & 250) | buffer3[72]) & 198));
  C = (buffer4[buffer1[168] % 21] & buffer0[buffer1[29] % 20] & 7) | ((buffer4[buffer1[168] % 21] | buffer0[buffer1[29] % 20]) & 6);
  F = (buffer4[buffer1[155] % 21] & buffer1[105]) | ((buffer4[buffer1[155] % 21] | buffer1[105]) & 141);
  buffer0[3] -= buffer4[weird_rol32(F, C) % 21];
  buffer1[5] = weird_ror8(buffer0[12], ((Math.floor(buffer0[buffer1[61] % 20] / 5)) & 7)) ^ (Math.floor(((~buffer2[buffer3[84] % 35]) & 0xffffffff) / 5));
  buffer1[198] += buffer1[3];
  A = (162 | buffer2[buffer3[64] % 35]);
  buffer1[164] += Math.floor((A * A) / 5);
  G = weird_ror8(139, (buffer3[80] & 7));
  C = ((buffer4[buffer3[64] % 21] * buffer4[buffer3[64] % 21] * buffer4[buffer3[64] % 21]) & 95) | (buffer0[buffer3[40] % 20] & ~95);
  buffer3[92] = (G & 12) | (buffer0[buffer3[20] % 20] & 12) | (G & buffer0[buffer3[20] % 20]) | C;
  buffer2[12] += Math.floor(((buffer1[103] & 32) | (buffer3[92] & ((buffer1[103] | 60))) | 16) / 3);
  buffer3[96] = buffer1[143];
  buffer3[100] = 27;
  buffer3[104] = (((buffer3[40] & ~buffer2[8]) | (buffer1[35] & buffer2[8])) & buffer3[64]) ^ 119;
  buffer3[108] = 238 & ((((buffer3[40] & ~buffer2[8]) | (buffer1[35] & buffer2[8])) & buffer3[64]) << 1);
  buffer3[112] = (~buffer3[64] & Math.floor(buffer3[84] / 3)) ^ 49;
  buffer3[116] = 98 & ((~buffer3[64] & Math.floor(buffer3[84] / 3)) << 1);
  A = (buffer1[35] & buffer2[8]) | (buffer3[40] & ~buffer2[8]);
  B = (A & buffer3[64]) | ((Math.floor(buffer3[84] / 3) & ~buffer3[64]));
  buffer1[143] = buffer3[96] - ((B & (86 + ((buffer1[172] & 64) >> 1))) | (((((buffer1[172] & 65) >> 1) ^ 86) | ((~buffer3[64] & Math.floor(buffer3[84] / 3)) | (((buffer3[40] & ~buffer2[8]) | (buffer1[35] & buffer2[8])) & buffer3[64]))) & buffer3[100]));
  buffer2[29] = 162;
  A = (((buffer4[buffer3[88] % 21]) & 160) | (buffer0[buffer1[125] % 20] & 95)) >> 1;
  B = buffer2[buffer1[149] % 35] ^ (buffer1[43] * buffer1[43]);
  buffer0[15] += (B & A) | ((A | B) & 115);
  buffer3[120] = buffer3[64] - buffer0[buffer3[40] % 20];
  buffer1[95] = buffer4[buffer3[20] % 21];
  A = weird_ror8(buffer2[buffer3[80] % 35], (buffer2[buffer1[17] % 35] * buffer2[buffer1[17] % 35] * buffer2[buffer1[17] % 35]) & 7);
  buffer0[7] -= (A * A);
  buffer2[8] = buffer2[8] - buffer1[184] + (buffer4[buffer1[202] % 21] * buffer4[buffer1[202] % 21] * buffer4[buffer1[202] % 21]);
  buffer0[16] = (buffer2[buffer1[102] % 35] << 1) & 132;
  buffer3[124] = (buffer4[buffer3[40] % 21] >> 1) ^ buffer3[68];
  buffer0[7] -= (buffer0[buffer1[191] % 20] - (((buffer4[buffer1[80] % 21] << 1) & ~177) | (buffer4[buffer4[buffer3[88] % 21] % 21] & 177)));
  buffer0[6] = buffer0[buffer1[119] % 20];
  A = (buffer4[buffer1[190] % 21] & ~209) | (buffer1[118] & 209);
  B = buffer0[buffer3[120] % 20] * buffer0[buffer3[120] % 20];
  buffer0[12] = (buffer0[buffer3[84] % 20] ^ (buffer2[buffer1[71] % 35] + buffer2[buffer1[15] % 35])) & ((A & B) | ((A | B) & 27));
  B = (buffer1[32] & buffer2[buffer3[88] % 35]) | ((buffer1[32] | buffer2[buffer3[88] % 35]) & 23);
  D = (((buffer4[buffer1[57] % 21] * 231) & 169) | (B & 86));
  F = (((buffer0[buffer1[82] % 20] & ~29) | (buffer4[buffer3[124] % 21] & 29)) & 190) | (buffer4[Math.floor(D / 5) % 21] & ~190);
  H = buffer0[buffer3[40] % 20] * buffer0[buffer3[40] % 20] * buffer0[buffer3[40] % 20];
  K = (H & buffer1[82]) | (H & 92) | (buffer1[82] & 92);
  buffer3[128] = ((F & K) | ((F | K) & 192)) ^ Math.floor(D / 5);
  buffer2[25] ^= ((buffer0[buffer3[120] % 20] << 1) * buffer1[5]) - (weird_rol8(buffer3[76], (buffer4[buffer3[124] % 21] & 7)) & (buffer3[20] + 110));
}

function sapHash(blockIn: Buffer, keyOut: Buffer): void {
  const blockWords = new Uint32Array(blockIn.buffer, blockIn.byteOffset, blockIn.length / 4);
  const buffer0 = Buffer.from([0x96, 0x5F, 0xC6, 0x53, 0xF8, 0x46, 0xCC, 0x18, 0xDF, 0xBE, 0xB2, 0xF8, 0x38, 0xD7, 0xEC, 0x22, 0x03, 0xD1, 0x20, 0x8F]);
  const buffer1 = Buffer.alloc(210);
  const buffer2 = Buffer.from([0x43, 0x54, 0x62, 0x7A, 0x18, 0xC3, 0xD6, 0xB3, 0x9A, 0x56, 0xF6, 0x1C, 0x14, 0x3F, 0x0C, 0x1D, 0x3B, 0x36, 0x83, 0xB1, 0x39, 0x51, 0x4A, 0xAA, 0x09, 0x3E, 0xFE, 0x44, 0xAF, 0xDE, 0xC3, 0x20, 0x9D, 0x42, 0x3A]);
  const buffer3 = Buffer.alloc(132);
  const buffer4 = Buffer.from([0xED, 0x25, 0xD1, 0xBB, 0xBC, 0x27, 0x9F, 0x02, 0xA2, 0xA9, 0x11, 0x00, 0x0C, 0xB3, 0x52, 0xC0, 0xBD, 0xE3, 0x1B, 0x49, 0xC7]);
  const i0_index = [18, 22, 23, 0, 5, 19, 32, 31, 10, 21, 30];
  
  // Load the input into the buffer
  for (let i = 0; i < 210; i++) {
    const inWord = blockWords[((i % 64) >> 2)];
    const inByte = (inWord >> ((3 - (i % 4)) << 3)) & 0xff;
    buffer1[i] = inByte;
  }
  
  // Scrambling
  for (let i = 0; i < 840; i++) {
    const x = buffer1[((i - 155) & 0xffffffff) % 210];
    const y = buffer1[((i - 57) & 0xffffffff) % 210];
    const z = buffer1[((i - 13) & 0xffffffff) % 210];
    const w = buffer1[(i & 0xffffffff) % 210];
    buffer1[i % 210] = (rol8(y, 5) + (rol8(z, 3) ^ w) - rol8(x, 7)) & 0xff;
  }
  
  garble(buffer0, buffer1, buffer2, buffer3, buffer4);
  
  // Fill output with 0xE1
  for (let i = 0; i < 16; i++) {
    keyOut[i] = 0xE1;
  }
  
  // Use buffers to compute output
  for (let i = 0; i < 11; i++) {
    if (i === 3) {
      keyOut[i] = 0x3d;
    } else {
      keyOut[i] = ((keyOut[i] + buffer3[i0_index[i] * 4]) & 0xff);
    }
  }
  
  // XOR with buffer0
  for (let i = 0; i < 20; i++) {
    keyOut[i % 16] ^= buffer0[i];
  }
  
  // XOR with buffer2
  for (let i = 0; i < 35; i++) {
    keyOut[i % 16] ^= buffer2[i];
  }
  
  // XOR with buffer1
  for (let i = 0; i < 210; i++) {
    keyOut[(i % 16)] ^= buffer1[i];
  }
  
  // Reverse-scramble
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const x = keyOut[((i - 7) & 0xffffffff) % 16];
      const y = keyOut[i % 16];
      const z = keyOut[((i - 37) & 0xffffffff) % 16];
      const w = keyOut[((i - 177) & 0xffffffff) % 16];
      keyOut[i] = rol8(x, 1) ^ y ^ rol8(z, 6) ^ rol8(w, 5);
    }
  }
}

function decryptMessage(messageIn: Buffer, decryptedMessage: Buffer): void {
  const buffer = Buffer.alloc(16);
  const keySchedule: number[][] = Array(11).fill(null).map(() => Array(4).fill(0));
  const mode = messageIn[12]; // 0,1,2,3
  
  generateKeySchedule(initial_session_key, keySchedule);
  
  // For M0-M6 we follow the same pattern
  for (let i = 0; i < 8; i++) {
    // Copy in the nth block
    for (let j = 0; j < 16; j++) {
      if (mode === 3) {
        buffer[j] = messageIn[(0x80 - 0x10 * i) + j];
      } else if (mode === 2 || mode === 1 || mode === 0) {
        buffer[j] = messageIn[(0x10 * (i + 1)) + j];
      }
    }
    
    // Permutation and update 9 times
    for (let j = 0; j < 9; j++) {
      const base = 0x80 - 0x10 * j;
      const msgTable = messageTableIndex(base);
      const msgKeyRow = message_key[mode];
      
      buffer[0x0] = msgTable[buffer[0x0]] ^ msgKeyRow[base + 0x0];
      buffer[0x4] = msgTable[buffer[0x4]] ^ msgKeyRow[base + 0x4];
      buffer[0x8] = msgTable[buffer[0x8]] ^ msgKeyRow[base + 0x8];
      buffer[0xc] = msgTable[buffer[0xc]] ^ msgKeyRow[base + 0xc];
      
      let tmp = buffer[0x0d];
      buffer[0xd] = msgTable[buffer[0x9]] ^ msgKeyRow[base + 0xd];
      buffer[0x9] = msgTable[buffer[0x5]] ^ msgKeyRow[base + 0x9];
      buffer[0x5] = msgTable[buffer[0x1]] ^ msgKeyRow[base + 0x5];
      buffer[0x1] = msgTable[tmp] ^ msgKeyRow[base + 0x1];
      
      tmp = buffer[0x02];
      buffer[0x2] = msgTable[buffer[0xa]] ^ msgKeyRow[base + 0x2];
      buffer[0xa] = msgTable[tmp] ^ msgKeyRow[base + 0xa];
      tmp = buffer[0x06];
      buffer[0x6] = msgTable[buffer[0xe]] ^ msgKeyRow[base + 0x6];
      buffer[0xe] = msgTable[tmp] ^ msgKeyRow[base + 0xe];
      
      tmp = buffer[0x3];
      buffer[0x3] = msgTable[buffer[0x7]] ^ msgKeyRow[base + 0x3];
      buffer[0x7] = msgTable[buffer[0xb]] ^ msgKeyRow[base + 0x7];
      buffer[0xb] = msgTable[buffer[0xf]] ^ msgKeyRow[base + 0xb];
      buffer[0xf] = msgTable[tmp] ^ msgKeyRow[base + 0xf];
      
      // Replace buffer with 4 words XORed together
      const block = new Uint32Array(buffer.buffer, buffer.byteOffset, 4);
      block[0] = table_s9[0x000 + buffer[0x0]] ^ table_s9[0x100 + buffer[0x1]] ^ table_s9[0x200 + buffer[0x2]] ^ table_s9[0x300 + buffer[0x3]];
      block[1] = table_s9[0x000 + buffer[0x4]] ^ table_s9[0x100 + buffer[0x5]] ^ table_s9[0x200 + buffer[0x6]] ^ table_s9[0x300 + buffer[0x7]];
      block[2] = table_s9[0x000 + buffer[0x8]] ^ table_s9[0x100 + buffer[0x9]] ^ table_s9[0x200 + buffer[0xa]] ^ table_s9[0x300 + buffer[0xb]];
      block[3] = table_s9[0x000 + buffer[0xc]] ^ table_s9[0x100 + buffer[0xd]] ^ table_s9[0x200 + buffer[0xe]] ^ table_s9[0x300 + buffer[0xf]];
    }
    
    // Another permute with table_s10
    buffer[0x0] = table_s10[(0x0 << 8) + buffer[0x0]];
    buffer[0x4] = table_s10[(0x4 << 8) + buffer[0x4]];
    buffer[0x8] = table_s10[(0x8 << 8) + buffer[0x8]];
    buffer[0xc] = table_s10[(0xc << 8) + buffer[0xc]];
    
    let tmp = buffer[0x0d];
    buffer[0xd] = table_s10[(0xd << 8) + buffer[0x9]];
    buffer[0x9] = table_s10[(0x9 << 8) + buffer[0x5]];
    buffer[0x5] = table_s10[(0x5 << 8) + buffer[0x1]];
    buffer[0x1] = table_s10[(0x1 << 8) + tmp];
    
    tmp = buffer[0x02];
    buffer[0x2] = table_s10[(0x2 << 8) + buffer[0xa]];
    buffer[0xa] = table_s10[(0xa << 8) + tmp];
    tmp = buffer[0x06];
    buffer[0x6] = table_s10[(0x6 << 8) + buffer[0xe]];
    buffer[0xe] = table_s10[(0xe << 8) + tmp];
    
    tmp = buffer[0x3];
    buffer[0x3] = table_s10[(0x3 << 8) + buffer[0x7]];
    buffer[0x7] = table_s10[(0x7 << 8) + buffer[0xb]];
    buffer[0xb] = table_s10[(0xb << 8) + buffer[0xf]];
    buffer[0xf] = table_s10[(0xf << 8) + tmp];
    
    // XOR with previous block or IV
    if (mode === 2 || mode === 1 || mode === 0) {
      if (i > 0) {
        xorBlocks(buffer, messageIn.slice(0x10 * i, 0x10 * i + 16), decryptedMessage.slice(0x10 * i, 0x10 * i + 16));
      } else {
        xorBlocks(buffer, Buffer.from(message_iv[mode]), decryptedMessage.slice(0x10 * i, 0x10 * i + 16));
      }
    } else {
      if (i < 7) {
        xorBlocks(buffer, messageIn.slice(0x70 - 0x10 * i, 0x70 - 0x10 * i + 16), decryptedMessage.slice(0x70 - 0x10 * i, 0x70 - 0x10 * i + 16));
      } else {
        xorBlocks(buffer, Buffer.from(message_iv[mode]), decryptedMessage.slice(0x70 - 0x10 * i, 0x70 - 0x10 * i + 16));
      }
    }
  }
}

function generateKeySchedule(keyMaterial: Buffer, keySchedule: number[][]): void {
  // Initialize key schedule
  for (let i = 0; i < 11; i++) {
    keySchedule[i][0] = 0xdeadbeef;
    keySchedule[i][1] = 0xdeadbeef;
    keySchedule[i][2] = 0xdeadbeef;
    keySchedule[i][3] = 0xdeadbeef;
  }
  
  const keyData = Buffer.alloc(16);
  let ti = 0;
  
  // G: t_xor
  tXor(keyMaterial, keyData);
  
  for (let round = 0; round < 11; round++) {
    // H: Store key_data[0]
    keySchedule[round][0] = keyData.readUInt32LE(0);
    
    // I: Table lookups and XOR
    const table1 = tableIndex(ti);
    const table2 = tableIndex(ti + 1);
    const table3 = tableIndex(ti + 2);
    const table4 = tableIndex(ti + 3);
    ti += 4;
    
    keyData[0] ^= table1[keyData[0x0d]] ^ index_mangle[round];
    keyData[1] ^= table2[keyData[0x0e]];
    keyData[2] ^= table3[keyData[0x0f]];
    keyData[3] ^= table4[keyData[0x0c]];
    
    // H: Store key_data[1]
    keySchedule[round][1] = keyData.readUInt32LE(4);
    
    // J: XOR
    keyData.writeUInt32LE(keyData.readUInt32LE(4) ^ keyData.readUInt32LE(0), 4);
    
    // H: Store key_data[2]
    keySchedule[round][2] = keyData.readUInt32LE(8);
    
    // J: XOR
    keyData.writeUInt32LE(keyData.readUInt32LE(8) ^ keyData.readUInt32LE(4), 8);
    
    // H: Store key_data[3]
    keySchedule[round][3] = keyData.readUInt32LE(12);
    
    // J: XOR
    keyData.writeUInt32LE(keyData.readUInt32LE(12) ^ keyData.readUInt32LE(8), 12);
  }
}

function cycle(block: Buffer, keySchedule: number[][]): void {
  const bWords = new Uint32Array(block.buffer, block.byteOffset, 4);
  
  // Initial XOR with key_schedule[10]
  bWords[0] ^= keySchedule[10][0];
  bWords[1] ^= keySchedule[10][1];
  bWords[2] ^= keySchedule[10][2];
  bWords[3] ^= keySchedule[10][3];
  
  // First permutation
  permuteBlock1(block);
  
  for (let round = 0; round < 9; round++) {
    const key0 = new Uint8Array(4);
    key0[0] = (keySchedule[9 - round][0] >> 0) & 0xff;
    key0[1] = (keySchedule[9 - round][0] >> 8) & 0xff;
    key0[2] = (keySchedule[9 - round][0] >> 16) & 0xff;
    key0[3] = (keySchedule[9 - round][0] >> 24) & 0xff;
    
    let ptr1 = table_s5[block[3] ^ key0[3]];
    let ptr2 = table_s6[block[2] ^ key0[2]];
    let ptr3 = table_s8[block[0] ^ key0[0]];
    let ptr4 = table_s7[block[1] ^ key0[1]];
    
    bWords[0] = ptr1 ^ ptr2 ^ ptr3 ^ ptr4;
    
    const key1 = new Uint8Array(4);
    key1[0] = (keySchedule[9 - round][1] >> 0) & 0xff;
    key1[1] = (keySchedule[9 - round][1] >> 8) & 0xff;
    key1[2] = (keySchedule[9 - round][1] >> 16) & 0xff;
    key1[3] = (keySchedule[9 - round][1] >> 24) & 0xff;
    
    ptr2 = table_s5[block[7] ^ key1[3]];
    ptr1 = table_s6[block[6] ^ key1[2]];
    ptr4 = table_s7[block[5] ^ key1[1]];
    ptr3 = table_s8[block[4] ^ key1[0]];
    
    bWords[1] = ptr1 ^ ptr2 ^ ptr3 ^ ptr4;
    
    const key2 = new Uint8Array(4);
    key2[0] = (keySchedule[9 - round][2] >> 0) & 0xff;
    key2[1] = (keySchedule[9 - round][2] >> 8) & 0xff;
    key2[2] = (keySchedule[9 - round][2] >> 16) & 0xff;
    key2[3] = (keySchedule[9 - round][2] >> 24) & 0xff;
    
    const key3 = new Uint8Array(4);
    key3[0] = (keySchedule[9 - round][3] >> 0) & 0xff;
    key3[1] = (keySchedule[9 - round][3] >> 8) & 0xff;
    key3[2] = (keySchedule[9 - round][3] >> 16) & 0xff;
    key3[3] = (keySchedule[9 - round][3] >> 24) & 0xff;
    
    bWords[2] = table_s5[block[11] ^ key2[3]] ^ table_s6[block[10] ^ key2[2]] ^ table_s7[block[9] ^ key2[1]] ^ table_s8[block[8] ^ key2[0]];
    bWords[3] = table_s5[block[15] ^ key3[3]] ^ table_s6[block[14] ^ key3[2]] ^ table_s7[block[13] ^ key3[1]] ^ table_s8[block[12] ^ key3[0]];
    
    permuteBlock2(block, 8 - round);
  }
  
  // Final XOR with key_schedule[0]
  bWords[0] ^= keySchedule[0][0];
  bWords[1] ^= keySchedule[0][1];
  bWords[2] ^= keySchedule[0][2];
  bWords[3] ^= keySchedule[0][3];
}

function generateSessionKey(oldSap: Buffer, messageIn: Buffer, sessionKey: Buffer): void {
  const decryptedMessage = Buffer.alloc(128);
  const newSap = Buffer.alloc(320);
  const md5 = Buffer.alloc(16);
  
  decryptMessage(messageIn, decryptedMessage);
  
  // Combine to form 5 blocks
  static_source_1.copy(newSap, 0x000);
  decryptedMessage.copy(newSap, 0x011);
  oldSap.slice(0x80).copy(newSap, 0x091);
  static_source_2.copy(newSap, 0x111);
  initial_session_key.copy(sessionKey, 0);
  
  for (let round = 0; round < 5; round++) {
    const base = newSap.slice(round * 64, round * 64 + 64);
    modifiedMd5(base, sessionKey, md5);
    sapHash(base, sessionKey);
    
    const sessionKeyWords = new Uint32Array(sessionKey.buffer, sessionKey.byteOffset, 4);
    const md5Words = new Uint32Array(md5.buffer, md5.byteOffset, 4);
    for (let i = 0; i < 4; i++) {
      sessionKeyWords[i] = (sessionKeyWords[i] + md5Words[i]) & 0xffffffff;
    }
  }
  
  // Swap bytes
  for (let i = 0; i < 16; i += 4) {
    swapBytes(sessionKey, i, i + 3);
    swapBytes(sessionKey, i + 1, i + 2);
  }
  
  // XOR with 121
  for (let i = 0; i < 16; i++) {
    sessionKey[i] ^= 121;
  }
}

function zXor(inBuf: Buffer, outBuf: Buffer, blocks: number): void {
  for (let j = 0; j < blocks; j++) {
    for (let i = 0; i < 16; i++) {
      outBuf[j * 16 + i] = inBuf[j * 16 + i] ^ z_key_buf[i];
    }
  }
}

function xXor(inBuf: Buffer, outBuf: Buffer, blocks: number): void {
  for (let j = 0; j < blocks; j++) {
    for (let i = 0; i < 16; i++) {
      outBuf[j * 16 + i] = inBuf[j * 16 + i] ^ x_key_buf[i];
    }
  }
}
