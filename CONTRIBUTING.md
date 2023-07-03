# Contributing

Contributions are much appreciated! 🙏

Feel to contribute:

1. Suppport ❤️ - By starring ⭐️ our repo
1. Code, Documentation - By raising PRs
1. Bug reports, feature requests - By Filing issues

# Setup

## Install the repos in sibling dirs

```
git clone git@github.com:Code-Parrot-ai/opentelemetry-js-contrib.git
git clone git@github.com:Code-Parrot-ai/opentelemetry-js.git
```

In each of the above sibling dirs, run:

```
npm i
```

For ease of development you should `npm link <full path of dep>` to the local packages. Like, I had to do

```
cd __codeparrot
npm link /Users/vedant/codeparrot/code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation-http
npm link /Users/vedant/codeparrot/code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation-grpc
npm link /Users/vedant/codeparrot/code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation
npm link /Users/vedant/codeparrot/code/opentelemetry-js-contrib/plugins/node/opentelemetry-instrumentation-pg
```

*Also see [this issue](https://github.com/npm/npm/issues/17287#issuecomment-389873586)*

Check status with `npm ls -g --depth=0 --link=true`

```
npm ls --depth=0 --link=true
/Users/vedant/.nvm/versions/node/v16.19.0/lib
├── @codeparrot/instrumentation-grpc@0.35.7 -> ./../../../../../code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation-grpc
├── @codeparrot/instrumentation-http@0.35.6 -> ./../../../../../code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation-http
├── @codeparrot/instrumentation-pg@0.34.4 -> ./../../../../../code/opentelemetry-js-contrib/plugins/node/opentelemetry-instrumentation-pg
└── @codeparrot/instrumentation@0.35.4 -> ./../../../../../code/opentelemetry-js/experimental/packages/opentelemetry-instrumentation
```

To unlink:

```
npm unlink @codeparrot/instrumentation
npm unlink @codeparrot/instrumentation-grpc
npm unlink @codeparrot/instrumentation-http
npm unlink @codeparrot/instrumentation-pg
npm unlink @codeparrot/js-agent
```

## Setup export to GCP trace

Create a local file `./agent-internal.json`. This file is provided by GCP after you have created a **service account** with appropriate permissions.

This file is ignored in git, but included in the npm package (i.e. during `npm publish`)

## Use a sample/real application to test

Since this ia a library, it can only be tested by requiring the package from a sample application. (More info in [README.md](./README.md))
