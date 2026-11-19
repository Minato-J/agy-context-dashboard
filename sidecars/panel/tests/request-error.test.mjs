import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  classifyRequestError,
  sanitizeRequestError,
  isVisibleRequestError,
  toVisibleRequestError,
  safeRequestError,
} from '../request-error.mjs';
import { TrajectoryJson } from '../trajectory-json.mjs';
import { trajectoryMetrics } from '../metrics.mjs';
import { SessionHistory, safeMetrics, reconcileMetrics } from '../history.mjs';
import { DiskStatistics } from '../disk-statistics.mjs';
import { MetricsStore } from '../store.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
const SCOPE = createHash('sha256').update('request-error-test@example.com').digest('hex');

test('classifyRequestError covers all 9 categories and priority conflicts', () => {
  assert.equal(classifyRequestError('').kind, 'none');
  assert.equal(classifyRequestError('   \r\n\t  ').kind, 'none');
  assert.equal(isVisibleRequestError(classifyRequestError('')), false);

  // Canceled (not visible)
  for (const sample of [
    'Post "https://example.invalid/private?key=secret": context canceled',
    'context cancelled by user',
    'User cancelled agent execution.',
    'AbortError: request was aborted',
  ]) {
    const res = classifyRequestError(sample);
    assert.equal(res.kind, 'canceled', sample);
    assert.equal(isVisibleRequestError(res), false);
    assert.equal(toVisibleRequestError(sample), null);
  }

  // Context overflow (visible) vs timeout guard (network_error)
  assert.equal(classifyRequestError('input token count (737355) exceeds maximum 200000').kind, 'context_overflow');
  assert.equal(classifyRequestError('prompt is too long for this model').kind, 'context_overflow');
  assert.equal(classifyRequestError('context window limit exceeded').kind, 'context_overflow');
  assert.equal(classifyRequestError('Post "https://api.example/v1": context deadline exceeded').kind, 'network_error');
  assert.equal(classifyRequestError('stream idle timeout exceeded context wait').kind, 'network_error');

  // Auth takes precedence over quota wording
  assert.equal(classifyRequestError('401 Unauthorized: invalid api key').kind, 'auth_error');
  assert.equal(classifyRequestError('401 permission denied; quota access rejected').kind, 'auth_error');
  assert.equal(classifyRequestError('PERMISSION_DENIED: credentials expired').kind, 'auth_error');

  // Service unavailable
  assert.equal(classifyRequestError('503 Service Unavailable: server overloaded').kind, 'service_unavailable');
  assert.equal(classifyRequestError('rpc error: code = Unavailable desc = high demand').kind, 'service_unavailable');

  // Network errors
  assert.equal(classifyRequestError('read tcp: ECONNRESET').kind, 'network_error');
  assert.equal(classifyRequestError('unexpected EOF during stream').kind, 'network_error');

  // Quota exhausted takes precedence over rate_limited
  assert.equal(classifyRequestError('RESOURCE_EXHAUSTED: daily quota exceeded, 429 too many requests').kind, 'quota_exhausted');
  assert.equal(classifyRequestError('You are out of quota for this billing cycle').kind, 'quota_exhausted');

  // Rate limited + retryAfterSec extraction and waitTime Duration fallback
  const rlInline = classifyRequestError('429 Too Many Requests: retry in 30s', { waitTime: '99s' });
  assert.equal(rlInline.kind, 'rate_limited');
  assert.equal(rlInline.retryAfterSec, 30);

  const rlStr = classifyRequestError('HTTP 429 rate limit hit', { waitTime: '12.5s' });
  assert.equal(rlStr.kind, 'rate_limited');
  assert.equal(rlStr.retryAfterSec, 12.5);

  const rlObj = classifyRequestError('Too many requests', { waitTime: { seconds: 45, nanos: 500000000 } });
  assert.equal(rlObj.kind, 'rate_limited');
  assert.equal(rlObj.retryAfterSec, 45.5);

  const rlZero = classifyRequestError('429 rate limit', { waitTime: '0s' });
  assert.equal(rlZero.kind, 'rate_limited');
  assert.equal(rlZero.retryAfterSec, null);

  // Unknown fallback
  const unk = classifyRequestError('something unexpected happened in backend');
  assert.equal(unk.kind, 'unknown');
  assert.equal(isVisibleRequestError(unk), true);
});

test('sanitizeRequestError redacts URLs, secrets, emails, paths and caps at 400 chars', () => {
  const raw = [
    'Post "https://example.invalid/private?key=secret":',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
    'x-codeium-csrf-token=tok_1234567890',
    'api_key=sk-ant-1234567890abcdef',
    'cookie=session=xyz',
    'user=alice.smith@corp.example.com',
    'at C:\\Users\\alice\\AppData\\Local\\secret.json',
    'and /Users/alice/.gemini/token.txt',
    '\r\n\t<script>alert(1)</script>',
  ].join('\n');

  const out = sanitizeRequestError(raw);
  assert.ok(out.includes('<API>'));
  assert.ok(!out.includes('example.invalid'));
  assert.ok(!out.includes('eyJhbGciOi'));
  assert.ok(!out.includes('tok_1234567890'));
  assert.ok(!out.includes('sk-ant-1234567890abcdef'));
  assert.ok(!out.includes('session=xyz'));
  assert.ok(!out.includes('alice.smith@corp.example.com'));
  assert.ok(!out.includes('C:\\Users\\alice'));
  assert.ok(!out.includes('/Users/alice'));
  assert.ok(out.includes('<EMAIL>'));
  assert.ok(out.includes('<PATH>'));
  assert.ok(!/[\r\n\t]/.test(out));
  assert.ok(out.includes('<script>alert(1)</script>'));

  const longOut = sanitizeRequestError('x'.repeat(1200));
  assert.equal(longOut.length, 400);
});

test('TrajectoryJson projects retryInfos error/retryReason/waitTime and truncates 20 KiB errors safely', () => {
  const hugeError = '429 Too Many Requests: ' + 'E'.repeat(24 * 1024);
  const payload = JSON.stringify({
    generatorMetadata: [
      {
        stepIndices: [1],
        chatModel: {
          modelDisplayName: 'Gemini 4 Argon',
          retryInfos: [
            { error: 'ECONNRESET', retryReason: 'RETRY_REASON_API_RETRYABLE', waitTime: '2s' },
            { error: hugeError, retryReason: 'RETRY_REASON_NON_RECOVERABLE', waitTime: { seconds: 15, nanos: 0 } },
          ],
        },
      },
    ],
  });

  const parser = new TrajectoryJson();
  // Stream in small slices to verify incremental boundary truncation.
  for (let i = 0; i < payload.length; i += 37) parser.write(payload.slice(i, i + 37));
  const projected = parser.end();
  const retries = projected.generatorMetadata[0].chatModel.retryInfos;
  assert.equal(retries.length, 2);
  assert.equal(retries[0].error, 'ECONNRESET');
  assert.equal(retries[0].waitTime, '2s');
  assert.equal(retries[1].error.length, 2048);
  assert.ok(retries[1].error.startsWith('429 Too Many Requests: '));
  assert.equal(retries[1].retryReason, 'RETRY_REASON_NON_RECOVERABLE');
  assert.deepEqual(retries[1].waitTime, { seconds: 15, nanos: 0 });
});

test('trajectoryMetrics preserves 0-token failures, shields TPS, and clears on retry/subsequent success', () => {
  const okGen = (id, out = 100) => ({
    stepIndices: [0],
    chatModel: {
      modelDisplayName: 'Gemini 4 Hydrogen',
      streamingDuration: '2s',
      timeToFirstToken: '0.5s',
      usage: {
        messageId: id,
        inputTokens: '100',
        outputTokens: String(out),
        responseOutputTokens: String(out),
        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      },
      retryInfos: [{ usage: { outputTokens: String(out) } }],
    },
  });

  // 1. Brand-new conversation with 0-token failure (no usage field)
  const zeroTok = trajectoryMetrics({
    trajectory: {
      cascadeId: ID,
      steps: [],
      generatorMetadata: [{
        chatModel: {
          retryInfos: [{ error: 'HTTP 429 Too Many Requests', waitTime: '18s' }],
        },
      }],
    },
  });
  assert.equal(zeroTok.requests, 0);
  assert.equal(zeroTok.latestTps, null);
  assert.deepEqual(zeroTok.requestError, {
    kind: 'rate_limited',
    retryAfterSec: 18,
    diagnostic: 'HTTP 429 Too Many Requests',
  });

  // 2. Failed request with partial usage must NOT pollute latestTps / tps
  const failedWithUsage = trajectoryMetrics({
    trajectory: {
      cascadeId: ID,
      steps: [],
      generatorMetadata: [
        okGen('m1', 100), // 50 tok/s
        {
          chatModel: {
            streamingDuration: '0.01s',
            usage: {
              messageId: 'm2',
              inputTokens: '50',
              outputTokens: '500',
              responseOutputTokens: '500',
              apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            },
            retryInfos: [{ error: '503 Service Unavailable' }],
          },
        },
      ],
    },
  });
  assert.equal(failedWithUsage.requests, 1);
  assert.equal(failedWithUsage.latestTps, 50);
  assert.equal(failedWithUsage.tps, 50);
  assert.equal(failedWithUsage.requestError?.kind, 'service_unavailable');

  // 3. Same request fails first then succeeds on final retry -> clears automatically
  const retryRecovered = trajectoryMetrics({
    trajectory: {
      cascadeId: ID,
      steps: [],
      generatorMetadata: [{
        chatModel: {
          streamingDuration: '2s',
          usage: {
            messageId: 'm3',
            inputTokens: '100',
            outputTokens: '120',
            responseOutputTokens: '120',
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
          },
          retryInfos: [
            { error: 'read tcp: ECONNRESET' },
            { error: '', usage: { outputTokens: '120' } },
          ],
        },
      }],
    },
  });
  assert.equal(retryRecovered.requestError, null);
  assert.equal(retryRecovered.latestTps, 60);

  // 4. Subsequent successful request after earlier failure -> clears automatically
  const laterSuccess = trajectoryMetrics({
    trajectory: {
      cascadeId: ID,
      steps: [],
      generatorMetadata: [
        { chatModel: { retryInfos: [{ error: '401 Unauthorized' }] } },
        okGen('m4', 80),
      ],
    },
  });
  assert.equal(laterSuccess.requestError, null);
  assert.equal(laterSuccess.latestTps, 40);

  // 5. Canceled final request -> requestError is null
  const canceled = trajectoryMetrics({
    trajectory: {
      cascadeId: ID,
      steps: [],
      generatorMetadata: [{
        chatModel: { retryInfos: [{ error: 'context canceled' }] },
      }],
    },
  });
  assert.equal(canceled.requestError, null);
});

test('history-v1 never persists requestError, DiskStatistics matches foreground, and MetricsStore handles live vs cached states', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-pulse-reqerr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const history = new SessionHistory(join(dir, 'history-v1'));
  const rawFailed = {
    trajectory: {
      cascadeId: ID,
      steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: '2026-11-19T10:00:00Z' } }],
      generatorMetadata: [
        {
          stepIndices: [0],
          chatModel: {
            modelDisplayName: 'Gemini 4 Hydrogen',
            streamingDuration: '2s',
            usage: {
              messageId: 'm1',
              inputTokens: '100',
              outputTokens: '100',
              responseOutputTokens: '100',
              apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            },
            chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 1000, maxContextTokens: 100000 } },
          },
        },
        {
          stepIndices: [0],
          chatModel: {
            retryInfos: [{ error: '429 Too Many Requests: retry in 25s' }],
          },
        },
      ],
    },
    numTotalSteps: 1,
    numTotalGeneratorMetadata: 2,
    status: 'CASCADE_RUN_STATUS_IDLE',
  };

  // Foreground metrics vs DiskStatistics parity
  const fg = trajectoryMetrics(rawFailed);
  const disk = new DiskStatistics({ file: join(dir, 'stats.sqlite'), conversationId: ID });
  try {
    disk.addStep(0, rawFailed.trajectory.steps[0]);
    disk.addGenerator(0, rawFailed.trajectory.generatorMetadata[0]);
    disk.addGenerator(1, rawFailed.trajectory.generatorMetadata[1]);
    const bg = disk.finish({ status: rawFailed.status, numTotalSteps: 1, numTotalGeneratorMetadata: 2 });
    assert.deepEqual(bg.metrics.requestError, fg.requestError);
    assert.equal(bg.metrics.latestTps, fg.latestTps);
    assert.equal(bg.metrics.latestTps, 50);
  } finally {
    disk.close();
  }

  // safeMetrics and disk history-v1 must strip requestError
  assert.equal(Object.hasOwn(safeMetrics(fg, ID), 'requestError'), false);
  await history.save(SCOPE, ID, fg);
  const onDisk = JSON.parse(await readFile(join(dir, 'history-v1', SCOPE, `${ID}.json`), 'utf8'));
  assert.equal(Object.hasOwn(onDisk.metrics, 'requestError'), false);

  // reconcileMetrics passes through live requestError even in shouldKeepSaved branch and never revives stale
  const reconciled = reconcileMetrics(onDisk.metrics, { ...fg, complete: false }, onDisk.savedAt);
  assert.deepEqual(reconciled.requestError, fg.requestError);
  const cleared = reconcileMetrics(reconciled, { ...fg, requestError: null }, onDisk.savedAt);
  assert.equal(cleared.requestError, null);

  // MetricsStore: live acceptBackground keeps requestError in memory, not on disk; cachedSession clears to null
  const fakeClient = {
    server: { pid: 100, port: 12345, csrf: 'tok' },
    async discover() { return this.server; },
    async call(method) {
      if (method === 'GetUserStatus') return { userStatus: { email: 'request-error-test@example.com' } };
      if (method === 'RetrieveUserQuotaSummary') return { groups: [] };
      return {};
    },
    async trajectory() { return rawFailed; },
  };
  const store = new MetricsStore(fakeClient, { history, background: null, transcripts: null });
  t.after(() => store.dispose());

  const liveSnap = await store.snapshot({ conversationId: ID, force: true });
  assert.deepEqual(liveSnap.speed?.requestError, {
    kind: 'rate_limited',
    retryAfterSec: 25,
    diagnostic: '429 Too Many Requests: retry in 25s',
  });

  // acceptBackground path preserves in-memory requestError while stripping disk file
  await store.acceptBackground(SCOPE, ID, { metrics: fg, delegatedIds: [] }, {
    database: join(dir, 'stats.sqlite'),
    revision: 'rev1',
    isCurrent: () => true,
  });
  assert.deepEqual(store.sessions.get(ID).data.requestError, fg.requestError);
  const onDiskAfterBg = JSON.parse(await readFile(join(dir, 'history-v1', SCOPE, `${ID}.json`), 'utf8'));
  assert.equal(Object.hasOwn(onDiskAfterBg.metrics, 'requestError'), false);

  // Offline/cached fallback must never show stale requestError
  const cached = await store.cachedSession(ID);
  assert.equal(cached?.requestError, null);

  // safeRequestError rejects non-visible / malformed objects
  assert.equal(safeRequestError({ kind: 'canceled', retryAfterSec: null, diagnostic: 'x' }), null);
  assert.equal(safeRequestError({ kind: 'quota_exhausted', retryAfterSec: 10, diagnostic: 'https://a.test/k' }).retryAfterSec, null);
  assert.equal(safeRequestError({ kind: 'quota_exhausted', retryAfterSec: 10, diagnostic: 'https://a.test/k' }).diagnostic, '<API>');
});
