'use strict';

const _ = require('lodash');

class AwsCompileLogEvents {
    constructor(serverless) {
        this.serverless = serverless;
        this.provider = 'aws';

        this.hooks = {
            'deploy:compileEvents': this.compileLogEvents.bind(this),
        }
    }

    compileLogEvents() {
        this.serverless.service.getAllFunctions().forEach((functionName) => {
            const functionObj = this.serverless.service.getFunction(functionName);

            if(functionObj.events) {
                for (let i = 0; i < functionObj.events.length; i++) {
                    const event = functionObj.events[i];
                    if (event.logs) {

                        let logGroupName;
                        let filterPattern = '';

                        if (typeof event.logs === 'object') {
                            if (event.logs.LogGroupName) {
                                logGroupName = event.logs.LogGroupName;
                            } else if (event.logs.functionName) {
                                logGroupName = `/aws/lambda/${event.logs.functionName}`
                            }
                        } else if (typeof event.logs === 'string') {
                            logGroupName = event.logs;
                        } else {
                            const errorMessage = [
                                `Logs event of function ${functionName} is not an object nor a string`,
                                ' The correct syntax is: logs: LogGroupName',
                                ' OR an object with "LogGroupName" AND "FilterPattern" properties.',
                                ' Please check the docs for more info.',
                            ].join('');
                            throw new this.serverless.classes
                                .Error(errorMessage);
                        }

                        const logSubscriptionTemplate = `
                        {
                            "SubscriptionFilter" : {
                                "Type" : "AWS::Logs::SubscriptionFilter",
                                "Properties" : {
                                    "LogGroupName" : { "Ref" : "${logGroupName}" },
                                    "FilterPattern" : "${filterPattern}",
                                    "DestinationArn" : { "Fn::GetAtt" : [ "${functionName}", "Arn" ] }
                                }
                            }
                        }
                        `;

                        const newLogSubscription = {
                            [`${functionName}LogEvents${i}`]: JSON.parse(logSubscriptionTemplate),
                        };
                
                        _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
                                newLogSubscription);
                    }
                }
            }
        });
    }
}