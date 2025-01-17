const request = require("request");
const wol = require('wake_on_lan');

class PhilipsTV {
    api = null;
    channelList = [];
    volume = {
        min: 0,
        max: 60,
        current: 3,
        muted: false
    };
    powerstate = false;
    ambilight = {
        styleName: "Lounge light",
        isExpert: false,
        menuSetting: "ISF",
        stringValue: "Warm White"
    };

    constructor(log, config) {
        const wolURL = config.wol_url;
        const baseURL = `https://${config.ip_address}:1926/6/`;

        this.log = log;
        this.api = (path, body = null) => {
            return new Promise((success, fail) => {
                log("Request to TV %s %s", path, body);
                request({
                    rejectUnauthorized: false,
                    timeout: 3000,
                    auth: {
                        user: config.username,
                        pass: config.password,
                        sendImmediately: false
                    },
                    method: body ? "POST" : "GET",
                    body: typeof body === "object" ? JSON.stringify(body) : body,
                    url: `${baseURL}${path}`
                }, (error, response, body) => {
                    if (error) {
                        log("Request error %s", error);
                        fail(error);
                    } else {
                        log("Response from TV %s", body);
                        if (body && body.indexOf("{") !== -1) {
                            try {
                                success(JSON.parse(body))
                            } catch (e) {
                                fail(e);
                            }
                        } else {
                            success({});
                        }
                    }
                })
            })
        };

        this.wake = (callback) => {
            if (!wolURL) {
                log("WOL disabled.")
                callback(null, "EMPTY");
                return;
            }
            if (wolURL.substring(0, 3).toUpperCase() === "WOL") {
                //Wake on lan request
                const macAddress = wolURL.replace(/^WOL[:]?[\/]?[\/]?/ig, "");
                log("Attempting WOL %s", macAddress)
                wol.wake(macAddress, function (error) {
                    if (error) {
                        log("WOL failed: %s", error)
                        callback(error);
                    } else {
                        callback(null, "OK");
                    }
                });
            } else {
                if (wolURL.length > 3) {
                    callback(new Error("Unsupported protocol: ", "ERROR"));
                } else {
                    callback(null, "EMPTY");
                }
            }
        };
    }

    getPowerState = (callback) => {
        this.api("powerstate").then((data) => {
            this.powerstate = data.powerstate === "On";
            callback && callback(null, this.powerstate)
        }).catch((e) => {
            callback && callback(null, this.powerstate)
        })
    };

    setPowerState = (value, callback) => {
        this.wake((error, wolState) => {
            this.api("powerstate", {
                powerstate: value ? "On" : "Standby"
            }).then((data) => {
                this.powerstate = value;
                callback(null, value)
            }).catch(() => {
                callback(null, this.powerstate)
            }); 
        });
    };

    sendKey = key => this.api("input/key", {key});
    setChannel = ccid => this.api("activities/tv", {channel: {ccid}, channelList: {id: "allsat"}});
    launchApp = app => this.api("activities/launch", app);
    getChannelList = () => this.api("channeldb/tv/channelLists/all").then((response) => {
        if (response) {
            return response.Channel;
        }
        return [];
    });
    presetToCCid = async preset => {
        if (!this.channelList.length) {
            this.channelList = await this.getChannelList();
        }
        const channel = this.channelList.filter(item => parseInt(item.preset) === parseInt(preset)).pop();
        return channel ? channel.ccid : 0;
    };

    getCurrentSource = (inputs) => {
        return new Promise(async (resolve, reject) => {
            try {
                const current = await this.api("activities/current");
                const currentPkgname = current.component.packageName;
                let currentTvPreset = 0;
                let selected = 0;
                if (currentPkgname === "org.droidtv.channels" || currentPkgname === "org.droidtv.playtv") {
                    const currentTV = await this.api("activities/tv");
                    currentTvPreset = parseInt(currentTV.channel.preset, 10);
                }
                inputs.forEach((item, index) => {
                    if (currentTvPreset && item.channel === currentTvPreset) {
                        selected = index
                    } else if (item.launch && item.launch.intent && item.launch.intent.component.packageName === currentPkgname) {
                        selected = index
                    }
                });
                resolve(selected)
            } catch (e) {
                resolve(0)
            }
        })
    };

    setSource = async (input, callback) => {
        if (input.channel) {
            await this.sendKey("WatchTV");
//            await this.sendKey("Digit" + input.channel);
//            await this.sendKey("Confirm");
            const ccid = await this.presetToCCid(input.channel);
            await this.setChannel(ccid);
        } else if (input.launch) {
            await this.launchApp(input.launch);
        } else {
            await this.sendKey("WatchTV");
        }
        callback(null);
    };

    getAmbilightState = (callback) => {
        this.api("ambilight/power").then((data) => {
            callback(null, data.power === "On")
        }).catch(() => {
            callback(null, false)
        })
    };

    getVolumeState = (callback) => {
        this.api("audio/volume").then((data) => {
            this.volume = {
                ...this.volume,
                ...data
            };
            callback(null, this.calculateCurrentVolume())
        }).catch(() => {
            callback(null, this.calculateCurrentVolume())
        })
    };

    calculateCurrentVolume = () => {
        let maxRange = this.volume.max - this.volume.min;
        if (maxRange <= 0) {
            maxRange = 1;
        }
        return Math.floor((1.0 * (this.volume.current - this.volume.min) / maxRange) * 100);
    };

    setVolumeState = (value, callback) => {
        this.api("audio/volume", this.volume).then(() => {
            this.volume.current = Math.round(this.volume.min + (this.volume.max - this.volume.min) * (value / 100.0));
            callback(null, this.calculateCurrentVolume());
        }).catch(() => {
            callback(null, this.calculateCurrentVolume());
        });
    };

    getMuteState = (callback) => {
        this.api("audio/volume").then(() => {
            this.volume = {
                ...this.volume,
                ...data
            };
            callback(null, this.volume.muted);
        }).catch(() => {
            callback(null, this.volume.muted);
        })
    };

    setMuteState = (ignoredValue, callback) => {
        this.getMuteState((ignored, value) => {
            this.api("audio/volume", this.volume).then(() => {
                this.volume.muted = !value;
                callback(null, this.volume.muted);
            }).catch(() => {
                callback(null, this.volume.muted);
            });
        });
    };

    setAmbilightState = (value, callback) => {
        if (value) {
            this.api("ambilight/currentconfiguration", this.ambilight).then((data) => {
                this.api("ambilight/power", {
                    power: "On"
                }).then((ignored) => {
                    callback(null, true)
                }).catch(() => {
                    callback(null, false)
                })
            }).catch(() => {
                callback(null, false)
            });
        } else {
            this.api("ambilight/currentconfiguration").then((data) => {
                this.ambilight = {...data};
                this.api("ambilight/power", {
                    power: "Off"
                }).then((data) => {
                    callback(null, false)
                }).catch(() => {
                    callback(null, false)
                });
            })
        }
    }
}

module.exports = PhilipsTV;
