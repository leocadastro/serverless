# Compile Cloudwatch Logs Events

This plugins compiles the function Logs event to a CloudFormation resource.

## How it works

`Compile Cloudwatch Logs Events` hooks into the [`deploy:compileEvents`](/lib/plugins/deploy) lifecycle.

It loops over all functions which are defined in `serverless.yml`. For each function that has a SNS event defined,
a corresponding  topic will be created.

You have two options to define the Logs event:

The first one is to use a simple string which defines the "Log Group Name" for SNS. The lambda function will be triggered
every time a message is sent to this topic.

The second option is to define the SNS event more granular (e.g. the "Topic name" and the "Display name") with the help of
key value pairs.