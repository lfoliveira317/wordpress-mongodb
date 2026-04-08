'use strict';

const crypto = require('node:crypto');

function sha1(...parts) {
  const hash = crypto.createHash('sha1');
  for (const part of parts) {
    if (part) {
      hash.update(part);
    }
  }
  return hash.digest();
}

function xorBuffers(left, right) {
  const output = Buffer.allocUnsafe(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] ^ right[index];
  }
  return output;
}

function doubleSha1(password) {
  return sha1(sha1(password));
}

function verifyToken(scramble1, scramble2, token, passwordDoubleSha) {
  const stage1 = xorBuffers(token, sha1(scramble1, scramble2, passwordDoubleSha));
  const candidate = sha1(stage1);
  return candidate.compare(passwordDoubleSha) === 0;
}

module.exports = {
  doubleSha1,
  verifyToken,
};
