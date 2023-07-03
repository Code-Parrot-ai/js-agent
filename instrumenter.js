const { HttpInstrumentation } = require("@codeparrot/instrumentation-http");
const opentelemetry = require("@opentelemetry/sdk-node");
const { PgInstrumentation } = require("@codeparrot/instrumentation-pg");
const { TraceExporter } = require("@google-cloud/opentelemetry-cloud-trace-exporter");
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis-4');
const { GrpcInstrumentation } = require('@codeparrot/instrumentation-grpc')
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
const { cpSetAttribute } = require('@codeparrot/instrumentation');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

const { env } = require('node:process');
const { hostname } = require("node:os");

const { CpLogger } = require('./logger');
const { ReplayRunner, triggerOnReplayComplete, onReplay } = require('./replay');

const isReplay = env.CODE_PARROT_IS_REPLAY === 'true';
let jsonKeyFile = env.CODE_PARROT_JSON_KEY_FILE;
const appName = env.CODE_PARROT_APP_NAME || 'nodeJS-app';
const samplingRatio = env.CODE_PARROT_SAMPLING_RATIO ?? 1.0;
const envName = isReplay ? 'replay' : env.CODE_PARROT_ENV_NAME || 'default';
const version = env.CODE_PARROT_VERSION;

// span processor. Default is BatchSpanProcessor. Implement anonymiser here maybe?

if (!jsonKeyFile) {
    console.info(`CODE_PARROT_JSON_KEY_FILE env variable not set. Sending data to common cloud!`);
    console.info(`DO NOT USE THIS IN PRODUCTION! Nor with sensitive data!`);

    jsonKeyFile = `${__dirname}/agent-internal.json`;
}
const namespace = require(jsonKeyFile)['client_email'];

function getVersion() {
    if (version) {
        return version;
    }

    try {
        const { execSync } = require('child_process');
        const gitVersion = execSync('git describe --tags --always').toString().trim();
        return gitVersion;
    } catch (e) {
        if (isReplay) {
            throw e;
        }

        console.error(`Failed to get git version: ${e}`);
        return 'unknown';
    }
}

const metadata = JSON.stringify({
    hostname: hostname(),
    version: getVersion(),
});


const { diag, DiagLogLevel } = require('@opentelemetry/api');
diag.setLogger(
    new CpLogger(isReplay, jsonKeyFile, namespace, appName, envName, metadata),
    env.CODE_PARROT_DEBUG ? DiagLogLevel.DEBUG : DiagLogLevel.INFO
);


if (isReplay) {
    global.CODE_PARROT_IS_REPLAY = true;
}

const spanProcessor = new BatchSpanProcessor(new TraceExporter({ keyFile: jsonKeyFile }));
const grpcInstrumentation = new GrpcInstrumentation();
const httpInstrumentation = new HttpInstrumentation({}, isReplay);
const pgInstrumentation = new PgInstrumentation({
    enhancedDatabaseReporting: true,
    responseHook: (span, responseInfo) => {
        const data = {
            rows: responseInfo.data.rows,

            // in case of INSERT, UPDATE, etc., only this field is populated:
            rowCount: responseInfo.data.rowCount,
        };
        cpSetAttribute(span, 'db.results', JSON.stringify(data));
    }
});


const sdk = new opentelemetry.NodeSDK({
    spanProcessor: spanProcessor,
    instrumentations: [
        httpInstrumentation,
        pgInstrumentation,
        new RedisInstrumentation({
            dbStatementSerializer: (cmdName, cmdArgs) => {
                return JSON.stringify({ cmd: cmdName, args: cmdArgs });
            },
            responseHook: (span, cmdName, cmdArgs, response) => {
                cpSetAttribute(span, 'db.response', JSON.stringify(response));
            }
        }),
        grpcInstrumentation,
    ],
    resource: new Resource({
        // we can use only these 4 attribute names. GCP exporter removes the others.

        // g.co/r/generic_task/namespace. :
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: namespace,
        // g.co/r/generic_task/job. :
        [SemanticResourceAttributes.SERVICE_NAME]: appName,
        // g.co/r/generic_task/task_id. Used as version:
        [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: getVersion(),

        // g.co/r/generic_task/location. Used as env:
        [SemanticResourceAttributes.CLOUD_AVAILABILITY_ZONE]: envName,
    }),
    spanLimits: {
        attributeValueLengthLimit: 1024, // 1KB
        attributeCountLimit: 100,
    },
    sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(samplingRatio),
    }),
});


if (isReplay) {
    onReplay();
    const replayDelay = Number(env.CODE_PARROT_REPLAY_DELAY_SECONDS ?? 5) * 1000;
    const testWait = Number(env.CODE_PARROT_REPLAY_TEST_WAIT_MS ?? 10);

    setTimeout(async () => {
        diag.info(`Replay delay of ${replayDelay}ms is over. Starting replay...`);
        const replayRunner = await ReplayRunner.create(jsonKeyFile, namespace, appName, testWait);
        httpInstrumentation.setReplayResponseFn(replayRunner.createHttpReplayResponseFn());
        grpcInstrumentation.setReplayResponseFn(replayRunner.createGrpcReplayResponseFn());
        pgInstrumentation.setReplayResponseFn(replayRunner.createPgReplayResponseFn());
        replayRunner.setSpanProcessor(spanProcessor);
        await spanProcessor.forceFlush();
        sdk.start();
        console.log(`@codeparrot/js-agent, 1.2.7, ${namespace}, ${appName}, in ${envName}`);
        await replayRunner.runHttpReplay(httpInstrumentation);
        await replayRunner.runGrpcReplay(grpcInstrumentation);

        sdk.shutdown();
        await triggerOnReplayComplete(jsonKeyFile, namespace, appName, metadata, getVersion());
        diag.info(`Replay is over. Exiting...`);
        await replayRunner.cleanUp();
        process.exit(0);
    }, replayDelay);
} else {
    sdk.start();
    console.log(`@codeparrot/js-agent, 1.2.7, ${namespace}, ${appName}, in ${envName}`);
}
