/**
* Copyright 2018 Awear Solutions Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

module.exports = function (RED) {
    "use strict";
    const EventEmitter = require('events').EventEmitter;
    const appEnv = require('cfenv').getAppEnv();
    const mongodb = require('mongodb');
    const forEachIteration = new Error("node-red-contrib-mongodb3 forEach iteration");
    const forEachEnd = new Error("node-red-contrib-mongodb3 forEach end");

    function checkServerIdentity(servername, cert) {
        try {
            if (cert && cert.subject && servername !== String(cert.subject.CN)) {
                return 'servername \'' + servername + '\' does not equal CN \''
                    + cert.subject.CN + '\' of server cert.';
            }
        } catch (e) {
            console.warn(e);
            return undefined;
        }
        return undefined;
    }

    function sendMsg(node, msg) {
        node.send([msg, null]);
    }

    function sendError(node, msg, error) {
        const err = error || 'unknown error';
        if(msg) {
            node.error(err, msg);
            msg = RED.util.cloneMessage(msg);
            msg.error = err;
            node.send([null, msg]);
        } else {
            node.error(err);
        }
    }

    let services = [];
    Object.keys(appEnv.services).forEach(function (label) {
        if ((/^mongo/i).test(label)) {
            services = services.concat(appEnv.services[label].map(function (service) {
                return {
                    "name": service.name,
                    "label": service.label
                };
            }));
        }
    });

    const operations = {};
    Object.keys(mongodb.Collection.prototype).forEach(function (operationName) {
        if ('function' == typeof Object.getOwnPropertyDescriptor(mongodb.Collection.prototype, operationName).value) {
            operations[operationName] = mongodb.Collection.prototype[operationName];
        }
    });
    // We don't want to pass the find-operation's cursor directly.
    delete operations.find;

    operations['find.toArray'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.find.apply(this, args).toArray(callback);
    };
    operations['find.forEach'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.find.apply(this, args).forEach(function (doc) {
            return callback(forEachIteration, doc);
        }, function (err) {
            return callback(err || forEachEnd);
        });
    };

    // We don't want to pass the aggregate's cursor directly.
    delete operations.aggregate;
    operations['aggregate.toArray'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.aggregate.apply(this, args).toArray(callback);
    };
    operations['aggregate.forEach'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.aggregate.apply(this, args).forEach(function (doc) {
            return callback(forEachIteration, doc);
        }, function (err) {
            return callback(err || forEachEnd);
        });
    };

    // We don't want to pass the listIndexes's cursor directly.
    delete operations.listIndexes;
    operations['listIndexes.toArray'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.listIndexes.apply(this, args).toArray(callback);
    };
    operations['listIndexes.forEach'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Collection.prototype.listIndexes.apply(this, args).forEach(function (doc) {
            return callback(forEachIteration, doc);
        }, function (err) {
            return callback(err || forEachEnd);
        });
    };

    // We don't want to pass the listCollections's cursor directly.
    delete operations.listCollections;
    operations['db.listCollections.toArray'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Db.prototype.listCollections.apply(this, args).toArray(callback);
    };
    operations['db.listCollections.forEach'] = function () {
        const args = Array.prototype.slice.call(arguments, 0);
        const callback = args.pop();
        mongodb.Db.prototype.listCollections.apply(this, args).forEach(
            function (doc) {
                return callback(forEachIteration, doc);
            },
            function (err) {
                return callback(err || forEachEnd);
            }
        );
    };

    operations.db = function (callback) {
        return callback(null, this);
    };

    operations.collection = function (callback) {
        return callback(null, this);
    };

    RED.nodes.registerType("mongodb3", function MongoConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.uri = '' + (n.uri || (n.defaultCredentials ? process.env.DEFAULT_MONGO_URI : ''));
        const user = this.credentials.user || (n.defaultCredentials ? process.env.DEFAULT_MONGO_USER : '');
        const password = this.credentials.password || (n.defaultCredentials ? process.env.DEFAULT_MONGO_PASSWORD : '');
        if (user || password) {
            this.uri = this.uri.replace(/^mongodb:\/\//, 'mongodb://' + encodeURIComponent(user) + ':' + encodeURIComponent(password) + '@');
        }
        this.name = n.name;
        this.parallelism = n.parallelism * 1;
        if (!!n.options) {
            try {
                this.options = JSON.parse(n.options);
            } catch (err) {
                this.error("Failed to parse options: " + err);
            }
        } else {
            this.options = {};
        }
        // enforce unified topology if not explicitly disabled
        if(this.options.useUnifiedTopology !== false) {
            this.options.useUnifiedTopology = true;
        } else {
            this.warn('using useUnifiedTopology = false is discouraged');
        }
        if (process.env.OVERRIDE_MONGO_OPTIONS && process.env.OVERRIDE_MONGO_OPTIONS.length > 0) {
            try {
                this.options = JSON.parse(process.env.OVERRIDE_MONGO_OPTIONS);
            } catch (err) {
                this.error("Failed to parse OVERRIDE_MONGO_OPTIONS: " + err);
            }
        }
        if (!this.options.checkServerIdentity && n.sslCheckViaCN) {
            // if configured use custom server identity check that checks for server identity
            // by checking if servername == CN
            this.options.checkServerIdentity = checkServerIdentity;
        }
        this.deploymentId = (1 + Math.random() * 0xffffffff).toString(16).replace('.', '');
    }, {
        "credentials": {
            "user": {
                "type": "text"
            },
            "password": {
                "type": "password"
            }
        }
    });

    RED.httpAdmin.get('/mongodb3/vcap', function (req, res) {
        res.json(services);
    });

    RED.httpAdmin.get('/mongodb3/operations', function (req, res) {
        res.json(Object.keys(operations).sort());
    });

    const mongoPool = {};

    function getClient(config) {
        let poolCell = mongoPool['#' + config.deploymentId];
        if(!config.uri) {
            return Promise.reject();
        }
        if (!poolCell) {
            class PoolCell {
                constructor(uri, options) {
                    this.instances = 0;
                    this.connection = null;
                    this.queue = [];
                    this.parallelOps = 0;
                    this.dbName = decodeURIComponent((uri.match(/^.*\/([^?]*)\??.*$/) || [])[1] || '');
                    this.options = options;
                }

                async _access_connection() {
                    if(!this.connection) {
                        // await connection and only keep it if initial connection did not fail
                        this.connection = await mongodb.MongoClient.connect(config.uri, configOptions);
                    }
                    return this.connection;
                }
                
                async runOp(coll, operation, args, callback) {
                    try {
                        const conn = await this._access_connection();
                        let applyOn = await conn.db(this.dbName);
                        if(coll) {
                            applyOn = applyOn.collection(coll);
                        }
                        operation.apply(applyOn, args.concat((err, response) => {
                            callback(err, response);
                        }));
                    } catch(err) {
                        throw err;
                    }
                }

                async closeConn(conn) {
                    try{
                        await conn.close();
                    } catch(err) {
                        console.error("Error while closing client: ", err);
                    }
                }

                async closeInternalConnections() {
                    if(this.connection) {
                        const conn = this.connection;
                        this.connection = null;
                        await this.closeConn(conn);
                    }
                }

            };
            const configOptions = config.options || {};
            poolCell = new PoolCell(config.uri, configOptions);
            mongoPool['#' + config.deploymentId] = poolCell;
        }
        poolCell.instances++;
        return Promise.resolve(poolCell);
    }

    function closeClient(config, client) {
        client.instances--;
        if (client.instances <= 0) {
            client.closeInternalConnections().finally(() => {
                if(mongoPool['#' + config.deploymentId] == client) {
                    // only really delete if the client in the pool is really ours
                    delete mongoPool['#' + config.deploymentId];
                }
            });
        }
    }

    RED.nodes.registerType("mongodb3 in", function MongoInputNode(n) {
        RED.nodes.createNode(this, n);
        this.configNode = n.configNode;
        this.collection = n.collection;
        this.operation = n.operation;
        this._closed = false;
        if (n.service == "_ext_") {
            // Refer to the config node's id, uri, options, parallelism and warn function.
            this.config = RED.nodes.getNode(this.configNode);
        } else if (n.service) {
            const configService = appEnv.getService(n.service);
            if (configService) {
                // Only a uri is defined.
                this.config = {
                    "deploymentId": 'service:' + n.service, // different from node-red deployment ids.
                    "uri": configService.credentials.uri || configService.credentials.url
                };
            }
        }
        if (!this.config || !(this.config.uri || this.config.defaultCredentials)) {
            this.error("missing mongodb3 configuration");
            return;
        }
        const node = this;

        // by default add error listener
        node.on('input', function (msg) {
            sendError(node, msg, "no connection to a database");
        });

        getClient(node.config).then(function (client) {
            let nodeOperation;
            node.client = client;
            if (node.operation) {
                nodeOperation = operations[node.operation];
            }
            // remove default listener
            node.removeAllListeners('input');
            node.on('input', function (msg) {
                if (node.config.parallelism && (node.config.parallelism > 0) && (client.parallelOps >= node.config.parallelism)) {
                    // msg cannot be handled right now - push to queue.
                    client.queue.push({
                        "node_id": node.id,
                        "msg": msg
                    });
                    return;
                }
                client.parallelOps += 1;
                setImmediate(function () {
                    handleMessage(msg);
                });
            });

            node.on('node-red-contrib-mongodb3 handleMessage', function (msg) {
                // see: messageHandlingCompleted
                setImmediate(function () {
                    handleMessage(msg);
                });
            });

            async function handleMessage(msg) {
                let operation = nodeOperation;
                if (!operation && msg.operation) {
                    operation = operations[msg.operation];
                }
                if (!operation) {
                    sendError(node, msg, "No operation defined");
                    return messageHandlingCompleted();
                }
                let collectionToUse;
                if (
                    operation != operations.db &&
                    operation != operations['db.listCollections.toArray'] &&
                    operation != operations['db.listCollections.forEach']
                ) {
                    collectionToUse = node.collection || msg.collection;
                    if (!collectionToUse) {
                        sendError(node, msg, "No collection defined");
                        return messageHandlingCompleted();
                    }
                }

                delete msg.collection;
                delete msg.operation;
                let args = msg.payload;
                if (!Array.isArray(args)) {
                    args = [args];
                }
                if (args.length === 0) {
                    // All operations can accept one argument (some can accept more).
                    // Some operations don't expect a single callback argument.
                    args.push(undefined);
                }
                if ((operation.length > 0) && (args.length > operation.length - 1)) {
                    // The operation was defined with arguments, thus it may not
                    // assume that the last argument is the callback.
                    // We must not pass too many arguments to the operation.
                    args = args.slice(0, operation.length - 1);
                }
                profiling.requests += 1;
                debounceProfilingStatus();
                client.runOp(collectionToUse, operation, args, function (err, response) {
                    if (err && (forEachIteration != err) && (forEachEnd != err)) {
                        profiling.error += 1;
                        debounceProfilingStatus();
                        sendError(node, msg, err);
                        return messageHandlingCompleted();
                    }
                    if (forEachEnd != err) {
                        if (!!response) {
                            // Some operations return a Connection object with the result.
                            // Passing this large connection object might be heavy - it will
                            // be cloned over and over by Node-RED, and there is no reason
                            // the typical user will need it.
                            // The mongodb package does not export the Connection prototype-function.
                            // Instead of loading the Connection prototype-function from the
                            // internal libs (which might change their path), I use the fact
                            // that it inherits EventEmitter.
                            if (response.connection instanceof EventEmitter) {
                                delete response.connection;
                            }
                            if (response.result && response.result.connection instanceof EventEmitter) {
                                delete response.result.connection;
                            }
                        }
                        
                        if(!Array.isArray(response)) {
                            // `response` is an instance of CommandResult, and does not seem to have the standard Object methods, 
                            // which means that some props are not correctly being forwarded to msg.payload (eg "ops" ouputted from `insertOne`)
                            // cloning the object fixes that.							
                            response = Object.assign({}, response);
                            // response.message includes info about the DB op, but is large and never used (like the connection)
                            delete response.message;
                        }

                        // send msg (when err == forEachEnd, this is just a forEach completion).
                        if (forEachIteration == err) {
                            // Clone, so we can send the same message again with a different payload
                            // in each iteration.
                            const messageToSend = RED.util.cloneMessage(msg);
                            messageToSend.payload = response;
                            sendMsg(node, messageToSend);
                        } else {
                            // No need to clone - the same message will not be sent again.
                            msg.payload = response;
                            sendMsg(node, msg);
                        }
                    }
                    if (forEachIteration != err) {
                        // success, no error
                        // clear status
                        profiling.success += 1;
                        debounceProfilingStatus();
                        messageHandlingCompleted();
                    }
                }).catch(err => {
                    profiling.error += 1;
                    debounceProfilingStatus();
                    sendError(node, msg, err);
                    messageHandlingCompleted();
                });
            }
            function messageHandlingCompleted() {
                setImmediate(handlePendingMessageOnDemand);
            }
            function handlePendingMessageOnDemand() {
                while (client.queue.length > 0) {
                    const pendingMessage = client.queue.shift();
                    const targetNode = RED.nodes.getNode(pendingMessage.node_id);
                    if (!targetNode) {
                        // The node was removed before handling the pending message.
                        // This is just a warning because a similar scenario can happen if
                        // a node was removed just before handling a message that was sent
                        // to it.
                        const warningMessage = "Node " + pendingMessage.node_id + " was removed while having a pending message";
                        if (node.config.warn) {
                            // The warning will appear from the config node, because the target
                            // node cannot be found.
                            node.config.warn(warningMessage, pendingMessage.msg);
                        } else {
                            // If the node was configured with a service instead of a config node,
                            // the warning will appear from the current node.
                            // This shouldn't happen in real life because in such scenario
                            // the parallelism limit is not configured.
                            node.warn(warningMessage, pendingMessage.msg);
                        }
                        continue;
                    }
                    // Handle the pending message.
                    if (!targetNode.emit('node-red-contrib-mongodb3 handleMessage', pendingMessage.msg)) {
                        // Safety check - if emit() returned false it means there are no listeners to the event.
                        // Was the target node closed?
                        // This shouldn't happen normally, but if it does, we must try to handle the next message in the queue.
                        const errorMessage = "Node " + pendingMessage.node_id + " could not handle the pending message";
                        if (node.config.error) {
                            node.config.error(errorMessage, pendingMessage.msg);
                        } else {
                            sendError(node, pendingMessage.msg, errorMessage)
                        }
                        continue;
                    }
                    // Another message is being handled. The number of parallel ops does not change.
                    return;
                }
                // The queue is empty. The number of parallel ops has reduced.
                if (client.parallelOps <= 0) {
                    sendError(node, undefined, "Something went wrong with node-red-contrib-mongodb3 parallel-ops count");
                    return
                }
                client.parallelOps -= 1;
            }
        }).catch((err) => {
            // Failed to create db client
            sendError(node, undefined, err);
        });

        const profiling = {
            "requests": 0,
            "success": 0,
            "error": 0
        };
        function profilingStatus() {
            node.status({
                "fill": "yellow",
                "shape": "dot",
                "text": "" + profiling.requests + ", success: " + profiling.success + ", error: " + profiling.error
            });
        }

        let debouncer = null;
        function debounceProfilingStatus() {
            if (debouncer) {
                return;
            }
            // show curent status, create debouncer.
            profilingStatus();
            debouncer = setTimeout(function () {
                profilingStatus(); // should we call only if there was a change?
                debouncer = null;
            }, 1000);
        }
        node.on('close', function () {
            node._closed = true;
            if (node.config) {
                closeClient(node.config, node.client);
            }
            node.removeAllListeners('node-red-contrib-mongodb3 handleMessage');
            if (debouncer) {
                clearTimeout(debouncer);
            }
        });
    });
};
