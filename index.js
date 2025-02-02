"use strict";
const pkg = require("./package.json");
const PhilipsTV = require("./PhilipsTV.js");
const pluginName = pkg.name;
const accessoryName = "PhilipsTV";
let Service, Characteristic;

class PhilipsTvAccessory {
  state = {
    power: true,
    ambilight: true,
    source: 0,
    volume: 0,
  };

  config = {};
  services = [];
  tvService = null;

  constructor(log, config) {
    this.config = { ...this.config, ...config };
    this.PhilipsTV = new PhilipsTV(log, config);

    this.registerAccessoryInformationService();
    this.registerTelevisionService();
    this.registerVolumeService();

    if (config.has_ambilight) {
      this.registerAmbilightService();
    }
    if (config.inputs) {
      this.registerInputService();
    }
  }

  identify(callback) {
    callback(); // success
  }

  registerAccessoryInformationService = () => {
    const { name, model_year } = this.config;
    const { Name, Manufacturer, Model, FirmwareRevision } = Characteristic;

    const infoService = new Service.AccessoryInformation();
    infoService
      .setCharacteristic(Name, name)
      .setCharacteristic(Manufacturer, "Philips")
      .setCharacteristic(Model, "Year " + model_year)
      .setCharacteristic(FirmwareRevision, pkg.version);
    this.services.push(infoService);
  };

  registerTelevisionService = () => {
    const { name, poll_status_interval } = this.config;
    const { ConfiguredName, SleepDiscoveryMode, Active } = Characteristic;
    const tvService = new Service.Television(name, "Television");
    const power = tvService.getCharacteristic(Active);

    tvService.setCharacteristic(ConfiguredName, name);
    tvService.setCharacteristic(
      SleepDiscoveryMode,
      SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );
    power.on("get", this.PhilipsTV.getPowerState);
    power.on("set", (value, callback) => {
      this.PhilipsTV.setPowerState(value, (param, newState) => {
        this.state.power = newState;
        power.updateValue(newState);
        callback(param, newState);
      })
    });

    tvService
      .getCharacteristic(Characteristic.RemoteKey)
      .on("set", (value, callback) => {
        switch (value) {
          case Characteristic.RemoteKey.PLAY_PAUSE:
            this.PhilipsTV.sendKey("PlayPause");
            break;
          case Characteristic.RemoteKey.BACK:
            this.PhilipsTV.sendKey("Back");
            break;
          case Characteristic.RemoteKey.ARROW_UP:
            this.PhilipsTV.sendKey("CursorUp");
            break;
          case Characteristic.RemoteKey.ARROW_DOWN:
            this.PhilipsTV.sendKey("CursorDown");
            break;
          case Characteristic.RemoteKey.ARROW_LEFT:
            this.PhilipsTV.sendKey("CursorLeft");
            break;
          case Characteristic.RemoteKey.ARROW_RIGHT:
            this.PhilipsTV.sendKey("CursorRight");
            break;
          case Characteristic.RemoteKey.SELECT:
            this.PhilipsTV.sendKey("Confirm");
            break;
          case Characteristic.RemoteKey.EXIT:
            this.PhilipsTV.sendKey("Exit");
            break;
          case Characteristic.RemoteKey.INFORMATION:
            this.PhilipsTV.sendKey("Info");
            break;
        }
        callback(null);
      });

    if (poll_status_interval) {
      setInterval(() => {
        this.PhilipsTV.getPowerState((err, value) => {
          if (this.state.power !== value) {
            this.state.power = value;
            power.updateValue(value);
          }
        });
      }, poll_status_interval * 1000);
    }

    this.tvService = tvService;
    this.services.push(tvService);
  };

  registerInputService = () => {
    const { inputs } = this.config;
    const { ActiveIdentifier } = Characteristic;

    this.tvService.setCharacteristic(ActiveIdentifier, 1);
    this.tvService
      .getCharacteristic(ActiveIdentifier)
      .on("get", (callback) => {
        this.PhilipsTV.getCurrentSource(inputs).then((source) => {
          this.state.source = source;
          callback(null, this.state.source);
        });
      })
      .on("set", (value, callback) => {
        this.state.source = value;
        const input = inputs[value];
        this.PhilipsTV.setSource(input, callback);
      });

    inputs.forEach((item, index) => {
      const input = this.createInputSource(item.name, item.name, index);
      this.tvService.addLinkedService(input);
      this.services.push(input);
    });
  };

  registerAmbilightService = () => {
    const { name, poll_status_interval } = this.config;

    this.ambilightService = new Service.Lightbulb(
      name + " Ambilight",
      "tvAmbilight"
    );
    const ambilightPower = this.ambilightService.getCharacteristic(
      Characteristic.On
    );
    ambilightPower
      .on("get", this.PhilipsTV.getAmbilightState)
      .on("set", (value, callback) => {
        this.state.ambilight = value;
        this.PhilipsTV.setAmbilightState(value, callback);
      });
    this.services.push(this.ambilightService);

    if (poll_status_interval) {
      setInterval(() => {
        this.PhilipsTV.getAmbilightState((err, value) => {
          if (this.state.ambilight !== value) {
            this.state.ambilight = value;
            ambilightPower.updateValue(value);
          }
        });
      }, poll_status_interval * 1000);
    }
  };

  registerVolumeService = () => {
    const { name, poll_status_interval } = this.config;

    this.volumeService = new Service.Fan(name + " Volume", "tvVolume");
    this.volumeService
      .getCharacteristic(Characteristic.On)
      .on("get", (callback) => {
        callback(null, 1);
      })
      .on("set", (value, callback) => {
        this.PhilipsTV.setMuteState(!value, callback)
      });
    const volumeLevel = this.volumeService.getCharacteristic(
      Characteristic.RotationSpeed
    );
    volumeLevel
      .on("get", this.PhilipsTV.getVolumeState)
      .on("set", (value, callback) => {
        this.state.volume = value;
        this.PhilipsTV.setVolumeState(value, callback);
      });
    if (poll_status_interval) {
      setInterval(() => {
        this.PhilipsTV.getVolumeState((err, value) => {
          if (this.state.volume !== value) {
            this.state.volume = value;
            volumeLevel.updateValue(value);
          }
        });
      }, poll_status_interval * 1000);
    }

    this.speakerService = new Service.TelevisionSpeaker(this.name + ' Volume', 'tvSpeakerService');
		this.speakerService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
		const muteCharacteristics = this.speakerService
			.getCharacteristic(Characteristic.Mute);

    muteCharacteristics
      .on('get', (callback) => this.PhilipsTV.getMuteState(callback))
			.on('set', (value, callback) => {
        this.PhilipsTV.setMuteState(value, (param, newState) => {
          muteCharacteristics.updateValue(newState);
          callback(param, newState);
        })
      });

    
		this.speakerService
			.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', (state, callback) => {
        this.PhilipsTV.sendKey(state ? "VolumeDown" : "VolumeUp");
        callback(null, null);
      });

		this.speakerService
		  .addCharacteristic(Characteristic.Volume)
			.on('get', this.PhilipsTV.getVolumeState)
			.on('set', (value, callback) => {
        this.state.volume = value;
        this.PhilipsTV.setVolumeState(value, callback);
      });

		this.tvService.addLinkedService(this.speakerService);
		this.services.push(this.speakerService);

    this.services.push(this.volumeService);
  };

  createInputSource(
    id,
    name,
    number,
    type = Characteristic.InputSourceType.TV
  ) {
    const { Identifier, ConfiguredName, IsConfigured, InputSourceType } =
      Characteristic;
    const input = new Service.InputSource(id, name);
    input
      .setCharacteristic(Identifier, number)
      .setCharacteristic(ConfiguredName, name)
      .setCharacteristic(IsConfigured, IsConfigured.CONFIGURED)
      .setCharacteristic(InputSourceType, type);
    return input;
  }

  getServices() {
    return this.services;
  }
}

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory(pluginName, accessoryName, PhilipsTvAccessory);
};
