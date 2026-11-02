// Web-standard byte operations, shared unchanged by Node and extension workers.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function fromText(value) {
  return encoder.encode(value);
}
function toText(value) {
  return decoder.decode(value);
}
function fromBase64(value) {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
function toBase64(value) {
  const parts = [];
  for (let i = 0; i < value.length; i += 16384)
    parts.push(String.fromCharCode(...value.subarray(i, i + 16384)));
  return btoa(parts.join(''));
}
function concatBytes(values) {
  const result = new Uint8Array(values.reduce((size, value) => size + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
function signature(value) {
  return String.fromCharCode(...value.subarray(0, 4));
}
module.exports = { fromText, toText, fromBase64, toBase64, concatBytes, signature };
