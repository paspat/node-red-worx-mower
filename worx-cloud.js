const awsIot = require("aws-iot-device-sdk");
const axios = require("axios").default;

const tough = require("tough-cookie");
const { HttpsCookieAgent } = require("http-cookie-agent/http");

const nodeapp = require('./package');
const EventEmitter = require('events').EventEmitter

const { v4: uuidv4 } = require("uuid");

const pingMqtt = false;

class WorxCloudConsoleLogger {
    
    error(msg){
        this.log('ERROR',msg);
    }
    
    debug(msg){
        this.log('DEBUG',msg);
    }
    
    info(msg){
        this.log('INFO',msg);
    }
    
    warn(msg){
        this.log('WARN',msg);
    }
    
    log(level, msg){
        var now = new Date();
        var date_string = now.getFullYear();
        date_string+='-'+('0' + now.getMonth()+1).slice(-2);
        date_string+='-'+('0' + now.getDate()).slice(-2);
        date_string+=' '+('0' + now.getHours()).slice(-2);
        date_string+=':'+('0' + now.getMinutes()).slice(-2);
        date_string+=':'+('0' + now.getSeconds()).slice(-2);
        console.log(date_string + ' ' + level + ' ' + msg);
    }
    
}

class WorxCloud extends EventEmitter {
    
        constructor(options) {
            super({
                ...options,
                name: "WorxLandroid",
            });
            
            this.appName = "NodeRedWorxLandroid";
            
            this.deviceArray = [];
            this.modules = {};
            this.userAgent = this.appName+" "+nodeapp.version;
            
            this.session = {};
            this.mqttC = {};
            this.mqtt_response_check = {};
            
            if(!options.logger) {
                this.log = new WorxConsoleLogger();
            }else{
                this.log = options.logger;
            }
            
            this.cookieJar = new tough.CookieJar();
            
            this.requestClient = axios.create({
                withCredentials: true,
                httpsAgent: new HttpsCookieAgent({
                    cookies: {
                        jar: this.cookieJar,
                    },
                }),
            });
            
            this.config = {
                server: options.server,
                mail: options.mail,
                password: options.password
            }
    
            this.clouds = {
                worx: {
                    url: "api.worxlandroid.com",
                    loginUrl: "https://id.worx.com/",
                    clientId: "150da4d2-bb44-433b-9429-3773adc70a2a",
                    redirectUri: "com.worxlandroid.landroid://oauth-callback/",
                    mqttPrefix: "WX",
                },
                kress: {
                    url: "api.kress-robotik.com",
                    loginUrl: "https://id.kress.com/",
                    clientId: "931d4bc4-3192-405a-be78-98e43486dc59",
                    redirectUri: "com.kress-robotik.mission://oauth-callback/",
                    mqttPrefix: "KR",
                },
                landxcape: {
                    url: "api.landxcape-services.com",
                    loginUrl: "https://id.landxcape-services.com/",
                    clientId: "dec998a9-066f-433b-987a-f5fc54d3af7c",
                    redirectUri: "com.landxcape-robotics.landxcape://oauth-callback/",
                    mqttPrefix: "LX",
                },
                ferrex: {
                    url: "api.watermelon.smartmower.cloud",
                    loginUrl: "https://id.watermelon.smartmower.cloud/",
                    clientId: "10078D10-3840-474A-848A-5EED949AB0FC",
                    redirectUri: "cloud.smartmower.watermelon://oauth-callback/",
                    mqttPrefix: "FE",
                },
            };
            
        }
        
        async login() {
            //Simple login
            const data = await this.requestClient({
                url: this.clouds[this.config.server].loginUrl + "oauth/token",
                method: "post",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                    "accept-language": "de-de",
                },
                data: JSON.stringify({
                    client_id: this.clouds[this.config.server].clientId,
                    username: this.config.mail,
                    password: this.config.password,
                    scope: "*",
                    grant_type: "password",
                }),
            })
                .then((response) => {
                    this.log.debug(JSON.stringify(response.data));
                    this.session = response.data;
                    this.log.debug(`Connected to ${this.config.server} server`);
                })
                .catch((error) => {
                    if(error.response)
                        this.log.error(error.response.data);
                    else
                        this.log.error(error);
                    this.emit('login_failed', error.response.data);
                });
            return data;
        }
    
        async getDeviceList() {
            await this.requestClient({
                method: "get",
                url: `https://${this.clouds[this.config.server].url}/api/v2/product-items?status=1&gps_status=1`,
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                    authorization: "Bearer " + this.session.access_token,
                    "accept-language": "de-de",
                },
            })
                .then(async (res) => {
                    this.log.debug(`Found ${res.data.length} devices`);
                    for (const device of res.data) {
                        const id = device.serial_number;
                        this.modules[device.serial_number] = {};
                        this.modules[device.serial_number]["edgeCut"] = false;
                        const name = device.name;
                        this.log.debug(`Found device ${name} with id ${id}`);

                        this.deviceArray.push(device);
                    }
                })
                .catch((error) => {
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        }
        
        async refreshToken() {
            this.log.debug("Refresh token");
            await this.requestClient({
                url: this.clouds[this.config.server].loginUrl + "oauth/token?",
                method: "post",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                    "accept-language": "de-de",
                },
                data: JSON.stringify({
                    client_id: this.clouds[this.config.server].clientId,
                    scope: "user:profile mower:firmware mower:view mower:pair user:manage mower:update mower:activity_log user:certificate data:products mower:unpair mower:warranty mobile:notifications mower:lawn",
                    refresh_token: this.session.refresh_token,
                    grant_type: "refresh_token",
                }),
            })
                .then((response) => {
                    this.log.debug(JSON.stringify(response.data));
                    this.session = response.data;
                    if (this.mqttC) {
                        this.mqttC.updateCustomAuthHeaders(this.createWebsocketHeader());
                    } else {
                        this.log.debug("Cannot update token for MQTT connection. MQTT Offline!");
                    }
                })
                .catch((error) => {
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        }
            
        async apiRequest(path, withoutToken, method, data) {
            const headers = {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": this.userAgent,
                "accept-language": "de-de",
            };
            if (!withoutToken) {
                headers["authorization"] = "Bearer " + this.session.access_token;
            }
            return await this.requestClient({
                method: method || "get",
                url: `https://${this.clouds[this.config.server].url}/api/v2/${path}`,
                headers: headers,
                data: data || null,
            })
                .then(async (res) => {
                    this.log.debug(JSON.stringify(res.data));
                    if (method === "PUT") {
                        this.log.debug(JSON.stringify(res.data));
                    }
                    return res.data;
                })
                .catch((error) => {
                    this.log.error(error);
                    if (error.response) {
                        if (error.response.status === 401) {
                            error.response && this.log.debug(JSON.stringify(error.response.data));
                            this.log.debug(path + " receive 401 error. Refresh Token in 30 seconds");
                            this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
                            this.refreshTokenTimeout = setTimeout(() => {
                                this.refreshToken();
                            }, 1000 * 30);
                            return;
                        }
                        this.log.error(JSON.stringify(error.response.data));
                    }
                });
        }
        
        
        async start_mqtt() {
            if (this.deviceArray.length === 0) {
                this.log.warn("No mower found to start mqtt");
                return;
            }

            this.userData = await this.apiRequest("users/me", false);
            this.connectMqtt();
        }
        
        stop_mqtt(done) {
            this.disconnectMqtt(done);
        }
        
        disconnectMqtt(done) {
            if(this.mqttC) {
                try{
                    this.mqttC.end(done);
                }catch(error){
                    done();
                }
            }
        }

        connectMqtt() {
            try {
                const uuid = this.deviceArray[0].uuid || uuidv4();
                const mqttEndpoint = this.deviceArray[0].mqtt_endpoint || "iot.eu-west-1.worxlandroid.com";
                if (this.deviceArray[0].mqtt_endpoint == null) {
                    this.log.warn(`Cannot read mqtt_endpoint use default`);
                }
                const headers = this.createWebsocketHeader();
                let region = "eu-west-1";

                const split_mqtt = mqttEndpoint.split(".");
                if (split_mqtt.length === 3) {
                    region = split_mqtt[2];
                }
                this.userData["mqtt_endpoint"] = mqttEndpoint;
                this.mqttC = awsIot.device({
                    clientId: `${this.clouds[this.config.server].mqttPrefix}/USER/${this.userData.id}/${this.appName}/${uuid}`,
                    username: this.appName,
                    protocol: "wss-custom-auth",
                    host: mqttEndpoint,
                    region: region,
                    customAuthHeaders: headers,
                    baseReconnectTimeMs: 1000,
                });

                this.mqttC.on("offline", () => {
                    this.CloudOnline = false;
                    this.emit('mqtt_disconnect');
                    this.log.debug("Worxcloud MQTT offline");
                });

                this.mqttC.on("end", () => {
                    this.log.debug("mqtt end");
                });

                this.mqttC.on("close", () => {
                    this.CloudOnline = false;
                    this.emit('mqtt_disconnect');
                    this.log.debug("mqtt closed");
                });

                this.mqttC.on("disconnect", (packet) => {
                    this.CloudOnline = false;
                    this.emit('mqtt_disconnect');
                    this.log.debug("MQTT disconnect" + packet);
                });

                this.mqttC.on("connect", () => {
                    this.CloudOnline = true;
                    this.emit('mqtt_connect');
                    this.log.debug("MQTT connected to: " + this.userData.mqtt_endpoint);
                    this.mqtt_blocking = 0;
                    this.mqtt_restart && clearTimeout(this.mqtt_restart);
                    for (const mower of this.deviceArray) {
                        this.log.debug("Worxcloud MQTT subscribe to " + mower.mqtt_topics.command_out);
                        this.mqttC.subscribe(mower.mqtt_topics.command_out, { qos: 1 });
                        this.mqttC.publish(mower.mqtt_topics.command_in, "{}", { qos: 1 });
                        if (pingMqtt) {
                            this.pingToMqtt(mower);
                        }
                    }
                });

                this.mqttC.on("reconnect", () => {
                    this.log.debug("MQTT reconnect");
                    ++this.mqtt_blocking;
                    if (this.mqtt_blocking > 10) {
                        this.log.warn(
                            "Maybe your connection is blocked from Worx or your worx is offline. Restart Mqtt connection automatic in 24h",
                        );
                        this.mqttC.end();
                        this.mqtt_restart = setTimeout(async () => {
                            this.log.debug("Restart Mqtt after 1h");
                            this.start_mqtt();
                        }, 1 * 60 * 1000 * 60); // 1 hour
                    }
                });

                this.mqttC.on("message", async (topic, message) => {
                    this.CloudOnline = true;
                    this.emit('mqtt_connect');
                    this.log.debug("NEW Message for "+topic+": "+message);
                    const data = JSON.parse(message);
                    this.mqtt_blocking = 0;
                    const mower = this.deviceArray.find((mower) => mower.mqtt_topics.command_out === topic);
                    const merge = this.deviceArray.findIndex((merge) => merge.mqtt_topics.command_out === topic);

                    if (mower) {
                        this.log.debug(
                            "Worxcloud MQTT get Message for mower " + mower.name + " (" + mower.serial_number + ")"
                        );
                        this.emit('mqtt', mower.serial_number, data);
                        try {
                            if (this.mqtt_response_check[data.cfg.id]) {
                                this.log.debug(`Request ID ${data.cfg.id} has been passed to the mower`);
                                delete this.mqtt_response_check[data.cfg.id];
                            } else if (data.cfg.id > 1) {
                                this.log.debug(`Response ID ${data.cfg.id} from mower`);
                            }
                        } catch (error) {
                            this.log.debug(`this.mqttC.on: ${error}`);
                        }
                        try {
                            if (!mower || !mower.last_status || !mower.last_status.payload) {
                                this.log.debug("No last_status found");
                                mower.last_status = {};
                                this.log.debug("Reset last_status");
                            } else {
                                this.log.debug("Set new timestamp");
                                try {
                                    if (merge) {
                                        this.deviceArray[merge].last_status.payload = data;
                                    }
                                } catch (error) {
                                    this.log.debug("Update deviceArray: " + error);
                                }
                                mower.last_status.payload = data;
                                mower.last_status.timestamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                                    .toISOString()
                                    .replace("T", " ")
                                    .replace("Z", "");
                            }
                        } catch (error) {
                            this.log.debug("Mqtt Delete last_status: " + error);
                        }
                        if (pingMqtt) {
                            this.pingToMqtt(mower);
                        }
                    } else {
                        this.log.debug("Worxcloud MQTT could not find mower topic in mowers");
                    }
                });

                this.mqttC.on("error", (error) => {
                    this.log.error("MQTT ERROR: " + error);
                });
            } catch (error) {
                this.log.error("MQTT ERROR: " + error);
                this.mqttC = {};
            }
        }
        
        async sendMessage(message, serial, command) {            
            /*if (serial == null) {
                this.log.error("please give a serial number!");
            }

            const mower = this.deviceArray.find((mower) => mower.serial_number === serial);*/

            for (const mower of this.deviceArray) {
                if ((serial==null || serial==="") || mower.serial_number==serial) {
                    this.log.debug("Worxcloud MQTT sendMessage to " + mower.serial_number + " Message: " + message);
                    if (this.mqttC) {
                        try {
                            this.log.debug(`length:  ${Object.keys(this.mqtt_response_check).length}`);
                            if (Object.keys(this.mqtt_response_check).length > 50) {
                                this.cleanup_json();
                            }
                            const data = await this.sendPing(mower, true, JSON.parse(message));
                            this.mqtt_response_check[data.id] = data;
                            this.log.debug(`this.mqtt_response_check:  ${JSON.stringify(this.mqtt_response_check)}`);
                            this.mqttC.publish(mower.mqtt_topics.command_in, JSON.stringify(data), { qos: 1 });
                        } catch (error) {
                            this.log.debug(`sendMessage normal:  ${error}`);
                            this.mqttC.publish(mower.mqtt_topics.command_in, message, { qos: 1 });
                        }
                    } else {
                        //  this.log.debug("Send via API");
                        //this.apiRequest("product-items", false, "PUT", message);
                    }
                } else {
                    this.log.error("Try to send a message but could not find the mower");
                }
            }
        }
        
        pingToMqtt(mower) {
            const mowerSN = mower.serial_number ? mower.serial_number : "";
            this.pingInterval[mowerSN] && clearTimeout(this.pingInterval[mowerSN]);
            this.log.debug("Reset ping");
            this.pingInterval[mowerSN] = setInterval(() => {
                this.sendPing(mower);
            }, ping_interval);
        }

        createWebsocketHeader() {
            const accessTokenParts = this.session.access_token.replace(/_/g, "/").replace(/-/g, "+").split(".");
            const headers = {
                "x-amz-customauthorizer-name": "com-worxlandroid-customer",
                "x-amz-customauthorizer-signature": accessTokenParts[2],
                jwt: `${accessTokenParts[0]}.${accessTokenParts[1]}`,
            };
            return headers;
        }

        async sendPing(mower, no_send, merge_message, command) {
            const language =
                mower.last_status &&
                mower.last_status.payload &&
                mower.last_status.payload.cfg &&
                mower.last_status.payload.cfg.lg
                    ? mower.last_status.payload.cfg.lg
                    : "de";
            const mowerSN = mower.serial_number;
            const now = new Date();
            const message = {
                id: 1024 + Math.floor(Math.random() * (65535 - 1025)),
                cmd: 0,
                lg: language,
                sn: mowerSN,
                // Important: Send the time in your local timezone, otherwise mowers clock will be wrong.
                tm: `${("0" + now.getHours()).slice(-2)}:${("0" + now.getMinutes()).slice(-2)}:${(
                    "0" + now.getSeconds()
                ).slice(-2)}`,
                dt: `${("0" + now.getDate()).slice(-2)}/${("0" + (now.getMonth() + 1)).slice(-2)}/${now.getFullYear()}`,
                ...merge_message,
            };
            this.log.debug("Start MQTT ping: " + JSON.stringify(message));
            if (no_send) {
                return message;
            } else {
                this.sendMessage(JSON.stringify(message), mowerSN, command);
            }
        }

        async sendCommand(value, mower, id) {
            const val = value;
            if (val < 0 || val > 9) {
                this.log.debug(`Sending cmd:${val} is not allowed.`);
                return;
            }
            this.log.debug(`Send cmd:${val}`);
            this.sendMessage(`{"cmd":${val}}`, mower.serial_number, id);
        }
        
        async start() {
            await this.login();
            if (this.session.access_token) {
                await this.getDeviceList();
                
                this.log.debug("Start MQTT connection");
                await this.start_mqtt();
                
                this.refreshTokenInterval = setInterval(() => {
                    this.refreshToken();
                }, (this.session.expires_in - 100) * 1000);
            }
        }
        
        stop(done) {
            this.stop_mqtt(done);
        }
}

module.exports = WorxCloud;
