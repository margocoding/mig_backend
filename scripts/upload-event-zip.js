#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CHUNK_MB = 50;
const DEFAULT_API_URL = 'http://localhost:3000';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      args.file = arg;
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    i += 1;
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/upload-event-zip.js <path-to-zip> --token <jwt>

Options:
  --api <url>             Backend base URL. Default: ${DEFAULT_API_URL}
  --token <jwt>           Admin JWT. Can also use TOKEN env var.
  --chunk-mb <number>     Chunk size in MB. Default: ${DEFAULT_CHUNK_MB}
  --deadline <date>       orderDeadline value, for example 2026-12-23.
  --upload-id <uuid>      Resume existing upload.

Examples:
  node scripts/upload-event-zip.js D:\\archives\\event.zip --token ey...
  node scripts/upload-event-zip.js ./event.zip --api http://localhost:3000 --chunk-mb 100 --token ey...
  node scripts/upload-event-zip.js ./event.zip --upload-id 8b7... --token ey...
`);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${url} failed: ${response.status} ${text}`,
    );
  }

  return data;
}

async function withRetry(fn, label, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) break;

      const delayMs = attempt * 1500;
      console.warn(
        `${label} failed, retrying in ${delayMs}ms (${attempt}/${attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function buildHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function initUpload({ apiUrl, token, filePath, fileSize, deadline }) {
  return requestJson(`${apiUrl}/event/process/upload`, {
    method: 'POST',
    headers: buildHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      filename: path.basename(filePath),
      size: fileSize,
      orderDeadline: deadline,
    }),
  });
}

async function fetchUploadState({ apiUrl, token, uploadId }) {
  return requestJson(`${apiUrl}/event/process/upload/${uploadId}`, {
    method: 'GET',
    headers: buildHeaders(token),
  });
}

async function uploadChunk({
  apiUrl,
  token,
  uploadId,
  filePath,
  offset,
  chunkSize,
  fileSize,
}) {
  const endInclusive = Math.min(offset + chunkSize, fileSize) - 1;
  const contentLength = endInclusive - offset + 1;
  const stream = fs.createReadStream(filePath, {
    start: offset,
    end: endInclusive,
  });

  return requestJson(`${apiUrl}/event/process/upload/${uploadId}`, {
    method: 'PATCH',
    headers: buildHeaders(token, {
      'content-type': 'application/octet-stream',
      'content-length': String(contentLength),
      'upload-offset': String(offset),
    }),
    body: stream,
    duplex: 'half',
  });
}

async function completeUpload({ apiUrl, token, uploadId }) {
  return requestJson(`${apiUrl}/event/process/upload/${uploadId}/complete`, {
    method: 'POST',
    headers: buildHeaders(token),
  });
}

function formatBytes(bytes) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;

  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const filePath = path.resolve(args.file);
  const apiUrl = (args.api || process.env.API_URL || DEFAULT_API_URL).replace(
    /\/$/,
    '',
  );
  const token = args.token || process.env.TOKEN;
  const chunkMb = Number(args['chunk-mb'] || DEFAULT_CHUNK_MB);
  const chunkSize = chunkMb * 1024 * 1024;

  if (!token) {
    throw new Error('Missing --token or TOKEN env var');
  }

  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('Invalid --chunk-mb value');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${filePath} is not a file`);
  }

  const fileSize = stat.size;
  let upload;

  if (args['upload-id']) {
    upload = await fetchUploadState({
      apiUrl,
      token,
      uploadId: args['upload-id'],
    });
    console.log(
      `Resuming upload ${upload.uploadId} from ${formatBytes(upload.offset)}`,
    );
  } else {
    upload = await initUpload({
      apiUrl,
      token,
      filePath,
      fileSize,
      deadline: args.deadline,
    });
    console.log(`Created upload ${upload.uploadId}`);
  }

  let offset = upload.offset;

  while (offset < fileSize) {
    const nextEnd = Math.min(offset + chunkSize, fileSize);
    const label = `Chunk ${formatBytes(offset)}-${formatBytes(nextEnd)}`;

    const state = await withRetry(
      () =>
        uploadChunk({
          apiUrl,
          token,
          uploadId: upload.uploadId,
          filePath,
          offset,
          chunkSize,
          fileSize,
        }),
      label,
    );

    offset = state.offset;
    const percent = ((offset / fileSize) * 100).toFixed(2);
    console.log(
      `Uploaded ${formatBytes(offset)} / ${formatBytes(fileSize)} (${percent}%)`,
    );
  }

  const result = await completeUpload({
    apiUrl,
    token,
    uploadId: upload.uploadId,
  });

  console.log(result.message || 'Upload completed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
