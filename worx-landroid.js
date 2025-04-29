const path = require('path');

const WorxCloud = require(path.join(__dirname, '/worx-cloud.js'));

module.exports = function(RED) {

    function WorxLandroid(config){
        RED.nodes.createNode(this,config);
        var node = this;
        
        this.status({fill:"red",shape:"ring",text:"disconnected"});
        
        this.errors = {
            0: "No error",
            1: "Trapped",
            2: "Lifted",
            3: "Wire missing",
            4: "Outside wire",
            5: "Raining",
            6: "Close door to mow",
            7: "Close door to go home",
            8: "Blade motor blocked",
            9: "Wheel motor blocked",
            10: "Trapped timeout", // Not sure what this is
            11: "Upside down",
            12: "Battery low",
            13: "Reverse wire",
            14: "Charge error",
            15: "Timeout finding home" // Not sure what this is
        };

        this.states = {
            0: "Idle",
            1: "Home",
            2: "Start sequence",
            3: "Leaving home",
            4: "Follow wire",
            5: "Searching home",
            6: "Searching wire",
            7: "Mowing",
            8: "Lifted",
            9: "Trapped",
            10: "Blade blocked", // Not sure what this is
            11: "Debug",
            12: "Remote control",
            30: "Going home",
            32: "Border Cut",
            33: "Searching zone",
            34: "Pause"
        };
        
        this.on('close', function(done) {
            if(this.cloud){
                this.cloud.stop(done);
            }
        });
        
        this.on('input', function(msg, send, done) {
            var serial_number = msg.topic;
            var cmd = msg.payload;
            if(msg.payload && msg.payload.serial_number){
                serial_number = msg.payload.serial_number;
                cmd = msg.payload.cmd;
            }
            
            if(cmd){
                if(cmd==="start")
                    cmd = '{"cmd":1}';
                else if(cmd==="stop")
                    cmd = '{"cmd":3}';
                else if(cmd==="pause")
                    cmd = '{"cmd":2}';
                else if(cmd==="status")
                    cmd = '{}';
                this.cloud.sendMessage(cmd.toString(), serial_number);
            }
            
            if(done){
                done();
            }
        })
        

        this.account = RED.nodes.getNode(config.account);
        if(this.account && this.account.mail) {
            this.cloud = new WorxCloud({
                server: config.server || 'worx',
                mail: node.account.mail,
                password: node.account.password,
                logger: {
                    error: function(msg){
                        node.error(msg);
                    },
                    debug: function(msg){
                        node.debug(msg);
                    },
                    info: function(msg){
                        node.log(msg);
                    },
                    warn: function(msg){
                        node.warn(msg);
                    }
                }
            });
            
            this.cloud.on('mqtt_connect', function(){
                node.status({fill:"green",shape:"dot",text:"connected"});
            });
            
            this.cloud.on('mqtt_disconnect', function(){
                node.status({fill:"red",shape:"ring",text:"disconnected"});
            });
            
            this.cloud.on('login_failed', function(){
                node.status({fill:"red",shape:"ring",text:"disconnected"});
            });
            
            this.cloud.on('mqtt', function(serial_number, msg){
                var msg1 = {};
                msg1.serial_number = serial_number;
                
                if(msg.cfg){
                    if(msg.cfg.sc) {
                        msg1.active = msg.cfg.sc.m===1;
                        msg1.mowTimeExtended = msg.cfg.sc.p;
                        if(msg.cfg.sc.distm!=null && msg.cfg.sc.m!=null)
                            msg1.partyModus = msg.sc.m===2;
                    }
                    msg1.lastUpdate = msg.cfg.dt.substr(0,2) + "." + msg.cfg.dt.substr(3,2) + "." + msg.cfg.dt.substr(6,4) + " " + msg.cfg.tm;
                    msg1.rainWaitingTime = msg.cfg.rd;
                }
                
                if(msg.dat){
                    msg1.firmware = msg.dat.fw;
                    msg1.wifiQuality = msg.dat.rsi;
                    msg1.totalDistance = parseFloat(parseFloat(msg.dat.st.d/1000).toFixed(2));
                    msg1.totalTime = parseFloat(parseFloat(msg.dat.st.wt/60).toFixed(2));
                    msg1.totalBladeTime = parseFloat(parseFloat(msg.dat.st.b/60).toFixed(2));
                    //msg1.bladeTime = parseFloat(parseFloat(msg.dat.st.b/60 - bladeTimeReset).toFixed(2));
                    msg1.error = node.errors[msg.dat.le]
                    msg1.state = node.states[msg.dat.ls]

                    msg1.battery = {};
                    msg1.battery.level = msg.dat.bt.p;
                    msg1.battery.voltage = msg.dat.bt.v;
                    msg1.battery.temperature = msg.dat.bt.t;
                    msg1.battery.chargeCycle = msg.dat.bt.nr;
                    msg1.battery.charging = (msg.dat.bt.c) ? true : false;
                }
                
                
                if(msg.cfg && msg.cfg.sc){
                    if(msg.cfg.sc.d){
                        msg1.working_days = [
                            { name: "SU" },
                            { name: "MO" },
                            { name: "TU" },
                            { name: "WE" },
                            { name: "TH" },
                            { name: "FR" },
                            { name: "SA" }
                        ]
                        
                        var d;
                        var n;
                        var i;
                        for (i = 0; i < 7; i++) {
                            startTime = new Date("1970-01-01 "+ msg.cfg.sc.d[i][0]);
                            endTime = new Date(startTime.getTime() + (msg.cfg.sc.d[i][1]*60000));
                            msg1.working_days[i].start = ("0" + startTime.getHours()).slice(-2) + ":" + ("0" + startTime.getMinutes()).slice(-2);
                            msg1.working_days[i].end = ("0" + endTime.getHours()).slice(-2) + ":" + ("0" + endTime.getMinutes()).slice(-2);
                            msg1.working_days[i].borderCut = msg.cfg.sc.d[i][2] == 1;
                        }
                    }
                    if(msg.cfg.sc.dd){
                        msg1.working_days1 = [
                            { name: "SU" },
                            { name: "MO" },
                            { name: "TU" },
                            { name: "WE" },
                            { name: "TH" },
                            { name: "FR" },
                            { name: "SA" }
                        ]
                        
                        var d;
                        var n;
                        var i;
                        for (i = 0; i < 7; i++) {
                            startTime = new Date("1970-01-01 "+ msg.cfg.sc.dd[i][0]);
                            endTime = new Date(startTime.getTime() + (msg.cfg.sc.dd[i][1]*60000));
                            msg1.working_days1[i].start = ("0" + startTime.getHours()).slice(-2) + ":" + ("0" + startTime.getMinutes()).slice(-2);
                            msg1.working_days1[i].end = ("0" + endTime.getHours()).slice(-2) + ":" + ("0" + endTime.getMinutes()).slice(-2);
                            msg1.working_days1[i].borderCut = msg.cfg.sc.dd[i][2] == 1;
                        }
                    }
                }
                
                node.send({payload: msg1});
            });
            
            this.cloud.start();
        }
    }
    
    RED.nodes.registerType("worx-landroid",WorxLandroid);
}