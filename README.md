# What is CodeParrot?

### Get a change report on response body, latency & error rates of your APIs!

![Example Diff](https://storage.googleapis.com/codeparrot-public/example-diff.png)

<sub>An Example Diff</sub>

CodeParrot uses AI and production traffic to generate a **change report**. This report gives you insights on differences in response body for all unique requests coming to your service!

It works by "recording" production (or staging env) traffic. Our AI figures out the unique API calls from this traffic, and also mocks the downstream dependencies! *Magic right?!* 🤯

Then for every PR, the above unique API calls are run against the new version of code. Its like- auto-generated functional tests (API calls for a service, with dependencies mocked).

# Installation

## Step 1 - Install the nodeJs "record" agent

1. Install  the CodeParrot dependency `@codeparrot/js-agent` by running

    ```bash
    npm install @codeparrot/js-agent
    ```

    This will add a dependency `"@codeparrot/js-agent": "^1.2.3"`, in your `package.json`

2. Update the `node` start app command with `-r @codeparrot/js-agent`, like

   ```json
   "scripts": {
       "server": "node -r @codeparrot/js-agent index.js"
   }
   ```

This basically `require`’s the code parrot agent package **before** your application code.

If you are using pm2 to run your application, then the following syantx can help you get started
```javascript
module.exports = {
  apps : [{
    name   : "app1",
    script : "./app.js",
    node_args: "--require @codeparrot/js-agent",
    env_production: {
      NODE_ENV: "production",
      CODE_PARROT_JSON_KEY_FILE: "/path-to-file/agent-file.json",
      CODE_PARROT_APP_NAME: "test-app-1",
      CODE_PARROT_VERSION: "0.0.1",
   },
  }]
}
```

### Set the following env variable:

```bash
# set it to your *unique* service name
CODE_PARROT_APP_NAME=<service-name>
```
> **_NOTE:_** The environment variables have to be set before the agent is pre-loaded. For example, if you are using dotenv to load environment variable in your app, then these variables won't be available to the codeparrot js-agent.

When you start your nodeJS application and see a log line like:

```
@codeparrot/js-agent, v1.2.5 nodejs-agent-<...>gserviceaccount.com
```

CodeParrot record is set up! 🎉 Use your application as normal, and CodeParrot will record the network traffic.

## Step 2 - Install GitHub App

Install the [CodeParrot GitHub App](https://github.com/apps/codeparrot-app) in the repo(s) that already have replay set up. *(It asks for the minimum possible permissions)*

Then, create 2 new files:

1. `codeparrot-replay.Dockerfile`
2. `codeparrot.sh`

to run the tests. Every code push, this Dockerfile is built and run. This new Dockerfile is almost as same as your existing one, except that it sets the `CMD` to run `codeparrot.sh` instead of the usual `npm start`.

> **_NOTE:_** You don't have to provision docker, you just provide the dockerfile, and our github app runs this in cloud so that it is able to generate diff report. The onus is on us.

`codeparrot.sh` runs your app start command (like `npm start`) in a loop, until all the tests execute.

Example `codeparrot.sh` :

```bash
#!/bin/sh

while :
do
    CODE_PARROT_IS_REPLAY=true npm start && break
    echo "Non-zero exit! Restarting replay..."
done
```

Example `codeparrot-replay.Dockerfile` :

```bash
# ... existing app setup

COPY codeparrot.sh ./codeparrot.sh

CMD ["sh", "./codeparrot.sh"]
```

Now, in every PR, a GitHub "check" with a link to the Change Report will appear: 🎉

![GitHub Check](https://storage.googleapis.com/codeparrot-public/Screenshot%20git%20hub%20check.png)


# Contributing, Self Setup

Refer to [CONTRIBUTING.md](./CONTRIBUTING.md)
