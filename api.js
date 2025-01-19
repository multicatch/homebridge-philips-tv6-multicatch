const request = require("request");

class ApiConfig {
    constructor(config) {
        this.wol_url = config.wol_url;
        this.api_url = config.api_url;
        this.username = config.username;
        this.password = config.password;
        this.api_timeout = config.api_timeout || 3000;
    }
}

class Api {
    constructor(log, config) {
        this.log = log;
        this.config = new ApiConfig(config);
    }

    call(method, path, requestBody = null) {
        const baseURL = this.config.api_url;
        const url = `${baseURL}${path}`;
        const body = typeof requestBody === "object" ? JSON.stringify(requestBody) : requestBody;
        const auth = {
            user: this.config.username,
            pass: this.config.password,
            sendImmediately: false
        };
        const timeout = this.config.api_timeout;

        return new Promise((success, fail) => {
            this.log.debug("[%s %s] Request to TV: %s", method, url, requestBody);
            request({
                rejectUnauthorized: false,
                timeout,
                auth,
                method,
                body,
                url
            }, (error, _response, body) => {
                if (error) {
                    this.log.debug("[%s %s] Request error %s", method, url, error);
                    fail(error);
                } else {
                    this.log.debug("[%s %s] Response from TV %s", method, url, body);
                    if (body && (body.indexOf("{") !== -1 || body.indexOf("[") !== -1)) {
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

}

export default Api;