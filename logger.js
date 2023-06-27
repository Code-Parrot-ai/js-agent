const { DiagConsoleLogger } = require('@opentelemetry/api');
const { Logging } = require('@google-cloud/logging');

/**
 * Implements DiagLogger interface
 */
module.exports.CpLogger = class CpLogger {
    constructor(isReplay, keyFilename, namespace, appName, env, metadata) {
        this._labels = {
            namespace,
            appName,
            env,
            metadata,
            version: JSON.parse(metadata).version,
        }
        this._isReplay = isReplay;

        this._consoleLogger = new DiagConsoleLogger();

        this._gcpLogger = new Logging({ keyFilename })
            .log('nodejs-agent');
    }

    logToGcp(severity, message, args) {
        message = message + ' ' + args.join(' ');
        const entry = this._gcpLogger.entry({
            severity,
            labels: this._labels,
        }, { message });
        this._gcpLogger.write(entry).catch(err => {
            console.error('CP: Failed to log', err);
        });
    }

    error(message, ...args) {
        this._consoleLogger.error(message, ...args);
        this.logToGcp('ERROR', message, args);
    }

    info(message, ...args) {
        this._consoleLogger.info(message, ...args);
        if (this._isReplay) {
            this.logToGcp('INFO', message, args);
        }
    }

    debug(message, ...args) {
        this._consoleLogger.debug(message, ...args);
        if (this._isReplay) {
            this.logToGcp('DEBUG', message, args);
        }
    }

    // unsued:

    warn(message, ...args) {
        this._consoleLogger.warn(message, ...args);
        this.logToGcp('WARN', message, args);
    }
    verbose(message, ...args) {
        this._consoleLogger.verbose(message, ...args);
        if (this._isReplay) {
            this.logToGcp('VERBOSE', message, args);
        }
    }
}
