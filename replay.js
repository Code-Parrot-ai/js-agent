const process = require('node:process');
const fs = require('fs').promises;

const { diag } = require('@opentelemetry/api');
const { logAndThrow } = require('@codeparrot/instrumentation');
const { Storage } = require('@google-cloud/storage');
const { JWT } = require('google-auth-library');

const REPLAY_FILE = '/tmp/code-parrot-replay.json';
const HTTP_INDEX_FILE = '/tmp/code-parrot-replay-http-index.txt';

function commonCharacters(str1, str2) {
  let i = 0;
  while (str1[i] === str2[i] && i < str1.length && i < str2.length) {
    i++;
  }
  return i;
}

module.exports.onReplay = () => {
  process.on('exit', (code) => {
    diag.info(`About to exit with code: ${code}`);
    if (code !== 0) {
      console.trace();
    }
  });
}

module.exports.ReplayRunner = class ReplayRunner {
  static async create(jsonKeyFile, namespace, service, testWait) {
    let fileContents;
    try {
      await fs.readFile(HTTP_INDEX_FILE, 'utf8'); // check if file exists
      fileContents = await fs.readFile(REPLAY_FILE, 'utf8');
    } catch (error) {
      const namespacePrefix = namespace.split('@')[0];
      const filePath = `${namespacePrefix}/default/${service}/`;

      // Lists files in the bucket
      const storage = new Storage({ keyFilename: jsonKeyFile });
      const [files, obj, meta] = await storage.bucket('codeparrotai-common')
        .getFiles({ prefix: filePath, autoPaginate: false });

      diag.info(`Fetched Files: ${files.length}`);
      const lastFile = await files.sort()[files.length - 1].download();
      fileContents = lastFile.toString('utf8');
      await fs.writeFile(REPLAY_FILE, fileContents);
    }

    return new ReplayRunner(JSON.parse(fileContents), testWait);
  }

  constructor(json, testWait) {
    this.json = json;
    this.currentSpan = undefined;
    this.testWait = testWait;
  }

  setSpanProcessor(spanProcessor) {
    this.spanProcessor = spanProcessor;
  }

  async runHttpReplay(httpInstrumentation) {
    const httpTraces = this.json.traces.filter(trace => trace.spans[0].labels['http.target']);

    let i;
    try {
      i = Number(await fs.readFile(HTTP_INDEX_FILE, 'utf8')) + 1;
      diag.info(`runHttpReplay: http index found! Skipping last test and resuming from ${i}`);
    } catch (error) {
      i = 0;
    }

    diag.info(`http.UpstreamReplay: run(), httpTraces: ${httpTraces.length}`);
    for (; i < httpTraces.length; i++) {
      const trace = httpTraces[i];

      diag.info(`runHttpReplay ${i}: --- ${trace.spans[0].labels['/http/method']} ${trace.spans[0].labels['http.target']} : ${trace.traceId} -------->`);
      await fs.writeFile(HTTP_INDEX_FILE, i.toString());
      this.currentSpan = trace.spans[0];
      try {
        await httpInstrumentation.runReplay(trace);
      } catch (error) {
        diag.error(`runHttpReplay: continuing after ${error?.stack}`);
      }
      await this.spanProcessor.forceFlush();
      await new Promise((resolve) => setTimeout(resolve, this.testWait));
    }
  }

  async runGrpcReplay(grpcInstrumentation) {
    const grpcSpans = this.json.traces.map((trace) => trace.spans[0])
      .filter((topSpan) => topSpan.labels['cp.req.name']);

    diag.info(`gRPC.UpstreamReplay: run(), grpcSpans: ${grpcSpans.length}`);
    for (const i in grpcSpans) {
      const topSpan = grpcSpans[i];
      diag.info(`runGrpcReplay ${i}: --- ${topSpan.labels['cp.req.name']} : ${topSpan.spanId} -------->`);
      this.currentSpan = topSpan;
      try {
        grpcInstrumentation.runReplay(topSpan);
      } catch (error) {
        diag.error(`runGrpcReplay: continuing after ${error?.stack}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.testWait));
    };
  }

  async cleanUp() {
    await fs.unlink(REPLAY_FILE);
    await fs.unlink(HTTP_INDEX_FILE);
  }

  createHttpReplayResponseFn() {
    return (requestUrl, method, requestBodyStr) => {
      // in downstream http, both URL and target include query params.
      const childSpans = this.currentSpan?.children
        ?.filter(span => span.labels['/http/url']?.substring(0, 50) === requestUrl.substring(0, 50))
        || [];

      if (childSpans.length === 0) {
        diag.error(`createHttpReplayResponseFn: Could not find span for requestUrl: ${requestUrl}. Returning empty response.`);
        return [200, undefined, undefined, 'cp-no-matching-span-id'];
      }

      diag.info(`createHttpReplayResponseFn: found ${childSpans.length} spans for requestUrl: ${requestUrl}.`);

      const span = childSpans.find(span =>
        span.labels['/http/method'] === method && span.labels['http.req.body'] === requestBodyStr
      ) || childSpans[0];
      return [
        span.labels['/http/status_code'],
        span.labels['http.res.body'],
        JSON.parse(span.labels['cp.res.headers']),
        span.spanId
      ];
    }
  }

  createGrpcReplayResponseFn() {
    return (requestName, requestStr) => {
      const childSpans = this.currentSpan.children.filter(span => span.labels['cp.req.name'] === requestName);

      if (childSpans.length === 0) {
        diag.error(`createGrpcReplayResponseFn: Could not find span for requestName: ${requestName}. Returning empty response.`);
        return ['', 'cp-no-matching-span-id'];
      }

      diag.info(`createGrpcReplayResponseFn: found ${childSpans.length} spans for requestName: ${requestName}.`);
      const span = childSpans.find(span => span.labels['cp.req.body'] === requestStr) || childSpans[0];
      return [span.labels['cp.res.body'], span.spanId];
    }
  }

  createPgReplayResponseFn() {
    return (statement, values) => {
      const childSpans = this.currentSpan.children.filter(span => span.labels['db.statement']);
      // TODO, maybe get better span(s) by considering 'db.postgresql.values'

      if (childSpans.length === 0) {
        diag.error(`createPgReplayResponseFn: Could not find span for statement: ${statement}`);
        return [undefined, { rows: [] }, 'cp-no-matching-span-id'];
      }

      diag.info(`createPgReplayResponseFn: found ${childSpans.length} spans for statement: ${statement}.`);

      // the span with max number of common characters in statement is the best match
      const span = childSpans.reduce((prev, curr) => {
        const prevCommon = prev ? commonCharacters(statement, prev.labels['db.statement']) : -1;
        const currCommon = commonCharacters(statement, curr.labels['db.statement']);
        return prevCommon > currCommon ? prev : curr;
      });

      diag.info(`createPgReplayResponseFn: best match span: ${span.labels['db.statement']}`);

      if (span.labels['db.results']) {
        return [undefined, JSON.parse(span.labels['db.results']), span.spanId];
      }

      const error = new Error(span.labels['cp.error.message'] || 'error from replay data');
      Object.assign(error, {
        schema: span.labels['cp.error.schema'],
        table: span.labels['cp.error.table'],
        column: span.labels['cp.error.column'],
        dataType: span.labels['cp.error.dataType'],
        constraint: span.labels['cp.error.constraint'],
      });

      return [error, undefined, span.spanId];
    }
  }
}

module.exports.triggerOnReplayComplete = async function (jsonKeyFile, namespace, service, metadata, version) {
  diag.info(`Waiting 10s before triggering onReplayComplete`);
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const keys = require(jsonKeyFile);
  const client = new JWT({
    email: keys.client_email,
    key: keys.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const url = `https://pubsub.googleapis.com/v1/projects/innate-actor-378220/topics/cp-replay-cron:publish`;
  const data = { // uses JSON
    messages: [{
      attributes: { namespace, service, metadata, version },
    }]
  }
  const res = await client.request({ url, method: 'POST', data });
  if (res.status !== 200) {
    logAndThrow(`Failed to trigger onReplayComplete: ${res.status} ${JSON.stringify(res.data)}`);
  }
  diag.info(`Triggered onReplayComplete: ${res.status}`);
  diag.info(`Report will be available at: https://dashboard.codeparrot.ai/diff/${namespace}/${service}/${version}`);
}
