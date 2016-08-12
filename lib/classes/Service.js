'use strict';

const SError = require('./Error').SError;
const path = require('path');
const _ = require('lodash');
const traverse = require('traverse');
const replaceall = require('replaceall');
const BbPromise = require('bluebird');

class Service {

  constructor(serverless, data) {
    this.serverless = serverless;

    // Default properties
    this.service = null;
    this.provider = {};
    this.defaults = {
      stage: 'dev',
      region: 'us-east-1',
      variableSyntax: '\\${([\\s\\S]+?)}',
    };
    this.custom = {};
    this.plugins = [];
    this.functions = {};
    this.environment = {};
    this.resources = {};
    this.package = {};

    if (data) this.update(data);
  }

  load(rawOptions) {
    const that = this;
    const options = rawOptions || {};
    options.stage = options.stage || options.s;
    options.region = options.region || options.r;
    const servicePath = that.serverless.config.servicePath;

    // skip if the service path is not found
    // because the user might be creating a new service
    if (!servicePath) {
      return BbPromise.resolve();
    }

    let serverlessYmlPath = path.join(servicePath, 'serverless.yml');
    // change to serverless.yaml if the file could not be found
    if (!this.serverless.utils.fileExistsSync(serverlessYmlPath)) {
      serverlessYmlPath = path
        .join(this.serverless.config.servicePath, 'serverless.yaml');
    }

    return that.serverless.yamlParser
      .parse(serverlessYmlPath)
      .then((serverlessYmlParam) => {
        const serverlessYml = serverlessYmlParam;
        // basic service level validation
        if (!serverlessYml.service) {
          throw new SError('"service" property is missing in serverless.yml');
        }
        if (!serverlessYml.provider) {
          throw new SError('"provider" property is missing in serverless.yml');
        }
        if (!serverlessYml.functions) {
          throw new SError('"functions" property is missing in serverless.yml');
        }

        // setup function.name property
        _.forEach(that.functions, (functionObj, functionName) => {
          if (!functionObj.name) {
            that.functions[functionName].name = `${that.service}-${options.stage}-${functionName}`;
          }
        });

        if (typeof serverlessYml.provider !== 'object') {
          const providerName = serverlessYml.provider;
          serverlessYml.provider = {
            name: providerName,
          };
        }

        if (['aws', 'azure', 'google', 'ibm'].indexOf(serverlessYml.provider.name)) {
          const errorMessage = [
            `Provider "${serverlessYml.provider.name}" is not supported.`,
            ' Valid values for provider are: aws, azure, google, ibm.',
            ' Please provide one of those values to the "provider" property in serverless.yml.',
          ].join('');
          throw new SError(errorMessage);
        }

        that.service = serverlessYml.service;
        that.provider = serverlessYml.provider;
        that.custom = serverlessYml.custom;
        that.plugins = serverlessYml.plugins;
        that.resources = serverlessYml.resources;
        that.functions = serverlessYml.functions;

        _.forEach(that.functions, (functionObj, index) => {
          if (!functionObj.events) {
            that.functions[index].events = [];
          }
        });

        if (serverlessYml.package && serverlessYml.package.artifact) {
          that.package.artifact = serverlessYml.package.artifact;
        }
        if (serverlessYml.package && serverlessYml.package.exclude) {
          that.package.exclude = serverlessYml.package.exclude;
        }
        if (serverlessYml.package && serverlessYml.package.include) {
          that.package.include = serverlessYml.package.include;
        }

        if (serverlessYml.defaults && serverlessYml.defaults.stage) {
          this.defaults.stage = serverlessYml.defaults.stage;
        }
        if (serverlessYml.defaults && serverlessYml.defaults.region) {
          this.defaults.region = serverlessYml.defaults.region;
        }
        if (serverlessYml.defaults && serverlessYml.defaults.variableSyntax) {
          this.defaults.variableSyntax = serverlessYml.defaults.variableSyntax;
        }
      });
  }

  populate(options) {
    const that = this;
    const variableSyntaxProperty = this.defaults.variableSyntax;
    const variableSyntax = RegExp(variableSyntaxProperty, 'g');

    // temporally remove variable syntax from service otherwise it'll match
    this.defaults.variableSyntax = true;

    /*
     * we can't use an arrow function in this case cause that would
     * change the lexical scoping required by the traverse module
     */
    traverse(this).forEach(function (propertyParam) {
      const t = this;
      let property = propertyParam;

      // check if the current string is a variable
      if (typeof(property) === 'string' && property.match(variableSyntax)) {
        // get all ${src.var} in the string
        property.match(variableSyntax).forEach((matchedString) => {
          const variableString = matchedString
            .replace(variableSyntax, (match, varName) => varName.trim());

          /*
           * File Reference
           */
          if (variableString.substring(0, 4) === 'file') {



            /*
             * Env Var Reference
             */
          } else if (variableString.split('.')[0] === 'env') {
            if (variableString.split('.').length !== 2) {
              const errorMessage = [
                'Trying to access sub properties of environment',
                ' variable strings, or trying to reference all environment variables.',
              ].join('');
              throw new SError(errorMessage);
            }
            const requestedEnvVar = variableString.split('.')[1];
            const propertyValue = process.env[requestedEnvVar];
            property = replaceall(matchedString, propertyValue, property);

          /*
           * Options Reference
           */
          } else if (variableString.split('.')[0] === 'opt') {
            if (variableString.split('.').length === 1) {
              // load all options object
              if (property === matchedString) {
                property = options;
              } else {
                const errorMessage = [
                  'Trying to reference all options object as a substring.',
                  ' Please make sure the string referencing the variable',
                  ' Does not contain any other sub-strings,',
                  ' or reference a specific option string.',
                ].join('');
                throw new SError(errorMessage);
              }
            } else if (variableString.split('.').length === 2) {
              // load specific option
              const requestedOption = variableString.split('.')[1];
              const propertyValue = options[requestedOption];

              property = replaceall(matchedString, propertyValue, property);
            } else {
              const errorMessage = [
                'Trying to reference a specific option sub properties.',
                ' Each passed option can only be a string, not objects.',
                ' Please make sure you only reference the option string',
                ' without any other dot notation.',
              ].join('');
              throw new SError(errorMessage);
            }

            /*
             * Self Reference
             */
          } else if (variableString.split('.')[0] === 'self') {
            let value = _.cloneDeep(that);
            const selfSubProperties = variableString.split('.');
            // remove first element. It's the "self" keyword
            selfSubProperties.splice(0, 1);
            selfSubProperties.forEach(selfSubProperty => {
              if (!value[selfSubProperty]) {
                const errorMessage = [
                  `serverless.yml doesn't have sub property "${selfSubProperty}".`,
                  ' Please make sure you are referencing the correct sub property',
                ].join('');
                throw new that.serverless.classes
                  .Error(errorMessage);
              }
              value = value[selfSubProperty];
            });

            if (typeof value === 'string') {
              property = replaceall(variableSyntax, value, property);
            } else {
              if (property !== variableSyntax) {
                const errorMessage = [
                  'Trying to populate non string value into',
                  ' a string when referencing "self".',
                  ' Please make sure the value of the property',
                  '  is a string',
                ].join('');
                throw new that.serverless.classes
                  .Error(errorMessage);
              }
              property = value;
            }
          } else {
            const errorMessage = [
              `Invalid variable reference syntax for variable ${matchedString}.`,
              ' You can only reference env vars, options, & files.',
              ' You can check our docs for more info.',
            ].join('');
            throw new SError(errorMessage);
          }
        });

        // Replace
        t.update(property);
      }
    });

    // put back variable syntax that we removed earlier
    this.defaults.variableSyntax = variableSyntaxProperty;
    return this;
  }

  update(data) {
    return _.merge(this, data);
  }

  getAllFunctions() {
    return Object.keys(this.functions);
  }

  getFunction(functionName) {
    if (functionName in this.functions) {
      return this.functions[functionName];
    }
    throw new SError(`Function "${functionName}" doesn't exist in this Service`);
  }

  getEventInFunction(eventName, functionName) {
    if (eventName in this.getFunction(functionName).events) {
      return this.getFunction(functionName).events[eventName];
    }
    throw new SError(`Event "${eventName}" doesn't exist in function "${functionName}"`);
  }

  getAllEventsInFunction(functionName) {
    return Object.keys(this.getFunction(functionName).events);
  }
}

module.exports = Service;
